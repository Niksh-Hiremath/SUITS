"""Non-loading health and capability inspection for the speech service."""

from __future__ import annotations

import asyncio
import logging
import shutil
import subprocess
from dataclasses import dataclass
from typing import Literal, cast

from .capacity import BoundedLeasePool, CapacityLease, CapacitySnapshot
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
    AudioChunk,
    ProviderStatus,
    SttProvider,
    StreamingSttSession,
    SynthesizedPhrase,
    TranscriptHypothesis,
    TtsProvider,
)
from .tts_lane import TtsLaneSnapshot, TtsProviderLane


_LOGGER = logging.getLogger(__name__)


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


class SttSessionCapacityError(RuntimeError):
    """Raised when all process-level recognizer slots are already leased."""


@dataclass(frozen=True, slots=True)
class RuntimeCapacitySnapshot:
    """Connection and recognizer admission state for diagnostics and tests."""

    connections: CapacitySnapshot
    stt_sessions: CapacitySnapshot


class _LeasedStreamingSttSession:
    """Return recognizer capacity exactly once on either terminal operation."""

    def __init__(
        self,
        *,
        session: StreamingSttSession,
        lease: CapacityLease,
    ) -> None:
        self._session = session
        self._lease = lease
        self._terminal: (
            Literal[
                "finishing",
                "cancelling",
                "finished",
                "cancelled",
                "quarantined",
            ]
            | None
        ) = None
        self._state_lock = asyncio.Lock()
        self._inflight_pushes = 0
        self._finish_inflight = False
        self._orphaned_call = False

    async def push_audio(self, chunk: AudioChunk) -> tuple[TranscriptHypothesis, ...]:
        async with self._state_lock:
            if self._terminal is not None:
                raise RuntimeError("STT session is already terminal")
            self._inflight_pushes += 1
        orphaned = False
        try:
            return await self._session.push_audio(chunk)
        except asyncio.CancelledError:
            orphaned = True
            raise
        finally:
            async with self._state_lock:
                self._inflight_pushes -= 1
                if orphaned:
                    self._orphaned_call = True
                    self._terminal = "quarantined"
                self._release_if_safe_locked()

    async def finish(self) -> TranscriptHypothesis:
        async with self._state_lock:
            if self._terminal is not None:
                raise RuntimeError("STT session is already terminal")
            if self._inflight_pushes != 0:
                raise RuntimeError("STT session still has active audio work")
            self._terminal = "finishing"
            self._finish_inflight = True
        orphaned = False
        try:
            result = await self._session.finish()
        except asyncio.CancelledError:
            orphaned = True
            raise
        finally:
            async with self._state_lock:
                self._finish_inflight = False
                if orphaned:
                    self._orphaned_call = True
                    self._terminal = "quarantined"
                elif self._terminal == "finishing":
                    self._terminal = "finished"
                self._release_if_safe_locked()
        return result

    async def cancel(self) -> None:
        async with self._state_lock:
            if self._terminal in {"finished", "cancelled"}:
                return
            if self._terminal == "cancelling":
                raise RuntimeError("STT session cancellation is already active")
            if self._terminal == "quarantined":
                return
            self._terminal = "cancelling"
        try:
            await self._session.cancel()
        except asyncio.CancelledError:
            async with self._state_lock:
                self._orphaned_call = True
                self._terminal = "quarantined"
            raise
        except BaseException:
            async with self._state_lock:
                self._terminal = "quarantined"
            raise
        async with self._state_lock:
            self._terminal = "cancelled"
            self._release_if_safe_locked()

    def _release_if_safe_locked(self) -> None:
        if (
            self._terminal in {"finished", "cancelled"}
            and self._inflight_pushes == 0
            and not self._finish_inflight
            and not self._orphaned_call
        ):
            self._lease.release()


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
        self._connection_pool = BoundedLeasePool(limit=settings.max_connections)
        self._stt_session_pool = BoundedLeasePool(limit=settings.max_stt_sessions)
        self._stt_creation_tasks: set[asyncio.Task[StreamingSttSession]] = set()
        self._stt_cleanup_tasks: set[asyncio.Task[None]] = set()
        self.cuda = detect_cuda(fake_mode=settings.mode == "fake")
        self.cached_clip_ids: tuple[str, ...] = ()
        self._load_lock = asyncio.Lock()
        self._load_task: asyncio.Task[CapabilitiesEvent] | None = None

    @property
    def models_ready(self) -> bool:
        return (
            self.stt_provider.status.ready
            and self.tts_provider.status.ready
            and self._stt_session_pool.snapshot.available > 0
            and not self._tts_lane.snapshot.quarantined
        )

    @property
    def tts_lane_snapshot(self) -> TtsLaneSnapshot:
        return self._tts_lane.snapshot

    @property
    def capacity_snapshot(self) -> RuntimeCapacitySnapshot:
        return RuntimeCapacitySnapshot(
            connections=self._connection_pool.snapshot,
            stt_sessions=self._stt_session_pool.snapshot,
        )

    def try_acquire_connection(self) -> CapacityLease | None:
        """Claim one WebSocket slot immediately, or reject process overload."""

        return self._connection_pool.try_acquire()

    async def create_stt_session(self, *, sample_rate_hz: int) -> StreamingSttSession:
        """Create one capacity-bound recognizer session without waiting for a slot."""

        lease = self._stt_session_pool.try_acquire()
        if lease is None:
            raise SttSessionCapacityError("local STT recognizer capacity is exhausted")
        provider_task = asyncio.create_task(
            self.stt_provider.create_session(sample_rate_hz=sample_rate_hz),
            name="speech:stt:create",
        )
        self._stt_creation_tasks.add(provider_task)
        provider_task.add_done_callback(self._stt_creation_done)
        try:
            session = await asyncio.shield(provider_task)
        except asyncio.CancelledError:
            cleanup = asyncio.create_task(
                self._dispose_abandoned_stt_creation(provider_task, lease),
                name="speech:stt:dispose-abandoned-create",
            )
            self._stt_cleanup_tasks.add(cleanup)
            cleanup.add_done_callback(self._stt_cleanup_done)
            raise
        except BaseException:
            lease.release()
            raise
        return _LeasedStreamingSttSession(session=session, lease=lease)

    async def _dispose_abandoned_stt_creation(
        self,
        provider_task: asyncio.Task[StreamingSttSession],
        lease: CapacityLease,
    ) -> None:
        try:
            session = await provider_task
        except BaseException as error:
            lease.release()
            _LOGGER.warning(
                "abandoned STT creation ended with error errorType=%s",
                type(error).__name__,
            )
            return
        try:
            await session.cancel()
        except BaseException as error:
            _LOGGER.error(
                "abandoned STT session could not be disposed errorType=%s",
                type(error).__name__,
            )
            return
        lease.release()

    def _stt_creation_done(self, task: asyncio.Task[StreamingSttSession]) -> None:
        self._stt_creation_tasks.discard(task)

    def _stt_cleanup_done(self, task: asyncio.Task[None]) -> None:
        self._stt_cleanup_tasks.discard(task)
        if task.cancelled():
            return
        error = task.exception()
        if error is not None:
            _LOGGER.error(
                "abandoned STT cleanup failed errorType=%s",
                type(error).__name__,
            )

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
            if self.models_ready:
                return self.capabilities()
            if self._load_task is None or self._load_task.done():
                self._load_task = asyncio.create_task(
                    self._load_models_once(),
                    name="speech:providers:load",
                )
            load_task = self._load_task
        return await asyncio.shield(load_task)

    async def _load_models_once(self) -> CapabilitiesEvent:
        results = await asyncio.gather(
            self._load_provider_if_needed(self.stt_provider),
            self._load_provider_if_needed(self.tts_provider),
            return_exceptions=True,
        )
        failures = tuple(result for result in results if isinstance(result, BaseException))
        if failures:
            _LOGGER.warning(
                "speech provider load failed failureCount=%s errorTypes=%s",
                len(failures),
                ",".join(sorted({type(error).__name__ for error in failures})),
            )
            raise RuntimeError("one or more local speech providers failed to load")
        return self.capabilities()

    @staticmethod
    async def _load_provider_if_needed(
        provider: SttProvider | TtsProvider,
    ) -> ProviderStatus:
        status = provider.status
        if status.ready:
            return status
        return await provider.load()

    def capabilities(self, *, request_id: str | None = None) -> CapabilitiesEvent:
        stt = _provider_capability(self.stt_provider.status)
        stt_capacity = self._stt_session_pool.snapshot
        if stt_capacity.available == 0:
            stt = stt.model_copy(
                update={
                    "ready": False,
                    "diagnostic": (
                        "local recognizer capacity is exhausted; finish the active utterance "
                        "or restart the speech service if capacity does not recover"
                    ),
                }
            )
        tts = _provider_capability(self.tts_provider.status)
        tts_lane = self._tts_lane.snapshot
        if tts_lane.quarantined:
            tts = tts.model_copy(
                update={
                    "ready": False,
                    "diagnostic": (
                        "local synthesis lane is quarantined after provider termination could "
                        "not be confirmed; restart the speech service"
                    ),
                }
            )
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
                stt,
                tts,
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
