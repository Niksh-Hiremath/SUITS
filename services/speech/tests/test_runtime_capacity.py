from __future__ import annotations

import asyncio
import threading

import pytest

import suits_speech.health as health_module
from suits_speech.config import SpeechSettings
from suits_speech.health import SpeechRuntime, SttSessionCapacityError
from suits_speech.protocol import CudaCapability
from suits_speech.providers.fake import FakeSttProvider, FakeSttSession
from suits_speech.providers.base import AudioChunk, TranscriptHypothesis


def _settings(*, max_connections: int, max_stt_sessions: int = 1) -> SpeechSettings:
    return SpeechSettings.from_env(
        {
            "SUITS_SPEECH_MODE": "fake",
            "SUITS_SPEECH_MAX_CONNECTIONS": str(max_connections),
            "SUITS_STT_MAX_SESSIONS": str(max_stt_sessions),
        }
    )


def _runtime(
    monkeypatch: pytest.MonkeyPatch,
    *,
    max_connections: int,
    max_stt_sessions: int = 1,
    stt_provider: FakeSttProvider | None = None,
) -> SpeechRuntime:
    monkeypatch.setattr(
        health_module,
        "detect_cuda",
        lambda *, fake_mode: CudaCapability(
            available=False,
            diagnostic=f"fake_mode={fake_mode}",
        ),
    )
    return SpeechRuntime(
        settings=_settings(
            max_connections=max_connections,
            max_stt_sessions=max_stt_sessions,
        ),
        stt_provider=stt_provider,
    )


async def test_connection_leases_reject_overload_without_counter_races(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runtime = _runtime(monkeypatch, max_connections=3)

    attempts = await asyncio.gather(
        *(asyncio.to_thread(runtime.try_acquire_connection) for _ in range(24))
    )
    admitted = [lease for lease in attempts if lease is not None]

    assert len(admitted) == 3
    assert runtime.capacity_snapshot.connections.active == 3
    assert runtime.capacity_snapshot.connections.available == 0
    assert runtime.try_acquire_connection() is None

    releases = await asyncio.gather(*(asyncio.to_thread(lease.release) for lease in admitted))
    assert releases == [True, True, True]
    assert runtime.capacity_snapshot.connections.active == 0
    assert admitted[0].release() is False
    assert runtime.capacity_snapshot.connections.active == 0


async def test_stt_sessions_are_bounded_and_terminal_release_is_idempotent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runtime = _runtime(monkeypatch, max_connections=1)
    await runtime.load_models()

    first = await runtime.create_stt_session(sample_rate_hz=16_000)
    assert runtime.capacity_snapshot.stt_sessions.active == 1
    stt_capability = runtime.capabilities().providers[0]
    assert stt_capability.ready is False
    assert stt_capability.diagnostic is not None
    assert "capacity is exhausted" in stt_capability.diagnostic
    assert runtime.models_ready is False
    with pytest.raises(SttSessionCapacityError, match="capacity is exhausted"):
        await runtime.create_stt_session(sample_rate_hz=16_000)

    final = await first.finish()
    assert final.is_final is True
    assert runtime.capacity_snapshot.stt_sessions.active == 0
    assert runtime.capabilities().providers[0].ready is True
    assert runtime.models_ready is True
    await first.cancel()
    assert runtime.capacity_snapshot.stt_sessions.active == 0

    second = await runtime.create_stt_session(sample_rate_hz=16_000)
    await second.cancel()
    await second.cancel()
    assert runtime.capacity_snapshot.stt_sessions.active == 0


class _FailOnceSttProvider(FakeSttProvider):
    def __init__(self) -> None:
        super().__init__()
        self.create_calls = 0

    async def create_session(self, *, sample_rate_hz: int) -> FakeSttSession:
        self.create_calls += 1
        if self.create_calls == 1:
            raise RuntimeError("injected recognizer creation failure")
        return await super().create_session(sample_rate_hz=sample_rate_hz)


async def test_stt_provider_create_failure_returns_capacity(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider = _FailOnceSttProvider()
    runtime = _runtime(
        monkeypatch,
        max_connections=1,
        stt_provider=provider,
    )
    await runtime.load_models()

    with pytest.raises(RuntimeError, match="injected recognizer creation failure"):
        await runtime.create_stt_session(sample_rate_hz=16_000)
    assert runtime.capacity_snapshot.stt_sessions.active == 0

    recovered = await runtime.create_stt_session(sample_rate_hz=16_000)
    assert provider.create_calls == 2
    assert runtime.capacity_snapshot.stt_sessions.active == 1
    await recovered.cancel()
    assert runtime.capacity_snapshot.stt_sessions.active == 0


class _ExecutorFinishSession:
    def __init__(self) -> None:
        self.worker_entered = asyncio.Event()
        self.release_worker = threading.Event()

    async def push_audio(self, chunk: AudioChunk) -> tuple[TranscriptHypothesis, ...]:
        del chunk
        return ()

    async def finish(self) -> TranscriptHypothesis:
        loop = asyncio.get_running_loop()

        def physical_finish() -> None:
            loop.call_soon_threadsafe(self.worker_entered.set)
            self.release_worker.wait(timeout=1)

        await asyncio.to_thread(physical_finish)
        return TranscriptHypothesis(
            text="finished",
            is_final=True,
            confidence=1.0,
            audio_end_ms=0,
        )

    async def cancel(self) -> None:
        return None


class _ExecutorFinishProvider(FakeSttProvider):
    def __init__(self) -> None:
        super().__init__()
        self.session = _ExecutorFinishSession()

    async def create_session(self, *, sample_rate_hz: int) -> _ExecutorFinishSession:
        if sample_rate_hz != 16_000:
            raise ValueError("expected 16 kHz")
        return self.session


async def test_cancelled_native_finalizer_quarantines_stt_capacity(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider = _ExecutorFinishProvider()
    runtime = _runtime(
        monkeypatch,
        max_connections=1,
        stt_provider=provider,
    )
    await runtime.load_models()
    session = await runtime.create_stt_session(sample_rate_hz=16_000)
    finalizer = asyncio.create_task(session.finish())
    await provider.session.worker_entered.wait()

    finalizer.cancel()
    with pytest.raises(asyncio.CancelledError):
        await finalizer

    assert runtime.capacity_snapshot.stt_sessions.active == 1
    with pytest.raises(SttSessionCapacityError):
        await runtime.create_stt_session(sample_rate_hz=16_000)
    provider.session.release_worker.set()
    await session.cancel()
    assert runtime.capacity_snapshot.stt_sessions.active == 1


class _BlockingPushSession:
    def __init__(self) -> None:
        self.push_entered = asyncio.Event()
        self.release_push = asyncio.Event()

    async def push_audio(self, chunk: AudioChunk) -> tuple[TranscriptHypothesis, ...]:
        del chunk
        self.push_entered.set()
        await self.release_push.wait()
        return ()

    async def finish(self) -> TranscriptHypothesis:
        return TranscriptHypothesis(
            text="finished",
            is_final=True,
            confidence=1.0,
            audio_end_ms=0,
        )

    async def cancel(self) -> None:
        return None


class _BlockingPushProvider(FakeSttProvider):
    def __init__(self) -> None:
        super().__init__()
        self.sessions: list[_BlockingPushSession] = []

    async def create_session(self, *, sample_rate_hz: int) -> _BlockingPushSession:
        if sample_rate_hz != 16_000:
            raise ValueError("expected 16 kHz")
        session = _BlockingPushSession()
        self.sessions.append(session)
        return session


async def test_active_push_holds_global_recognizer_capacity_after_cancel(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider = _BlockingPushProvider()
    runtime = _runtime(
        monkeypatch,
        max_connections=4,
        max_stt_sessions=1,
        stt_provider=provider,
    )
    await runtime.load_models()
    session = await runtime.create_stt_session(sample_rate_hz=16_000)
    push = asyncio.create_task(
        session.push_audio(AudioChunk(sequence=0, pcm_s16le=b"\x00\x00", duration_ms=1))
    )
    await provider.sessions[0].push_entered.wait()

    await session.cancel()
    with pytest.raises(SttSessionCapacityError):
        await runtime.create_stt_session(sample_rate_hz=16_000)

    provider.sessions[0].release_push.set()
    await push
    assert runtime.capacity_snapshot.stt_sessions.active == 0

    recovered = await runtime.create_stt_session(sample_rate_hz=16_000)
    await recovered.cancel()


class _ExecutorCreateProvider(FakeSttProvider):
    def __init__(self) -> None:
        super().__init__()
        self.create_entered = asyncio.Event()
        self.release_create = threading.Event()

    async def create_session(self, *, sample_rate_hz: int) -> FakeSttSession:
        if sample_rate_hz != 16_000:
            raise ValueError("expected 16 kHz")
        loop = asyncio.get_running_loop()

        def physical_create() -> None:
            loop.call_soon_threadsafe(self.create_entered.set)
            self.release_create.wait(timeout=1)

        await asyncio.to_thread(physical_create)
        return FakeSttSession(partials=(), final_text="finished")


async def test_cancelled_native_session_creation_holds_capacity_until_disposed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider = _ExecutorCreateProvider()
    runtime = _runtime(
        monkeypatch,
        max_connections=4,
        max_stt_sessions=1,
        stt_provider=provider,
    )
    await runtime.load_models()
    creation = asyncio.create_task(runtime.create_stt_session(sample_rate_hz=16_000))
    await provider.create_entered.wait()

    creation.cancel()
    with pytest.raises(asyncio.CancelledError):
        await creation
    with pytest.raises(SttSessionCapacityError):
        await runtime.create_stt_session(sample_rate_hz=16_000)

    provider.release_create.set()
    for _ in range(100):
        if runtime.capacity_snapshot.stt_sessions.active == 0:
            break
        await asyncio.sleep(0.005)
    assert runtime.capacity_snapshot.stt_sessions.active == 0

    recovered = await runtime.create_stt_session(sample_rate_hz=16_000)
    await recovered.cancel()
