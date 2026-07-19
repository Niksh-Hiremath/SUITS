from __future__ import annotations

import asyncio
from collections.abc import Callable

import pytest

from suits_speech.clip_cache import (
    CANONICAL_FIXED_CLIP_IDS,
    CANONICAL_FIXED_CLIPS,
    OBJECTION_CLIP_ID,
    OVERRULED_CLIP_ID,
    SUSTAINED_CLIP_ID,
    FixedClipCache,
    FixedClipSpec,
    InvalidFixedClipError,
)
from suits_speech.providers.base import SynthesizedPhrase, SynthesisTiming


def _phrase(
    spec: FixedClipSpec,
    *,
    pcm_s16le: bytes | None = None,
    duration_ms: int = 100,
) -> SynthesizedPhrase:
    sample_rate_hz = 16_000
    pcm = b"\x01\x00" * (sample_rate_hz * duration_ms // 1_000)
    return SynthesizedPhrase(
        pcm_s16le=pcm if pcm_s16le is None else pcm_s16le,
        sample_rate_hz=sample_rate_hz,
        channels=1,
        duration_ms=duration_ms,
        timings=(
            SynthesisTiming(
                kind="phrase",
                value=spec.text,
                start_ms=0,
                end_ms=duration_ms,
            ),
        ),
    )


async def _valid_synthesizer(spec: FixedClipSpec) -> SynthesizedPhrase:
    await asyncio.sleep(0)
    return _phrase(spec)


def test_canonical_set_has_stable_bounded_metadata() -> None:
    assert CANONICAL_FIXED_CLIP_IDS == (
        OBJECTION_CLIP_ID,
        SUSTAINED_CLIP_ID,
        OVERRULED_CLIP_ID,
    )
    assert [
        (spec.text, spec.default_actor, spec.default_voice_role) for spec in CANONICAL_FIXED_CLIPS
    ] == [
        ("Objection!", "opposing_counsel", "opposing_counsel"),
        ("Sustained.", "judge", "judge"),
        ("Overruled.", "judge", "judge"),
    ]
    assert len(set(CANONICAL_FIXED_CLIP_IDS)) == 3


async def test_prewarm_publishes_only_immutable_validated_clips() -> None:
    cache = FixedClipCache()
    assert cache.ready_clip_ids == ()
    assert cache.lookup(OBJECTION_CLIP_ID) is None
    assert cache.lookup("courtroom.unknown.v1") is None

    await cache.prewarm(_valid_synthesizer)

    assert cache.ready is True
    assert cache.ready_clip_ids == CANONICAL_FIXED_CLIP_IDS
    clip = cache.lookup(OBJECTION_CLIP_ID)
    assert clip is not None
    assert clip.clip_id == OBJECTION_CLIP_ID
    assert clip.encoding == "pcm_s16le"
    assert clip.channels == 1
    assert clip.sample_rate_hz == 16_000
    assert clip.duration_ms == 100
    assert isinstance(clip.pcm_s16le, bytes)
    assert isinstance(clip.timings, tuple)
    assert clip.timings[0].value == "Objection!"
    assert clip.text not in repr(clip)
    assert clip.timings[0].value not in repr(clip.timings[0])
    with pytest.raises(AttributeError):
        setattr(clip, "duration_ms", 1)
    assert cache.lookup("courtroom.unknown.v1") is None


async def test_concurrent_prewarm_is_coalesced_and_idempotent() -> None:
    cache = FixedClipCache()
    entered = asyncio.Event()
    release = asyncio.Event()
    calls: list[str] = []

    async def synthesize(spec: FixedClipSpec) -> SynthesizedPhrase:
        calls.append(spec.clip_id)
        if len(calls) == 1:
            entered.set()
            await release.wait()
        return _phrase(spec)

    warmers = [asyncio.create_task(cache.prewarm(synthesize)) for _ in range(8)]
    await asyncio.wait_for(entered.wait(), timeout=1)
    await asyncio.sleep(0)
    assert calls == [OBJECTION_CLIP_ID]
    assert cache.ready_clip_ids == ()

    release.set()
    await asyncio.gather(*warmers)
    assert calls == list(CANONICAL_FIXED_CLIP_IDS)
    assert cache.ready is True

    await cache.prewarm(synthesize)
    assert calls == list(CANONICAL_FIXED_CLIP_IDS)


async def test_invalid_audio_keeps_the_entire_cache_unready_and_allows_retry() -> None:
    cache = FixedClipCache()

    async def invalid_second(spec: FixedClipSpec) -> SynthesizedPhrase:
        if spec.clip_id == SUSTAINED_CLIP_ID:
            return _phrase(spec, pcm_s16le=b"\x00", duration_ms=100)
        return _phrase(spec)

    with pytest.raises(InvalidFixedClipError, match="aligned bytes"):
        await cache.prewarm(invalid_second)

    assert cache.ready is False
    assert cache.ready_clip_ids == ()
    assert all(cache.lookup(clip_id) is None for clip_id in CANONICAL_FIXED_CLIP_IDS)

    await cache.prewarm(_valid_synthesizer)
    assert cache.ready is True


async def test_synthesis_failure_is_atomic_for_all_concurrent_waiters() -> None:
    cache = FixedClipCache()
    attempts: list[str] = []
    gate = asyncio.Event()
    release_failure = asyncio.Event()

    async def fail_after_one(spec: FixedClipSpec) -> SynthesizedPhrase:
        attempts.append(spec.clip_id)
        if spec.clip_id == OBJECTION_CLIP_ID:
            gate.set()
            await release_failure.wait()
            return _phrase(spec)
        raise RuntimeError("provider unavailable")

    first = asyncio.create_task(cache.prewarm(fail_after_one))
    await asyncio.wait_for(gate.wait(), timeout=1)
    followers = [asyncio.create_task(cache.prewarm(fail_after_one)) for _ in range(3)]
    await asyncio.sleep(0)
    release_failure.set()
    outcomes = await asyncio.gather(first, *followers, return_exceptions=True)

    assert all(isinstance(outcome, RuntimeError) for outcome in outcomes)
    assert attempts == [OBJECTION_CLIP_ID, SUSTAINED_CLIP_ID]
    assert cache.ready is False
    assert cache.ready_clip_ids == ()
    assert all(cache.lookup(clip_id) is None for clip_id in CANONICAL_FIXED_CLIP_IDS)


@pytest.mark.parametrize(
    "mutate",
    [
        lambda spec: SynthesizedPhrase(
            pcm_s16le=b"\x00\x00" * 1_600,
            sample_rate_hz=16_000,
            channels=1,
            duration_ms=99,
            timings=(),
        ),
        lambda spec: SynthesizedPhrase(
            pcm_s16le=b"\x00\x00" * 1_600,
            sample_rate_hz=16_000,
            channels=1,
            duration_ms=100,
            timings=(
                SynthesisTiming(
                    kind="word",
                    value=spec.text,
                    start_ms=0,
                    end_ms=101,
                ),
            ),
        ),
    ],
)
async def test_inconsistent_duration_or_timings_are_rejected(
    mutate: Callable[[FixedClipSpec], SynthesizedPhrase],
) -> None:
    cache = FixedClipCache()

    async def synthesize(spec: FixedClipSpec) -> SynthesizedPhrase:
        return mutate(spec)

    with pytest.raises(InvalidFixedClipError):
        await cache.prewarm(synthesize)
    assert cache.ready is False


async def test_cancelled_waiter_does_not_cancel_shared_prewarm() -> None:
    cache = FixedClipCache()
    entered = asyncio.Event()
    release = asyncio.Event()

    async def synthesize(spec: FixedClipSpec) -> SynthesizedPhrase:
        if spec.clip_id == OBJECTION_CLIP_ID:
            entered.set()
            await release.wait()
        return _phrase(spec)

    owner = asyncio.create_task(cache.prewarm(synthesize))
    await asyncio.wait_for(entered.wait(), timeout=1)
    follower: asyncio.Task[None] = asyncio.create_task(cache.prewarm(synthesize))
    follower.cancel()
    with pytest.raises(asyncio.CancelledError):
        await follower

    release.set()
    await owner
    assert cache.ready is True
