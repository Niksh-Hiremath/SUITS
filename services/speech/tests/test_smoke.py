from __future__ import annotations

import asyncio
import json
import sys
from array import array
from dataclasses import dataclass, field
from pathlib import Path

import pytest

import suits_speech.health as health_module
import suits_speech.smoke as smoke_module
from suits_speech.config import SpeechSettings
from suits_speech.health import SpeechRuntime
from suits_speech.protocol import CudaCapability
from suits_speech.providers.base import AudioChunk, ProviderStatus, TranscriptHypothesis
from suits_speech.providers.fake import FakeSttSession, FakeTtsProvider
from suits_speech.smoke import (
    CHUNK_BYTE_COUNT,
    CHUNK_DURATION_MS,
    EXIT_FAILURE,
    EXIT_SKIPPED,
    EXIT_SUCCESS,
    EXPECTED_NORMALIZED_FINAL,
    LIVE_SMOKE_ENV,
    SMOKE_PHRASE,
    SmokeFailure,
    exact_20ms_chunks,
    normalize_transcript,
    resample_pcm_s16le_24k_to_16k,
    run_smoke,
)


@dataclass
class _Clock:
    now: float = 100.0
    sleeps: list[float] = field(default_factory=list)

    def __call__(self) -> float:
        return self.now

    async def sleep(self, delay: float) -> None:
        assert delay >= 0
        self.sleeps.append(delay)
        self.now += delay
        await asyncio.sleep(0)


class _RecordingSession:
    def __init__(self, *, fail_push: bool = False) -> None:
        self._inner = FakeSttSession(
            partials=("May", "May it please"),
            final_text=SMOKE_PHRASE,
        )
        self.fail_push = fail_push
        self.chunks: list[AudioChunk] = []
        self.cancel_calls = 0

    async def push_audio(self, chunk: AudioChunk) -> tuple[TranscriptHypothesis, ...]:
        self.chunks.append(chunk)
        if self.fail_push:
            raise RuntimeError("private provider detail")
        return await self._inner.push_audio(chunk)

    async def finish(self) -> TranscriptHypothesis:
        return await self._inner.finish()

    async def cancel(self) -> None:
        self.cancel_calls += 1
        await self._inner.cancel()


class _RecordingSttProvider:
    def __init__(self, *, fail_push: bool = False) -> None:
        self.loaded = False
        self.session = _RecordingSession(fail_push=fail_push)

    @property
    def status(self) -> ProviderStatus:
        return ProviderStatus(
            provider_id="recording-stt",
            kind="stt",
            configured=True,
            loaded=self.loaded,
            ready=self.loaded,
            device="cpu",
            model_id=None,
            supports_streaming=True,
            supports_timings=True,
            warmup_latency_ms=0 if self.loaded else None,
        )

    async def load(self) -> ProviderStatus:
        self.loaded = True
        return self.status

    async def create_session(self, *, sample_rate_hz: int) -> _RecordingSession:
        assert sample_rate_hz == 16_000
        return self.session


def _settings(tmp_path: Path) -> SpeechSettings:
    return SpeechSettings.from_env(
        {
            "SUITS_SPEECH_MODE": "cpu",
            "SUITS_SPEECH_CACHE_DIR": str(tmp_path),
        }
    )


def _runtime(
    monkeypatch: pytest.MonkeyPatch,
    settings: SpeechSettings,
    stt: _RecordingSttProvider,
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
        settings=settings,
        stt_provider=stt,
        tts_provider=FakeTtsProvider(),
    )


def test_in_memory_resample_and_chunking_are_exact() -> None:
    source = array("h", [1_234] * 240)
    if sys.byteorder != "little":
        source.byteswap()

    resampled = resample_pcm_s16le_24k_to_16k(source.tobytes())
    samples = array("h")
    samples.frombytes(resampled)
    if sys.byteorder != "little":
        samples.byteswap()

    assert len(samples) == 160
    assert set(samples) == {1_234}
    chunks = exact_20ms_chunks(resampled)
    assert len(chunks) == 1
    assert len(chunks[0]) == CHUNK_BYTE_COUNT
    assert chunks[0][len(resampled) :] == bytes(CHUNK_BYTE_COUNT - len(resampled))


def test_transcript_normalization_is_bounded_to_fixed_english_tokens() -> None:
    assert normalize_transcript(" MAY, it PLEASE the Court! ") == EXPECTED_NORMALIZED_FINAL
    assert normalize_transcript("different private text") != EXPECTED_NORMALIZED_FINAL


async def test_smoke_streams_exact_chunks_at_real_time_cadence_and_passes(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = _settings(tmp_path)
    stt = _RecordingSttProvider()
    runtime = _runtime(monkeypatch, settings, stt)
    clock = _Clock()

    result = await run_smoke(settings, runtime, clock=clock, sleep=clock.sleep)
    payload = result.to_public_dict()

    assert payload["status"] == "passed"
    assert payload["exitCode"] == EXIT_SUCCESS
    assert payload["finalMatched"] is True
    assert result.partial_count >= 1
    assert result.timings.audio_stream_ms == result.streamed_duration_ms
    assert result.chunk_count == len(stt.session.chunks)
    assert [chunk.sequence for chunk in stt.session.chunks] == list(range(result.chunk_count))
    assert all(chunk.duration_ms == CHUNK_DURATION_MS for chunk in stt.session.chunks)
    assert all(len(chunk.pcm_s16le) == CHUNK_BYTE_COUNT for chunk in stt.session.chunks)
    assert stt.session.cancel_calls == 0
    rendered = json.dumps(payload, sort_keys=True)
    assert "pcm" not in rendered.lower()
    assert "private provider detail" not in rendered


async def test_smoke_cancels_the_stt_session_and_redacts_provider_failure(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = _settings(tmp_path)
    stt = _RecordingSttProvider(fail_push=True)
    runtime = _runtime(monkeypatch, settings, stt)
    clock = _Clock()

    with pytest.raises(SmokeFailure) as caught:
        await run_smoke(settings, runtime, clock=clock, sleep=clock.sleep)

    assert caught.value.code == "stt_failed"
    assert caught.value.stage == "stt"
    assert "private provider detail" not in str(caught.value)
    assert stt.session.cancel_calls == 1
    assert runtime.capacity_snapshot.stt_sessions.available == 1


async def test_cleanup_defers_repeated_cancellation_until_physical_exit() -> None:
    class _BlockingCancelSession:
        def __init__(self) -> None:
            self.started = asyncio.Event()
            self.release = asyncio.Event()
            self.exited = False

        async def push_audio(self, chunk: AudioChunk) -> tuple[TranscriptHypothesis, ...]:
            del chunk
            return ()

        async def finish(self) -> TranscriptHypothesis:
            raise AssertionError("not used")

        async def cancel(self) -> None:
            self.started.set()
            await self.release.wait()
            self.exited = True

    session = _BlockingCancelSession()
    cleanup = asyncio.create_task(smoke_module._cancel_safely(session))
    await session.started.wait()

    cleanup.cancel()
    await asyncio.sleep(0)
    cleanup.cancel()
    await asyncio.sleep(0)
    assert cleanup.done() is False

    session.release.set()
    await cleanup
    assert session.exited is True


def test_cli_skips_without_exact_opt_in(capsys: pytest.CaptureFixture[str]) -> None:
    exit_code = smoke_module.main({})
    payload = json.loads(capsys.readouterr().out)

    assert exit_code == EXIT_SKIPPED
    assert payload == {
        "code": "explicit_opt_in_required",
        "exitCode": EXIT_SKIPPED,
        "requiredEnvironment": f"{LIVE_SMOKE_ENV}=1",
        "schemaVersion": "speech-live-smoke.v1",
        "status": "skipped",
    }


def test_cli_redacts_invalid_configuration(
    capsys: pytest.CaptureFixture[str],
) -> None:
    private_value = "private-mode-value"
    exit_code = smoke_module.main(
        {
            LIVE_SMOKE_ENV: "1",
            "SUITS_SPEECH_MODE": private_value,
        }
    )
    rendered = capsys.readouterr().out
    payload = json.loads(rendered)

    assert exit_code == EXIT_FAILURE
    assert payload["code"] == "configuration_invalid"
    assert private_value not in rendered


def test_cli_redacts_unexpected_runtime_failures(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    private_value = "never expose this provider value"

    async def fail_safely(settings: SpeechSettings) -> object:
        del settings
        print(private_value)
        print(private_value, file=sys.stderr)
        raise RuntimeError(private_value)

    monkeypatch.setattr(smoke_module, "_run_configured", fail_safely)
    exit_code = smoke_module.main(
        {
            LIVE_SMOKE_ENV: "1",
            "SUITS_SPEECH_MODE": "cpu",
            "SUITS_SPEECH_CACHE_DIR": str(tmp_path),
        }
    )
    captured = capsys.readouterr()
    rendered = captured.out
    payload = json.loads(rendered)

    assert exit_code == EXIT_FAILURE
    assert payload["code"] == "smoke_failed"
    assert private_value not in rendered
    assert captured.err == ""
