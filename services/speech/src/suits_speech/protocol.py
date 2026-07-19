"""Strict JSON control protocol for the local speech companion.

Raw PCM frames deliberately have no JSON representation in this module. An
``audio_chunk`` control message declares the metadata for the *next* binary
WebSocket frame; the runtime rejects text/base64 audio fields as unknown input.
"""

from __future__ import annotations

from typing import Annotated, Literal, TypeAlias

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    TypeAdapter,
    model_validator,
)

PROTOCOL_VERSION = "suits.speech.v1"
SERVICE_VERSION = "0.1.0"

_ID_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$"
Identifier = Annotated[str, StringConstraints(pattern=_ID_PATTERN)]
ShortText = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=512),
]
SpeechText = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=8_192),
]


def _to_camel(value: str) -> str:
    head, *tail = value.split("_")
    return head + "".join(part.capitalize() for part in tail)


class ProtocolModel(BaseModel):
    """Base for immutable, strict, camel-cased wire messages."""

    model_config = ConfigDict(
        alias_generator=_to_camel,
        extra="forbid",
        frozen=True,
        populate_by_name=True,
        serialize_by_alias=True,
        strict=True,
    )

    protocol: Literal[PROTOCOL_VERSION] = PROTOCOL_VERSION


class HelloControl(ProtocolModel):
    type: Literal["hello"] = "hello"
    request_id: Identifier
    client_id: Identifier
    supported_protocols: tuple[Literal[PROTOCOL_VERSION], ...] = (PROTOCOL_VERSION,)


class LoadModelsControl(ProtocolModel):
    type: Literal["load_models"] = "load_models"
    request_id: Identifier
    stt_provider: Identifier | None = None
    tts_provider: Identifier | None = None
    warmup: bool = True


class StartUtteranceControl(ProtocolModel):
    type: Literal["start_utterance"] = "start_utterance"
    utterance_id: Identifier
    sample_rate_hz: int = Field(default=16_000, ge=8_000, le=48_000)
    channels: Literal[1] = 1
    encoding: Literal["pcm_s16le"] = "pcm_s16le"
    barge_in: bool = True
    end_of_utterance_silence_ms: int = Field(default=600, ge=200, le=3_000)


class AudioChunkControl(ProtocolModel):
    """Metadata for the binary frame that must immediately follow it."""

    type: Literal["audio_chunk"] = "audio_chunk"
    utterance_id: Identifier
    sequence: int = Field(ge=0, le=2_147_483_647)
    byte_length: int = Field(ge=2, le=262_144, multiple_of=2)
    duration_ms: int = Field(gt=0, le=2_000)


class EndUtteranceControl(ProtocolModel):
    type: Literal["end_utterance"] = "end_utterance"
    utterance_id: Identifier


class CancelUtteranceControl(ProtocolModel):
    type: Literal["cancel_utterance"] = "cancel_utterance"
    utterance_id: Identifier
    reason: ShortText = "client_cancelled"


class SynthesizeControl(ProtocolModel):
    type: Literal["synthesize"] = "synthesize"
    job_id: Identifier
    response_id: Identifier
    actor: Identifier
    sequence: int = Field(ge=0, le=2_147_483_647)
    text: SpeechText | None = None
    clip_id: Identifier | None = None
    voice_id: Identifier | None = None

    @model_validator(mode="after")
    def require_exactly_one_source(self) -> SynthesizeControl:
        if (self.text is None) == (self.clip_id is None):
            raise ValueError("exactly one of text or clipId is required")
        return self


class CancelSynthesisControl(ProtocolModel):
    type: Literal["cancel_synthesis"] = "cancel_synthesis"
    scope: Literal["job", "response", "all"]
    job_id: Identifier | None = None
    response_id: Identifier | None = None
    reason: ShortText = "client_cancelled"

    @model_validator(mode="after")
    def bind_scope_to_identifier(self) -> CancelSynthesisControl:
        expected_job = self.scope == "job"
        expected_response = self.scope == "response"
        if (self.job_id is not None) != expected_job:
            raise ValueError("job scope requires only jobId")
        if (self.response_id is not None) != expected_response:
            raise ValueError("response scope requires only responseId")
        return self


class AckTtsAudioControl(ProtocolModel):
    type: Literal["ack_tts_audio"] = "ack_tts_audio"
    job_id: Identifier
    response_id: Identifier
    frame_sequence: int = Field(ge=0)
    byte_length: int = Field(ge=2, multiple_of=2)


class SetVoiceControl(ProtocolModel):
    type: Literal["set_voice"] = "set_voice"
    actor: Identifier
    voice_id: Identifier


class PingControl(ProtocolModel):
    type: Literal["ping"] = "ping"
    nonce: Identifier
    sent_at_ms: int = Field(ge=0)


ClientControlMessage: TypeAlias = Annotated[
    HelloControl
    | LoadModelsControl
    | StartUtteranceControl
    | AudioChunkControl
    | EndUtteranceControl
    | CancelUtteranceControl
    | SynthesizeControl
    | CancelSynthesisControl
    | AckTtsAudioControl
    | SetVoiceControl
    | PingControl,
    Field(discriminator="type"),
]


class CudaCapability(ProtocolModel):
    available: bool
    device_name: ShortText | None = None
    driver_version: ShortText | None = None
    compute_capability: ShortText | None = None
    vram_mb: int | None = Field(default=None, ge=0)
    diagnostic: ShortText | None = None


class ProviderCapability(ProtocolModel):
    provider_id: Identifier
    kind: Literal["stt", "tts", "vad"]
    configured: bool
    loaded: bool
    ready: bool
    device: Literal["cuda", "cpu", "fake", "unavailable"]
    model_id: ShortText | None = None
    supports_streaming: bool
    supports_timings: bool = False
    warmup_latency_ms: int | None = Field(default=None, ge=0)
    diagnostic: ShortText | None = None


class ReadyEvent(ProtocolModel):
    type: Literal["ready"] = "ready"
    session_id: Identifier
    service_version: Literal[SERVICE_VERSION] = SERVICE_VERSION
    mode: Literal["fake", "cpu", "cuda"]


class CapabilitiesEvent(ProtocolModel):
    type: Literal["capabilities"] = "capabilities"
    request_id: Identifier | None = None
    providers: tuple[ProviderCapability, ...]
    cuda: CudaCapability
    cached_clip_ids: tuple[Identifier, ...] = ()
    max_tts_queue_depth: int = Field(ge=1, le=256)
    max_audio_chunk_bytes: int = Field(default=262_144, ge=2)


class SpeechStartedEvent(ProtocolModel):
    type: Literal["speech_started"] = "speech_started"
    utterance_id: Identifier
    detected_at_ms: int = Field(ge=0)


class SttPartialEvent(ProtocolModel):
    type: Literal["stt_partial"] = "stt_partial"
    utterance_id: Identifier
    revision: int = Field(ge=1)
    text: SpeechText
    confidence: float | None = Field(default=None, ge=0, le=1)
    audio_end_ms: int = Field(ge=0)
    emitted_at_ms: int = Field(ge=0)


class SttFinalEvent(ProtocolModel):
    type: Literal["stt_final"] = "stt_final"
    utterance_id: Identifier
    revision: int = Field(ge=1)
    text: SpeechText
    confidence: float | None = Field(default=None, ge=0, le=1)
    audio_end_ms: int = Field(ge=0)
    emitted_at_ms: int = Field(ge=0)


class SpeechEndedEvent(ProtocolModel):
    type: Literal["speech_ended"] = "speech_ended"
    utterance_id: Identifier
    reason: Literal["client_end", "vad_end", "cancelled", "disconnect"]
    detected_at_ms: int = Field(ge=0)


class TtsStartedEvent(ProtocolModel):
    type: Literal["tts_started"] = "tts_started"
    job_id: Identifier
    response_id: Identifier
    actor: Identifier
    sequence: int = Field(ge=0)
    voice_id: Identifier
    cached: bool
    queue_latency_ms: int = Field(ge=0)


class TtsAudioEvent(ProtocolModel):
    """Metadata for the binary audio frame sent immediately after this event."""

    type: Literal["tts_audio"] = "tts_audio"
    job_id: Identifier
    response_id: Identifier
    actor: Identifier
    sequence: int = Field(ge=0)
    frame_sequence: int = Field(ge=0)
    byte_length: int = Field(ge=2, multiple_of=2)
    duration_ms: int = Field(gt=0)
    sample_rate_hz: int = Field(ge=8_000, le=48_000)
    channels: Literal[1] = 1
    encoding: Literal["pcm_s16le"] = "pcm_s16le"
    ack_required: Literal[True] = True


class TimingMark(ProtocolModel):
    kind: Literal["phrase", "word", "viseme"]
    value: ShortText
    start_ms: int = Field(ge=0)
    end_ms: int = Field(ge=0)

    @model_validator(mode="after")
    def require_ordered_interval(self) -> TimingMark:
        if self.end_ms < self.start_ms:
            raise ValueError("endMs must be greater than or equal to startMs")
        return self


class TtsTimingEvent(ProtocolModel):
    type: Literal["tts_timing"] = "tts_timing"
    job_id: Identifier
    response_id: Identifier
    actor: Identifier
    sequence: int = Field(ge=0)
    marks: tuple[TimingMark, ...] = Field(max_length=2_048)


class TtsFinishedEvent(ProtocolModel):
    type: Literal["tts_finished"] = "tts_finished"
    job_id: Identifier
    response_id: Identifier
    actor: Identifier
    sequence: int = Field(ge=0)
    audio_duration_ms: int = Field(ge=0)
    synthesis_latency_ms: int = Field(ge=0)


class CancelledEvent(ProtocolModel):
    type: Literal["cancelled"] = "cancelled"
    target: Literal["utterance", "job", "response", "all_synthesis"]
    target_id: Identifier | None = None
    reason: ShortText
    cancellation_latency_ms: int = Field(ge=0)

    @model_validator(mode="after")
    def require_target_identifier(self) -> CancelledEvent:
        requires_id = self.target != "all_synthesis"
        if (self.target_id is not None) != requires_id:
            raise ValueError("targetId must match the cancellation target")
        return self


class Metric(ProtocolModel):
    name: Identifier
    value: float
    unit: Literal["count", "bytes", "milliseconds", "ratio"]


class MetricsEvent(ProtocolModel):
    type: Literal["metrics"] = "metrics"
    utterance_id: Identifier | None = None
    job_id: Identifier | None = None
    metrics: tuple[Metric, ...] = Field(min_length=1, max_length=64)


class FlowControlEvent(ProtocolModel):
    type: Literal["flow_control"] = "flow_control"
    stt_available_frames: int = Field(ge=0)
    stt_available_bytes: int = Field(ge=0)
    tts_window_bytes: int = Field(ge=2)
    tts_outstanding_bytes: int = Field(ge=0)


class ErrorEvent(ProtocolModel):
    type: Literal["error"] = "error"
    code: Identifier
    message: ShortText
    request_id: Identifier | None = None
    utterance_id: Identifier | None = None
    job_id: Identifier | None = None
    retryable: bool
    fatal: bool = False


class PongEvent(ProtocolModel):
    type: Literal["pong"] = "pong"
    nonce: Identifier
    received_at_ms: int = Field(ge=0)


ServerEvent: TypeAlias = Annotated[
    ReadyEvent
    | CapabilitiesEvent
    | SpeechStartedEvent
    | SttPartialEvent
    | SttFinalEvent
    | SpeechEndedEvent
    | TtsStartedEvent
    | TtsAudioEvent
    | TtsTimingEvent
    | TtsFinishedEvent
    | CancelledEvent
    | MetricsEvent
    | FlowControlEvent
    | ErrorEvent
    | PongEvent,
    Field(discriminator="type"),
]

_CLIENT_ADAPTER = TypeAdapter(ClientControlMessage)
_SERVER_ADAPTER = TypeAdapter(ServerEvent)


def parse_client_control(payload: str) -> ClientControlMessage:
    """Parse one JSON control frame. Binary audio is handled separately."""

    return _CLIENT_ADAPTER.validate_json(payload)


def parse_server_event(payload: str) -> ServerEvent:
    """Parse one server JSON event."""

    return _SERVER_ADAPTER.validate_json(payload)


def dump_message(message: ProtocolModel) -> str:
    """Serialize a protocol message using its strict wire aliases."""

    return message.model_dump_json(by_alias=True, exclude_none=True)
