"""Optional cache-only NVIDIA Nemotron streaming-English STT adapter.

The default backend uses the experimental Transformers 5.13 streaming API.
It never falls back to whole-buffer transcription and never downloads models.
Raw PCM stays in bounded in-memory queues and is excluded from representations.
"""

from __future__ import annotations

import asyncio
import importlib
import importlib.metadata
import logging
import queue
import re
import sys
import threading
from array import array
from collections.abc import Iterable, Iterator, Sequence
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Callable, Final, Literal, Protocol, TypeVar, cast

from .base import (
    AudioChunk,
    ProviderCancelled,
    ProviderStatus,
    TranscriptHypothesis,
)

SUPPORTED_LOOKAHEAD_TOKENS = frozenset({0, 1, 6, 13})
_MODEL_ID = re.compile(r"[A-Za-z0-9._-]+/[A-Za-z0-9._-]+")
_REVISION = re.compile(r"[0-9a-f]{40}")
_MAX_DEVICE_NAME_CHARACTERS: Final = 80
_MAX_BUFFERED_SAMPLES: Final = 16_000 * 600
_AUDIO_QUEUE_CAPACITY: Final = 128
_MAX_AUDIO_CHUNK_DURATION_MS: Final = 1_000
_LOGGER = logging.getLogger(__name__)
REQUIRED_ARTIFACT_FILES = frozenset(
    {
        "config.json",
        "generation_config.json",
        "model.safetensors",
        "processor_config.json",
        "tokenizer.json",
        "tokenizer_config.json",
    }
)

NemotronDevice = Literal["cpu", "cuda"]
_T = TypeVar("_T")


class NemotronProviderError(RuntimeError):
    """Base error for safe, actionable Nemotron failures."""


class NemotronWorkerTerminationError(NemotronProviderError):
    """Raised when a native generation worker has not demonstrably exited."""


@dataclass(frozen=True, slots=True)
class NemotronLoadRequest:
    artifact_path: Path
    cache_dir: Path
    model_id: str
    model_revision: str
    lookahead_tokens: int
    sample_rate_hz: int
    device: NemotronDevice


@dataclass(frozen=True, slots=True)
class NemotronRevision:
    revision: int
    text: str = field(repr=False)
    is_final: bool
    confidence: float | None = None


@dataclass(frozen=True, slots=True)
class NemotronBackendInfo:
    device_name: str
    sample_rate_hz: int
    streaming_latency_ms: int


class NemotronBackendSession(Protocol):
    async def push_audio(self, chunk: AudioChunk) -> tuple[NemotronRevision, ...]: ...

    async def finish(self) -> NemotronRevision: ...

    async def cancel(self) -> None:
        """Return only after native work exits; otherwise raise termination error."""


class NemotronBackend(Protocol):
    @property
    def info(self) -> NemotronBackendInfo: ...

    async def create_session(self) -> NemotronBackendSession: ...


class NemotronBackendLoader(Protocol):
    def load_local(self, request: NemotronLoadRequest) -> NemotronBackend: ...


class NemotronStreamingSession:
    """Validate native revisions and expose the provider-neutral STT contract."""

    def __init__(
        self,
        *,
        backend: NemotronBackendSession,
        release_provider_lane: Callable[[], None],
        quarantine_provider_lane: Callable[[str], None],
    ) -> None:
        self._backend = backend
        self._release_provider_lane = release_provider_lane
        self._quarantine_provider_lane = quarantine_provider_lane
        self._lane_released = False
        self._operation_lock = asyncio.Lock()
        self._next_audio_sequence = 0
        self._last_revision = 0
        self._audio_end_ms = 0
        self._terminal: Literal["finished", "cancelled", "quarantined"] | None = None

    async def push_audio(self, chunk: AudioChunk) -> tuple[TranscriptHypothesis, ...]:
        async with self._operation_lock:
            if self._terminal is not None:
                raise ProviderCancelled(f"Nemotron session is {self._terminal}")
            if chunk.sequence != self._next_audio_sequence:
                raise ValueError(
                    f"expected audio sequence {self._next_audio_sequence}, got {chunk.sequence}"
                )
            if chunk.duration_ms <= 0 or not chunk.pcm_s16le or len(chunk.pcm_s16le) % 2:
                raise ValueError("Nemotron audio must be non-empty 16-bit mono PCM")
            expected_numerator = 16_000 * 2 * chunk.duration_ms
            if (
                chunk.duration_ms > _MAX_AUDIO_CHUNK_DURATION_MS
                or expected_numerator % 1_000
                or len(chunk.pcm_s16le) != expected_numerator // 1_000
            ):
                raise ValueError("Nemotron audio duration does not match its bounded PCM payload")
            self._next_audio_sequence += 1
            self._audio_end_ms += chunk.duration_ms
            try:
                revisions = await self._backend.push_audio(chunk)
            except asyncio.CancelledError:
                await self._cancel_after_interrupted_call()
                raise
            return tuple(self._accept_revision(item, expect_final=False) for item in revisions)

    async def finish(self) -> TranscriptHypothesis:
        async with self._operation_lock:
            if self._terminal is not None:
                raise ProviderCancelled(f"Nemotron session is {self._terminal}")
            try:
                revision = await self._backend.finish()
            except asyncio.CancelledError:
                await self._cancel_after_interrupted_call()
                raise
            try:
                result = self._accept_revision(revision, expect_final=True)
            finally:
                # A returned final proves the backend worker has exited, even if its
                # transcript metadata is rejected at this boundary.
                self._terminal = "finished"
                self._release_lane_once()
            return result

    async def cancel(self) -> None:
        async with self._operation_lock:
            if self._terminal in {"finished", "cancelled"}:
                return
            try:
                cancellation_requested = await self._cancel_backend_physical()
            except BaseException as error:
                self._terminal = "quarantined"
                self._quarantine_provider_lane(type(error).__name__)
                raise
            self._terminal = "cancelled"
            self._release_lane_once()
            if cancellation_requested:
                raise asyncio.CancelledError

    async def _cancel_after_interrupted_call(self) -> None:
        try:
            await self._cancel_backend_physical()
        except BaseException as error:
            self._terminal = "quarantined"
            error_type = type(error).__name__
            self._quarantine_provider_lane(error_type)
            _LOGGER.error(
                "Nemotron cleanup could not confirm worker termination errorType=%s",
                error_type,
            )
        else:
            self._terminal = "cancelled"
            self._release_lane_once()

    def _release_lane_once(self) -> None:
        if self._lane_released:
            return
        self._lane_released = True
        self._release_provider_lane()

    async def _cancel_backend_physical(self) -> bool:
        cancel_task = asyncio.create_task(self._backend.cancel())
        cancellation_requested = await _wait_until_done(cancel_task)
        cancel_task.result()
        return cancellation_requested

    def _accept_revision(
        self,
        revision: NemotronRevision,
        *,
        expect_final: bool,
    ) -> TranscriptHypothesis:
        if revision.revision != self._last_revision + 1:
            raise NemotronProviderError("Nemotron backend emitted a non-monotonic revision")
        if revision.is_final is not expect_final:
            raise NemotronProviderError("Nemotron backend emitted an invalid final-state revision")
        if revision.confidence is not None and not 0 <= revision.confidence <= 1:
            raise NemotronProviderError("Nemotron backend emitted invalid confidence")
        if not revision.text.strip():
            raise NemotronProviderError("Nemotron backend emitted an empty transcript")
        self._last_revision = revision.revision
        return TranscriptHypothesis(
            text=revision.text,
            is_final=revision.is_final,
            confidence=revision.confidence,
            audio_end_ms=self._audio_end_ms,
        )


class NemotronSttProvider:
    """Load one pinned local snapshot and create native streaming sessions."""

    def __init__(
        self,
        *,
        artifact_path: Path,
        cache_dir: Path,
        model_id: str,
        model_revision: str,
        lookahead_tokens: int,
        sample_rate_hz: int = 16_000,
        device: NemotronDevice = "cuda",
        backend_loader: NemotronBackendLoader | None = None,
    ) -> None:
        if not artifact_path.is_absolute() or not cache_dir.is_absolute():
            raise ValueError("Nemotron artifact and cache paths must be absolute")
        if lookahead_tokens not in SUPPORTED_LOOKAHEAD_TOKENS:
            raise ValueError("Nemotron lookahead tokens must be one of 0, 1, 6, or 13")
        if sample_rate_hz != 16_000:
            raise ValueError("Nemotron streaming English requires 16 kHz mono PCM")
        if _MODEL_ID.fullmatch(model_id) is None:
            raise ValueError("Nemotron model ID must be an owner/name identifier")
        if _REVISION.fullmatch(model_revision) is None:
            raise ValueError("Nemotron model revision must be a pinned SHA-1")
        if device not in {"cpu", "cuda"}:
            raise ValueError("Nemotron device must be cpu or cuda")
        self._request = NemotronLoadRequest(
            artifact_path=artifact_path.resolve(),
            cache_dir=cache_dir.resolve(),
            model_id=model_id,
            model_revision=model_revision,
            lookahead_tokens=lookahead_tokens,
            sample_rate_hz=sample_rate_hz,
            device=device,
        )
        self._loader = backend_loader or TransformersNemotronBackendLoader()
        self._backend: NemotronBackend | None = None
        self._session_lock = asyncio.Lock()
        self._next_session_token = 0
        self._active_session_token: int | None = None
        self._quarantined = False
        self._load_lock = asyncio.Lock()
        self._load_task: asyncio.Task[ProviderStatus] | None = None
        self._status = ProviderStatus(
            provider_id="nemotron-transformers",
            kind="stt",
            configured=True,
            loaded=False,
            ready=False,
            device=device,
            model_id=f"{model_id}@{model_revision}",
            supports_streaming=True,
            supports_timings=True,
            diagnostic="pinned local Nemotron snapshot is not loaded",
        )

    @property
    def status(self) -> ProviderStatus:
        return self._status

    async def load(self) -> ProviderStatus:
        async with self._load_lock:
            if self._quarantined:
                raise NemotronProviderError(
                    "Nemotron provider is quarantined; restart the speech service"
                )
            if self._status.ready:
                return self._status
            if self._load_task is None or self._load_task.done():
                self._load_task = asyncio.create_task(self._load_once())
            task = self._load_task
        return await asyncio.shield(task)

    async def _load_once(self) -> ProviderStatus:
        if self._quarantined:
            raise NemotronProviderError(
                "Nemotron provider is quarantined; restart the speech service"
            )
        missing = sorted(
            name
            for name in REQUIRED_ARTIFACT_FILES
            if not (self._request.artifact_path / name).is_file()
        )
        if missing:
            self._status = ProviderStatus(
                provider_id="nemotron-transformers",
                kind="stt",
                configured=True,
                loaded=False,
                ready=False,
                device=self._request.device,
                model_id=f"{self._request.model_id}@{self._request.model_revision}",
                supports_streaming=True,
                supports_timings=True,
                diagnostic="local Nemotron snapshot is incomplete: " + ", ".join(missing),
            )
            raise NemotronProviderError(self._status.diagnostic)
        try:
            loop = asyncio.get_running_loop()
            work = loop.run_in_executor(None, self._loader.load_local, self._request)
            backend = await _await_physical_load(work)
            if backend.info.sample_rate_hz != self._request.sample_rate_hz:
                raise NemotronProviderError(
                    "Nemotron backend sample rate does not match configuration"
                )
        except asyncio.CancelledError:
            raise
        except NemotronProviderError as error:
            self._status = ProviderStatus(
                provider_id="nemotron-transformers",
                kind="stt",
                configured=True,
                loaded=False,
                ready=False,
                device=self._request.device,
                model_id=f"{self._request.model_id}@{self._request.model_revision}",
                supports_streaming=True,
                supports_timings=True,
                diagnostic=str(error),
            )
            raise
        except Exception as error:
            self._status = ProviderStatus(
                provider_id="nemotron-transformers",
                kind="stt",
                configured=True,
                loaded=False,
                ready=False,
                device=self._request.device,
                model_id=f"{self._request.model_id}@{self._request.model_revision}",
                supports_streaming=True,
                supports_timings=True,
                diagnostic=f"local Nemotron load failed: {type(error).__name__}",
            )
            raise NemotronProviderError(self._status.diagnostic) from None
        self._backend = backend
        self._status = ProviderStatus(
            provider_id="nemotron-transformers",
            kind="stt",
            configured=True,
            loaded=True,
            ready=True,
            device=self._request.device,
            model_id=f"{self._request.model_id}@{self._request.model_revision}",
            supports_streaming=True,
            supports_timings=True,
            warmup_latency_ms=None,
            diagnostic=(
                f"{self._request.device.upper()} ready "
                f"({_safe_device_name(backend.info.device_name)}); native streaming latency "
                f"{backend.info.streaming_latency_ms} ms; live warmup is not measured"
            ),
        )
        return self._status

    async def create_session(self, *, sample_rate_hz: int) -> NemotronStreamingSession:
        if self._quarantined:
            raise NemotronProviderError(
                "Nemotron provider is quarantined; restart the speech service"
            )
        if not self._status.ready or self._backend is None:
            raise NemotronProviderError("Nemotron provider is not loaded")
        if sample_rate_hz != self._request.sample_rate_hz:
            raise ValueError(f"Nemotron expects {self._request.sample_rate_hz} Hz mono PCM")
        async with self._session_lock:
            if self._active_session_token is not None:
                raise NemotronProviderError("Nemotron supports one active native streaming session")
            self._next_session_token += 1
            session_token = self._next_session_token
            self._active_session_token = session_token
            try:
                backend_session = await self._backend.create_session()
            except BaseException:
                if self._active_session_token == session_token:
                    self._active_session_token = None
                raise
        return NemotronStreamingSession(
            backend=backend_session,
            release_provider_lane=lambda: self._release_session_lane(session_token),
            quarantine_provider_lane=lambda error_type: self._quarantine_session_lane(
                session_token,
                error_type,
            ),
        )

    def _release_session_lane(self, session_token: int) -> None:
        if self._active_session_token == session_token:
            self._active_session_token = None

    def _quarantine_session_lane(self, session_token: int, error_type: str) -> None:
        if self._active_session_token != session_token:
            return
        self._quarantined = True
        self._status = replace(
            self._status,
            ready=False,
            diagnostic=(
                "native Nemotron lane is quarantined after unconfirmed termination "
                f"({error_type}); restart the speech service"
            ),
        )


class _Tensor(Protocol):
    def __getitem__(self, key: object) -> object: ...


class _Batch(Protocol):
    input_features: _Tensor

    def to(self, device: object, *, dtype: object) -> _Batch: ...

    def keys(self) -> Iterable[str]: ...

    def __getitem__(self, key: str) -> object: ...


class _FeatureExtractor(Protocol):
    sampling_rate: int
    hop_length: int
    n_fft: int


class _Processor(Protocol):
    feature_extractor: _FeatureExtractor
    tokenizer: object
    num_samples_first_audio_chunk: int
    num_samples_per_audio_chunk: int
    num_mel_frames_first_audio_chunk: int
    num_mel_frames_per_audio_chunk: int
    streaming_latency_ms: int

    def set_num_lookahead_tokens(self, value: int) -> None: ...

    def __call__(self, audio: object, **kwargs: object) -> _Batch: ...


class _Model(Protocol):
    device: object
    dtype: object

    def to(self, device: str) -> _Model: ...

    def eval(self) -> _Model: ...

    def generate(self, **kwargs: object) -> object: ...


class _Factory(Protocol):
    def from_pretrained(self, path: str, **kwargs: object) -> object: ...


class _StreamerFactory(Protocol):
    def __call__(self, tokenizer: object, **kwargs: object) -> object: ...


class _Cuda(Protocol):
    def is_available(self) -> bool: ...

    def get_device_name(self, index: int) -> str: ...


class _Torch(Protocol):
    cuda: _Cuda
    float16: object
    float32: object


class _Numpy(Protocol):
    float32: object

    def asarray(self, value: object, *, dtype: object) -> object: ...


class _Streamer(Protocol):
    text_queue: queue.Queue[object]
    stop_signal: object

    def end(self) -> None: ...


@dataclass(frozen=True, slots=True)
class _TransformersBackend:
    processor: _Processor
    model: _Model
    streamer_factory: _StreamerFactory
    audio_array_factory: Callable[[Sequence[float]], object]
    info: NemotronBackendInfo
    worker_join_timeout_seconds: float = 10.0

    async def create_session(self) -> _TransformersSession:
        return _TransformersSession(
            processor=self.processor,
            model=self.model,
            streamer_factory=self.streamer_factory,
            audio_array_factory=self.audio_array_factory,
            join_timeout_seconds=self.worker_join_timeout_seconds,
        )


class TransformersNemotronBackendLoader:
    """Lazy boundary around optional torch/Transformers dependencies."""

    def load_local(self, request: NemotronLoadRequest) -> NemotronBackend:
        try:
            version = importlib.metadata.version("transformers")
            transformers = importlib.import_module("transformers")
            torch_module = importlib.import_module("torch")
            numpy_module = importlib.import_module("numpy")
            importlib.import_module("librosa")
        except (ImportError, importlib.metadata.PackageNotFoundError):
            raise NemotronProviderError(
                "Nemotron requires optional torch, transformers>=5.13,<5.14, "
                "numpy, and librosa packages"
            ) from None
        if not (5, 13, 0) <= _version_tuple(version) < (5, 14, 0):
            raise NemotronProviderError("Nemotron requires transformers>=5.13,<5.14")
        torch = cast(_Torch, torch_module)
        numpy = cast(_Numpy, numpy_module)
        if request.device == "cuda" and not torch.cuda.is_available():
            raise NemotronProviderError("PyTorch CUDA is unavailable for Nemotron")
        processor_factory = cast(_Factory, getattr(transformers, "AutoProcessor"))
        model_factory = cast(_Factory, getattr(transformers, "AutoModelForRNNT"))
        streamer_factory = cast(
            _StreamerFactory,
            getattr(transformers, "TextIteratorStreamer"),
        )
        load_options: dict[str, object] = {
            "cache_dir": str(request.cache_dir),
            "revision": request.model_revision,
            "local_files_only": True,
            "trust_remote_code": False,
        }
        processor = cast(
            _Processor,
            processor_factory.from_pretrained(str(request.artifact_path), **load_options),
        )
        model = cast(
            _Model,
            model_factory.from_pretrained(
                str(request.artifact_path),
                **load_options,
                dtype=torch.float16 if request.device == "cuda" else torch.float32,
            ),
        )
        processor.set_num_lookahead_tokens(request.lookahead_tokens)
        if processor.feature_extractor.sampling_rate != request.sample_rate_hz:
            raise NemotronProviderError("local processor has an unexpected sample rate")
        model = model.to(request.device).eval()
        device_name = torch.cuda.get_device_name(0) if request.device == "cuda" else "CPU"
        return _TransformersBackend(
            processor=processor,
            model=model,
            streamer_factory=streamer_factory,
            audio_array_factory=lambda values: numpy.asarray(values, dtype=numpy.float32),
            info=NemotronBackendInfo(
                device_name=device_name,
                sample_rate_hz=processor.feature_extractor.sampling_rate,
                streaming_latency_ms=processor.streaming_latency_ms,
            ),
        )


def _version_tuple(value: str) -> tuple[int, int, int]:
    numbers: list[int] = []
    for component in value.split(".")[:3]:
        digits = "".join(character for character in component if character.isdigit())
        numbers.append(int(digits or "0"))
    padded = numbers + [0, 0, 0]
    return padded[0], padded[1], padded[2]


class _AudioSource:
    _END = object()

    def __init__(self) -> None:
        # One extra slot is reserved for the terminal sentinel.
        self._queue: queue.Queue[bytes | object] = queue.Queue(maxsize=_AUDIO_QUEUE_CAPACITY + 1)
        self._samples = array("h")
        self._accepting = True
        self._ended = False
        self._terminal_window_emitted = False
        self._cancelled = threading.Event()

    def push(self, pcm: bytes) -> None:
        if not self._accepting or self._cancelled.is_set():
            raise ProviderCancelled("Nemotron audio source is terminal")
        if self._queue.qsize() >= _AUDIO_QUEUE_CAPACITY:
            raise queue.Full
        self._queue.put_nowait(pcm)

    def finish(self) -> None:
        if self._accepting:
            self._accepting = False
            self._queue.put_nowait(self._END)

    def cancel(self) -> None:
        self._cancelled.set()
        self._accepting = False
        while True:
            try:
                self._queue.get_nowait()
            except queue.Empty:
                break
        self._ended = True
        self._queue.put_nowait(self._END)

    def window(self, start: int, length: int) -> tuple[float, ...] | None:
        if self._terminal_window_emitted:
            return None
        required = start + length
        while len(self._samples) < required and not self._ended:
            item = self._queue.get()
            if item is self._END:
                self._ended = True
                break
            pcm = array("h")
            pcm.frombytes(cast(bytes, item))
            if sys.byteorder != "little":
                pcm.byteswap()
            if len(self._samples) + len(pcm) > _MAX_BUFFERED_SAMPLES:
                raise NemotronProviderError("Nemotron utterance exceeds the local audio bound")
            self._samples.extend(pcm)
        if self._cancelled.is_set() or (self._ended and start >= len(self._samples)):
            return None
        samples = self._samples[start : min(required, len(self._samples))]
        if len(samples) < length:
            self._terminal_window_emitted = True
            samples.extend([0] * (length - len(samples)))
        return tuple(sample / 32768.0 for sample in samples)


class _TransformersSession:
    def __init__(
        self,
        *,
        processor: _Processor,
        model: _Model,
        streamer_factory: _StreamerFactory,
        audio_array_factory: Callable[[Sequence[float]], object],
        join_timeout_seconds: float,
    ) -> None:
        self._processor = processor
        self._model = model
        self._audio_array_factory = audio_array_factory
        self._source = _AudioSource()
        self._join_timeout_seconds = join_timeout_seconds
        self._streamer = cast(
            _Streamer,
            streamer_factory(
                processor.tokenizer,
                skip_special_tokens=True,
            ),
        )
        self._revision = 0
        self._text = ""
        self._last_emitted_text = ""
        self._failure: BaseException | None = None
        self._worker = threading.Thread(
            target=self._run_generate,
            name="suits-nemotron-generate",
            daemon=True,
        )
        self._worker.start()

    async def push_audio(self, chunk: AudioChunk) -> tuple[NemotronRevision, ...]:
        try:
            self._source.push(chunk.pcm_s16le)
        except queue.Full:
            raise NemotronProviderError("Nemotron native audio queue is full") from None
        await asyncio.sleep(0)
        self._raise_worker_failure()
        return self._drain_partials()

    async def finish(self) -> NemotronRevision:
        self._source.finish()
        await self._join_worker()
        self._raise_worker_failure()
        self._drain_partials(emit=False)
        self._revision += 1
        return NemotronRevision(revision=self._revision, text=self._text.strip(), is_final=True)

    async def cancel(self) -> None:
        self._source.cancel()
        await self._join_worker()

    async def _join_worker(self) -> None:
        join_task = asyncio.create_task(
            asyncio.to_thread(self._worker.join, self._join_timeout_seconds)
        )
        try:
            cancellation_requested = await _wait_until_done(join_task)
            join_task.result()
        except asyncio.CancelledError:
            raise
        except BaseException as error:
            raise NemotronWorkerTerminationError(
                f"Nemotron generation worker join failed: {type(error).__name__}"
            ) from None
        if self._worker.is_alive():
            raise NemotronWorkerTerminationError(
                "Nemotron generation worker termination could not be confirmed"
            )
        if cancellation_requested:
            raise asyncio.CancelledError

    def _run_generate(self) -> None:
        try:
            first = self._source.window(0, self._processor.num_samples_first_audio_chunk)
            if first is None:
                self._streamer.end()
                return
            first_inputs = self._processor(
                self._audio_array_factory(first),
                sampling_rate=self._processor.feature_extractor.sampling_rate,
                is_streaming=True,
                is_first_audio_chunk=True,
                return_tensors="pt",
            ).to(self._model.device, dtype=self._model.dtype)

            def features() -> Iterator[object]:
                yield first_inputs.input_features[
                    :, : self._processor.num_mel_frames_first_audio_chunk, :
                ]
                mel_frame = self._processor.num_mel_frames_first_audio_chunk
                while True:
                    start = (
                        mel_frame * self._processor.feature_extractor.hop_length
                        - self._processor.feature_extractor.n_fft // 2
                    )
                    audio = self._source.window(
                        start,
                        self._processor.num_samples_per_audio_chunk,
                    )
                    if audio is None:
                        return
                    inputs = self._processor(
                        self._audio_array_factory(audio),
                        sampling_rate=self._processor.feature_extractor.sampling_rate,
                        is_streaming=True,
                        is_first_audio_chunk=False,
                        return_tensors="pt",
                    ).to(self._model.device, dtype=self._model.dtype)
                    yield inputs.input_features
                    mel_frame += self._processor.num_mel_frames_per_audio_chunk

            kwargs: dict[str, object] = {key: first_inputs[key] for key in first_inputs.keys()}
            kwargs["input_features"] = features()
            kwargs["streamer"] = self._streamer
            self._model.generate(**kwargs)
        except BaseException as error:
            self._failure = error
            self._streamer.end()

    def _drain_partials(self, *, emit: bool = True) -> tuple[NemotronRevision, ...]:
        revisions: list[NemotronRevision] = []
        while True:
            try:
                item = self._streamer.text_queue.get_nowait()
            except queue.Empty:
                break
            if item is self._streamer.stop_signal:
                continue
            if type(item) is not str:
                raise NemotronProviderError("Nemotron streamer emitted an invalid text item")
            self._text += item
            normalized = self._text.strip()
            if normalized and emit and normalized != self._last_emitted_text:
                self._revision += 1
                self._last_emitted_text = normalized
                revisions.append(
                    NemotronRevision(
                        revision=self._revision,
                        text=normalized,
                        is_final=False,
                    )
                )
        return tuple(revisions)

    def _raise_worker_failure(self) -> None:
        if self._failure is not None:
            raise NemotronProviderError(
                f"Nemotron generation failed: {type(self._failure).__name__}"
            ) from None


async def _await_physical_load(
    work: asyncio.Future[NemotronBackend],
) -> NemotronBackend:
    """Do not report a cancelled model load while its worker still runs."""

    cancellation_requested = await _wait_until_done(work)
    try:
        result = work.result()
    except BaseException as error:
        if cancellation_requested:
            _LOGGER.warning(
                "Nemotron load worker ended during task cancellation errorType=%s",
                type(error).__name__,
            )
            raise asyncio.CancelledError from None
        raise
    if cancellation_requested:
        raise asyncio.CancelledError
    return result


async def _wait_until_done(work: asyncio.Future[_T]) -> bool:
    """Defer repeated caller cancellation until the physical future is terminal."""

    cancellation_requested = False
    while not work.done():
        try:
            await asyncio.shield(work)
        except asyncio.CancelledError:
            cancellation_requested = True
        except BaseException:
            # The caller consumes the terminal result so diagnostics remain scoped.
            pass
    return cancellation_requested


def _safe_device_name(value: str) -> str:
    normalized = " ".join(value.split())
    if not normalized or any(ord(character) < 32 for character in normalized):
        return "local device"
    return normalized[:_MAX_DEVICE_NAME_CHARACTERS]
