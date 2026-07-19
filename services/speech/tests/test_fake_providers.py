from __future__ import annotations

import asyncio

import pytest

from suits_speech.providers import (
    AudioChunk,
    FakeSttProvider,
    FakeTtsProvider,
    ProviderCancelled,
)


async def test_fake_stt_emits_ordered_partials_and_one_final() -> None:
    provider = FakeSttProvider()
    await provider.load()
    session = await provider.create_session(sample_rate_hz=16_000)

    first = await session.push_audio(
        AudioChunk(sequence=0, pcm_s16le=b"\x00\x00" * 160, duration_ms=20)
    )
    second = await session.push_audio(
        AudioChunk(sequence=1, pcm_s16le=b"\x00\x00" * 160, duration_ms=20)
    )
    final = await session.finish()

    assert [item.text for item in (*first, *second)] == ["May", "May it please"]
    assert [item.audio_end_ms for item in (*first, *second)] == [20, 40]
    assert final.is_final is True
    assert final.text == "May it please the court."
    assert final.audio_end_ms == 40


async def test_fake_stt_rejects_stale_sequence_and_cancelled_work() -> None:
    provider = FakeSttProvider()
    await provider.load()
    session = await provider.create_session(sample_rate_hz=16_000)
    chunk = AudioChunk(sequence=1, pcm_s16le=b"\x00\x00", duration_ms=20)

    with pytest.raises(ValueError, match="expected audio sequence 0"):
        await session.push_audio(chunk)

    await session.cancel()
    with pytest.raises(ProviderCancelled):
        await session.finish()


async def test_fake_tts_is_deterministic_and_voice_specific() -> None:
    provider = FakeTtsProvider()
    await provider.load()
    first = await provider.synthesize_phrase(
        text="Objection sustained.",
        voice_id="judge",
        cancel_event=asyncio.Event(),
    )
    replay = await provider.synthesize_phrase(
        text="Objection sustained.",
        voice_id="judge",
        cancel_event=asyncio.Event(),
    )
    other_voice = await provider.synthesize_phrase(
        text="Objection sustained.",
        voice_id="counsel",
        cancel_event=asyncio.Event(),
    )

    assert first == replay
    assert first.pcm_s16le != other_voice.pcm_s16le
    assert first.sample_rate_hz == 24_000
    assert first.duration_ms > 0
    assert [mark.value for mark in first.timings] == ["Objection", "sustained."]
    assert all(mark.start_ms <= mark.end_ms for mark in first.timings)


async def test_fake_tts_honors_preflight_cancellation() -> None:
    provider = FakeTtsProvider()
    await provider.load()
    cancelled = asyncio.Event()
    cancelled.set()

    with pytest.raises(ProviderCancelled):
        await provider.synthesize_phrase(
            text="This must not play.",
            voice_id="judge",
            cancel_event=cancelled,
        )
