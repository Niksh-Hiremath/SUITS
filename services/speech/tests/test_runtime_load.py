from __future__ import annotations

import asyncio

import pytest

import suits_speech.health as health_module
from suits_speech.config import SpeechSettings
from suits_speech.health import SpeechRuntime
from suits_speech.protocol import CudaCapability
from suits_speech.providers.base import ProviderStatus
from suits_speech.providers.fake import FakeSttProvider, FakeTtsProvider


class _FailOnceLoadSttProvider(FakeSttProvider):
    def __init__(self) -> None:
        super().__init__()
        self.load_calls = 0

    async def load(self) -> ProviderStatus:
        self.load_calls += 1
        if self.load_calls == 1:
            raise OSError("simulated STT load failure")
        return await super().load()


class _BlockingLoadTtsProvider(FakeTtsProvider):
    def __init__(self) -> None:
        super().__init__()
        self.entered = asyncio.Event()
        self.release = asyncio.Event()
        self.load_calls = 0
        self.active_loads = 0
        self.max_active_loads = 0

    async def load(self) -> ProviderStatus:
        self.load_calls += 1
        self.active_loads += 1
        self.max_active_loads = max(self.max_active_loads, self.active_loads)
        self.entered.set()
        try:
            await self.release.wait()
            return await super().load()
        finally:
            self.active_loads -= 1


async def test_failed_shared_load_waits_for_sibling_and_coalesces_retry(
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
    stt = _FailOnceLoadSttProvider()
    tts = _BlockingLoadTtsProvider()
    runtime = SpeechRuntime(
        settings=SpeechSettings.from_env({"SUITS_SPEECH_MODE": "fake"}),
        stt_provider=stt,
        tts_provider=tts,
    )

    first = asyncio.create_task(runtime.load_models())
    await tts.entered.wait()
    retry_while_loading = asyncio.create_task(runtime.load_models())
    await asyncio.sleep(0)

    assert first.done() is False
    assert retry_while_loading.done() is False
    assert tts.load_calls == 1
    assert stt.load_calls == 0
    assert tts.max_active_loads == 1

    tts.release.set()
    with pytest.raises(RuntimeError, match="failed to load"):
        await first
    with pytest.raises(RuntimeError, match="failed to load"):
        await retry_while_loading
    assert tts.max_active_loads == 1

    capabilities = await runtime.load_models()
    assert stt.load_calls == 2
    assert tts.load_calls == 1
    assert all(provider.ready for provider in capabilities.providers)
