"""Deterministic fake providers for protocol, integration, and CI tests."""

from __future__ import annotations

import asyncio
import hashlib
import math
import sys
from array import array

from .base import (
    AudioChunk,
    ProviderCancelled,
    ProviderStatus,
    SynthesizedPhrase,
    SynthesisTiming,
    TranscriptHypothesis,
)


class FakeSttSession:
    def __init__(
        self,
        *,
        partials: tuple[str, ...],
        final_text: str,
    ) -> None:
        self._partials = partials
        self._final_text = final_text
        self._next_sequence = 0
        self._audio_end_ms = 0
        self._cancelled = False

    async def push_audio(
        self,
        chunk: AudioChunk,
    ) -> tuple[TranscriptHypothesis, ...]:
        if self._cancelled:
            raise ProviderCancelled("STT session was cancelled")
        if chunk.sequence != self._next_sequence:
            raise ValueError(f"expected audio sequence {self._next_sequence}, got {chunk.sequence}")
        self._next_sequence += 1
        self._audio_end_ms += chunk.duration_ms
        partial_index = chunk.sequence
        if partial_index >= len(self._partials):
            return ()
        return (
            TranscriptHypothesis(
                text=self._partials[partial_index],
                is_final=False,
                confidence=1.0,
                audio_end_ms=self._audio_end_ms,
            ),
        )

    async def finish(self) -> TranscriptHypothesis:
        if self._cancelled:
            raise ProviderCancelled("STT session was cancelled")
        return TranscriptHypothesis(
            text=self._final_text,
            is_final=True,
            confidence=1.0,
            audio_end_ms=self._audio_end_ms,
        )

    async def cancel(self) -> None:
        self._cancelled = True


class FakeSttProvider:
    def __init__(
        self,
        *,
        partials: tuple[str, ...] = (
            "May",
            "May it please",
            "May it please the court.",
        ),
        final_text: str = "May it please the court.",
    ) -> None:
        self._partials = partials
        self._final_text = final_text
        self._loaded = False

    @property
    def status(self) -> ProviderStatus:
        return ProviderStatus(
            provider_id="fake-stt",
            kind="stt",
            configured=True,
            loaded=self._loaded,
            ready=self._loaded,
            device="fake",
            model_id=None,
            supports_streaming=True,
            supports_timings=True,
            warmup_latency_ms=0 if self._loaded else None,
        )

    async def load(self) -> ProviderStatus:
        self._loaded = True
        return self.status

    async def create_session(self, *, sample_rate_hz: int) -> FakeSttSession:
        if not self._loaded:
            raise RuntimeError("fake STT provider is not loaded")
        if sample_rate_hz != 16_000:
            raise ValueError("fake STT expects 16 kHz mono PCM")
        return FakeSttSession(
            partials=self._partials,
            final_text=self._final_text,
        )


class FakeTtsProvider:
    def __init__(self) -> None:
        self._loaded = False

    @property
    def status(self) -> ProviderStatus:
        return ProviderStatus(
            provider_id="fake-tts",
            kind="tts",
            configured=True,
            loaded=self._loaded,
            ready=self._loaded,
            device="fake",
            model_id=None,
            supports_streaming=False,
            supports_timings=True,
            warmup_latency_ms=0 if self._loaded else None,
            diagnostic="deterministic phrase synthesis for CI",
        )

    async def load(self) -> ProviderStatus:
        self._loaded = True
        return self.status

    async def synthesize_phrase(
        self,
        *,
        text: str,
        voice_id: str,
        cancel_event: asyncio.Event,
    ) -> SynthesizedPhrase:
        if not self._loaded:
            raise RuntimeError("fake TTS provider is not loaded")
        await asyncio.sleep(0)
        if cancel_event.is_set():
            raise ProviderCancelled("TTS job was cancelled")

        sample_rate_hz = 24_000
        duration_ms = max(120, min(900, 80 + len(text) * 9))
        sample_count = sample_rate_hz * duration_ms // 1_000
        voice_digest = hashlib.sha256(voice_id.encode("utf-8")).digest()
        frequency_hz = 180 + int.from_bytes(voice_digest[:2], "big") % 180
        samples = array(
            "h",
            (
                int(1_200 * math.sin(2 * math.pi * frequency_hz * index / sample_rate_hz))
                for index in range(sample_count)
            ),
        )
        if sys.byteorder != "little":
            samples.byteswap()

        words = text.split()
        word_duration_ms = max(1, duration_ms // max(1, len(words)))
        timings = tuple(
            SynthesisTiming(
                kind="word",
                value=word,
                start_ms=index * word_duration_ms,
                end_ms=(
                    duration_ms
                    if index == len(words) - 1
                    else min(duration_ms, (index + 1) * word_duration_ms)
                ),
            )
            for index, word in enumerate(words)
        )
        return SynthesizedPhrase(
            pcm_s16le=samples.tobytes(),
            sample_rate_hz=sample_rate_hz,
            channels=1,
            duration_ms=duration_ms,
            timings=timings,
        )
