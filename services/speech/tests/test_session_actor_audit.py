from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path
from types import SimpleNamespace
from typing import Literal, cast

import pytest
from fastapi import WebSocket

from suits_speech.audio_queue import TtsJob
from suits_speech.config import SpeechSettings
from suits_speech.health import SpeechRuntime
from suits_speech.protocol import StartUtteranceControl, SynthesizeControl
from suits_speech.providers.base import (
    AudioChunk,
    ProviderCancelled,
    ProviderStatus,
    StreamingSttSession,
    SynthesizedPhrase,
    TranscriptHypothesis,
)
from suits_speech.session import SpeechConnection, _SttFrame, _Utterance
from suits_speech.vad import EnergyVad


class _RecordingSocket:
    def __init__(self) -> None:
        self.sent: list[str | bytes] = []
        self.closed: tuple[int, str] | None = None
        self.headers = {
            "origin": "http://testserver",
            "sec-websocket-protocol": "suits.speech.v1",
        }
        self.client = SimpleNamespace(host="127.0.0.1")

    async def send_text(self, value: str) -> None:
        self.sent.append(value)

    async def send_bytes(self, value: bytes) -> None:
        self.sent.append(value)

    async def close(self, *, code: int = 1_000, reason: str = "") -> None:
        self.closed = (code, reason)


class _BaseSttSession:
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
        return None


class _DisposableSttSession(_BaseSttSession):
    def __init__(self) -> None:
        self.cancelled = asyncio.Event()

    async def cancel(self) -> None:
        self.cancelled.set()


class _CreationProvider:
    def __init__(self) -> None:
        self.session = _DisposableSttSession()

    @property
    def status(self) -> ProviderStatus:
        return _provider_status("creation-stt", kind="stt")

    async def load(self) -> ProviderStatus:
        return self.status

    async def create_session(self, *, sample_rate_hz: int) -> _DisposableSttSession:
        assert sample_rate_hz == 16_000
        return self.session


class _BarrierRuntime(SpeechRuntime):
    def __init__(self, *, settings: SpeechSettings, provider: _CreationProvider) -> None:
        super().__init__(settings=settings, stt_provider=provider)
        self.session_returned = asyncio.Event()
        self.allow_return = asyncio.Event()

    async def create_stt_session(self, *, sample_rate_hz: int) -> StreamingSttSession:
        session = await super().create_stt_session(sample_rate_hz=sample_rate_hz)
        self.session_returned.set()
        await self.allow_return.wait()
        return session


class _InvalidFinalSession(_BaseSttSession):
    def __init__(self, *, confidence: float, audio_end_ms: int) -> None:
        self.confidence = confidence
        self.audio_end_ms = audio_end_ms

    async def finish(self) -> TranscriptHypothesis:
        return TranscriptHypothesis(
            text="This text must never commit.",
            is_final=True,
            confidence=self.confidence,
            audio_end_ms=self.audio_end_ms,
        )


class _CancellationSuppressingSession(_BaseSttSession):
    def __init__(self) -> None:
        self.cancel_started = asyncio.Event()
        self.cancel_suppressed = asyncio.Event()
        self.release_cancel = asyncio.Event()

    async def cancel(self) -> None:
        self.cancel_started.set()
        while not self.release_cancel.is_set():
            try:
                await self.release_cancel.wait()
            except asyncio.CancelledError:
                self.cancel_suppressed.set()


class _ProviderCancelledPushSession(_BaseSttSession):
    def __init__(self) -> None:
        self.cancel_calls = 0

    async def push_audio(self, chunk: AudioChunk) -> tuple[TranscriptHypothesis, ...]:
        del chunk
        raise ProviderCancelled("recognizer stopped unexpectedly")

    async def cancel(self) -> None:
        self.cancel_calls += 1


class _FailingTtsProvider:
    def __init__(self, *, provider_cancelled: bool) -> None:
        self.provider_cancelled = provider_cancelled
        self.calls: list[str] = []

    @property
    def status(self) -> ProviderStatus:
        return _provider_status("failing-tts", kind="tts")

    async def load(self) -> ProviderStatus:
        return self.status

    async def synthesize_phrase(
        self,
        *,
        text: str,
        voice_id: str,
        cancel_event: asyncio.Event,
    ) -> SynthesizedPhrase:
        del voice_id, cancel_event
        self.calls.append(text)
        if self.provider_cancelled:
            raise ProviderCancelled("provider stopped without a client cancellation")
        raise RuntimeError("first phrase failed")


def _provider_status(
    provider_id: str,
    *,
    kind: Literal["stt", "tts"],
) -> ProviderStatus:
    return ProviderStatus(
        provider_id=provider_id,
        kind=kind,
        configured=True,
        loaded=True,
        ready=True,
        device="fake",
        model_id=None,
        supports_streaming=True,
        supports_timings=True,
        warmup_latency_ms=0,
    )


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
    runtime: SpeechRuntime | None = None,
    **overrides: str,
) -> tuple[SpeechConnection, _RecordingSocket]:
    socket = _RecordingSocket()
    resolved_runtime = runtime or SpeechRuntime(settings=_settings(tmp_path, **overrides))
    connection = SpeechConnection(
        websocket=cast(WebSocket, socket),
        runtime=resolved_runtime,
    )
    connection._hello_received = True
    return connection, socket


def _set_active(
    connection: SpeechConnection,
    session: _BaseSttSession,
    *,
    utterance_id: str,
    status: Literal["listening", "finalizing"] = "listening",
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
    connection._utterance_epoch = active.epoch
    connection._remember_utterance(active.utterance_id)
    return active


def _events(socket: _RecordingSocket) -> list[dict[str, object]]:
    return [json.loads(packet) for packet in socket.sent if isinstance(packet, str)]


def _queued_events(connection: SpeechConnection) -> list[dict[str, object]]:
    return [
        json.loads(packet)
        for batch in connection._outbound
        for packet in batch.packets
        if isinstance(packet, str)
    ]


async def _start_workers(
    connection: SpeechConnection,
    *,
    stt: bool = False,
    tts: bool = False,
) -> None:
    connection._outbound_worker_task = asyncio.create_task(connection._outbound_worker())
    if stt:
        connection._stt_worker_task = asyncio.create_task(connection._stt_worker())
    if tts:
        connection._tts_worker_task = asyncio.create_task(connection._tts_worker())


async def _wait_until(predicate: object, *, timeout: float = 0.5) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if cast("object", predicate)():
            return
        await asyncio.sleep(0.005)
    raise AssertionError("timed out waiting for deterministic speech test condition")


async def test_connection_capacity_releases_even_when_shutdown_raises(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = _settings(tmp_path, SUITS_SPEECH_MAX_CONNECTIONS="1")
    runtime = SpeechRuntime(settings=settings)
    connection, _ = _connection(tmp_path, runtime=runtime)

    async def admitted() -> None:
        return None

    async def broken_shutdown() -> None:
        raise RuntimeError("injected shutdown failure")

    monkeypatch.setattr(connection, "_run_admitted", admitted)
    monkeypatch.setattr(connection, "_shutdown", broken_shutdown)

    with pytest.raises(RuntimeError, match="injected shutdown failure"):
        await connection.run()

    assert runtime.capacity_snapshot.connections.active == 0
    recovered = runtime.try_acquire_connection()
    assert recovered is not None
    assert recovered.release() is True


@pytest.mark.parametrize("terminal_race", ["closed", "cancelled"])
async def test_unadopted_created_stt_session_is_disposed(
    tmp_path: Path,
    terminal_race: Literal["closed", "cancelled"],
) -> None:
    settings = _settings(tmp_path, SUITS_STT_MAX_SESSIONS="1")
    provider = _CreationProvider()
    runtime = _BarrierRuntime(settings=settings, provider=provider)
    connection, _ = _connection(tmp_path, runtime=runtime)
    start = asyncio.create_task(
        connection._start_utterance(
            StartUtteranceControl(
                utterance_id=f"utterance:{terminal_race}",
                barge_in=False,
            )
        )
    )
    await runtime.session_returned.wait()
    await connection._state_lock.acquire()
    runtime.allow_return.set()
    await asyncio.sleep(0)

    if terminal_race == "closed":
        connection._closed = True
    else:
        start.cancel()
    connection._state_lock.release()

    if terminal_race == "cancelled":
        with pytest.raises(asyncio.CancelledError):
            await start
    else:
        await start
    await asyncio.wait_for(provider.session.cancelled.wait(), timeout=0.2)
    await _wait_until(lambda: runtime.capacity_snapshot.stt_sessions.active == 0)
    assert connection._active_utterance is None

    if not connection._closed:
        await connection._shutdown()


@pytest.mark.parametrize(
    ("confidence", "audio_end_ms"),
    [(2.0, 20), (1.0, -1)],
    ids=["confidence", "audio-end"],
)
async def test_invalid_final_metadata_fails_atomically_without_final_event(
    tmp_path: Path,
    confidence: float,
    audio_end_ms: int,
) -> None:
    connection, socket = _connection(tmp_path)
    await _start_workers(connection)
    active = _set_active(
        connection,
        _InvalidFinalSession(confidence=confidence, audio_end_ms=audio_end_ms),
        utterance_id="utterance:invalid-final",
        status="finalizing",
    )
    active.end_reason = "client_end"

    await connection._finalize_utterance(active, active.epoch)
    await _wait_until(lambda: any(event.get("type") == "cancelled" for event in _events(socket)))

    events = _events(socket)
    assert connection._utterance_terminals[active.utterance_id] == "failed"
    assert active.status == "cancelled"
    assert all(event.get("type") != "stt_final" for event in events)
    assert any(
        event.get("type") == "error" and event.get("code") == "INVALID_STT_FINAL"
        for event in events
    )
    await connection._shutdown()


async def test_shutdown_is_bounded_when_provider_cancel_suppresses_cancellation(
    tmp_path: Path,
) -> None:
    connection, _ = _connection(tmp_path)
    session = _CancellationSuppressingSession()
    _set_active(connection, session, utterance_id="utterance:stubborn")

    shutdown = asyncio.create_task(connection._shutdown())
    await session.cancel_started.wait()
    provider_cancel = next(iter(connection._provider_cleanup_tasks))
    provider_cancel.cancel()
    await session.cancel_suppressed.wait()

    started = time.perf_counter()
    await asyncio.wait_for(shutdown, timeout=0.6)
    assert time.perf_counter() - started < 0.55
    assert not provider_cancel.done()

    session.release_cancel.set()
    await asyncio.wait_for(provider_cancel, timeout=0.2)


async def test_cancel_all_at_max_queue_depth_retains_every_terminal_event(
    tmp_path: Path,
) -> None:
    connection, socket = _connection(
        tmp_path,
        SUITS_TTS_MAX_QUEUE_DEPTH="256",
    )
    response_id = "response:max-depth"
    for sequence in range(256):
        await connection._phrase_queue.enqueue(
            TtsJob(
                job_id=f"job:{sequence}",
                response_id=response_id,
                actor="judge",
                sequence=sequence,
                text=f"phrase {sequence}",
                clip_id=None,
                voice_id="am_michael",
                enqueued_at_ms=1,
                is_final=sequence == 255,
            )
        )

    await connection._cancel_synthesis_scope(
        scope="all",
        target_id=None,
        reason="cancel_everything",
        emit_empty=True,
    )

    cancelled = [event for event in _queued_events(connection) if event["type"] == "cancelled"]
    assert len(cancelled) == 256
    assert {event["targetId"] for event in cancelled} == {
        f"job:{sequence}" for sequence in range(256)
    }
    assert socket.closed is None
    assert connection._closed is False
    snapshot = await connection._phrase_queue.snapshot()
    assert snapshot.queued_job_ids == ()
    assert snapshot.terminal_job_count == 256
    await connection._shutdown()


async def test_unexpected_current_stt_provider_cancel_is_a_provider_failure(
    tmp_path: Path,
) -> None:
    connection, socket = _connection(tmp_path)
    await _start_workers(connection, stt=True)
    session = _ProviderCancelledPushSession()
    active = _set_active(connection, session, utterance_id="utterance:provider-cancel")
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

    await _wait_until(
        lambda: any(event.get("code") == "STT_PROVIDER_FAILED" for event in _events(socket))
    )
    await _wait_until(lambda: any(event.get("type") == "cancelled" for event in _events(socket)))

    assert connection._utterance_terminals[active.utterance_id] == "failed"
    assert connection._active_utterance is None
    assert all(event.get("type") != "stt_final" for event in _events(socket))
    await _wait_until(lambda: session.cancel_calls == 1)
    await connection._shutdown()


async def test_unexpected_tts_provider_cancel_fails_and_cancels_response(
    tmp_path: Path,
) -> None:
    provider = _FailingTtsProvider(provider_cancelled=True)
    settings = _settings(tmp_path)
    runtime = SpeechRuntime(settings=settings, tts_provider=provider)
    connection, socket = _connection(tmp_path, runtime=runtime)
    await _start_workers(connection, tts=True)
    await _enqueue_response(connection, phrase_count=2, response_id="response:cancelled")

    await _wait_for_tts_response_failure(socket, expected_cancelled=2)

    events = _events(socket)
    assert provider.calls == ["phrase 0"]
    assert any(event.get("code") == "TTS_PROVIDER_FAILED" for event in events)
    assert {event["targetId"] for event in events if event["type"] == "cancelled"} == {
        "job:response:cancelled:0",
        "job:response:cancelled:1",
    }
    await _assert_tts_queue_idle(connection)
    await connection._shutdown()


async def test_first_tts_phrase_failure_cancels_all_later_response_phrases(
    tmp_path: Path,
) -> None:
    provider = _FailingTtsProvider(provider_cancelled=False)
    settings = _settings(tmp_path)
    runtime = SpeechRuntime(settings=settings, tts_provider=provider)
    connection, socket = _connection(tmp_path, runtime=runtime)
    await _start_workers(connection, tts=True)
    await _enqueue_response(connection, phrase_count=3, response_id="response:failed")

    await _wait_for_tts_response_failure(socket, expected_cancelled=3)

    events = _events(socket)
    assert provider.calls == ["phrase 0"]
    assert any(event.get("code") == "TTS_PROVIDER_FAILED" for event in events)
    assert {event["targetId"] for event in events if event["type"] == "cancelled"} == {
        f"job:response:failed:{sequence}" for sequence in range(3)
    }
    assert all(
        event.get("jobId") not in {"job:response:failed:1", "job:response:failed:2"}
        for event in events
        if event["type"] in {"tts_started", "tts_audio", "tts_finished"}
    )
    await _assert_tts_queue_idle(connection)
    await connection._shutdown()


async def _enqueue_response(
    connection: SpeechConnection,
    *,
    phrase_count: int,
    response_id: str,
) -> None:
    for sequence in range(phrase_count):
        await connection._enqueue_synthesis(
            SynthesizeControl(
                job_id=f"job:{response_id}:{sequence}",
                response_id=response_id,
                actor="judge",
                sequence=sequence,
                text=f"phrase {sequence}",
                is_final=sequence == phrase_count - 1,
            )
        )


async def _wait_for_tts_response_failure(
    socket: _RecordingSocket,
    *,
    expected_cancelled: int,
) -> None:
    await _wait_until(
        lambda: (
            sum(event.get("type") == "cancelled" for event in _events(socket)) == expected_cancelled
        )
    )


async def _assert_tts_queue_idle(connection: SpeechConnection) -> None:
    await _wait_until(
        lambda: (
            connection._phrase_queue._active_job_id is None
            and not connection._phrase_queue._pending
        )
    )


async def test_quarantined_tts_lane_rejects_new_work_as_non_retryable(
    tmp_path: Path,
) -> None:
    runtime = SpeechRuntime(settings=_settings(tmp_path))
    await runtime.load_models()
    runtime._tts_lane._quarantine_diagnostic = "simulated quarantine"
    connection, _ = _connection(tmp_path, runtime=runtime)

    await connection._enqueue_synthesis(
        SynthesizeControl(
            job_id="job:quarantined",
            response_id="response:quarantined",
            actor="judge",
            sequence=0,
            text="This must not be queued.",
            is_final=True,
        )
    )

    events = _queued_events(connection)
    assert events[0]["code"] == "TTS_RESTART_REQUIRED"
    assert events[0]["retryable"] is False
    assert events[1]["type"] == "capabilities"
    tts_capability = cast(list[dict[str, object]], events[1]["providers"])[1]
    assert tts_capability["ready"] is False
    assert (await connection._phrase_queue.snapshot()).queued_job_ids == ()
    await connection._shutdown()
