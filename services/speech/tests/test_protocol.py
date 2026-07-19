from __future__ import annotations

import json

import pytest
from pydantic import ValidationError

from suits_speech.protocol import (
    PROTOCOL_VERSION,
    AudioChunkControl,
    CancelSynthesisControl,
    CapabilitiesEvent,
    CudaCapability,
    HelloControl,
    ProviderCapability,
    SttFinalEvent,
    SynthesizeControl,
    TtsAudioEvent,
    dump_message,
    parse_client_control,
    parse_server_event,
)


def test_client_control_round_trips_with_camel_case_wire_fields() -> None:
    message = HelloControl(request_id="request:1", client_id="browser:1")

    wire = dump_message(message)

    assert json.loads(wire) == {
        "protocol": PROTOCOL_VERSION,
        "type": "hello",
        "requestId": "request:1",
        "clientId": "browser:1",
        "supportedProtocols": [PROTOCOL_VERSION],
    }
    assert parse_client_control(wire) == message


@pytest.mark.parametrize(
    "payload",
    [
        {
            "protocol": PROTOCOL_VERSION,
            "type": "load_models",
            "requestId": "load:1",
            "sttProvider": "fake-stt",
            "ttsProvider": "fake-tts",
            "warmup": True,
        },
        {
            "protocol": PROTOCOL_VERSION,
            "type": "start_utterance",
            "utteranceId": "utterance:1",
            "sampleRateHz": 16_000,
            "channels": 1,
            "encoding": "pcm_s16le",
            "bargeIn": True,
            "endOfUtteranceSilenceMs": 600,
        },
        {
            "protocol": PROTOCOL_VERSION,
            "type": "audio_chunk",
            "utteranceId": "utterance:1",
            "sequence": 0,
            "byteLength": 640,
            "durationMs": 20,
        },
        {
            "protocol": PROTOCOL_VERSION,
            "type": "end_utterance",
            "utteranceId": "utterance:1",
        },
        {
            "protocol": PROTOCOL_VERSION,
            "type": "cancel_utterance",
            "utteranceId": "utterance:1",
            "reason": "browser stopped capture",
        },
        {
            "protocol": PROTOCOL_VERSION,
            "type": "synthesize",
            "jobId": "job:1",
            "responseId": "response:1",
            "actor": "witness:maya",
            "sequence": 2,
            "text": "I saw the signal change.",
        },
        {
            "protocol": PROTOCOL_VERSION,
            "type": "cancel_synthesis",
            "scope": "response",
            "responseId": "response:1",
            "reason": "barge in",
        },
        {
            "protocol": PROTOCOL_VERSION,
            "type": "set_voice",
            "actor": "judge",
            "voiceId": "voice:judge",
        },
        {
            "protocol": PROTOCOL_VERSION,
            "type": "ping",
            "nonce": "ping:1",
            "sentAtMs": 123,
        },
    ],
)
def test_every_client_message_type_parses(payload: dict[str, object]) -> None:
    message = parse_client_control(json.dumps(payload))
    assert json.loads(dump_message(message)) == payload


def test_audio_chunk_is_metadata_only_and_rejects_raw_audio_fields() -> None:
    valid = AudioChunkControl(
        utterance_id="utterance:1",
        sequence=0,
        byte_length=640,
        duration_ms=20,
    )
    payload = json.loads(dump_message(valid))
    payload["audioBase64"] = "AAECAw=="

    with pytest.raises(ValidationError):
        parse_client_control(json.dumps(payload))


@pytest.mark.parametrize(
    ("text", "clip_id"),
    [(None, None), ("Objection!", "clip:objection")],
)
def test_synthesis_requires_exactly_one_text_source(
    text: str | None,
    clip_id: str | None,
) -> None:
    with pytest.raises(ValidationError):
        SynthesizeControl(
            job_id="job:1",
            response_id="response:1",
            actor="judge",
            sequence=0,
            text=text,
            clip_id=clip_id,
        )


@pytest.mark.parametrize(
    "kwargs",
    [
        {"scope": "job"},
        {"scope": "all", "job_id": "job:1"},
        {"scope": "response", "job_id": "job:1"},
    ],
)
def test_cancel_scope_is_bound_to_one_identifier(kwargs: dict[str, str]) -> None:
    with pytest.raises(ValidationError):
        CancelSynthesisControl(**kwargs)


def test_protocol_is_strict_and_version_pinned() -> None:
    wrong_version = {
        "protocol": "suits.speech.v2",
        "type": "ping",
        "nonce": "ping:1",
        "sentAtMs": 10,
    }
    coerced_integer = {
        "protocol": PROTOCOL_VERSION,
        "type": "ping",
        "nonce": "ping:1",
        "sentAtMs": "10",
    }

    with pytest.raises(ValidationError):
        parse_client_control(json.dumps(wrong_version))
    with pytest.raises(ValidationError):
        parse_client_control(json.dumps(coerced_integer))


def test_server_events_round_trip_without_embedding_audio() -> None:
    capabilities = CapabilitiesEvent(
        providers=(
            ProviderCapability(
                provider_id="fake-stt",
                kind="stt",
                configured=True,
                loaded=True,
                ready=True,
                device="fake",
                supports_streaming=True,
            ),
        ),
        cuda=CudaCapability(available=False, diagnostic="CI fake mode"),
        cached_clip_ids=("clip:objection",),
        max_tts_queue_depth=8,
    )
    final = SttFinalEvent(
        utterance_id="utterance:1",
        revision=3,
        text="May it please the court.",
        confidence=1.0,
        audio_end_ms=500,
        emitted_at_ms=550,
    )
    audio = TtsAudioEvent(
        job_id="job:1",
        response_id="response:1",
        actor="judge",
        sequence=0,
        frame_sequence=0,
        byte_length=640,
        duration_ms=20,
        sample_rate_hz=16_000,
    )

    for event in (capabilities, final, audio):
        parsed = parse_server_event(dump_message(event))
        assert parsed == event
        assert "audioBase64" not in dump_message(event)
