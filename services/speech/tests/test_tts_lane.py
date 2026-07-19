from __future__ import annotations

import asyncio
import threading

import pytest

import suits_speech.health as health_module
from suits_speech.config import SpeechSettings
from suits_speech.health import SpeechRuntime
from suits_speech.protocol import CudaCapability
from suits_speech.providers.base import (
    ProviderCancelled,
    ProviderStatus,
    SynthesizedPhrase,
)
from suits_speech.tts_lane import (
    TtsLaneQuarantinedError,
    TtsProviderLane,
    TtsProviderTimeoutError,
)


def _phrase() -> SynthesizedPhrase:
    return SynthesizedPhrase(
        pcm_s16le=b"\x00\x00",
        sample_rate_hz=24_000,
        channels=1,
        duration_ms=1,
        timings=(),
    )


class _ControlledProvider:
    def __init__(self) -> None:
        self.first_entered = asyncio.Event()
        self.release_first = asyncio.Event()
        self.calls = 0
        self.active = 0
        self.max_active = 0

    @property
    def status(self) -> ProviderStatus:
        return ProviderStatus(
            provider_id="controlled-tts",
            kind="tts",
            configured=True,
            loaded=True,
            ready=True,
            device="fake",
            model_id=None,
            supports_streaming=False,
            supports_timings=True,
        )

    async def load(self) -> ProviderStatus:
        return self.status

    async def synthesize_phrase(
        self,
        *,
        text: str,
        voice_id: str,
        cancel_event: asyncio.Event,
    ) -> SynthesizedPhrase:
        del text, voice_id, cancel_event
        self.calls += 1
        call_number = self.calls
        self.active += 1
        self.max_active = max(self.max_active, self.active)
        try:
            if call_number == 1:
                self.first_entered.set()
                await self.release_first.wait()
            return _phrase()
        finally:
            self.active -= 1


class _FirstCallSlowProvider(_ControlledProvider):
    async def synthesize_phrase(
        self,
        *,
        text: str,
        voice_id: str,
        cancel_event: asyncio.Event,
    ) -> SynthesizedPhrase:
        del text, voice_id
        self.calls += 1
        call_number = self.calls
        self.active += 1
        self.max_active = max(self.max_active, self.active)
        try:
            if call_number == 1:
                self.first_entered.set()
                await cancel_event.wait()
                raise ProviderCancelled("provider observed cancellation signal")
            return _phrase()
        finally:
            self.active -= 1


class _NonCooperativeProvider(_ControlledProvider):
    async def synthesize_phrase(
        self,
        *,
        text: str,
        voice_id: str,
        cancel_event: asyncio.Event,
    ) -> SynthesizedPhrase:
        del text, voice_id, cancel_event
        self.calls += 1
        self.active += 1
        self.max_active = max(self.max_active, self.active)
        self.first_entered.set()
        try:
            while not self.release_first.is_set():
                await self.release_first.wait()
            return _phrase()
        finally:
            self.active -= 1


class _ExecutorBackedProvider(_ControlledProvider):
    def __init__(self) -> None:
        super().__init__()
        self.worker_entered = asyncio.Event()
        self.release_worker = threading.Event()

    async def synthesize_phrase(
        self,
        *,
        text: str,
        voice_id: str,
        cancel_event: asyncio.Event,
    ) -> SynthesizedPhrase:
        del text, voice_id, cancel_event
        self.calls += 1
        self.active += 1
        self.max_active = max(self.max_active, self.active)
        loop = asyncio.get_running_loop()

        def run_physical_inference() -> None:
            loop.call_soon_threadsafe(self.worker_entered.set)
            self.release_worker.wait(timeout=2)

        try:
            await asyncio.to_thread(run_physical_inference)
            return _phrase()
        finally:
            self.active -= 1


async def _wait_until_lane_is_physically_idle(lane: TtsProviderLane) -> None:
    for _ in range(100):
        if not lane.snapshot.busy:
            return
        await asyncio.sleep(0.005)
    raise AssertionError("provider task did not exit")


async def test_runtime_serializes_provider_across_shared_consumers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        health_module,
        "detect_cuda",
        lambda *, fake_mode: CudaCapability(
            available=False,
            diagnostic=f"fake_mode={fake_mode}",
        ),
    )
    provider = _ControlledProvider()
    settings = SpeechSettings.from_env({"SUITS_SPEECH_MODE": "fake"})
    runtime = SpeechRuntime(settings=settings, tts_provider=provider)

    first = asyncio.create_task(
        runtime.synthesize_phrase(
            text="first",
            voice_id="judge",
            cancel_event=asyncio.Event(),
        )
    )
    await provider.first_entered.wait()
    second = asyncio.create_task(
        runtime.synthesize_phrase(
            text="second",
            voice_id="witness",
            cancel_event=asyncio.Event(),
        )
    )
    await asyncio.sleep(0)

    assert provider.calls == 1
    assert provider.max_active == 1
    assert runtime.tts_lane_snapshot.provider_call_active is True

    provider.release_first.set()
    await asyncio.gather(first, second)
    assert provider.calls == 2
    assert provider.max_active == 1
    assert runtime.tts_lane_snapshot.provider_call_active is False


async def test_waiting_cancellation_never_enters_provider() -> None:
    provider = _ControlledProvider()
    lane = TtsProviderLane(provider=provider, call_timeout_seconds=1)
    first = asyncio.create_task(
        lane.synthesize_phrase(
            text="first",
            voice_id="judge",
            cancel_event=asyncio.Event(),
        )
    )
    await provider.first_entered.wait()

    waiting_cancel = asyncio.Event()
    second = asyncio.create_task(
        lane.synthesize_phrase(
            text="must not enter",
            voice_id="witness",
            cancel_event=waiting_cancel,
        )
    )
    await asyncio.sleep(0)
    waiting_cancel.set()

    with pytest.raises(ProviderCancelled, match="while waiting"):
        await second
    assert provider.calls == 1

    provider.release_first.set()
    await first


async def test_cooperative_timeout_is_bounded_and_lane_can_be_reused() -> None:
    provider = _FirstCallSlowProvider()
    lane = TtsProviderLane(
        provider=provider,
        call_timeout_seconds=0.01,
        cancellation_grace_seconds=0.05,
    )

    with pytest.raises(TtsProviderTimeoutError, match="bounded synthesis deadline"):
        await asyncio.wait_for(
            lane.synthesize_phrase(
                text="slow",
                voice_id="judge",
                cancel_event=asyncio.Event(),
            ),
            timeout=0.2,
        )

    assert lane.snapshot.quarantined is False
    assert lane.snapshot.provider_call_active is False
    result = await lane.synthesize_phrase(
        text="next",
        voice_id="judge",
        cancel_event=asyncio.Event(),
    )
    assert result == _phrase()
    assert provider.calls == 2
    assert provider.max_active == 1


async def test_noncooperative_timeout_quarantines_without_overlap() -> None:
    provider = _NonCooperativeProvider()
    lane = TtsProviderLane(
        provider=provider,
        call_timeout_seconds=0.01,
        cancellation_grace_seconds=0.01,
    )
    first = asyncio.create_task(
        lane.synthesize_phrase(
            text="slow",
            voice_id="judge",
            cancel_event=asyncio.Event(),
        )
    )
    await provider.first_entered.wait()
    queued = asyncio.create_task(
        lane.synthesize_phrase(
            text="must not overlap",
            voice_id="witness",
            cancel_event=asyncio.Event(),
        )
    )

    with pytest.raises(TtsLaneQuarantinedError, match="restart"):
        await asyncio.wait_for(first, timeout=0.2)
    with pytest.raises(TtsLaneQuarantinedError, match="restart"):
        await asyncio.wait_for(queued, timeout=0.2)

    assert provider.calls == 1
    assert provider.max_active == 1
    assert lane.snapshot.busy is True
    assert lane.snapshot.provider_call_active is True
    assert lane.snapshot.quarantined is True

    with pytest.raises(TtsLaneQuarantinedError, match="quarantined"):
        await lane.synthesize_phrase(
            text="future",
            voice_id="judge",
            cancel_event=asyncio.Event(),
        )
    assert provider.calls == 1

    provider.release_first.set()
    await _wait_until_lane_is_physically_idle(lane)
    assert lane.snapshot.busy is False
    assert lane.snapshot.quarantined is True


async def test_executor_work_remains_tracked_until_physical_exit() -> None:
    provider = _ExecutorBackedProvider()
    lane = TtsProviderLane(
        provider=provider,
        call_timeout_seconds=0.01,
        cancellation_grace_seconds=0.01,
    )
    synthesis = asyncio.create_task(
        lane.synthesize_phrase(
            text="threaded",
            voice_id="judge",
            cancel_event=asyncio.Event(),
        )
    )
    await provider.worker_entered.wait()

    with pytest.raises(TtsLaneQuarantinedError, match="restart"):
        await asyncio.wait_for(synthesis, timeout=0.2)
    assert provider.active == 1
    assert lane.snapshot.busy is True
    assert lane.snapshot.provider_call_active is True

    with pytest.raises(TtsLaneQuarantinedError, match="quarantined"):
        await lane.synthesize_phrase(
            text="no overlap",
            voice_id="witness",
            cancel_event=asyncio.Event(),
        )
    assert provider.calls == 1
    assert provider.max_active == 1

    provider.release_worker.set()
    await _wait_until_lane_is_physically_idle(lane)
    assert provider.active == 0
    assert lane.snapshot.busy is False
    assert lane.snapshot.quarantined is True


async def test_noncooperative_active_cancellation_quarantines_lane() -> None:
    provider = _NonCooperativeProvider()
    lane = TtsProviderLane(
        provider=provider,
        call_timeout_seconds=1,
        cancellation_grace_seconds=0.01,
    )
    cancel_event = asyncio.Event()
    synthesis = asyncio.create_task(
        lane.synthesize_phrase(
            text="cancel me",
            voice_id="judge",
            cancel_event=cancel_event,
        )
    )
    await provider.first_entered.wait()
    cancel_event.set()

    with pytest.raises(TtsLaneQuarantinedError, match="ignored active-job cancellation"):
        await asyncio.wait_for(synthesis, timeout=0.2)
    assert provider.calls == 1
    assert lane.snapshot.provider_call_active is True
    assert lane.snapshot.quarantined is True

    provider.release_first.set()
    await _wait_until_lane_is_physically_idle(lane)
