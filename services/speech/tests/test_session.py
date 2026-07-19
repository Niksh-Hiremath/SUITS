from __future__ import annotations

import asyncio
import json
import time
from array import array
from pathlib import Path

from fastapi.testclient import TestClient
from starlette.testclient import WebSocketTestSession

from suits_speech.app import create_app
from suits_speech.clip_cache import SUSTAINED_CLIP_ID
from suits_speech.config import SpeechSettings
from suits_speech.health import SpeechRuntime
from suits_speech.protocol import PROTOCOL_VERSION
from suits_speech.providers import FakeTtsProvider
from suits_speech.providers.base import (
    AudioChunk,
    ProviderStatus,
    SynthesizedPhrase,
    TranscriptHypothesis,
)


class _SlowLateSttSession:
    def __init__(self) -> None:
        self.audio_end_ms = 0

    async def push_audio(self, chunk: AudioChunk) -> tuple[TranscriptHypothesis, ...]:
        self.audio_end_ms += chunk.duration_ms
        await asyncio.sleep(0.2)
        return (
            TranscriptHypothesis(
                text="late partial that must be fenced",
                is_final=False,
                confidence=1.0,
                audio_end_ms=self.audio_end_ms,
            ),
        )

    async def finish(self) -> TranscriptHypothesis:
        await asyncio.sleep(0.2)
        return TranscriptHypothesis(
            text="late final that must be fenced",
            is_final=True,
            confidence=1.0,
            audio_end_ms=self.audio_end_ms,
        )

    async def cancel(self) -> None:
        return None


class _SlowLateSttProvider:
    @property
    def status(self) -> ProviderStatus:
        return ProviderStatus(
            provider_id="slow-test-stt",
            kind="stt",
            configured=True,
            loaded=True,
            ready=True,
            device="fake",
            model_id=None,
            supports_streaming=True,
            supports_timings=True,
            warmup_latency_ms=0,
        )

    async def load(self) -> ProviderStatus:
        return self.status

    async def create_session(self, *, sample_rate_hz: int) -> _SlowLateSttSession:
        assert sample_rate_hz == 16_000
        return _SlowLateSttSession()


class _CountingTtsProvider(FakeTtsProvider):
    def __init__(self) -> None:
        super().__init__()
        self.synthesized_texts: list[str] = []

    async def synthesize_phrase(
        self,
        *,
        text: str,
        voice_id: str,
        cancel_event: asyncio.Event,
    ) -> SynthesizedPhrase:
        self.synthesized_texts.append(text)
        return await super().synthesize_phrase(
            text=text,
            voice_id=voice_id,
            cancel_event=cancel_event,
        )


def _settings(tmp_path: Path, **overrides: str) -> SpeechSettings:
    environ = {
        "SUITS_SPEECH_MODE": "fake",
        "SUITS_SPEECH_ALLOWED_ORIGINS": "http://testserver",
        "SUITS_SPEECH_CACHE_DIR": str(tmp_path),
    }
    environ.update(overrides)
    return SpeechSettings.from_env(environ)


def _connect(client: TestClient) -> WebSocketTestSession:
    return client.websocket_connect(
        "/v1/speech",
        headers={"origin": "http://testserver"},
        subprotocols=[PROTOCOL_VERSION],
    )


def _slow_client(settings: SpeechSettings) -> TestClient:
    runtime = SpeechRuntime(
        settings=settings,
        stt_provider=_SlowLateSttProvider(),
        tts_provider=FakeTtsProvider(),
    )
    return TestClient(create_app(settings, runtime=runtime))


def _handshake_and_load(websocket: WebSocketTestSession) -> None:
    websocket.send_json(
        {
            "protocol": PROTOCOL_VERSION,
            "type": "hello",
            "requestId": "request:hello",
            "clientId": "browser:test",
            "supportedProtocols": [PROTOCOL_VERSION],
        }
    )
    assert websocket.receive_json()["type"] == "ready"
    assert websocket.receive_json()["type"] == "capabilities"
    assert websocket.receive_json()["type"] == "flow_control"
    websocket.send_json(
        {
            "protocol": PROTOCOL_VERSION,
            "type": "load_models",
            "requestId": "request:load",
            "sttProvider": "fake-stt",
            "ttsProvider": "fake-tts",
            "warmup": True,
        }
    )
    loaded = websocket.receive_json()
    assert loaded["type"] == "capabilities"
    assert all(provider["ready"] for provider in loaded["providers"])


def _tone_pcm(*, sample_count: int = 320, amplitude: int = 1_000) -> bytes:
    return array("h", [amplitude] * sample_count).tobytes()


def _send_audio(
    websocket: WebSocketTestSession,
    *,
    utterance_id: str,
    sequence: int,
    pcm: bytes,
    duration_ms: int = 20,
) -> None:
    websocket.send_json(
        {
            "protocol": PROTOCOL_VERSION,
            "type": "audio_chunk",
            "utteranceId": utterance_id,
            "sequence": sequence,
            "byteLength": len(pcm),
            "durationMs": duration_ms,
        }
    )
    websocket.send_bytes(pcm)


def _receive_json_until(
    websocket: WebSocketTestSession,
    wanted_type: str,
    *,
    limit: int = 32,
) -> tuple[dict[str, object], list[dict[str, object]]]:
    seen: list[dict[str, object]] = []
    for _ in range(limit):
        event = websocket.receive_json()
        seen.append(event)
        if event.get("type") == wanted_type:
            return event, seen
    raise AssertionError(f"did not receive {wanted_type}; saw {seen}")


def test_hello_must_advertise_the_negotiated_protocol(tmp_path: Path) -> None:
    client = TestClient(create_app(_settings(tmp_path)))
    with _connect(client) as websocket:
        websocket.send_json(
            {
                "protocol": PROTOCOL_VERSION,
                "type": "hello",
                "requestId": "request:unsupported",
                "clientId": "browser:test",
                "supportedProtocols": [],
            }
        )

        error = websocket.receive_json()
        assert error["type"] == "error"
        assert error["code"] == "PROTOCOL_NOT_SUPPORTED"
        assert error["fatal"] is True


def test_fake_websocket_stt_emits_monotonic_partial_and_final_revisions(
    tmp_path: Path,
) -> None:
    settings = _settings(tmp_path, SUITS_SPEECH_MAX_CONNECTIONS="1")
    runtime = SpeechRuntime(settings=settings)
    client = TestClient(create_app(settings, runtime=runtime))
    with _connect(client) as websocket:
        assert runtime.capacity_snapshot.connections.active == 1
        _handshake_and_load(websocket)
        websocket.send_json(
            {
                "protocol": PROTOCOL_VERSION,
                "type": "start_utterance",
                "utteranceId": "utterance:1",
                "sampleRateHz": 16_000,
                "channels": 1,
                "encoding": "pcm_s16le",
                "bargeIn": True,
                "endOfUtteranceSilenceMs": 600,
            }
        )

        pcm = _tone_pcm()
        _send_audio(
            websocket,
            utterance_id="utterance:1",
            sequence=0,
            pcm=pcm,
        )
        first_partial, _ = _receive_json_until(websocket, "stt_partial")
        assert first_partial["revision"] == 1
        assert first_partial["text"] == "May"

        _send_audio(
            websocket,
            utterance_id="utterance:1",
            sequence=1,
            pcm=pcm,
        )
        second_partial, second_events = _receive_json_until(websocket, "stt_partial")
        assert second_partial["revision"] == 2
        assert any(event["type"] == "speech_started" for event in second_events)

        websocket.send_json(
            {
                "protocol": PROTOCOL_VERSION,
                "type": "end_utterance",
                "utteranceId": "utterance:1",
            }
        )
        final, _ = _receive_json_until(websocket, "stt_final")
        assert final["revision"] == 3
        assert final["text"] == "May it please the court."
        ended, trailing = _receive_json_until(websocket, "speech_ended")
        assert ended["reason"] == "client_end"
        assert all(event["type"] != "stt_final" for event in trailing)
        assert runtime.capacity_snapshot.stt_sessions.active == 0
    assert runtime.capacity_snapshot.connections.active == 0


def test_binary_pcm_length_mismatch_cancels_without_transcript(tmp_path: Path) -> None:
    client = TestClient(create_app(_settings(tmp_path)))
    with _connect(client) as websocket:
        _handshake_and_load(websocket)
        websocket.send_json(
            {
                "protocol": PROTOCOL_VERSION,
                "type": "start_utterance",
                "utteranceId": "utterance:bad",
            }
        )
        _send_audio(
            websocket,
            utterance_id="utterance:bad",
            sequence=0,
            pcm=_tone_pcm(),
            duration_ms=40,
        )

        error, seen = _receive_json_until(websocket, "error")
        assert error["code"] == "AUDIO_LENGTH_MISMATCH"
        cancelled, after_error = _receive_json_until(websocket, "cancelled")
        assert cancelled["target"] == "utterance"
        assert all(
            event["type"] not in {"stt_partial", "stt_final"} for event in (*seen, *after_error)
        )


def test_audio_sequence_gap_cancels_the_utterance(tmp_path: Path) -> None:
    client = TestClient(create_app(_settings(tmp_path)))
    with _connect(client) as websocket:
        _handshake_and_load(websocket)
        websocket.send_json(
            {
                "protocol": PROTOCOL_VERSION,
                "type": "start_utterance",
                "utteranceId": "utterance:gap",
            }
        )
        websocket.send_json(
            {
                "protocol": PROTOCOL_VERSION,
                "type": "audio_chunk",
                "utteranceId": "utterance:gap",
                "sequence": 1,
                "byteLength": 640,
                "durationMs": 20,
            }
        )

        error, _ = _receive_json_until(websocket, "error")
        assert error["code"] == "STALE_AUDIO_SEQUENCE"
        cancelled, _ = _receive_json_until(websocket, "cancelled")
        assert cancelled["targetId"] == "utterance:gap"


def test_stt_cancel_drops_late_revisions_before_next_control(tmp_path: Path) -> None:
    client = TestClient(create_app(_settings(tmp_path)))
    with _connect(client) as websocket:
        _handshake_and_load(websocket)
        websocket.send_json(
            {
                "protocol": PROTOCOL_VERSION,
                "type": "start_utterance",
                "utteranceId": "utterance:cancel",
            }
        )
        _send_audio(
            websocket,
            utterance_id="utterance:cancel",
            sequence=0,
            pcm=_tone_pcm(),
        )
        websocket.send_json(
            {
                "protocol": PROTOCOL_VERSION,
                "type": "cancel_utterance",
                "utteranceId": "utterance:cancel",
                "reason": "user stopped",
            }
        )
        cancelled, _ = _receive_json_until(websocket, "cancelled")
        assert cancelled["targetId"] == "utterance:cancel"

        websocket.send_json(
            {
                "protocol": PROTOCOL_VERSION,
                "type": "ping",
                "nonce": "after:stt:cancel",
                "sentAtMs": 1,
            }
        )
        pong, after_cancel = _receive_json_until(websocket, "pong")
        assert pong["nonce"] == "after:stt:cancel"
        assert all(event["type"] not in {"stt_partial", "stt_final"} for event in after_cancel)


def test_cancel_fences_a_provider_callback_that_returns_late(tmp_path: Path) -> None:
    client = _slow_client(_settings(tmp_path))
    with _connect(client) as websocket:
        _handshake_and_load(websocket)
        websocket.send_json(
            {
                "protocol": PROTOCOL_VERSION,
                "type": "start_utterance",
                "utteranceId": "utterance:slow",
            }
        )
        _send_audio(
            websocket,
            utterance_id="utterance:slow",
            sequence=0,
            pcm=_tone_pcm(),
        )
        websocket.send_json(
            {
                "protocol": PROTOCOL_VERSION,
                "type": "cancel_utterance",
                "utteranceId": "utterance:slow",
                "reason": "barge-in",
            }
        )
        cancelled, _ = _receive_json_until(websocket, "cancelled")
        assert cancelled["targetId"] == "utterance:slow"

        time.sleep(0.25)
        websocket.send_json(
            {
                "protocol": PROTOCOL_VERSION,
                "type": "ping",
                "nonce": "after:late:provider",
                "sentAtMs": 1,
            }
        )
        pong, after_cancel = _receive_json_until(websocket, "pong")
        assert pong["nonce"] == "after:late:provider"
        assert all(event["type"] not in {"stt_partial", "stt_final"} for event in after_cancel)


def test_input_credit_overflow_cancels_instead_of_dropping_pcm(
    tmp_path: Path,
) -> None:
    settings = _settings(
        tmp_path,
        SUITS_STT_INPUT_MAX_FRAMES="1",
        SUITS_STT_INPUT_MAX_BYTES="640",
    )
    client = _slow_client(settings)
    with _connect(client) as websocket:
        _handshake_and_load(websocket)
        websocket.send_json(
            {
                "protocol": PROTOCOL_VERSION,
                "type": "start_utterance",
                "utteranceId": "utterance:overflow",
            }
        )
        pcm = _tone_pcm()
        _send_audio(
            websocket,
            utterance_id="utterance:overflow",
            sequence=0,
            pcm=pcm,
        )
        _send_audio(
            websocket,
            utterance_id="utterance:overflow",
            sequence=1,
            pcm=pcm,
        )

        error, _ = _receive_json_until(websocket, "error")
        assert error["code"] == "STT_BACKPRESSURE"
        cancelled, _ = _receive_json_until(websocket, "cancelled")
        assert cancelled["targetId"] == "utterance:overflow"


def test_fake_tts_streams_binary_frames_with_acknowledged_backpressure(
    tmp_path: Path,
) -> None:
    client = TestClient(create_app(_settings(tmp_path)))
    with _connect(client) as websocket:
        _handshake_and_load(websocket)
        websocket.send_json(
            {
                "protocol": PROTOCOL_VERSION,
                "type": "synthesize",
                "jobId": "job:1",
                "responseId": "response:1",
                "actor": "judge",
                "sequence": 0,
                "text": "The objection is sustained.",
                "isFinal": True,
            }
        )

        text_events: list[dict[str, object]] = []
        audio_bytes = 0
        audio_frames = 0
        while True:
            packet = websocket.receive()
            assert packet["type"] == "websocket.send"
            if packet.get("bytes") is not None:
                raise AssertionError("binary frame arrived without tts_audio metadata")
            event = json.loads(packet["text"])
            text_events.append(event)
            if event["type"] == "tts_audio":
                binary = websocket.receive()
                assert binary["type"] == "websocket.send"
                audio = binary["bytes"]
                assert len(audio) == event["byteLength"]
                audio_bytes += len(audio)
                audio_frames += 1
                websocket.send_json(
                    {
                        "protocol": PROTOCOL_VERSION,
                        "type": "ack_tts_audio",
                        "jobId": event["jobId"],
                        "responseId": event["responseId"],
                        "frameSequence": event["frameSequence"],
                        "frameToken": event["frameToken"],
                        "byteLength": event["byteLength"],
                    }
                )
            if event["type"] == "tts_finished":
                break

        assert audio_bytes > 0
        assert audio_frames > 1
        assert any(event["type"] == "tts_started" for event in text_events)
        timing = next(event for event in text_events if event["type"] == "tts_timing")
        assert timing["marks"]
        assert all("protocol" not in mark for mark in timing["marks"])


def test_cached_courtroom_clip_streams_without_runtime_provider_call(
    tmp_path: Path,
) -> None:
    settings = _settings(tmp_path)
    provider = _CountingTtsProvider()
    runtime = SpeechRuntime(settings=settings, tts_provider=provider)
    client = TestClient(create_app(settings, runtime=runtime))
    with _connect(client) as websocket:
        _handshake_and_load(websocket)
        assert provider.synthesized_texts == ["Objection!", "Sustained.", "Overruled."]
        websocket.send_json(
            {
                "protocol": PROTOCOL_VERSION,
                "type": "synthesize",
                "jobId": "job:cached",
                "responseId": "response:cached",
                "actor": "judge",
                "sequence": 0,
                "clipId": SUSTAINED_CLIP_ID,
                "isFinal": True,
            }
        )

        started: dict[str, object] | None = None
        audio_bytes = 0
        while True:
            packet = websocket.receive()
            assert packet["type"] == "websocket.send"
            event = json.loads(packet["text"])
            if event["type"] == "tts_started":
                started = event
            if event["type"] == "tts_audio":
                binary = websocket.receive()
                assert binary["type"] == "websocket.send"
                audio = binary["bytes"]
                assert len(audio) == event["byteLength"]
                audio_bytes += len(audio)
                websocket.send_json(
                    {
                        "protocol": PROTOCOL_VERSION,
                        "type": "ack_tts_audio",
                        "jobId": event["jobId"],
                        "responseId": event["responseId"],
                        "frameSequence": event["frameSequence"],
                        "frameToken": event["frameToken"],
                        "byteLength": event["byteLength"],
                    }
                )
            if event["type"] == "tts_finished":
                break

        assert started is not None
        assert started["cached"] is True
        assert started["voiceId"] == "am_michael"
        assert audio_bytes > 0
        assert provider.synthesized_texts == ["Objection!", "Sustained.", "Overruled."]


def test_tts_cancel_purges_ack_blocked_audio_before_pong(tmp_path: Path) -> None:
    settings = _settings(tmp_path, SUITS_TTS_ACK_WINDOW_BYTES="1920")
    client = TestClient(create_app(settings))
    with _connect(client) as websocket:
        _handshake_and_load(websocket)
        websocket.send_json(
            {
                "protocol": PROTOCOL_VERSION,
                "type": "synthesize",
                "jobId": "job:cancel",
                "responseId": "response:cancel",
                "actor": "witness:test",
                "sequence": 0,
                "text": "This phrase is long enough to require several local audio frames.",
                "isFinal": True,
            }
        )
        first_audio, _ = _receive_json_until(websocket, "tts_audio")
        binary = websocket.receive()
        assert len(binary["bytes"]) == first_audio["byteLength"]

        websocket.send_json(
            {
                "protocol": PROTOCOL_VERSION,
                "type": "cancel_synthesis",
                "scope": "job",
                "jobId": "job:cancel",
                "reason": "barge in",
            }
        )
        cancelled, _ = _receive_json_until(websocket, "cancelled")
        assert cancelled["targetId"] == "job:cancel"

        websocket.send_json(
            {
                "protocol": PROTOCOL_VERSION,
                "type": "ping",
                "nonce": "after:cancel",
                "sentAtMs": 1,
            }
        )
        pong, after_cancel = _receive_json_until(websocket, "pong")
        assert pong["nonce"] == "after:cancel"
        assert all(event["type"] != "tts_audio" for event in after_cancel)
