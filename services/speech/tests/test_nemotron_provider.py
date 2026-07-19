from __future__ import annotations

import asyncio
import importlib
import importlib.metadata
import logging
import queue
from collections.abc import Iterator
from pathlib import Path
from types import SimpleNamespace
from typing import cast

import pytest

from suits_speech.providers.base import AudioChunk, ProviderCancelled
from suits_speech.providers.nemotron import (
    REQUIRED_ARTIFACT_FILES,
    NemotronBackend,
    NemotronBackendInfo,
    NemotronBackendLoader,
    NemotronBackendSession,
    NemotronDevice,
    NemotronLoadRequest,
    NemotronProviderError,
    NemotronRevision,
    NemotronSttProvider,
    NemotronWorkerTerminationError,
    TransformersNemotronBackendLoader,
)

PINNED_REVISION = "df1f0fe9dfdf05152936192b4c8c7653d53bf557"


def _artifacts(tmp_path: Path) -> tuple[Path, Path]:
    snapshot = tmp_path / "snapshot"
    cache = tmp_path / "cache"
    snapshot.mkdir()
    cache.mkdir()
    for name in REQUIRED_ARTIFACT_FILES:
        (snapshot / name).write_text("fixture", encoding="utf-8")
    return snapshot, cache


class _BackendSession:
    def __init__(self) -> None:
        self.cancelled = False
        self.fail_cancel = False

    async def push_audio(self, chunk: AudioChunk) -> tuple[NemotronRevision, ...]:
        return (
            NemotronRevision(
                revision=chunk.sequence + 1,
                text=f"revision {chunk.sequence + 1}",
                is_final=False,
                confidence=0.9,
            ),
        )

    async def finish(self) -> NemotronRevision:
        return NemotronRevision(revision=2, text="revision 1 final", is_final=True)

    async def cancel(self) -> None:
        if self.fail_cancel:
            raise NemotronWorkerTerminationError("worker still alive")
        self.cancelled = True


class _Backend:
    def __init__(self, session: _BackendSession | None = None) -> None:
        self.session = session or _BackendSession()
        self.info = NemotronBackendInfo(
            device_name="Injected RTX",
            sample_rate_hz=16_000,
            streaming_latency_ms=160,
        )

    async def create_session(self) -> NemotronBackendSession:
        return self.session


class _Loader:
    def __init__(self, backend: NemotronBackend | None = None) -> None:
        self.backend = backend or _Backend()
        self.requests: list[NemotronLoadRequest] = []

    def load_local(self, request: NemotronLoadRequest) -> NemotronBackend:
        self.requests.append(request)
        return self.backend


def _provider(
    snapshot: Path,
    cache: Path,
    loader: NemotronBackendLoader,
    *,
    device: NemotronDevice = "cuda",
) -> NemotronSttProvider:
    return NemotronSttProvider(
        artifact_path=snapshot,
        cache_dir=cache,
        model_id="nvidia/nemotron-speech-streaming-en-0.6b",
        model_revision=PINNED_REVISION,
        lookahead_tokens=1,
        device=device,
        backend_loader=loader,
    )


async def test_provider_loads_only_complete_explicit_local_snapshot(tmp_path: Path) -> None:
    snapshot, cache = _artifacts(tmp_path)
    loader = _Loader()
    provider = _provider(snapshot, cache, loader)

    status = await provider.load()

    assert len(loader.requests) == 1
    assert loader.requests[0].artifact_path == snapshot.resolve()
    assert loader.requests[0].cache_dir == cache.resolve()
    assert loader.requests[0].model_revision == PINNED_REVISION
    assert status.ready is True
    assert status.device == "cuda"
    assert status.supports_streaming is True
    assert status.warmup_latency_ms is None
    assert status.diagnostic == (
        "CUDA ready (Injected RTX); native streaming latency 160 ms; live warmup is not measured"
    )
    assert await provider.load() == status
    assert len(loader.requests) == 1


async def test_incomplete_snapshot_fails_before_optional_backend_load(tmp_path: Path) -> None:
    snapshot, cache = _artifacts(tmp_path)
    (snapshot / "model.safetensors").unlink()
    loader = _Loader()
    provider = _provider(snapshot, cache, loader)

    with pytest.raises(NemotronProviderError, match="model.safetensors"):
        await provider.load()

    assert loader.requests == []
    assert provider.status.ready is False
    assert provider.status.device == "cuda"


def test_provider_rejects_implicit_or_unsupported_configuration(tmp_path: Path) -> None:
    snapshot, cache = _artifacts(tmp_path)
    with pytest.raises(ValueError, match="must be absolute"):
        NemotronSttProvider(
            artifact_path=Path("relative"),
            cache_dir=cache,
            model_id="model",
            model_revision="sha",
            lookahead_tokens=1,
        )
    with pytest.raises(ValueError, match="0, 1, 6, or 13"):
        NemotronSttProvider(
            artifact_path=snapshot,
            cache_dir=cache,
            model_id="model",
            model_revision="sha",
            lookahead_tokens=2,
        )
    with pytest.raises(ValueError, match="owner/name"):
        NemotronSttProvider(
            artifact_path=snapshot,
            cache_dir=cache,
            model_id="unsafe-model",
            model_revision=PINNED_REVISION,
            lookahead_tokens=1,
        )
    with pytest.raises(ValueError, match="pinned SHA-1"):
        NemotronSttProvider(
            artifact_path=snapshot,
            cache_dir=cache,
            model_id="nvidia/model",
            model_revision="main",
            lookahead_tokens=1,
        )


async def test_session_enforces_ordered_revisions_and_hides_transcript(tmp_path: Path) -> None:
    snapshot, cache = _artifacts(tmp_path)
    provider = _provider(snapshot, cache, _Loader())
    await provider.load()
    session = await provider.create_session(sample_rate_hz=16_000)

    partial = await session.push_audio(
        AudioChunk(sequence=0, pcm_s16le=b"\x00\x00" * 320, duration_ms=20)
    )
    final = await session.finish()

    assert partial[0].text == "revision 1"
    assert partial[0].audio_end_ms == 20
    assert final.text == "revision 1 final"
    assert final.is_final is True
    assert "revision 1 final" not in repr(final)


async def test_session_quarantines_unconfirmed_native_termination(tmp_path: Path) -> None:
    snapshot, cache = _artifacts(tmp_path)
    backend_session = _BackendSession()
    backend_session.fail_cancel = True
    provider = _provider(snapshot, cache, _Loader(_Backend(backend_session)))
    await provider.load()
    session = await provider.create_session(sample_rate_hz=16_000)

    with pytest.raises(NemotronWorkerTerminationError, match="still alive"):
        await session.cancel()
    assert provider.status.ready is False
    assert "restart the speech service" in (provider.status.diagnostic or "")
    with pytest.raises(NemotronProviderError, match="quarantined"):
        await provider.load()
    with pytest.raises(ProviderCancelled, match="quarantined"):
        await session.push_audio(AudioChunk(sequence=0, pcm_s16le=b"\x00\x00" * 16, duration_ms=1))


async def test_session_rejects_empty_final_transcript(tmp_path: Path) -> None:
    class _EmptyFinalSession(_BackendSession):
        async def finish(self) -> NemotronRevision:
            return NemotronRevision(revision=1, text="   ", is_final=True)

    snapshot, cache = _artifacts(tmp_path)
    provider = _provider(snapshot, cache, _Loader(_Backend(_EmptyFinalSession())))
    await provider.load()
    session = await provider.create_session(sample_rate_hz=16_000)

    with pytest.raises(NemotronProviderError, match="empty transcript"):
        await session.finish()


async def test_provider_bounds_audio_and_allows_only_one_native_session(
    tmp_path: Path,
) -> None:
    snapshot, cache = _artifacts(tmp_path)
    provider = _provider(snapshot, cache, _Loader())
    await provider.load()
    first = await provider.create_session(sample_rate_hz=16_000)

    with pytest.raises(NemotronProviderError, match="one active"):
        await provider.create_session(sample_rate_hz=16_000)
    with pytest.raises(ValueError, match="duration does not match"):
        await first.push_audio(AudioChunk(sequence=0, pcm_s16le=b"\x00\x00" * 16, duration_ms=20))

    await first.cancel()
    replacement = await provider.create_session(sample_rate_hz=16_000)
    provider._release_session_lane(1)
    with pytest.raises(NemotronProviderError, match="one active"):
        await provider.create_session(sample_rate_hz=16_000)
    await replacement.cancel()


async def test_repeated_task_cancellation_waits_for_physical_backend_exit(
    tmp_path: Path,
) -> None:
    class _BlockingCancelSession(_BackendSession):
        def __init__(self) -> None:
            super().__init__()
            self.cancel_started = asyncio.Event()
            self.allow_cancel = asyncio.Event()

        async def cancel(self) -> None:
            self.cancel_started.set()
            await self.allow_cancel.wait()
            self.cancelled = True

    snapshot, cache = _artifacts(tmp_path)
    backend_session = _BlockingCancelSession()
    provider = _provider(snapshot, cache, _Loader(_Backend(backend_session)))
    await provider.load()
    session = await provider.create_session(sample_rate_hz=16_000)
    cancel_task = asyncio.create_task(session.cancel())
    await backend_session.cancel_started.wait()

    cancel_task.cancel()
    await asyncio.sleep(0)
    cancel_task.cancel()
    await asyncio.sleep(0)
    assert cancel_task.done() is False

    backend_session.allow_cancel.set()
    with pytest.raises(asyncio.CancelledError):
        await cancel_task
    assert backend_session.cancelled is True

    replacement = await provider.create_session(sample_rate_hz=16_000)
    await replacement.cancel()


async def test_interrupted_push_logs_only_cleanup_error_type(
    tmp_path: Path,
    caplog: pytest.LogCaptureFixture,
) -> None:
    class _InterruptedPushSession(_BackendSession):
        def __init__(self) -> None:
            super().__init__()
            self.push_started = asyncio.Event()

        async def push_audio(self, chunk: AudioChunk) -> tuple[NemotronRevision, ...]:
            del chunk
            self.push_started.set()
            await asyncio.Future[None]()
            return ()

        async def cancel(self) -> None:
            raise RuntimeError("PRIVATE TRANSCRIPT must never reach logs")

    snapshot, cache = _artifacts(tmp_path)
    backend_session = _InterruptedPushSession()
    provider = _provider(snapshot, cache, _Loader(_Backend(backend_session)))
    await provider.load()
    session = await provider.create_session(sample_rate_hz=16_000)
    caplog.set_level(logging.ERROR, logger="suits_speech.providers.nemotron")
    push_task = asyncio.create_task(
        session.push_audio(AudioChunk(sequence=0, pcm_s16le=b"\x00\x00" * 320, duration_ms=20))
    )
    await backend_session.push_started.wait()

    push_task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await push_task

    assert "errorType=RuntimeError" in caplog.text
    assert "PRIVATE TRANSCRIPT" not in caplog.text
    assert provider.status.ready is False


class _Tensor:
    def __getitem__(self, key: object) -> _Tensor:
        del key
        return self


class _Batch(dict[str, object]):
    def __init__(self) -> None:
        self.input_features = _Tensor()
        super().__init__(
            {
                "input_features": self.input_features,
                "num_lookahead_tokens": 1,
            }
        )

    def to(self, device: object, *, dtype: object) -> _Batch:
        del device, dtype
        return self


class _Processor:
    def __init__(self) -> None:
        self.feature_extractor = SimpleNamespace(sampling_rate=16_000, hop_length=160, n_fft=400)
        self.tokenizer = object()
        self.num_samples_first_audio_chunk = 320
        self.num_samples_per_audio_chunk = 320
        self.num_mel_frames_first_audio_chunk = 2
        self.num_mel_frames_per_audio_chunk = 2
        self.streaming_latency_ms = 160
        self.lookahead: int | None = None
        self.audio_shapes: list[tuple[int, ...]] = []

    def set_num_lookahead_tokens(self, value: int) -> None:
        self.lookahead = value

    def __call__(self, audio: object, **kwargs: object) -> _Batch:
        self.audio_shapes.append(cast(tuple[int, ...], getattr(audio, "shape")))
        del kwargs
        return _Batch()


class _Streamer:
    def __init__(self) -> None:
        self.text_queue: queue.Queue[object] = queue.Queue()
        self.stop_signal = object()

    def end(self) -> None:
        self.text_queue.put(self.stop_signal)


class _Model:
    device: object = "cuda"
    dtype: object = "float16"

    def __init__(self) -> None:
        self.generate_calls = 0
        self.target_device: str | None = None
        self.last_generate_options: dict[str, object] = {}

    def to(self, device: str) -> _Model:
        self.device = device
        self.target_device = device
        return self

    def eval(self) -> _Model:
        return self

    def generate(self, **kwargs: object) -> object:
        self.generate_calls += 1
        self.last_generate_options = kwargs
        streamer = cast(_Streamer, kwargs["streamer"])
        for _ in cast(Iterator[object], kwargs["input_features"]):
            streamer.text_queue.put("native ")
            streamer.text_queue.put("")
        streamer.end()
        return object()


class _PretrainedFactory:
    def __init__(self, result: object) -> None:
        self.result = result
        self.calls: list[tuple[str, dict[str, object]]] = []

    def from_pretrained(self, path: str, **kwargs: object) -> object:
        self.calls.append((path, kwargs))
        return self.result


class _StreamerFactory:
    def __init__(self) -> None:
        self.instances: list[_Streamer] = []

    def __call__(self, tokenizer: object, **kwargs: object) -> _Streamer:
        del tokenizer, kwargs
        result = _Streamer()
        self.instances.append(result)
        return result


class _Numpy:
    float32: object = "float32"

    def asarray(self, value: object, *, dtype: object) -> object:
        assert dtype == self.float32
        samples = cast(tuple[float, ...], value)
        return SimpleNamespace(shape=(len(samples),))


async def test_transformers_backend_is_cache_only_and_uses_one_streaming_worker(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    snapshot, cache = _artifacts(tmp_path)
    processor = _Processor()
    model = _Model()
    processor_factory = _PretrainedFactory(processor)
    model_factory = _PretrainedFactory(model)
    streamer_factory = _StreamerFactory()
    transformers = SimpleNamespace(
        AutoProcessor=processor_factory,
        AutoModelForRNNT=model_factory,
        TextIteratorStreamer=streamer_factory,
    )
    torch = SimpleNamespace(
        cuda=SimpleNamespace(
            is_available=lambda: True,
            get_device_name=lambda index: f"GPU {index}",
        ),
        float16="float16",
        float32="float32",
    )
    numpy = _Numpy()
    monkeypatch.setattr(importlib.metadata, "version", lambda name: "5.13.0")
    monkeypatch.setattr(
        importlib,
        "import_module",
        lambda name: (
            transformers if name == "transformers" else numpy if name == "numpy" else torch
        ),
    )
    loader = TransformersNemotronBackendLoader()
    provider = _provider(snapshot, cache, loader)

    await provider.load()
    session = await provider.create_session(sample_rate_hz=16_000)
    partials = await session.push_audio(
        AudioChunk(sequence=0, pcm_s16le=b"\x00\x00" * 320, duration_ms=20)
    )
    final = await session.finish()

    for factory in (processor_factory, model_factory):
        path, options = factory.calls[0]
        assert path == str(snapshot.resolve())
        assert options["cache_dir"] == str(cache.resolve())
        assert options["revision"] == PINNED_REVISION
        assert options["local_files_only"] is True
    assert options["trust_remote_code"] is False
    assert processor.lookahead == 1
    assert processor.audio_shapes == [(320,), (320,)]
    assert model.target_device == "cuda"
    assert model.generate_calls == 1
    assert model.last_generate_options["num_lookahead_tokens"] == 1
    assert len({item.text for item in partials}) == len(partials)
    assert final.text == "native native"

    short_session = await provider.create_session(sample_rate_hz=16_000)
    await short_session.push_audio(
        AudioChunk(sequence=0, pcm_s16le=b"\x00\x00" * 80, duration_ms=5)
    )
    short_final = await short_session.finish()
    assert short_final.text == "native"
    assert processor.audio_shapes == [(320,), (320,), (320,)]
    assert model.generate_calls == 2

    processor.num_mel_frames_per_audio_chunk = 1
    overlap_session = await provider.create_session(sample_rate_hz=16_000)
    await overlap_session.push_audio(
        AudioChunk(sequence=0, pcm_s16le=b"\x00\x00" * 320, duration_ms=20)
    )
    await overlap_session.push_audio(
        AudioChunk(sequence=1, pcm_s16le=b"\x00\x00" * 176, duration_ms=11)
    )
    overlap_final = await overlap_session.finish()
    assert overlap_final.text == "native native native"
    assert processor.audio_shapes[-3:] == [(320,), (320,), (320,)]
    assert model.generate_calls == 3

    torch.cuda.is_available = lambda: False
    cpu_request = NemotronLoadRequest(
        artifact_path=snapshot.resolve(),
        cache_dir=cache.resolve(),
        model_id="nvidia/nemotron-speech-streaming-en-0.6b",
        model_revision=PINNED_REVISION,
        lookahead_tokens=1,
        sample_rate_hz=16_000,
        device="cpu",
    )
    cpu_backend = loader.load_local(cpu_request)

    assert cpu_backend.info.device_name == "CPU"
    assert model.target_device == "cpu"
    assert model_factory.calls[-1][1]["dtype"] == "float32"

    monkeypatch.setattr(importlib.metadata, "version", lambda name: "5.14.0")
    with pytest.raises(NemotronProviderError, match=r">=5\.13,<5\.14"):
        loader.load_local(cpu_request)
