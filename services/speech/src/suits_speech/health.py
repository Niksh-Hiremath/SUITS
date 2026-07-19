"""Non-loading health and capability inspection for the speech service."""

from __future__ import annotations

import asyncio
import shutil
import subprocess
from typing import cast

from .config import SpeechSettings
from .protocol import (
    CapabilitiesEvent,
    CudaCapability,
    ProviderCapability,
)
from .providers import (
    FakeSttProvider,
    FakeTtsProvider,
    UnavailableSttProvider,
    UnavailableTtsProvider,
)
from .providers.base import (
    ProviderStatus,
    SttProvider,
    SynthesizedPhrase,
    TtsProvider,
)
from .tts_lane import TtsLaneSnapshot, TtsProviderLane


def detect_cuda(*, fake_mode: bool) -> CudaCapability:
    executable = shutil.which("nvidia-smi")
    if executable is None:
        return CudaCapability(
            available=False,
            diagnostic="nvidia-smi is not available; CUDA speech is unverified",
        )
    command = [
        executable,
        "--query-gpu=name,driver_version,memory.total,compute_cap",
        "--format=csv,noheader,nounits",
    ]
    creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    try:
        completed = subprocess.run(
            command,
            check=True,
            capture_output=True,
            text=True,
            timeout=5,
            creationflags=creation_flags,
        )
        first_gpu = completed.stdout.strip().splitlines()[0]
        name, driver, memory_mb, compute = (
            value.strip() for value in first_gpu.split(",", maxsplit=3)
        )
        diagnostic = (
            "hardware visible; fake mode does not verify CUDA providers"
            if fake_mode
            else "hardware visible; provider/model readiness is reported separately"
        )
        return CudaCapability(
            available=True,
            device_name=name,
            driver_version=driver,
            compute_capability=compute,
            vram_mb=int(memory_mb),
            diagnostic=diagnostic,
        )
    except (OSError, subprocess.SubprocessError, ValueError, IndexError) as error:
        return CudaCapability(
            available=False,
            diagnostic=f"CUDA probe failed: {type(error).__name__}",
        )


def _provider_capability(status: ProviderStatus) -> ProviderCapability:
    return ProviderCapability(
        provider_id=status.provider_id,
        kind=status.kind,
        configured=status.configured,
        loaded=status.loaded,
        ready=status.ready,
        device=status.device,
        model_id=status.model_id,
        supports_streaming=status.supports_streaming,
        supports_timings=status.supports_timings,
        warmup_latency_ms=status.warmup_latency_ms,
        diagnostic=status.diagnostic,
    )


class SpeechRuntime:
    """Process-level providers and immutable hardware discovery."""

    def __init__(
        self,
        *,
        settings: SpeechSettings,
        stt_provider: SttProvider | None = None,
        tts_provider: TtsProvider | None = None,
    ) -> None:
        self.settings = settings
        self.stt_provider = stt_provider or self._default_stt_provider(settings)
        self.tts_provider = tts_provider or self._default_tts_provider(settings)
        self._tts_lane = TtsProviderLane(
            provider=self.tts_provider,
            call_timeout_seconds=settings.tts_max_phrase_duration_ms / 1_000,
        )
        self.cuda = detect_cuda(fake_mode=settings.mode == "fake")
        self.cached_clip_ids: tuple[str, ...] = ()
        self._load_lock = asyncio.Lock()

    @property
    def models_ready(self) -> bool:
        return self.stt_provider.status.ready and self.tts_provider.status.ready

    @property
    def tts_lane_snapshot(self) -> TtsLaneSnapshot:
        return self._tts_lane.snapshot

    async def synthesize_phrase(
        self,
        *,
        text: str,
        voice_id: str,
        cancel_event: asyncio.Event,
    ) -> SynthesizedPhrase:
        """Serialize a physical provider call across all connections."""

        return await self._tts_lane.synthesize_phrase(
            text=text,
            voice_id=voice_id,
            cancel_event=cancel_event,
        )

    async def load_models(self) -> CapabilitiesEvent:
        """Load configured local artifacts. Providers may not download here."""

        async with self._load_lock:
            await asyncio.gather(
                self.stt_provider.load(),
                self.tts_provider.load(),
            )
            return self.capabilities()

    def capabilities(self, *, request_id: str | None = None) -> CapabilitiesEvent:
        vad = ProviderCapability(
            provider_id="energy-vad",
            kind="vad",
            configured=True,
            loaded=True,
            ready=True,
            device="cpu",
            model_id=None,
            supports_streaming=True,
            supports_timings=False,
            warmup_latency_ms=0,
            diagnostic="dependency-free local RMS VAD",
        )
        return CapabilitiesEvent(
            request_id=request_id,
            providers=(
                _provider_capability(self.stt_provider.status),
                _provider_capability(self.tts_provider.status),
                vad,
            ),
            cuda=self.cuda,
            cached_clip_ids=self.cached_clip_ids,
            max_tts_queue_depth=self.settings.max_tts_queue_depth,
        )

    @staticmethod
    def _default_stt_provider(settings: SpeechSettings) -> SttProvider:
        if settings.stt_provider == "fake-stt":
            return cast(SttProvider, FakeSttProvider())
        return cast(
            SttProvider,
            UnavailableSttProvider(
                provider_id=settings.stt_provider,
                model_id=(f"{settings.stt_model_id}@{settings.stt_model_revision}"),
                diagnostic=(
                    "configured Nemotron adapter is not installed or its pinned "
                    "artifacts are not ready"
                ),
            ),
        )

    @staticmethod
    def _default_tts_provider(settings: SpeechSettings) -> TtsProvider:
        if settings.tts_provider == "fake-tts":
            return cast(TtsProvider, FakeTtsProvider())
        return cast(
            TtsProvider,
            UnavailableTtsProvider(
                provider_id=settings.tts_provider,
                model_id=(f"{settings.tts_model_id}@{settings.tts_model_revision}"),
                diagnostic=(
                    "configured Kokoro adapter is not installed or its pinned "
                    "artifacts are not ready"
                ),
            ),
        )
