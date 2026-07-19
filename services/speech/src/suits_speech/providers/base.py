"""Provider-neutral speech interfaces.

Providers receive in-memory PCM and return in-memory text/audio. Persisting raw
audio is intentionally outside these interfaces.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Literal, Protocol


class ProviderCancelled(RuntimeError):
    """Raised when work is requested after a provider session is cancelled."""


@dataclass(frozen=True, slots=True)
class AudioChunk:
    sequence: int
    pcm_s16le: bytes
    duration_ms: int


@dataclass(frozen=True, slots=True)
class TranscriptHypothesis:
    text: str
    is_final: bool
    confidence: float | None
    audio_end_ms: int


@dataclass(frozen=True, slots=True)
class SynthesisTiming:
    kind: Literal["phrase", "word", "viseme"]
    value: str
    start_ms: int
    end_ms: int


@dataclass(frozen=True, slots=True)
class SynthesizedPhrase:
    pcm_s16le: bytes
    sample_rate_hz: int
    channels: Literal[1]
    duration_ms: int
    timings: tuple[SynthesisTiming, ...]


@dataclass(frozen=True, slots=True)
class ProviderStatus:
    provider_id: str
    kind: Literal["stt", "tts"]
    configured: bool
    loaded: bool
    ready: bool
    device: Literal["cuda", "cpu", "fake", "unavailable"]
    model_id: str | None
    supports_streaming: bool
    supports_timings: bool
    warmup_latency_ms: int | None = None
    diagnostic: str | None = None


class StreamingSttSession(Protocol):
    async def push_audio(self, chunk: AudioChunk) -> tuple[TranscriptHypothesis, ...]:
        """Consume one ordered PCM chunk and return zero or more revisions."""

    async def finish(self) -> TranscriptHypothesis:
        """Flush and return the final hypothesis."""

    async def cancel(self) -> None:
        """Cancel the session and release its resources."""


class SttProvider(Protocol):
    @property
    def status(self) -> ProviderStatus:
        """Return a non-loading readiness snapshot."""

    async def load(self) -> ProviderStatus:
        """Load already-installed artifacts; never download implicitly."""

    async def create_session(
        self,
        *,
        sample_rate_hz: int,
    ) -> StreamingSttSession:
        """Create one isolated streaming recognizer session."""


class TtsProvider(Protocol):
    @property
    def status(self) -> ProviderStatus:
        """Return a non-loading readiness snapshot."""

    async def load(self) -> ProviderStatus:
        """Load already-installed artifacts; never download implicitly."""

    async def synthesize_phrase(
        self,
        *,
        text: str,
        voice_id: str,
        cancel_event: asyncio.Event,
    ) -> SynthesizedPhrase:
        """Synthesize one phrase; the queue owns phrase-level streaming."""
