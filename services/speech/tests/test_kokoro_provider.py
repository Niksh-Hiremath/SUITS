from __future__ import annotations

import asyncio
import threading
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace

import pytest

import suits_speech.providers.kokoro as kokoro_provider
from suits_speech.providers.base import ProviderCancelled
from suits_speech.providers.kokoro import (
    KOKORO_SAMPLE_RATE_HZ,
    KokoroArtifactError,
    KokoroBackend,
    KokoroChunk,
    KokoroInvalidOutputError,
    KokoroLocalArtifacts,
    KokoroTtsProvider,
    KokoroWordTiming,
)

MODEL_ID = "hexgrad/Kokoro-82M"
MODEL_REVISION = "f3ff3571791e39611d31c381e3a41a3af07b4987"
VOICES = ("am_michael", "bm_george", "af_heart")


def _snapshot(tmp_path: Path, *, complete: bool = True) -> Path:
    snapshot = tmp_path / "kokoro"
    snapshot.mkdir()
    if complete:
        (snapshot / "config.json").write_text("{}", encoding="utf-8")
        (snapshot / "kokoro-v1_0.pth").write_bytes(b"weights")
        voices = snapshot / "voices"
        voices.mkdir()
        for voice_id in VOICES:
            (voices / f"{voice_id}.pt").write_bytes(b"voice")
    return snapshot


@dataclass
class _Backend(KokoroBackend):
    entered: threading.Event | None = None
    release: threading.Event | None = None
    calls: int = 0

    def synthesize(self, *, text: str, voice_id: str) -> tuple[KokoroChunk, ...]:
        assert text
        assert voice_id in VOICES
        self.calls += 1
        if self.entered is not None:
            self.entered.set()
        if self.release is not None:
            self.release.wait(timeout=2)
        return (
            KokoroChunk(
                text=text,
                samples=(0.0,) * 2_400,
                words=(KokoroWordTiming(value="Sustained", start_seconds=0, end_seconds=0.1),),
            ),
        )


def _provider(
    snapshot: Path,
    backend: KokoroBackend,
) -> KokoroTtsProvider:
    def load_backend(
        *,
        artifacts: KokoroLocalArtifacts,
        model_id: str,
        voice_ids: tuple[str, ...],
        device: str,
    ) -> KokoroBackend:
        assert artifacts.snapshot_dir == snapshot
        assert model_id == MODEL_ID
        assert voice_ids == VOICES
        assert device == "cpu"
        return backend

    return KokoroTtsProvider(
        model_id=MODEL_ID,
        model_revision=MODEL_REVISION,
        snapshot_dir=snapshot,
        voice_ids=VOICES,
        device="cpu",
        backend_loader=load_backend,
    )


async def test_load_requires_complete_explicit_snapshot_before_backend_import(
    tmp_path: Path,
) -> None:
    called = False

    def must_not_load(**_: object) -> KokoroBackend:
        nonlocal called
        called = True
        return _Backend()

    provider = KokoroTtsProvider(
        model_id=MODEL_ID,
        model_revision=MODEL_REVISION,
        snapshot_dir=_snapshot(tmp_path, complete=False),
        voice_ids=VOICES,
        device="cpu",
        backend_loader=must_not_load,
    )

    with pytest.raises(KokoroArtifactError, match="snapshot is incomplete"):
        await provider.load()
    assert called is False
    assert provider.status.ready is False


async def test_multi_voice_synthesis_returns_validated_pcm_and_timings(tmp_path: Path) -> None:
    backend = _Backend()
    provider = _provider(_snapshot(tmp_path), backend)
    status = await provider.load()

    phrase = await provider.synthesize_phrase(
        text="Sustained.",
        voice_id="am_michael",
        cancel_event=asyncio.Event(),
    )

    assert status.ready is True
    assert status.model_id == f"{MODEL_ID}@{MODEL_REVISION}"
    assert phrase.sample_rate_hz == KOKORO_SAMPLE_RATE_HZ
    assert phrase.channels == 1
    assert phrase.duration_ms == 100
    assert len(phrase.pcm_s16le) == 4_800
    assert [(mark.kind, mark.start_ms, mark.end_ms) for mark in phrase.timings] == [
        ("phrase", 0, 100),
        ("word", 0, 100),
    ]
    assert backend.calls == 1

    await provider.synthesize_phrase(
        text="Witness response.",
        voice_id="af_heart",
        cancel_event=asyncio.Event(),
    )
    assert backend.calls == 2


async def test_active_cancel_waits_for_executor_to_physically_exit(tmp_path: Path) -> None:
    entered = threading.Event()
    release = threading.Event()
    provider = _provider(
        _snapshot(tmp_path),
        _Backend(entered=entered, release=release),
    )
    await provider.load()
    cancel_event = asyncio.Event()
    synthesis = asyncio.create_task(
        provider.synthesize_phrase(
            text="This worker must physically finish.",
            voice_id="bm_george",
            cancel_event=cancel_event,
        )
    )
    assert await asyncio.to_thread(entered.wait, 1)
    cancel_event.set()
    await asyncio.sleep(0.01)
    assert synthesis.done() is False

    release.set()
    with pytest.raises(ProviderCancelled):
        await synthesis


async def test_task_cancellation_waits_for_executor_to_physically_exit(tmp_path: Path) -> None:
    entered = threading.Event()
    release = threading.Event()
    provider = _provider(
        _snapshot(tmp_path),
        _Backend(entered=entered, release=release),
    )
    await provider.load()
    synthesis = asyncio.create_task(
        provider.synthesize_phrase(
            text="Cancellation cannot orphan inference.",
            voice_id="am_michael",
            cancel_event=asyncio.Event(),
        )
    )
    assert await asyncio.to_thread(entered.wait, 1)
    synthesis.cancel()
    await asyncio.sleep(0.01)
    assert synthesis.done() is False

    release.set()
    with pytest.raises(asyncio.CancelledError):
        await synthesis


async def test_unknown_voice_and_preflight_cancel_never_enter_backend(tmp_path: Path) -> None:
    backend = _Backend()
    provider = _provider(_snapshot(tmp_path), backend)
    await provider.load()

    with pytest.raises(ValueError, match="not configured"):
        await provider.synthesize_phrase(
            text="No.",
            voice_id="am_adam",
            cancel_event=asyncio.Event(),
        )
    cancelled = asyncio.Event()
    cancelled.set()
    with pytest.raises(ProviderCancelled):
        await provider.synthesize_phrase(
            text="No.",
            voice_id="am_michael",
            cancel_event=cancelled,
        )
    assert backend.calls == 0


async def test_invalid_backend_timing_is_rejected_without_raw_content(
    tmp_path: Path,
) -> None:
    class InvalidBackend:
        def synthesize(self, *, text: str, voice_id: str) -> tuple[KokoroChunk, ...]:
            del text, voice_id
            return (
                KokoroChunk(
                    text="private phrase",
                    samples=(0.0,) * 240,
                    words=(
                        KokoroWordTiming(
                            value="private-word",
                            start_seconds=0.02,
                            end_seconds=0.01,
                        ),
                    ),
                ),
            )

    provider = _provider(_snapshot(tmp_path), InvalidBackend())
    await provider.load()
    with pytest.raises(KokoroInvalidOutputError) as captured:
        await provider.synthesize_phrase(
            text="private phrase",
            voice_id="am_michael",
            cancel_event=asyncio.Event(),
        )
    assert "private" not in str(captured.value)


def test_dependency_content_logging_is_disabled_before_inference(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    disabled: list[str] = []
    logger = SimpleNamespace(disable=disabled.append)

    def import_module(name: str) -> object:
        assert name == "loguru"
        return SimpleNamespace(logger=logger)

    monkeypatch.setattr(kokoro_provider.importlib, "import_module", import_module)

    kokoro_provider._disable_dependency_content_logging()

    assert disabled == ["kokoro", "misaki"]
