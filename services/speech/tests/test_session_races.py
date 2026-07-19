from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path
from typing import Literal, cast

import pytest
from fastapi import WebSocket

from suits_speech.audio_queue import AckReservation, TtsJob
from suits_speech.config import SpeechSettings
from suits_speech.health import SpeechRuntime
from suits_speech.protocol import (
    AudioChunkControl,
    CancelUtteranceControl,
    TtsAudioEvent,
)
from suits_speech.providers.base import (
    AudioChunk,
    SynthesizedPhrase,
    TranscriptHypothesis,
)
from suits_speech.session import SpeechConnection, _SttFrame, _Utterance
from suits_speech.vad import EnergyVad


class _RecordingSocket:
    def __init__(self, *, block_text: bool = False, fail_bytes: bool = False) -> None:
        self.sent: list[str | bytes] = []
        self.closed: tuple[int, str] | None = None
        self.text_started = asyncio.Event()
        self.release_text = asyncio.Event()
        if not block_text:
            self.release_text.set()
        self.fail_bytes = fail_bytes

    async def send_text(self, value: str) -> None:
        self.text_started.set()
        await self.release_text.wait()
        self.sent.append(value)

    async def send_bytes(self, value: bytes) -> None:
        if self.fail_bytes:
            raise RuntimeError("simulated transport failure")
        self.sent.append(value)

    async def close(self, *, code: int = 1_000, reason: str = "") -> None:
        self.closed = (code, reason)


class _NoopSttSession:
    def __init__(self) -> None:
        self.cancel_calls = 0

    async def push_audio(self, chunk: AudioChunk) -> tuple[TranscriptHypothesis, ...]:
        del chunk
        return ()

    async def finish(self) -> TranscriptHypothesis:
        return TranscriptHypothesis(
            text="Final testimony.",
            is_final=True,
            confidence=1.0,
            audio_end_ms=20,
        )

    async def cancel(self) -> None:
        self.cancel_calls += 1


class _DeviceFailureSttSession(_NoopSttSession):
    async def push_audio(self, chunk: AudioChunk) -> tuple[TranscriptHypothesis, ...]:
        del chunk
        raise OSError("simulated device loss")


class _BarrierFinalSession(_NoopSttSession):
    def __init__(
        self,
        *,
        invalid: bool = False,
        suppress_cancel: bool = False,
        release_on_cancel: bool = False,
    ) -> None:
        super().__init__()
        self.invalid = invalid
        self.suppress_cancel = suppress_cancel
        self.release_on_cancel = release_on_cancel
        self.finish_started = asyncio.Event()
        self.finish_cancelled = asyncio.Event()
        self.release_finish = asyncio.Event()

    async def finish(self) -> TranscriptHypothesis:
        self.finish_started.set()
        try:
            await self.release_finish.wait()
        except asyncio.CancelledError:
            self.finish_cancelled.set()
            if not self.suppress_cancel:
                raise
            await self.release_finish.wait()
        return TranscriptHypothesis(
            text="" if self.invalid else "Final testimony.",
            is_final=True,
            confidence=1.0,
            audio_end_ms=20,
        )

    async def cancel(self) -> None:
        await super().cancel()
        if self.release_on_cancel:
            self.release_finish.set()


def _settings(tmp_path: Path, **overrides: str) -> SpeechSettings:
    environ = {
        "SUITS_SPEECH_MODE": "fake",
        "SUITS_SPEECH_ALLOWED_ORIGINS": "http://testserver",
        "SUITS_SPEECH_CACHE_DIR": str(tmp_path),
    }
    environ.update(overrides)
    return SpeechSettings.from_env(environ)


def _connection(
    tmp_path: Path,
    *,
    socket: _RecordingSocket | None = None,
    **overrides: str,
) -> tuple[SpeechConnection, _RecordingSocket]:
    resolved_socket = socket or _RecordingSocket()
    runtime = SpeechRuntime(settings=_settings(tmp_path, **overrides))
    connection = SpeechConnection(
        websocket=cast(WebSocket, resolved_socket),
        runtime=runtime,
    )
    connection._hello_received = True
    return connection, resolved_socket


def _active(
    connection: SpeechConnection,
    session: _NoopSttSession,
    *,
    utterance_id: str = "utterance:1",
    status: Literal["listening", "finalizing", "cancelled", "final"] = "listening",
) -> _Utterance:
    active = _Utterance(
        utterance_id=utterance_id,
        epoch=1,
        sample_rate_hz=16_000,
        stt_session=session,
        vad=EnergyVad(),
        status=status,
    )
    connection._active_utterance = active
    connection._utterance_epoch = 1
    connection._remember_utterance(utterance_id)
    return active


def _json_events(socket: _RecordingSocket) -> list[dict[str, object]]:
    return [json.loads(packet) for packet in socket.sent if isinstance(packet, str)]


async def _wait_for_event(socket: _RecordingSocket, event_type: str) -> None:
    for _ in range(100):
        if any(event.get("type") == event_type for event in _json_events(socket)):
            return
        await asyncio.sleep(0.005)
    raise AssertionError(f"did not receive {event_type}: {_json_events(socket)}")


async def _start_outbound(connection: SpeechConnection) -> None:
    connection._outbound_worker_task = asyncio.create_task(connection._outbound_worker())


async def test_final_terminal_batch_precedes_cancel_after_final(tmp_path: Path) -> None:
    connection, socket = _connection(tmp_path)
    await _start_outbound(connection)
    session = _BarrierFinalSession()
    active = _active(connection, session, status="finalizing")
    active.end_reason = "client_end"
    connection._spawn_finalizer_locked(active, active.epoch)
    assert active.finalize_task is not None
    await session.finish_started.wait()

    session.release_finish.set()
    await active.finalize_task
    await connection._cancel_utterance(
        CancelUtteranceControl(
            utterance_id=active.utterance_id,
            reason="too late",
        )
    )
    await _wait_for_event(socket, "error")

    events = _json_events(socket)
    types = [event["type"] for event in events]
    final_index = types.index("stt_final")
    assert types[final_index : final_index + 2] == ["stt_final", "speech_ended"]
    assert "cancelled" not in types
    assert events[-1]["code"] == "UTTERANCE_ALREADY_FINAL"
    await connection._shutdown()


async def test_cancel_fences_invalid_final_that_ignores_task_cancel(tmp_path: Path) -> None:
    connection, socket = _connection(tmp_path)
    await _start_outbound(connection)
    session = _BarrierFinalSession(invalid=True, suppress_cancel=True)
    active = _active(connection, session, status="finalizing")
    connection._spawn_finalizer_locked(active, active.epoch)
    assert active.finalize_task is not None
    await session.finish_started.wait()

    await asyncio.wait_for(
        connection._cancel_utterance(
            CancelUtteranceControl(
                utterance_id=active.utterance_id,
                reason="barge-in",
            )
        ),
        timeout=0.15,
    )
    session.release_finish.set()
    await active.finalize_task
    await _wait_for_event(socket, "cancelled")

    events = _json_events(socket)
    types = [event["type"] for event in events]
    assert types[:2] == ["speech_ended", "cancelled"]
    assert all(event_type not in {"stt_partial", "stt_final", "error"} for event_type in types)
    assert connection._utterance_terminals[active.utterance_id] == "cancelled"
    await connection._shutdown()


async def test_cancel_physically_purges_queued_pcm_before_reusing_credits(
    tmp_path: Path,
) -> None:
    connection, _ = _connection(
        tmp_path,
        SUITS_STT_INPUT_MAX_FRAMES="2",
        SUITS_STT_INPUT_MAX_BYTES="1280",
    )
    old_session = _NoopSttSession()
    old = _active(connection, old_session, utterance_id="utterance:old")
    for sequence in range(2):
        await connection._input_credits.reserve(
            utterance_id=old.utterance_id,
            sequence=sequence,
            byte_length=640,
        )
        connection._stt_frames.put_nowait(
            _SttFrame(
                utterance=old,
                epoch=old.epoch,
                sequence=sequence,
                duration_ms=20,
                pcm_s16le=b"\x00" * 640,
            )
        )
        old.pending_frames += 1

    await connection._cancel_active_utterance(
        utterance_id=old.utterance_id,
        reason="replace",
        emit=True,
    )
    credits = await connection._input_credits.snapshot()
    assert connection._stt_frames.qsize() == 0
    assert credits.available_frames == 2
    assert credits.available_bytes == 1_280

    new = _active(connection, _NoopSttSession(), utterance_id="utterance:new")
    connection._pending_audio_header = AudioChunkControl(
        utterance_id=new.utterance_id,
        sequence=0,
        byte_length=640,
        duration_ms=20,
    )
    await connection._handle_binary(b"\x00" * 640)
    assert connection._stt_frames.qsize() == 1
    assert connection._active_utterance is new
    await connection._shutdown()


async def test_device_io_failure_terminalizes_without_killing_stt_worker(
    tmp_path: Path,
) -> None:
    connection, socket = _connection(tmp_path)
    await _start_outbound(connection)
    active = _active(connection, _DeviceFailureSttSession())
    await connection._input_credits.reserve(
        utterance_id=active.utterance_id,
        sequence=0,
        byte_length=640,
    )
    active.pending_frames = 1
    connection._stt_frames.put_nowait(
        _SttFrame(
            utterance=active,
            epoch=active.epoch,
            sequence=0,
            duration_ms=20,
            pcm_s16le=b"\x00" * 640,
        )
    )
    connection._stt_worker_task = asyncio.create_task(connection._stt_worker())

    await _wait_for_event(socket, "cancelled")

    assert connection._stt_worker_task.done() is False
    assert connection._utterance_terminals[active.utterance_id] == "failed"
    assert _json_events(socket)[0]["code"] == "STT_PROVIDER_FAILED"
    await connection._shutdown()


async def test_shutdown_signals_finalizer_and_scrubs_buffered_pcm(tmp_path: Path) -> None:
    connection, _ = _connection(tmp_path)
    session = _BarrierFinalSession(release_on_cancel=True)
    active = _active(connection, session, status="finalizing")
    connection._spawn_finalizer_locked(active, active.epoch)
    assert active.finalize_task is not None
    await session.finish_started.wait()
    connection._pending_audio_header = AudioChunkControl(
        utterance_id=active.utterance_id,
        sequence=0,
        byte_length=640,
        duration_ms=20,
    )
    connection._stt_frames.put_nowait(
        _SttFrame(
            utterance=active,
            epoch=active.epoch,
            sequence=0,
            duration_ms=20,
            pcm_s16le=b"\x01" * 640,
        )
    )

    await connection._shutdown()

    assert active.finalize_task.done()
    assert connection._pending_audio_header is None
    assert connection._stt_frames.qsize() == 0
    assert active.last_text is None
    assert session.cancel_calls == 1


async def test_stalled_audio_send_does_not_block_cancellation_fence(
    tmp_path: Path,
) -> None:
    socket = _RecordingSocket(block_text=True)
    connection, _ = _connection(
        tmp_path,
        socket=socket,
        SUITS_TTS_ACK_WINDOW_BYTES="640",
    )
    await _start_outbound(connection)
    job = TtsJob(
        job_id="job:blocked",
        response_id="response:blocked",
        actor="judge",
        sequence=0,
        text="Objection.",
        clip_id=None,
        voice_id="af_heart",
        enqueued_at_ms=1,
        is_final=True,
    )
    await connection._phrase_queue.enqueue(job)
    lease = await connection._phrase_queue.next()
    assert await connection._phrase_queue.mark_streaming(lease)
    reservation = AckReservation(
        job_id=job.job_id,
        response_id=job.response_id,
        frame_sequence=0,
        frame_token="frame:blocked",
        byte_length=640,
    )
    await connection._ack_window.reserve(
        reservation,
        cancel_event=lease.cancel_event,
    )
    event = TtsAudioEvent(
        job_id=job.job_id,
        response_id=job.response_id,
        actor=job.actor,
        sequence=job.sequence,
        frame_sequence=0,
        frame_token=reservation.frame_token,
        byte_length=640,
        duration_ms=20,
        sample_rate_hz=16_000,
    )
    send = asyncio.create_task(connection._send_audio(event, b"\x00" * 640, reservation))
    await socket.text_started.wait()

    await asyncio.wait_for(
        connection._cancel_synthesis_scope(
            scope="job",
            target_id=job.job_id,
            reason="barge-in",
            emit_empty=True,
        ),
        timeout=0.15,
    )
    assert await connection._ack_window.outstanding_bytes() == 0
    assert socket.sent == []

    socket.release_text.set()
    with pytest.raises(asyncio.CancelledError):
        await send
    await _wait_for_event(socket, "cancelled")
    events = _json_events(socket)
    types = [item["type"] for item in events]
    cancelled_index = types.index("cancelled")
    assert all(item != "tts_audio" for item in types[cancelled_index + 1 :])
    await connection._shutdown()


async def test_binary_send_failure_releases_ack_reservation(tmp_path: Path) -> None:
    socket = _RecordingSocket(fail_bytes=True)
    connection, _ = _connection(tmp_path, socket=socket)
    await _start_outbound(connection)
    reservation = AckReservation(
        job_id="job:failure",
        response_id="response:failure",
        frame_sequence=0,
        frame_token="frame:failure",
        byte_length=640,
    )
    await connection._ack_window.reserve(
        reservation,
        cancel_event=asyncio.Event(),
    )
    event = TtsAudioEvent(
        job_id=reservation.job_id,
        response_id=reservation.response_id,
        actor="judge",
        sequence=0,
        frame_sequence=0,
        frame_token=reservation.frame_token,
        byte_length=640,
        duration_ms=20,
        sample_rate_hz=16_000,
    )

    with pytest.raises(asyncio.CancelledError):
        await connection._send_audio(event, b"\x00" * 640, reservation)

    assert await connection._ack_window.outstanding_bytes() == 0
    assert socket.closed == (4_011, "speech transport stalled")
    await connection._shutdown()


async def test_tts_duration_is_derived_from_pcm_not_provider_metadata(
    tmp_path: Path,
) -> None:
    connection, _ = _connection(tmp_path)
    pcm = b"\x00" * (24_000 * 2)
    invalid = SynthesizedPhrase(
        pcm_s16le=pcm,
        sample_rate_hz=24_000,
        channels=1,
        duration_ms=1,
        timings=(),
    )
    valid = SynthesizedPhrase(
        pcm_s16le=pcm,
        sample_rate_hz=24_000,
        channels=1,
        duration_ms=1_000,
        timings=(),
    )

    with pytest.raises(ValueError, match="invalid synthesized phrase"):
        connection._validate_synthesized_phrase(invalid)
    assert connection._validate_synthesized_phrase(valid) == 1_000
    await connection._shutdown()


async def test_idle_and_duration_limits_commit_explicit_terminal_errors(
    tmp_path: Path,
) -> None:
    idle_connection, idle_socket = _connection(
        tmp_path,
        SUITS_STT_IDLE_TIMEOUT_MS="1000",
    )
    await _start_outbound(idle_connection)
    idle = _active(idle_connection, _NoopSttSession(), utterance_id="utterance:idle")
    idle.last_audio_at = time.monotonic() - 2
    idle_connection._spawn_idle_watch_locked(idle)
    await _wait_for_event(idle_socket, "cancelled")
    idle_events = _json_events(idle_socket)
    assert idle_events[0]["code"] == "STT_IDLE_TIMEOUT"
    assert idle_connection._utterance_terminals[idle.utterance_id] == "failed"
    await idle_connection._shutdown()

    duration_connection, duration_socket = _connection(
        tmp_path,
        SUITS_STT_MAX_UTTERANCE_MS="5000",
    )
    await _start_outbound(duration_connection)
    duration = _active(
        duration_connection,
        _NoopSttSession(),
        utterance_id="utterance:duration",
    )
    duration.accepted_duration_ms = 4_990
    duration_connection._pending_audio_header = AudioChunkControl(
        utterance_id=duration.utterance_id,
        sequence=0,
        byte_length=640,
        duration_ms=20,
    )
    await duration_connection._handle_binary(b"\x00" * 640)
    await _wait_for_event(duration_socket, "cancelled")
    duration_events = _json_events(duration_socket)
    assert duration_events[0]["code"] == "STT_UTTERANCE_LIMIT"
    assert duration_connection._stt_frames.qsize() == 0
    await duration_connection._shutdown()
