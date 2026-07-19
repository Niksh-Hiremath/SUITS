from __future__ import annotations

from dataclasses import replace
from pathlib import Path

import pytest

import suits_speech.health as health_module
from suits_speech.config import SpeechSettings
from suits_speech.health import SpeechRuntime
from suits_speech.protocol import CudaCapability
from suits_speech.providers import (
    AudioChunk,
    FakeSttProvider,
    FakeTtsProvider,
    KokoroTtsProvider,
    NemotronSttProvider,
    UnavailableSttProvider,
    UnavailableTtsProvider,
)


@pytest.fixture(autouse=True)
def _stable_cuda_probe(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        health_module,
        "detect_cuda",
        lambda *, fake_mode: CudaCapability(
            available=False,
            diagnostic=f"test probe; fake_mode={fake_mode}",
        ),
    )


def _settings(tmp_path: Path, *, mode: str) -> SpeechSettings:
    return SpeechSettings.from_env(
        {
            "SUITS_SPEECH_MODE": mode,
            "SUITS_SPEECH_CACHE_DIR": str(tmp_path),
        }
    )


@pytest.mark.parametrize("mode", ["cpu", "cuda"])
def test_real_modes_select_cache_only_local_providers(tmp_path: Path, mode: str) -> None:
    settings = _settings(tmp_path, mode=mode)
    runtime = SpeechRuntime(settings=settings)

    assert isinstance(runtime.stt_provider, NemotronSttProvider)
    assert isinstance(runtime.tts_provider, KokoroTtsProvider)
    assert runtime.stt_provider.status.device == mode
    assert runtime.tts_provider.status.device == mode
    assert runtime.stt_provider.status.loaded is False
    assert runtime.tts_provider.status.loaded is False
    assert runtime.stt_provider.status.model_id == (
        f"{settings.stt_model_id}@{settings.stt_model_revision}"
    )
    assert runtime.tts_provider.status.model_id == (
        f"{settings.tts_model_id}@{settings.tts_model_revision}"
    )
    stt_capability, tts_capability = runtime.capabilities().providers[:2]
    assert (stt_capability.provider_id, stt_capability.device) == (
        "nemotron-transformers",
        mode,
    )
    assert (tts_capability.provider_id, tts_capability.device) == ("kokoro", mode)
    assert list(tmp_path.iterdir()) == []


def test_fake_mode_keeps_deterministic_providers(tmp_path: Path) -> None:
    runtime = SpeechRuntime(settings=_settings(tmp_path, mode="fake"))

    assert isinstance(runtime.stt_provider, FakeSttProvider)
    assert isinstance(runtime.tts_provider, FakeTtsProvider)


async def test_fake_mode_selects_the_allowlisted_stt_scenario(tmp_path: Path) -> None:
    settings = SpeechSettings.from_env(
        {
            "SUITS_SPEECH_MODE": "fake",
            "SUITS_FAKE_STT_SCENARIO": "leading-objection",
            "SUITS_SPEECH_CACHE_DIR": str(tmp_path),
        }
    )
    runtime = SpeechRuntime(settings=settings)
    await runtime.stt_provider.load()
    session = await runtime.stt_provider.create_session(sample_rate_hz=16_000)

    partial = ()
    for sequence in range(3):
        partial = await session.push_audio(
            AudioChunk(
                sequence=sequence,
                pcm_s16le=b"\x00\x00" * 160,
                duration_ms=20,
            )
        )

    assert partial[0].text.endswith("correct?")


def test_snapshot_selection_supports_setup_and_legacy_cache_layouts(tmp_path: Path) -> None:
    settings = _settings(tmp_path, mode="cuda")
    slug = f"models--{settings.stt_model_id.replace('/', '--')}"
    direct = tmp_path / slug / "snapshots" / settings.stt_model_revision
    legacy = tmp_path / "hub" / slug / "snapshots" / settings.stt_model_revision

    assert (
        health_module._pinned_snapshot_path(
            cache_dir=tmp_path,
            model_id=settings.stt_model_id,
            revision=settings.stt_model_revision,
        )
        == direct
    )

    legacy.mkdir(parents=True)
    assert (
        health_module._pinned_snapshot_path(
            cache_dir=tmp_path,
            model_id=settings.stt_model_id,
            revision=settings.stt_model_revision,
        )
        == legacy
    )

    direct.mkdir(parents=True)
    assert (
        health_module._pinned_snapshot_path(
            cache_dir=tmp_path,
            model_id=settings.stt_model_id,
            revision=settings.stt_model_revision,
        )
        == direct
    )


async def test_missing_artifacts_fail_without_cache_mutation(tmp_path: Path) -> None:
    runtime = SpeechRuntime(settings=_settings(tmp_path, mode="cuda"))

    with pytest.raises(RuntimeError, match="local speech providers failed to load"):
        await runtime.load_models()

    capabilities = runtime.capabilities()
    stt, tts = capabilities.providers[:2]
    assert stt.ready is False
    assert tts.ready is False
    assert "snapshot is incomplete" in (stt.diagnostic or "")
    assert "snapshot is incomplete" in (tts.diagnostic or "")
    assert str(tmp_path) not in capabilities.model_dump_json()
    assert list(tmp_path.iterdir()) == []


def test_unsupported_or_invalid_configuration_is_redacted(tmp_path: Path) -> None:
    secret = "private-token-value"
    unsupported = replace(
        _settings(tmp_path, mode="cuda"),
        stt_provider=f"unsupported-{secret}",
        tts_provider=f"unsupported-{secret}",
        stt_model_id=f"owner/{secret}",
        tts_model_id=f"owner/{secret}",
    )
    unsupported_runtime = SpeechRuntime(settings=unsupported)

    assert type(unsupported_runtime.stt_provider) is UnavailableSttProvider
    assert type(unsupported_runtime.tts_provider) is UnavailableTtsProvider
    assert secret not in unsupported_runtime.capabilities().model_dump_json()

    invalid = replace(
        _settings(tmp_path, mode="cuda"),
        stt_model_revision=f"../{secret}",
        tts_model_revision=f"../{secret}",
        tts_voices=(
            f"judge=../{secret}",
            "opposing_counsel=bm_george",
        ),
    )
    invalid_runtime = SpeechRuntime(settings=invalid)

    assert type(invalid_runtime.stt_provider) is UnavailableSttProvider
    assert type(invalid_runtime.tts_provider) is UnavailableTtsProvider
    assert secret not in invalid_runtime.capabilities().model_dump_json()
    assert all(
        "invalid or inconsistent" in (item.diagnostic or "")
        for item in (
            invalid_runtime.stt_provider.status,
            invalid_runtime.tts_provider.status,
        )
    )
