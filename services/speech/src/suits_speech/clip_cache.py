"""Atomic in-memory cache for canonical courtroom reaction clips.

The cache owns no provider and performs no persistence. Callers supply an async
synthesizer that resolves each clip's voice role to a provider-specific voice.
Clip text and PCM bytes are intentionally excluded from object representations.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Final, Literal, Mapping, Protocol

from .providers.base import SynthesizedPhrase

FixedClipId = Literal[
    "courtroom.objection.v1",
    "courtroom.sustained.v1",
    "courtroom.overruled.v1",
]
FixedClipActor = Literal["judge", "opposing_counsel"]
FixedClipVoiceRole = Literal["judge", "opposing_counsel"]
TimingKind = Literal["phrase", "word", "viseme"]

OBJECTION_CLIP_ID: Final[FixedClipId] = "courtroom.objection.v1"
SUSTAINED_CLIP_ID: Final[FixedClipId] = "courtroom.sustained.v1"
OVERRULED_CLIP_ID: Final[FixedClipId] = "courtroom.overruled.v1"

_MAX_CLIP_DURATION_MS = 5_000
_MAX_CLIP_SAMPLE_RATE_HZ = 96_000
_MIN_CLIP_SAMPLE_RATE_HZ = 8_000
_MAX_CLIP_BYTES = _MAX_CLIP_SAMPLE_RATE_HZ * 2 * _MAX_CLIP_DURATION_MS // 1_000
_MAX_TIMING_MARKS = 128
_MAX_TIMING_VALUE_LENGTH = 256


class InvalidFixedClipError(ValueError):
    """Raised when provider output is unsafe or internally inconsistent."""


@dataclass(frozen=True, slots=True)
class FixedClipSpec:
    """Provider-neutral metadata for one canonical reaction."""

    clip_id: FixedClipId
    text: str = field(repr=False)
    default_actor: FixedClipActor
    default_voice_role: FixedClipVoiceRole


@dataclass(frozen=True, slots=True)
class FixedClipTiming:
    """Immutable timing mark with spoken values omitted from repr output."""

    kind: TimingKind
    value: str = field(repr=False)
    start_ms: int
    end_ms: int


@dataclass(frozen=True, slots=True)
class FixedClip:
    """Validated immutable mono PCM associated with a canonical clip."""

    clip_id: FixedClipId
    text: str = field(repr=False)
    default_actor: FixedClipActor
    default_voice_role: FixedClipVoiceRole
    pcm_s16le: bytes = field(repr=False)
    sample_rate_hz: int
    channels: Literal[1]
    duration_ms: int
    timings: tuple[FixedClipTiming, ...]
    encoding: Literal["pcm_s16le"] = "pcm_s16le"


class FixedClipSynthesizer(Protocol):
    """Callable used to synthesize one canonical, provider-neutral spec."""

    async def __call__(self, spec: FixedClipSpec, /) -> SynthesizedPhrase:
        """Return in-memory mono PCM without persisting or downloading artifacts."""


CANONICAL_FIXED_CLIPS: Final[tuple[FixedClipSpec, ...]] = (
    FixedClipSpec(
        clip_id=OBJECTION_CLIP_ID,
        text="Objection!",
        default_actor="opposing_counsel",
        default_voice_role="opposing_counsel",
    ),
    FixedClipSpec(
        clip_id=SUSTAINED_CLIP_ID,
        text="Sustained.",
        default_actor="judge",
        default_voice_role="judge",
    ),
    FixedClipSpec(
        clip_id=OVERRULED_CLIP_ID,
        text="Overruled.",
        default_actor="judge",
        default_voice_role="judge",
    ),
)
CANONICAL_FIXED_CLIP_IDS: Final[tuple[FixedClipId, ...]] = tuple(
    spec.clip_id for spec in CANONICAL_FIXED_CLIPS
)


class FixedClipCache:
    """Bounded all-or-nothing cache for the canonical reaction clip set."""

    def __init__(self) -> None:
        self._clips: Mapping[str, FixedClip] = MappingProxyType({})
        self._state_lock = asyncio.Lock()
        self._prewarm_task: asyncio.Task[None] | None = None

    @property
    def ready(self) -> bool:
        """Return whether the complete canonical set is available."""

        return len(self._clips) == len(CANONICAL_FIXED_CLIPS)

    @property
    def ready_clip_ids(self) -> tuple[FixedClipId, ...]:
        """Expose either the complete canonical ID set or no readiness."""

        if not self.ready:
            return ()
        return CANONICAL_FIXED_CLIP_IDS

    def lookup(self, clip_id: str) -> FixedClip | None:
        """Return an immutable clip, or ``None`` for unknown/unready IDs."""

        return self._clips.get(clip_id)

    async def prewarm(self, synthesize: FixedClipSynthesizer) -> None:
        """Build the complete set once, coalescing concurrent callers.

        The first caller's synthesizer owns a coalesced attempt. Results remain
        private until all canonical clips validate, so a failed attempt never
        exposes partial readiness. A later call may retry after failure.
        """

        async with self._state_lock:
            if self.ready:
                return
            task = self._prewarm_task
            if task is None:
                task = asyncio.create_task(
                    self._build_and_publish(synthesize),
                    name="fixed-clip-prewarm",
                )
                self._prewarm_task = task
        await asyncio.shield(task)

    async def _build_and_publish(self, synthesize: FixedClipSynthesizer) -> None:
        current_task = asyncio.current_task()
        try:
            pending: dict[str, FixedClip] = {}
            for spec in CANONICAL_FIXED_CLIPS:
                phrase = await synthesize(spec)
                pending[spec.clip_id] = _validated_clip(spec, phrase)
            if tuple(pending) != CANONICAL_FIXED_CLIP_IDS:
                raise RuntimeError("canonical fixed clip construction was incomplete")
            immutable: Mapping[str, FixedClip] = MappingProxyType(pending.copy())
            async with self._state_lock:
                self._clips = immutable
        finally:
            async with self._state_lock:
                if self._prewarm_task is current_task:
                    self._prewarm_task = None


def _validated_clip(spec: FixedClipSpec, phrase: SynthesizedPhrase) -> FixedClip:
    pcm = phrase.pcm_s16le
    sample_rate_hz = phrase.sample_rate_hz
    channels = phrase.channels
    duration_ms = phrase.duration_ms
    if type(pcm) is not bytes or not pcm or len(pcm) % 2 != 0:
        raise InvalidFixedClipError("fixed clip PCM must be non-empty aligned bytes")
    if len(pcm) > _MAX_CLIP_BYTES:
        raise InvalidFixedClipError("fixed clip PCM exceeds the bounded reaction size")
    if (
        type(sample_rate_hz) is not int
        or sample_rate_hz < _MIN_CLIP_SAMPLE_RATE_HZ
        or sample_rate_hz > _MAX_CLIP_SAMPLE_RATE_HZ
    ):
        raise InvalidFixedClipError("fixed clip sample rate is invalid")
    if type(channels) is not int or channels != 1:
        raise InvalidFixedClipError("fixed clips must contain mono PCM")
    if type(duration_ms) is not int or not 0 < duration_ms <= _MAX_CLIP_DURATION_MS:
        raise InvalidFixedClipError("fixed clip duration is invalid")

    sample_count = len(pcm) // 2
    derived_duration_ms = (sample_count * 1_000 + sample_rate_hz // 2) // sample_rate_hz
    if derived_duration_ms != duration_ms:
        raise InvalidFixedClipError("fixed clip duration does not match its PCM")

    source_timings = phrase.timings
    if not isinstance(source_timings, tuple) or len(source_timings) > _MAX_TIMING_MARKS:
        raise InvalidFixedClipError("fixed clip timing metadata is invalid")
    timings: list[FixedClipTiming] = []
    prior_start_ms = -1
    for mark in source_timings:
        if mark.kind not in {"phrase", "word", "viseme"}:
            raise InvalidFixedClipError("fixed clip timing kind is invalid")
        if not mark.value or len(mark.value) > _MAX_TIMING_VALUE_LENGTH:
            raise InvalidFixedClipError("fixed clip timing value is invalid")
        if (
            type(mark.start_ms) is not int
            or type(mark.end_ms) is not int
            or mark.start_ms < prior_start_ms
            or mark.start_ms < 0
            or mark.end_ms < mark.start_ms
            or mark.end_ms > duration_ms
        ):
            raise InvalidFixedClipError("fixed clip timing range is invalid")
        timings.append(
            FixedClipTiming(
                kind=mark.kind,
                value=mark.value,
                start_ms=mark.start_ms,
                end_ms=mark.end_ms,
            )
        )
        prior_start_ms = mark.start_ms

    return FixedClip(
        clip_id=spec.clip_id,
        text=spec.text,
        default_actor=spec.default_actor,
        default_voice_role=spec.default_voice_role,
        pcm_s16le=bytes(pcm),
        sample_rate_hz=sample_rate_hz,
        channels=1,
        duration_ms=duration_ms,
        timings=tuple(timings),
    )
