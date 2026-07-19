"""Optional cache-only Kokoro TTS adapter.

The official Kokoro API downloads missing model and voice files from the Hub.
This adapter deliberately avoids those paths: callers provide one absolute,
pinned snapshot containing the config, weights, and every allowlisted voice.
Kokoro and torch are imported only during explicit ``load()``.
"""

from __future__ import annotations

import asyncio
import importlib
import logging
import math
import re
import sys
from array import array
from collections.abc import Iterable
from concurrent.futures import Executor
from dataclasses import dataclass, field
from functools import partial
from pathlib import Path
from time import perf_counter
from typing import Final, Literal, Protocol, TypeVar, cast

from .base import ProviderCancelled, ProviderStatus, SynthesizedPhrase, SynthesisTiming

KOKORO_SAMPLE_RATE_HZ: Final = 24_000
KOKORO_CONFIG_FILENAME: Final = "config.json"
KOKORO_MODEL_FILENAME: Final = "kokoro-v1_0.pth"
KOKORO_ENGLISH_MODEL_PACKAGE: Final = "en_core_web_sm"
_MAX_TEXT_CHARACTERS: Final = 2_000
_MAX_AUDIO_SECONDS: Final = 30
_MAX_TIMING_MARKS: Final = 2_048
_VOICE_ID = re.compile(r"[abefhijpz][fm]_[a-z0-9]+(?:_[a-z0-9]+)*")
_MODEL_ID = re.compile(r"[A-Za-z0-9._-]+/[A-Za-z0-9._-]+")
_REVISION = re.compile(r"[0-9a-f]{40}")
_SAFE_FILENAME = re.compile(r"[A-Za-z0-9._-]+")
_LOGGER = logging.getLogger(__name__)

KokoroDevice = Literal["cpu", "cuda"]
_T = TypeVar("_T")


class KokoroProviderError(RuntimeError):
    """Base error with privacy-safe messages."""


class KokoroArtifactError(KokoroProviderError):
    """Raised when the explicit local snapshot is incomplete."""


class KokoroDependencyError(KokoroProviderError):
    """Raised when the optional Kokoro runtime is not installed."""


class KokoroLoadError(KokoroProviderError):
    """Raised when local artifacts cannot be loaded."""


class KokoroSynthesisError(KokoroProviderError):
    """Raised when physical synthesis fails."""


class KokoroInvalidOutputError(KokoroSynthesisError):
    """Raised when backend audio or timing output is invalid."""


@dataclass(frozen=True, slots=True)
class KokoroWordTiming:
    value: str = field(repr=False)
    start_seconds: float
    end_seconds: float


@dataclass(frozen=True, slots=True)
class KokoroChunk:
    """One synchronous backend result before PCM conversion."""

    text: str = field(repr=False)
    samples: tuple[float, ...] = field(repr=False)
    words: tuple[KokoroWordTiming, ...]


class KokoroBackend(Protocol):
    """Injected synchronous seam used by deterministic tests."""

    def synthesize(self, *, text: str, voice_id: str) -> tuple[KokoroChunk, ...]:
        """Return in-memory floating-point mono chunks and word timings."""


@dataclass(frozen=True, slots=True)
class KokoroLocalArtifacts:
    snapshot_dir: Path
    config_path: Path
    model_path: Path
    voice_paths: tuple[tuple[str, Path], ...]

    @classmethod
    def from_snapshot(
        cls,
        *,
        snapshot_dir: Path,
        voice_ids: tuple[str, ...],
        model_filename: str = KOKORO_MODEL_FILENAME,
    ) -> KokoroLocalArtifacts:
        if not snapshot_dir.is_absolute():
            raise ValueError("Kokoro snapshot directory must be absolute")
        if _SAFE_FILENAME.fullmatch(model_filename) is None:
            raise ValueError("Kokoro model filename must be a safe basename")
        return cls(
            snapshot_dir=snapshot_dir,
            config_path=snapshot_dir / KOKORO_CONFIG_FILENAME,
            model_path=snapshot_dir / model_filename,
            voice_paths=tuple(
                (voice_id, snapshot_dir / "voices" / f"{voice_id}.pt") for voice_id in voice_ids
            ),
        )

    def validate(self) -> None:
        required = (self.config_path, self.model_path, *(path for _, path in self.voice_paths))
        if not self.snapshot_dir.is_dir() or any(not path.is_file() for path in required):
            raise KokoroArtifactError("local Kokoro snapshot is incomplete")

    def voice_path(self, voice_id: str) -> Path:
        for configured_id, path in self.voice_paths:
            if configured_id == voice_id:
                return path
        raise KeyError("voice is not part of the pinned Kokoro snapshot")


class KokoroBackendLoader(Protocol):
    def __call__(
        self,
        *,
        artifacts: KokoroLocalArtifacts,
        model_id: str,
        voice_ids: tuple[str, ...],
        device: KokoroDevice,
    ) -> KokoroBackend:
        """Load only the supplied local artifacts and return a backend."""


class KokoroTtsProvider:
    """Kokoro provider with explicit artifacts and honest worker lifetime."""

    def __init__(
        self,
        *,
        model_id: str,
        model_revision: str,
        snapshot_dir: Path,
        voice_ids: tuple[str, ...],
        device: KokoroDevice,
        model_filename: str = KOKORO_MODEL_FILENAME,
        backend_loader: KokoroBackendLoader | None = None,
        executor: Executor | None = None,
    ) -> None:
        if _MODEL_ID.fullmatch(model_id) is None:
            raise ValueError("Kokoro model ID must be an owner/name identifier")
        if _REVISION.fullmatch(model_revision) is None:
            raise ValueError("Kokoro model revision must be a pinned SHA-1")
        if not voice_ids or len(set(voice_ids)) != len(voice_ids):
            raise ValueError("Kokoro voice IDs must be non-empty and unique")
        if any(_VOICE_ID.fullmatch(voice_id) is None for voice_id in voice_ids):
            raise ValueError("Kokoro voice IDs are invalid")
        if device not in {"cpu", "cuda"}:
            raise ValueError("Kokoro device must be cpu or cuda")

        self._model_id = model_id
        self._model_revision = model_revision
        self._voice_ids = voice_ids
        self._device = device
        self._artifacts = KokoroLocalArtifacts.from_snapshot(
            snapshot_dir=snapshot_dir,
            voice_ids=voice_ids,
            model_filename=model_filename,
        )
        self._backend_loader = backend_loader or _load_official_backend
        self._executor = executor
        self._backend: KokoroBackend | None = None
        self._warmup_latency_ms: int | None = None
        self._diagnostic: str | None = "explicit local Kokoro artifacts are not loaded"
        self._load_lock = asyncio.Lock()
        self._load_task: asyncio.Task[None] | None = None

    @property
    def status(self) -> ProviderStatus:
        ready = self._backend is not None
        return ProviderStatus(
            provider_id="kokoro",
            kind="tts",
            configured=True,
            loaded=ready,
            ready=ready,
            device=self._device,
            model_id=f"{self._model_id}@{self._model_revision}",
            supports_streaming=False,
            supports_timings=True,
            warmup_latency_ms=self._warmup_latency_ms,
            diagnostic=self._diagnostic,
        )

    async def load(self) -> ProviderStatus:
        """Load a complete local snapshot, coalescing concurrent callers."""

        async with self._load_lock:
            if self._backend is not None:
                return self.status
            if self._load_task is None or self._load_task.done():
                self._load_task = asyncio.create_task(
                    self._load_once(),
                    name="speech:kokoro:load",
                )
            load_task = self._load_task
        await asyncio.shield(load_task)
        return self.status

    async def _load_once(self) -> None:
        try:
            self._artifacts.validate()
            loop = asyncio.get_running_loop()
            work = loop.run_in_executor(
                self._executor,
                partial(
                    self._backend_loader,
                    artifacts=self._artifacts,
                    model_id=self._model_id,
                    voice_ids=self._voice_ids,
                    device=self._device,
                ),
            )
            backend = await _await_physical_work(work)
        except asyncio.CancelledError:
            raise
        except KokoroProviderError as error:
            self._diagnostic = str(error)
            raise
        except Exception as error:
            self._diagnostic = f"local Kokoro load failed ({type(error).__name__})"
            raise KokoroLoadError("local Kokoro artifacts could not be loaded") from None
        self._backend = backend
        self._diagnostic = None

    async def synthesize_phrase(
        self,
        *,
        text: str,
        voice_id: str,
        cancel_event: asyncio.Event,
    ) -> SynthesizedPhrase:
        backend = self._backend
        if backend is None:
            raise KokoroLoadError("local Kokoro provider is not loaded")
        normalized_text = _validate_text(text)
        if voice_id not in self._voice_ids:
            raise ValueError("Kokoro voice is not configured")
        if cancel_event.is_set():
            raise ProviderCancelled("TTS job was cancelled")

        started = perf_counter()
        loop = asyncio.get_running_loop()
        work = loop.run_in_executor(
            self._executor,
            partial(
                _synthesize_blocking,
                backend=backend,
                text=normalized_text,
                voice_id=voice_id,
            ),
        )
        cancel_waiter = asyncio.create_task(cancel_event.wait())
        try:
            done, _ = await asyncio.wait(
                (work, cancel_waiter),
                return_when=asyncio.FIRST_COMPLETED,
            )
            if work in done:
                phrase = _physical_result(work)
                if cancel_event.is_set():
                    raise ProviderCancelled("TTS job was cancelled")
                if self._warmup_latency_ms is None:
                    self._warmup_latency_ms = max(
                        0,
                        round((perf_counter() - started) * 1_000),
                    )
                return phrase

            # Kokoro exposes no cooperative stop primitive. Keep this coroutine
            # alive until the executor future physically exits; the owning lane
            # can then quarantine honestly if its grace deadline expires.
            try:
                await asyncio.shield(work)
            except Exception:
                raise KokoroSynthesisError(
                    "Kokoro synthesis failed while cancellation was pending"
                ) from None
            raise ProviderCancelled("TTS job was cancelled")
        except asyncio.CancelledError:
            await _consume_after_task_cancellation(work)
            raise
        finally:
            if not cancel_waiter.done():
                cancel_waiter.cancel()
            await asyncio.gather(cancel_waiter, return_exceptions=True)


def _validate_text(text: str) -> str:
    if type(text) is not str:
        raise TypeError("Kokoro text must be a string")
    normalized = text.strip()
    if not normalized or len(normalized) > _MAX_TEXT_CHARACTERS or "\x00" in normalized:
        raise ValueError("Kokoro text is empty or exceeds the bounded phrase size")
    return normalized


async def _await_physical_work(
    work: asyncio.Future[KokoroBackend],
) -> KokoroBackend:
    try:
        return await asyncio.shield(work)
    except asyncio.CancelledError:
        await _consume_after_task_cancellation(work)
        raise


async def _consume_after_task_cancellation(work: asyncio.Future[_T]) -> None:
    try:
        await asyncio.shield(work)
    except BaseException as error:
        _LOGGER.warning(
            "Kokoro executor work ended during task cancellation errorType=%s",
            type(error).__name__,
        )


def _physical_result(work: asyncio.Future[SynthesizedPhrase]) -> SynthesizedPhrase:
    try:
        return work.result()
    except KokoroProviderError:
        raise
    except Exception as error:
        raise KokoroSynthesisError(
            f"local Kokoro synthesis failed ({type(error).__name__})"
        ) from None


def _synthesize_blocking(
    *,
    backend: KokoroBackend,
    text: str,
    voice_id: str,
) -> SynthesizedPhrase:
    chunks = backend.synthesize(text=text, voice_id=voice_id)
    if type(chunks) is not tuple or not chunks or len(chunks) > 64:
        raise KokoroInvalidOutputError("Kokoro returned an invalid chunk set")

    pcm = array("h")
    pending_words: list[tuple[str, int, int]] = []
    sample_offset = 0
    for chunk in chunks:
        if type(chunk.text) is not str or not chunk.text.strip():
            raise KokoroInvalidOutputError("Kokoro returned invalid chunk metadata")
        if type(chunk.samples) is not tuple or not chunk.samples:
            raise KokoroInvalidOutputError("Kokoro returned empty audio")
        if type(chunk.words) is not tuple or not chunk.words:
            raise KokoroInvalidOutputError("Kokoro returned no word timings")
        if sample_offset + len(chunk.samples) > KOKORO_SAMPLE_RATE_HZ * _MAX_AUDIO_SECONDS:
            raise KokoroInvalidOutputError("Kokoro audio exceeds the bounded phrase duration")

        for sample in chunk.samples:
            if isinstance(sample, bool) or not isinstance(sample, (int, float)):
                raise KokoroInvalidOutputError("Kokoro returned a non-numeric sample")
            value = float(sample)
            if not math.isfinite(value):
                raise KokoroInvalidOutputError("Kokoro returned a non-finite sample")
            value = max(-1.0, min(1.0, value))
            pcm.append(-32_768 if value <= -1 else round(value * 32_767))

        chunk_duration_seconds = len(chunk.samples) / KOKORO_SAMPLE_RATE_HZ
        chunk_offset_ms = _samples_to_ms(sample_offset)
        prior_start_seconds = -1.0
        for word in chunk.words:
            if (
                type(word.value) is not str
                or not word.value.strip()
                or len(word.value) > 256
                or any(ord(character) < 32 for character in word.value)
                or isinstance(word.start_seconds, bool)
                or isinstance(word.end_seconds, bool)
                or not isinstance(word.start_seconds, (int, float))
                or not isinstance(word.end_seconds, (int, float))
            ):
                raise KokoroInvalidOutputError("Kokoro returned invalid word timing metadata")
            start_seconds = float(word.start_seconds)
            end_seconds = float(word.end_seconds)
            if (
                not math.isfinite(start_seconds)
                or not math.isfinite(end_seconds)
                or start_seconds < prior_start_seconds
                or start_seconds < 0
                or end_seconds <= start_seconds
                or end_seconds > chunk_duration_seconds + 0.05
            ):
                raise KokoroInvalidOutputError("Kokoro returned an invalid word timing range")
            pending_words.append(
                (
                    word.value.strip(),
                    chunk_offset_ms + round(start_seconds * 1_000),
                    chunk_offset_ms
                    + min(_samples_to_ms(len(chunk.samples)), round(end_seconds * 1_000)),
                )
            )
            prior_start_seconds = start_seconds
        sample_offset += len(chunk.samples)

    if sys.byteorder != "little":
        pcm.byteswap()
    duration_ms = _samples_to_ms(sample_offset)
    if duration_ms <= 0 or len(pending_words) + 1 > _MAX_TIMING_MARKS:
        raise KokoroInvalidOutputError("Kokoro returned invalid phrase timing metadata")
    timings = (
        SynthesisTiming(kind="phrase", value=text, start_ms=0, end_ms=duration_ms),
        *(
            SynthesisTiming(
                kind="word",
                value=value,
                start_ms=start_ms,
                end_ms=min(duration_ms, end_ms),
            )
            for value, start_ms, end_ms in pending_words
        ),
    )
    if any(mark.start_ms < 0 or mark.end_ms <= mark.start_ms for mark in timings):
        raise KokoroInvalidOutputError("Kokoro returned invalid normalized timings")
    return SynthesizedPhrase(
        pcm_s16le=pcm.tobytes(),
        sample_rate_hz=KOKORO_SAMPLE_RATE_HZ,
        channels=1,
        duration_ms=duration_ms,
        timings=timings,
    )


def _samples_to_ms(sample_count: int) -> int:
    return (sample_count * 1_000 + KOKORO_SAMPLE_RATE_HZ // 2) // KOKORO_SAMPLE_RATE_HZ


class _KModel(Protocol):
    def to(self, device: str) -> _KModel: ...

    def eval(self) -> _KModel: ...


class _KModelFactory(Protocol):
    def __call__(
        self,
        *,
        repo_id: str,
        config: str,
        model: str,
    ) -> _KModel: ...


class _KPipeline(Protocol):
    def load_voice(self, voice: str) -> object: ...

    def __call__(
        self,
        text: str,
        voice: str,
        speed: float,
        split_pattern: None,
    ) -> object: ...


class _KPipelineFactory(Protocol):
    def __call__(
        self,
        *,
        lang_code: str,
        repo_id: str,
        model: _KModel,
        trf: bool,
        device: str,
    ) -> _KPipeline: ...


class _Tensor(Protocol):
    def detach(self) -> _Tensor: ...

    def cpu(self) -> _Tensor: ...

    def reshape(self, shape: int) -> _Tensor: ...

    def tolist(self) -> object: ...


class _OfficialBackend:
    def __init__(
        self,
        *,
        pipelines: dict[str, _KPipeline],
        voice_paths: dict[str, Path],
    ) -> None:
        self._pipelines = pipelines
        self._voice_paths = voice_paths

    def synthesize(self, *, text: str, voice_id: str) -> tuple[KokoroChunk, ...]:
        pipeline = self._pipelines[voice_id[0]]
        voice_path = self._voice_paths[voice_id]
        generated = pipeline(text, str(voice_path), 1.0, None)
        try:
            results = iter(cast(Iterable[object], generated))
        except TypeError:
            raise KokoroInvalidOutputError("Kokoro returned a non-iterable result") from None

        chunks: list[KokoroChunk] = []
        for result in results:
            graphemes = getattr(result, "graphemes", None)
            audio = getattr(result, "audio", None)
            tokens = getattr(result, "tokens", None)
            if type(graphemes) is not str or audio is None or not isinstance(tokens, list):
                raise KokoroInvalidOutputError("Kokoro returned an invalid pipeline result")
            sample_values = cast(_Tensor, audio).detach().cpu().reshape(-1).tolist()
            if not isinstance(sample_values, list):
                raise KokoroInvalidOutputError("Kokoro returned invalid audio storage")
            samples: list[float] = []
            for sample in sample_values:
                if isinstance(sample, bool) or not isinstance(sample, (int, float)):
                    raise KokoroInvalidOutputError("Kokoro returned invalid audio values")
                samples.append(float(sample))

            words: list[KokoroWordTiming] = []
            for token in tokens:
                value = getattr(token, "text", None)
                if type(value) is not str or not any(character.isalnum() for character in value):
                    continue
                start = getattr(token, "start_ts", None)
                end = getattr(token, "end_ts", None)
                if not isinstance(start, (int, float)) or not isinstance(end, (int, float)):
                    raise KokoroInvalidOutputError("Kokoro token timings are unavailable")
                words.append(
                    KokoroWordTiming(
                        value=value.strip(),
                        start_seconds=float(start),
                        end_seconds=float(end),
                    )
                )
            chunks.append(
                KokoroChunk(
                    text=graphemes,
                    samples=tuple(samples),
                    words=tuple(words),
                )
            )
        return tuple(chunks)


def _load_official_backend(
    *,
    artifacts: KokoroLocalArtifacts,
    model_id: str,
    voice_ids: tuple[str, ...],
    device: KokoroDevice,
) -> KokoroBackend:
    """Use Kokoro 0.9.4 only through explicit local path arguments."""

    _require_offline_english_model()
    try:
        module = importlib.import_module("kokoro")
    except ModuleNotFoundError:
        raise KokoroDependencyError("optional Kokoro runtime is not installed") from None
    _disable_dependency_content_logging()
    model_factory = cast(_KModelFactory, getattr(module, "KModel", None))
    pipeline_factory = cast(_KPipelineFactory, getattr(module, "KPipeline", None))
    if not callable(model_factory) or not callable(pipeline_factory):
        raise KokoroDependencyError("optional Kokoro runtime has an incompatible API")

    model = (
        model_factory(
            repo_id=model_id,
            config=str(artifacts.config_path),
            model=str(artifacts.model_path),
        )
        .to(device)
        .eval()
    )
    pipelines: dict[str, _KPipeline] = {}
    voice_paths: dict[str, Path] = {}
    for voice_id in voice_ids:
        language = voice_id[0]
        pipeline = pipelines.get(language)
        if pipeline is None:
            pipeline = pipeline_factory(
                lang_code=language,
                repo_id=model_id,
                model=model,
                trf=False,
                device=device,
            )
            pipelines[language] = pipeline
        voice_path = artifacts.voice_path(voice_id)
        pipeline.load_voice(str(voice_path))
        voice_paths[voice_id] = voice_path
    return _OfficialBackend(pipelines=pipelines, voice_paths=voice_paths)


def _require_offline_english_model() -> None:
    """Reject a missing spaCy model before Misaki can invoke its downloader."""

    try:
        spacy_module = importlib.import_module("spacy")
    except ModuleNotFoundError:
        raise KokoroDependencyError(
            "offline Kokoro English requires spaCy and the pinned en_core_web_sm package; "
            "install the matching local speech extra before loading models"
        ) from None
    spacy_util = getattr(spacy_module, "util", None)
    is_package = getattr(spacy_util, "is_package", None)
    if not callable(is_package):
        raise KokoroDependencyError("optional spaCy runtime has an incompatible API")
    try:
        installed = is_package(KOKORO_ENGLISH_MODEL_PACKAGE)
    except Exception:
        raise KokoroDependencyError(
            "the pinned offline Kokoro English model could not be verified"
        ) from None
    if installed is not True:
        raise KokoroDependencyError(
            "offline Kokoro English requires the pinned en_core_web_sm package; "
            "install the matching local speech extra before loading models"
        )


def _disable_dependency_content_logging() -> None:
    """Prevent Kokoro/Misaki debug handlers from emitting text or phonemes."""

    try:
        loguru_module = importlib.import_module("loguru")
    except ModuleNotFoundError:
        raise KokoroDependencyError("optional Kokoro logging runtime is not installed") from None
    dependency_logger = getattr(loguru_module, "logger", None)
    disable = getattr(dependency_logger, "disable", None)
    if not callable(disable):
        raise KokoroDependencyError("optional Kokoro logging runtime has an incompatible API")
    disable("kokoro")
    disable("misaki")
