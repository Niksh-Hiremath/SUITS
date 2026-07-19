from __future__ import annotations

import asyncio

import pytest

from suits_speech.audio_queue import (
    AckReservation,
    InputBackpressureError,
    InputCreditWindow,
    PhraseQueue,
    TtsAckWindow,
    TtsBackpressureError,
    TtsJob,
)


def _job(
    job_id: str,
    *,
    response_id: str = "response:1",
    sequence: int = 0,
    is_final: bool = False,
) -> TtsJob:
    return TtsJob(
        job_id=job_id,
        response_id=response_id,
        actor="judge",
        sequence=sequence,
        text="The court is ready.",
        clip_id=None,
        voice_id="am_michael",
        enqueued_at_ms=100,
        is_final=is_final,
    )


def _reservation(
    job_id: str,
    *,
    frame_sequence: int,
    response_id: str = "response:1",
    frame_token: str | None = None,
    byte_length: int = 640,
) -> AckReservation:
    return AckReservation(
        job_id=job_id,
        response_id=response_id,
        frame_sequence=frame_sequence,
        frame_token=frame_token or f"frame:{job_id}:{frame_sequence}",
        byte_length=byte_length,
    )


async def test_phrase_queue_orders_jobs_and_fences_finished_leases() -> None:
    queue = PhraseQueue(max_depth=2)
    await queue.enqueue(_job("job:1"))
    await queue.enqueue(_job("job:2", sequence=1))

    first = await queue.next()
    assert first.job.job_id == "job:1"
    assert await queue.mark_streaming(first) is True
    assert await queue.finish(first) is True
    assert await queue.is_current(first) is False

    second = await queue.next()
    assert second.job.job_id == "job:2"


async def test_phrase_queue_never_leases_two_active_jobs() -> None:
    queue = PhraseQueue(max_depth=2)
    await queue.enqueue(_job("job:1"))
    await queue.enqueue(_job("job:2", sequence=1))
    first = await queue.next()

    blocked = asyncio.create_task(queue.next())
    await asyncio.sleep(0)
    assert blocked.done() is False

    assert await queue.finish(first) is True
    second = await asyncio.wait_for(blocked, timeout=0.25)
    assert second.job.job_id == "job:2"


async def test_phrase_queue_rejects_depth_duplicates_and_sequence_gaps() -> None:
    queue = PhraseQueue(max_depth=1)
    await queue.enqueue(_job("job:1"))

    with pytest.raises(TtsBackpressureError):
        await queue.enqueue(_job("job:2", sequence=1))
    with pytest.raises(ValueError, match="duplicate"):
        await queue.enqueue(_job("job:1", response_id="response:2"))

    other = PhraseQueue(max_depth=2)
    with pytest.raises(ValueError, match="expected phrase sequence 0"):
        await other.enqueue(_job("job:gap", sequence=3))


async def test_cancellation_purges_queued_jobs_and_invalidates_active_epoch() -> None:
    queue = PhraseQueue(max_depth=3)
    await queue.enqueue(_job("job:1"))
    await queue.enqueue(_job("job:2", sequence=1))
    active = await queue.next()

    cancellations = await queue.cancel(
        scope="response",
        target_id="response:1",
    )
    snapshot = await queue.snapshot()

    assert {item.job_id for item in cancellations} == {"job:1", "job:2"}
    assert active.cancel_event.is_set()
    assert await queue.is_current(active) is False
    assert snapshot.queued_job_ids == ()
    assert snapshot.active_job_id == "job:1"
    assert await queue.finish(active) is False
    assert (await queue.snapshot()).active_job_id is None


async def test_response_cancellation_rejects_delayed_phrase_continuations() -> None:
    queue = PhraseQueue(max_depth=2)
    await queue.enqueue(_job("job:1"))

    cancellations = await queue.cancel(scope="response", target_id="response:1")

    assert [item.job_id for item in cancellations] == ["job:1"]
    with pytest.raises(ValueError, match="already final"):
        await queue.enqueue(_job("job:late", sequence=1, is_final=True))


async def test_ack_window_blocks_until_browser_acknowledges_audio() -> None:
    window = TtsAckWindow(max_outstanding_bytes=640)
    cancel_event = asyncio.Event()
    first = _reservation("job:1", frame_sequence=0)
    second = _reservation("job:1", frame_sequence=1)
    await window.reserve(first, cancel_event=cancel_event)

    blocked = asyncio.create_task(window.reserve(second, cancel_event=cancel_event))
    await asyncio.sleep(0)
    assert blocked.done() is False
    assert await window.mark_sent(frame_token=first.frame_token) is True
    assert await window.acknowledge(
        job_id="job:1",
        response_id="response:1",
        frame_sequence=0,
        frame_token="frame:job:1:0",
        byte_length=640,
    )
    await asyncio.wait_for(blocked, timeout=0.25)
    assert await window.outstanding_bytes() == 640


async def test_ack_window_cancellation_releases_bytes_and_wakes_waiter() -> None:
    window = TtsAckWindow(max_outstanding_bytes=640)
    first_cancel = asyncio.Event()
    second_cancel = asyncio.Event()
    await window.reserve(
        _reservation("job:1", frame_sequence=0),
        cancel_event=first_cancel,
    )
    blocked = asyncio.create_task(
        window.reserve(
            _reservation("job:2", frame_sequence=0),
            cancel_event=second_cancel,
        )
    )
    await asyncio.sleep(0)

    assert await window.cancel_job("job:1") == 640
    await asyncio.wait_for(blocked, timeout=0.25)
    assert await window.outstanding_bytes() == 640
    assert (
        await window.acknowledge(
            job_id="job:missing",
            response_id="response:1",
            frame_sequence=0,
            frame_token="frame:missing",
            byte_length=640,
        )
        is False
    )


async def test_ack_window_wakes_a_cancelled_waiter_without_releasing_other_job() -> None:
    window = TtsAckWindow(max_outstanding_bytes=640)
    await window.reserve(
        _reservation("job:1", frame_sequence=0),
        cancel_event=asyncio.Event(),
    )
    second_cancel = asyncio.Event()
    blocked = asyncio.create_task(
        window.reserve(
            _reservation("job:2", frame_sequence=0),
            cancel_event=second_cancel,
        )
    )
    await asyncio.sleep(0)

    second_cancel.set()
    assert await window.cancel_job("job:2") == 0
    with pytest.raises(asyncio.CancelledError):
        await asyncio.wait_for(blocked, timeout=0.25)
    assert await window.outstanding_bytes() == 640


async def test_ack_window_observes_cancel_event_without_external_notification() -> None:
    window = TtsAckWindow(max_outstanding_bytes=640)
    await window.reserve(
        _reservation("job:1", frame_sequence=0),
        cancel_event=asyncio.Event(),
    )
    cancel_event = asyncio.Event()
    blocked = asyncio.create_task(
        window.reserve(
            _reservation("job:2", frame_sequence=0),
            cancel_event=cancel_event,
        )
    )
    await asyncio.sleep(0)

    cancel_event.set()
    with pytest.raises(asyncio.CancelledError):
        await asyncio.wait_for(blocked, timeout=0.15)


async def test_ack_window_rejects_duplicate_waiting_frame_keys() -> None:
    window = TtsAckWindow(max_outstanding_bytes=640)
    await window.reserve(
        _reservation("job:1", frame_sequence=0),
        cancel_event=asyncio.Event(),
    )
    waiting_cancel = asyncio.Event()
    blocked = asyncio.create_task(
        window.reserve(
            _reservation("job:2", frame_sequence=0),
            cancel_event=waiting_cancel,
        )
    )
    await asyncio.sleep(0)

    with pytest.raises(ValueError, match="duplicate"):
        await window.reserve(
            _reservation("job:2", frame_sequence=0),
            cancel_event=asyncio.Event(),
        )
    waiting_cancel.set()
    with pytest.raises(asyncio.CancelledError):
        await asyncio.wait_for(blocked, timeout=0.15)
    assert await window.outstanding_bytes() == 640


async def test_ack_identity_includes_response_and_server_frame_token() -> None:
    window = TtsAckWindow(max_outstanding_bytes=640)
    reservation = _reservation("job:1", frame_sequence=0)
    await window.reserve(reservation, cancel_event=asyncio.Event())
    assert await window.mark_sent(frame_token=reservation.frame_token) is True

    assert (
        await window.acknowledge(
            job_id="job:1",
            response_id="response:wrong",
            frame_sequence=0,
            frame_token=reservation.frame_token,
            byte_length=640,
        )
        is False
    )
    assert await window.outstanding_bytes() == 640
    assert await window.acknowledge(
        job_id="job:1",
        response_id="response:1",
        frame_sequence=0,
        frame_token=reservation.frame_token,
        byte_length=640,
    )


async def test_ack_window_waits_until_every_job_frame_is_drained() -> None:
    window = TtsAckWindow(max_outstanding_bytes=1_280)
    first = _reservation("job:1", frame_sequence=0)
    second = _reservation("job:1", frame_sequence=1)
    await window.reserve(first, cancel_event=asyncio.Event())
    await window.reserve(second, cancel_event=asyncio.Event())
    assert await window.mark_sent(frame_token=first.frame_token) is True
    assert await window.mark_sent(frame_token=second.frame_token) is True
    drained = asyncio.create_task(
        window.wait_for_job_drained(job_id="job:1", cancel_event=asyncio.Event())
    )
    await asyncio.sleep(0)
    assert drained.done() is False

    for reservation in (first, second):
        assert await window.acknowledge(
            job_id=reservation.job_id,
            response_id=reservation.response_id,
            frame_sequence=reservation.frame_sequence,
            frame_token=reservation.frame_token,
            byte_length=reservation.byte_length,
        )
    await asyncio.wait_for(drained, timeout=0.25)


async def test_ack_before_binary_send_never_releases_reserved_bytes() -> None:
    window = TtsAckWindow(max_outstanding_bytes=640)
    reservation = _reservation("job:reserved", frame_sequence=0)
    await window.reserve(reservation, cancel_event=asyncio.Event())

    assert (
        await window.acknowledge(
            job_id=reservation.job_id,
            response_id=reservation.response_id,
            frame_sequence=reservation.frame_sequence,
            frame_token=reservation.frame_token,
            byte_length=reservation.byte_length,
        )
        is False
    )
    assert await window.outstanding_bytes() == 640

    assert await window.mark_sent(frame_token=reservation.frame_token) is True
    assert await window.acknowledge(
        job_id=reservation.job_id,
        response_id=reservation.response_id,
        frame_sequence=reservation.frame_sequence,
        frame_token=reservation.frame_token,
        byte_length=reservation.byte_length,
    )
    assert await window.outstanding_bytes() == 0
    assert await window.mark_sent(frame_token=reservation.frame_token) is False


@pytest.mark.parametrize("byte_length", [0, -10])
async def test_credit_accounting_rejects_non_positive_lengths(byte_length: int) -> None:
    with pytest.raises(ValueError):
        _reservation("job:1", frame_sequence=0, byte_length=byte_length)

    credits = InputCreditWindow(max_frames=1, max_bytes=640)
    with pytest.raises(ValueError):
        await credits.reserve(
            utterance_id="utterance:1",
            sequence=0,
            byte_length=byte_length,
        )


async def test_final_response_retires_sequence_state_and_scrubs_repr() -> None:
    queue = PhraseQueue(max_depth=1)
    job = _job("job:final", is_final=True)
    assert "The court is ready" not in repr(job)
    await queue.enqueue(job)
    lease = await queue.next()
    assert await queue.finish(lease) is True

    with pytest.raises(ValueError, match="already final"):
        await queue.enqueue(_job("job:late"))


async def test_input_credit_window_is_bounded_and_replenished() -> None:
    credits = InputCreditWindow(max_frames=1, max_bytes=640)
    await credits.reserve(utterance_id="utterance:1", sequence=0, byte_length=640)
    exhausted = await credits.snapshot()

    assert exhausted.available_frames == 0
    assert exhausted.available_bytes == 0
    with pytest.raises(InputBackpressureError):
        await credits.reserve(
            utterance_id="utterance:1",
            sequence=1,
            byte_length=640,
        )

    assert await credits.release(utterance_id="utterance:1", sequence=0) is True
    replenished = await credits.snapshot()
    assert replenished.available_frames == 1
    assert replenished.available_bytes == 640
