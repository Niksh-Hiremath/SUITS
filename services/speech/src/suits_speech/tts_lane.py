"""Process-level serialization and lifecycle fencing for TTS providers."""

from __future__ import annotations

import asyncio
import math
from dataclasses import dataclass

from .providers.base import (
    ProviderCancelled,
    SynthesizedPhrase,
    TtsProvider,
)


class TtsLaneError(RuntimeError):
    """Base error for process-level TTS lane failures."""


class TtsProviderTimeoutError(TtsLaneError):
    """Raised when a provider call exceeds its configured deadline."""


class TtsLaneQuarantinedError(TtsLaneError):
    """Raised when provider termination could not be proven safe."""


@dataclass(frozen=True, slots=True)
class TtsLaneSnapshot:
    """Privacy-safe diagnostics for the process-level provider lane."""

    busy: bool
    provider_call_active: bool
    quarantined: bool
    diagnostic: str | None


class TtsProviderLane:
    """Serialize physical TTS calls and fence uncooperative providers.

    The provider task remains strongly referenced for its full physical
    lifetime. If cancellation cannot stop it within the grace period, this
    lane is quarantined until process restart and retains ownership until the
    task actually ends. No phrase text, voice ID, or audio is retained in lane
    diagnostics.
    """

    def __init__(
        self,
        *,
        provider: TtsProvider,
        call_timeout_seconds: float,
        cancellation_grace_seconds: float = 0.15,
    ) -> None:
        if not math.isfinite(call_timeout_seconds) or call_timeout_seconds <= 0:
            raise ValueError("call_timeout_seconds must be finite and positive")
        if not math.isfinite(cancellation_grace_seconds) or cancellation_grace_seconds <= 0:
            raise ValueError("cancellation_grace_seconds must be finite and positive")

        self._provider = provider
        self._call_timeout_seconds = call_timeout_seconds
        self._cancellation_grace_seconds = cancellation_grace_seconds
        self._busy = False
        self._available = asyncio.Event()
        self._available.set()
        self._quarantined = asyncio.Event()
        self._quarantine_diagnostic: str | None = None
        self._active_task: asyncio.Task[SynthesizedPhrase] | None = None
        self._quarantine_watcher: asyncio.Task[None] | None = None

    @property
    def snapshot(self) -> TtsLaneSnapshot:
        return TtsLaneSnapshot(
            busy=self._busy,
            provider_call_active=(self._active_task is not None and not self._active_task.done()),
            quarantined=self._quarantine_diagnostic is not None,
            diagnostic=self._quarantine_diagnostic,
        )

    async def synthesize_phrase(
        self,
        *,
        text: str,
        voice_id: str,
        cancel_event: asyncio.Event,
    ) -> SynthesizedPhrase:
        """Run one provider call with process-level serialization."""

        await self._enter(cancel_event)
        provider_task: asyncio.Task[SynthesizedPhrase] | None = None
        provider_cancel_event = asyncio.Event()
        try:
            if cancel_event.is_set():
                raise ProviderCancelled("TTS job was cancelled while waiting for provider")
            self._raise_if_quarantined()

            provider_task = asyncio.create_task(
                self._provider.synthesize_phrase(
                    text=text,
                    voice_id=voice_id,
                    cancel_event=provider_cancel_event,
                ),
                name="suits-tts-provider-call",
            )
            self._active_task = provider_task
            return await self._await_provider(
                provider_task=provider_task,
                caller_cancel_event=cancel_event,
                provider_cancel_event=provider_cancel_event,
            )
        except asyncio.CancelledError:
            if provider_task is not None and not provider_task.done():
                await self._stop_or_quarantine(
                    provider_task=provider_task,
                    provider_cancel_event=provider_cancel_event,
                    reason="the owning synthesis task was cancelled",
                )
            raise
        finally:
            if provider_task is not None and not provider_task.done():
                self._quarantine(
                    provider_task,
                    "provider work remained active after synthesis returned",
                )
            elif self._quarantine_diagnostic is None:
                self._release(provider_task)

    async def _enter(self, cancel_event: asyncio.Event) -> None:
        while True:
            if cancel_event.is_set():
                raise ProviderCancelled("TTS job was cancelled while waiting for provider")
            self._raise_if_quarantined()
            if not self._busy:
                # No await occurs between the check and assignment, so this is
                # atomic with respect to other tasks on the runtime event loop.
                self._busy = True
                self._available.clear()
                if cancel_event.is_set():
                    self._release(None)
                    raise ProviderCancelled("TTS job was cancelled while waiting for provider")
                self._raise_if_quarantined()
                return

            available_waiter = asyncio.create_task(self._available.wait())
            cancel_waiter = asyncio.create_task(cancel_event.wait())
            quarantine_waiter = asyncio.create_task(self._quarantined.wait())
            waiters = (available_waiter, cancel_waiter, quarantine_waiter)
            try:
                await asyncio.wait(waiters, return_when=asyncio.FIRST_COMPLETED)
            finally:
                for waiter in waiters:
                    if not waiter.done():
                        waiter.cancel()
                await asyncio.gather(*waiters, return_exceptions=True)

    async def _await_provider(
        self,
        *,
        provider_task: asyncio.Task[SynthesizedPhrase],
        caller_cancel_event: asyncio.Event,
        provider_cancel_event: asyncio.Event,
    ) -> SynthesizedPhrase:
        cancel_waiter = asyncio.create_task(caller_cancel_event.wait())
        try:
            done, _ = await asyncio.wait(
                (provider_task, cancel_waiter),
                timeout=self._call_timeout_seconds,
                return_when=asyncio.FIRST_COMPLETED,
            )
            if provider_task in done:
                result = provider_task.result()
                if caller_cancel_event.is_set():
                    raise ProviderCancelled("TTS job was cancelled")
                return result

            if caller_cancel_event.is_set():
                stopped = await self._stop_or_quarantine(
                    provider_task=provider_task,
                    provider_cancel_event=provider_cancel_event,
                    reason="provider ignored active-job cancellation",
                )
                if not stopped:
                    self._raise_if_quarantined()
                raise ProviderCancelled("TTS job was cancelled")

            stopped = await self._stop_or_quarantine(
                provider_task=provider_task,
                provider_cancel_event=provider_cancel_event,
                reason=(
                    "provider exceeded its deadline and did not terminate "
                    "within the cancellation grace period"
                ),
            )
            if not stopped:
                self._raise_if_quarantined()
            raise TtsProviderTimeoutError("TTS provider exceeded the bounded synthesis deadline")
        finally:
            if not cancel_waiter.done():
                cancel_waiter.cancel()
            await asyncio.gather(cancel_waiter, return_exceptions=True)

    async def _stop_or_quarantine(
        self,
        *,
        provider_task: asyncio.Task[SynthesizedPhrase],
        provider_cancel_event: asyncio.Event,
        reason: str,
    ) -> bool:
        provider_cancel_event.set()
        try:
            done, _ = await asyncio.wait(
                (provider_task,),
                timeout=self._cancellation_grace_seconds,
            )
        except asyncio.CancelledError:
            self._quarantine(
                provider_task,
                "provider shutdown was interrupted before termination was proven",
            )
            raise
        if provider_task in done:
            self._consume_terminal_task(provider_task)
            return True
        self._quarantine(provider_task, reason)
        return False

    def _quarantine(
        self,
        provider_task: asyncio.Task[SynthesizedPhrase],
        reason: str,
    ) -> None:
        if self._quarantine_diagnostic is None:
            self._quarantine_diagnostic = (
                f"TTS provider lane quarantined: {reason}; restart the local "
                "speech service before retrying"
            )
            self._quarantined.set()
        if self._quarantine_watcher is None:
            self._quarantine_watcher = asyncio.create_task(
                self._hold_lane_until_provider_exits(provider_task),
                name="suits-tts-quarantine-watcher",
            )

    async def _hold_lane_until_provider_exits(
        self,
        provider_task: asyncio.Task[SynthesizedPhrase],
    ) -> None:
        late_outcome: str | None = None
        try:
            await asyncio.shield(provider_task)
        except asyncio.CancelledError:
            late_outcome = "cancelled"
        except BaseException as error:
            late_outcome = type(error).__name__
        finally:
            if late_outcome is not None and self._quarantine_diagnostic is not None:
                self._quarantine_diagnostic = (
                    f"{self._quarantine_diagnostic}; late provider outcome: {late_outcome}"
                )
            self._release(provider_task)

    def _release(
        self,
        provider_task: asyncio.Task[SynthesizedPhrase] | None,
    ) -> None:
        if provider_task is None or self._active_task is provider_task:
            self._active_task = None
        self._busy = False
        self._available.set()

    def _raise_if_quarantined(self) -> None:
        if self._quarantine_diagnostic is not None:
            raise TtsLaneQuarantinedError(self._quarantine_diagnostic)

    @staticmethod
    def _consume_terminal_task(
        provider_task: asyncio.Task[SynthesizedPhrase],
    ) -> None:
        try:
            provider_task.exception()
        except asyncio.CancelledError:
            pass
