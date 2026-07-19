"""Honest placeholders for configured optional providers that are not installed."""

from __future__ import annotations

import asyncio

from .base import ProviderStatus, StreamingSttSession, SynthesizedPhrase


class UnavailableSttProvider:
    def __init__(self, *, provider_id: str, model_id: str, diagnostic: str) -> None:
        self._status = ProviderStatus(
            provider_id=provider_id,
            kind="stt",
            configured=True,
            loaded=False,
            ready=False,
            device="unavailable",
            model_id=model_id,
            supports_streaming=True,
            supports_timings=True,
            diagnostic=diagnostic,
        )

    @property
    def status(self) -> ProviderStatus:
        return self._status

    async def load(self) -> ProviderStatus:
        return self._status

    async def create_session(self, *, sample_rate_hz: int) -> StreamingSttSession:
        del sample_rate_hz
        raise RuntimeError(self._status.diagnostic or "STT provider unavailable")


class UnavailableTtsProvider:
    def __init__(self, *, provider_id: str, model_id: str, diagnostic: str) -> None:
        self._status = ProviderStatus(
            provider_id=provider_id,
            kind="tts",
            configured=True,
            loaded=False,
            ready=False,
            device="unavailable",
            model_id=model_id,
            supports_streaming=False,
            supports_timings=False,
            diagnostic=diagnostic,
        )

    @property
    def status(self) -> ProviderStatus:
        return self._status

    async def load(self) -> ProviderStatus:
        return self._status

    async def synthesize_phrase(
        self,
        *,
        text: str,
        voice_id: str,
        cancel_event: asyncio.Event,
    ) -> SynthesizedPhrase:
        del text, voice_id, cancel_event
        raise RuntimeError(self._status.diagnostic or "TTS provider unavailable")
