"""Bounded speech queues, explicit credits, and cancellation epoch fencing."""

from __future__ import annotations

import asyncio
import time
from collections import deque
from dataclasses import dataclass, field, replace
from typing import Literal, cast


class TtsBackpressureError(RuntimeError):
    """Raised when the bounded phrase queue has no remaining capacity."""


class InputBackpressureError(RuntimeError):
    """Raised when a client exceeds its advertised microphone credits."""


@dataclass(frozen=True, slots=True)
class TtsJob:
    job_id: str
    response_id: str
    actor: str
    sequence: int
    text: str | None = field(repr=False)
    clip_id: str | None
    voice_id: str
    enqueued_at_ms: int
    is_final: bool


@dataclass(frozen=True, slots=True)
class TtsLease:
    job: TtsJob
    epoch: int
    cancel_event: asyncio.Event


@dataclass(frozen=True, slots=True)
class QueueCancellation:
    job_id: str
    response_id: str
    prior_status: Literal["queued", "generating", "streaming"]


@dataclass(frozen=True, slots=True)
class QueueSnapshot:
    queued_job_ids: tuple[str, ...]
    active_job_id: str | None
    terminal_job_count: int


@dataclass(slots=True)
class _QueueEntry:
    job: TtsJob
    epoch: int
    cancel_event: asyncio.Event
    status: Literal[
        "queued",
        "generating",
        "streaming",
        "finished",
        "cancelled",
        "failed",
    ]


class PhraseQueue:
    """One synthesis lane with bounded queued work and epoch-safe cancellation."""

    def __init__(self, *, max_depth: int, tombstone_limit: int = 2_048) -> None:
        if max_depth <= 0:
            raise ValueError("max_depth must be positive")
        if tombstone_limit < max_depth:
            raise ValueError("tombstone_limit must cover the queue depth")
        self._max_depth = max_depth
        self._tombstone_limit = tombstone_limit
        self._condition = asyncio.Condition()
        self._pending: deque[str] = deque()
        self._entries: dict[str, _QueueEntry] = {}
        self._terminal_order: deque[str] = deque()
        self._active_job_id: str | None = None
        self._next_sequence_by_response: dict[str, int] = {}
        self._response_live_jobs: dict[str, int] = {}
        self._idle_response_order: deque[str] = deque()
        self._closed_responses: set[str] = set()
        self._closed_response_order: deque[str] = deque()
        self._closed = False

    async def enqueue(self, job: TtsJob) -> None:
        async with self._condition:
            if self._closed:
                raise RuntimeError("phrase queue is closed")
            if job.job_id in self._entries:
                raise ValueError(f"duplicate TTS jobId: {job.job_id}")
            if job.response_id in self._closed_responses:
                raise ValueError(f"TTS response is already final: {job.response_id}")
            expected_sequence = self._next_sequence_by_response.get(job.response_id, 0)
            if job.sequence != expected_sequence:
                raise ValueError(
                    f"expected phrase sequence {expected_sequence} for {job.response_id}, "
                    f"got {job.sequence}"
                )
            if len(self._pending) >= self._max_depth:
                raise TtsBackpressureError("TTS phrase queue is full")
            try:
                self._idle_response_order.remove(job.response_id)
            except ValueError:
                pass
            self._next_sequence_by_response[job.response_id] = expected_sequence + 1
            self._response_live_jobs[job.response_id] = (
                self._response_live_jobs.get(job.response_id, 0) + 1
            )
            if job.is_final:
                self._closed_responses.add(job.response_id)
            self._entries[job.job_id] = _QueueEntry(
                job=job,
                epoch=0,
                cancel_event=asyncio.Event(),
                status="queued",
            )
            self._pending.append(job.job_id)
            self._condition.notify_all()

    async def next(self) -> TtsLease:
        async with self._condition:
            while True:
                if self._active_job_id is not None:
                    await self._condition.wait()
                    continue
                while self._pending:
                    job_id = self._pending.popleft()
                    entry = self._entries[job_id]
                    if entry.status != "queued":
                        continue
                    entry.status = "generating"
                    self._active_job_id = job_id
                    return TtsLease(
                        job=entry.job,
                        epoch=entry.epoch,
                        cancel_event=entry.cancel_event,
                    )
                if self._closed:
                    raise RuntimeError("phrase queue is closed")
                await self._condition.wait()

    async def mark_streaming(self, lease: TtsLease) -> bool:
        async with self._condition:
            entry = self._current_entry(lease)
            if entry is None or entry.status != "generating":
                return False
            entry.status = "streaming"
            return True

    async def finish(
        self,
        lease: TtsLease,
        *,
        failed: bool = False,
    ) -> bool:
        async with self._condition:
            entry = self._current_entry(lease)
            if entry is None:
                cancelled_entry = self._entries.get(lease.job.job_id)
                if (
                    cancelled_entry is not None
                    and cancelled_entry.status == "cancelled"
                    and cancelled_entry.cancel_event is lease.cancel_event
                    and self._active_job_id == lease.job.job_id
                ):
                    self._active_job_id = None
                    self._condition.notify_all()
                return False
            if entry.status not in {"generating", "streaming"}:
                return False
            entry.status = "failed" if failed else "finished"
            if self._active_job_id == lease.job.job_id:
                self._active_job_id = None
            self._record_terminal(lease.job.job_id)
            self._condition.notify_all()
            return True

    async def cancel(
        self,
        *,
        scope: Literal["job", "response", "all"],
        target_id: str | None,
    ) -> tuple[QueueCancellation, ...]:
        async with self._condition:
            if scope != "all" and target_id is None:
                raise ValueError("target_id is required for job and response cancellation")
            responses_to_close: set[str] = set()
            if scope == "response":
                assert target_id is not None
                responses_to_close.add(target_id)
            elif scope == "all":
                responses_to_close.update(
                    entry.job.response_id
                    for entry in self._entries.values()
                    if entry.status in {"queued", "generating", "streaming"}
                )
            self._closed_responses.update(responses_to_close)
            if responses_to_close:
                self._idle_response_order = deque(
                    response_id
                    for response_id in self._idle_response_order
                    if response_id not in responses_to_close
                )
            cancellations: list[QueueCancellation] = []
            for job_id, entry in list(self._entries.items()):
                matches = (
                    scope == "all"
                    or (scope == "job" and job_id == target_id)
                    or (scope == "response" and entry.job.response_id == target_id)
                )
                if not matches or entry.status not in {
                    "queued",
                    "generating",
                    "streaming",
                }:
                    continue
                prior_status = cast(Literal["queued", "generating", "streaming"], entry.status)
                entry.epoch += 1
                entry.status = "cancelled"
                entry.cancel_event.set()
                cancellations.append(
                    QueueCancellation(
                        job_id=job_id,
                        response_id=entry.job.response_id,
                        prior_status=prior_status,
                    )
                )
                self._record_terminal(job_id)
            cancelled_ids = {item.job_id for item in cancellations}
            if cancelled_ids:
                self._pending = deque(
                    job_id for job_id in self._pending if job_id not in cancelled_ids
                )
                self._condition.notify_all()
            for response_id in responses_to_close:
                if response_id not in self._response_live_jobs:
                    self._next_sequence_by_response.pop(response_id, None)
                    self._record_closed_response(response_id)
            return tuple(cancellations)

    async def is_current(self, lease: TtsLease) -> bool:
        async with self._condition:
            return self._current_entry(lease) is not None

    async def snapshot(self) -> QueueSnapshot:
        async with self._condition:
            return QueueSnapshot(
                queued_job_ids=tuple(self._pending),
                active_job_id=self._active_job_id,
                terminal_job_count=len(self._terminal_order),
            )

    async def close(self) -> tuple[QueueCancellation, ...]:
        async with self._condition:
            self._closed = True
            self._condition.notify_all()
        return await self.cancel(scope="all", target_id=None)

    def _current_entry(self, lease: TtsLease) -> _QueueEntry | None:
        entry = self._entries.get(lease.job.job_id)
        if (
            entry is None
            or entry.epoch != lease.epoch
            or entry.cancel_event.is_set()
            or entry.status in {"finished", "cancelled", "failed"}
        ):
            return None
        return entry

    def _record_terminal(self, job_id: str) -> None:
        if job_id in self._terminal_order:
            return
        entry = self._entries[job_id]
        entry.job = replace(entry.job, text=None)
        response_id = entry.job.response_id
        remaining_jobs = self._response_live_jobs[response_id] - 1
        if remaining_jobs == 0:
            del self._response_live_jobs[response_id]
            if response_id in self._closed_responses:
                self._next_sequence_by_response.pop(response_id, None)
                self._record_closed_response(response_id)
            else:
                self._record_idle_response(response_id)
        else:
            self._response_live_jobs[response_id] = remaining_jobs
        self._terminal_order.append(job_id)
        while len(self._terminal_order) > self._tombstone_limit:
            expired_id = self._terminal_order.popleft()
            expired_entry = self._entries.get(expired_id)
            if expired_entry is not None and expired_entry.status in {
                "finished",
                "cancelled",
                "failed",
            }:
                del self._entries[expired_id]

    def _record_closed_response(self, response_id: str) -> None:
        if response_id not in self._closed_response_order:
            self._closed_response_order.append(response_id)
        while len(self._closed_response_order) > self._tombstone_limit:
            expired_response_id = self._closed_response_order.popleft()
            self._closed_responses.discard(expired_response_id)

    def _record_idle_response(self, response_id: str) -> None:
        if response_id not in self._idle_response_order:
            self._idle_response_order.append(response_id)
        while len(self._idle_response_order) > self._tombstone_limit:
            expired_response_id = self._idle_response_order.popleft()
            self._next_sequence_by_response.pop(expired_response_id, None)
            self._closed_responses.add(expired_response_id)
            self._record_closed_response(expired_response_id)


@dataclass(frozen=True, slots=True)
class AckReservation:
    job_id: str
    response_id: str
    frame_sequence: int
    frame_token: str
    byte_length: int

    def __post_init__(self) -> None:
        if self.frame_sequence < 0:
            raise ValueError("frame_sequence must be non-negative")
        if self.byte_length <= 0:
            raise ValueError("byte_length must be positive")
        if not self.job_id or not self.response_id or not self.frame_token:
            raise ValueError("ACK reservation identities must be non-empty")


class TtsAckWindow:
    """Bounds binary TTS bytes until the browser confirms consumption."""

    def __init__(self, *, max_outstanding_bytes: int) -> None:
        if max_outstanding_bytes <= 0:
            raise ValueError("max_outstanding_bytes must be positive")
        self._maximum = max_outstanding_bytes
        self._condition = asyncio.Condition()
        self._reservations: dict[str, AckReservation] = {}
        self._sent_tokens: set[str] = set()
        self._pending_keys: set[str] = set()
        self._outstanding_bytes = 0

    @property
    def maximum_bytes(self) -> int:
        return self._maximum

    async def reserve(
        self,
        reservation: AckReservation,
        *,
        cancel_event: asyncio.Event,
        timeout_seconds: float = 5,
    ) -> None:
        if timeout_seconds <= 0:
            raise ValueError("timeout_seconds must be positive")
        if reservation.byte_length > self._maximum:
            raise TtsBackpressureError("one TTS frame exceeds the ACK window")
        key = reservation.frame_token
        deadline = time.monotonic() + timeout_seconds
        async with self._condition:
            if key in self._reservations or key in self._pending_keys:
                raise ValueError("duplicate TTS frame reservation")
            self._pending_keys.add(key)
            try:
                while self._outstanding_bytes + reservation.byte_length > self._maximum:
                    if cancel_event.is_set():
                        raise asyncio.CancelledError
                    if time.monotonic() >= deadline:
                        raise TtsBackpressureError("timed out waiting for browser TTS ACKs")
                    try:
                        await asyncio.wait_for(
                            self._condition.wait(),
                            timeout=min(0.05, max(0.001, deadline - time.monotonic())),
                        )
                    except TimeoutError:
                        continue
                if cancel_event.is_set():
                    raise asyncio.CancelledError
                self._reservations[key] = reservation
                self._outstanding_bytes += reservation.byte_length
            finally:
                self._pending_keys.discard(key)

    async def mark_sent(self, *, frame_token: str) -> bool:
        """Make a reservation ACKable only after its binary frame was sent."""

        async with self._condition:
            if frame_token not in self._reservations:
                return False
            self._sent_tokens.add(frame_token)
            return True

    async def acknowledge(
        self,
        *,
        job_id: str,
        response_id: str,
        frame_sequence: int,
        frame_token: str,
        byte_length: int,
    ) -> bool:
        if byte_length <= 0 or frame_sequence < 0:
            raise ValueError("invalid TTS acknowledgement accounting")
        key = frame_token
        async with self._condition:
            reservation = self._reservations.get(key)
            if reservation is None or key not in self._sent_tokens:
                return False
            if (
                reservation.job_id != job_id
                or reservation.response_id != response_id
                or reservation.frame_sequence != frame_sequence
                or reservation.byte_length != byte_length
            ):
                return False
            del self._reservations[key]
            self._sent_tokens.discard(key)
            self._outstanding_bytes -= reservation.byte_length
            self._condition.notify_all()
            return True

    async def cancel_job(self, job_id: str) -> int:
        async with self._condition:
            removed = [
                key
                for key, reservation in self._reservations.items()
                if reservation.job_id == job_id
            ]
            released = 0
            for key in removed:
                released += self._reservations.pop(key).byte_length
                self._sent_tokens.discard(key)
            self._outstanding_bytes -= released
            self._condition.notify_all()
            return released

    async def wait_for_job_drained(
        self,
        *,
        job_id: str,
        cancel_event: asyncio.Event,
        timeout_seconds: float = 15,
    ) -> None:
        if timeout_seconds <= 0:
            raise ValueError("timeout_seconds must be positive")
        deadline = time.monotonic() + timeout_seconds
        async with self._condition:
            while any(reservation.job_id == job_id for reservation in self._reservations.values()):
                if cancel_event.is_set():
                    raise asyncio.CancelledError
                if time.monotonic() >= deadline:
                    raise TtsBackpressureError("timed out waiting for final browser TTS ACK")
                try:
                    await asyncio.wait_for(
                        self._condition.wait(),
                        timeout=min(0.05, max(0.001, deadline - time.monotonic())),
                    )
                except TimeoutError:
                    continue

    async def outstanding_bytes(self) -> int:
        async with self._condition:
            return self._outstanding_bytes

    async def clear(self) -> int:
        async with self._condition:
            released = self._outstanding_bytes
            self._reservations.clear()
            self._sent_tokens.clear()
            self._outstanding_bytes = 0
            self._condition.notify_all()
            return released


@dataclass(frozen=True, slots=True)
class InputCreditSnapshot:
    available_frames: int
    available_bytes: int


class InputCreditWindow:
    """Advertised bounded ownership of microphone frames awaiting processing."""

    def __init__(self, *, max_frames: int, max_bytes: int) -> None:
        if max_frames <= 0 or max_bytes <= 0:
            raise ValueError("input credit limits must be positive")
        self._max_frames = max_frames
        self._max_bytes = max_bytes
        self._lock = asyncio.Lock()
        self._reserved: dict[tuple[str, int], int] = {}
        self._reserved_bytes = 0

    async def reserve(self, *, utterance_id: str, sequence: int, byte_length: int) -> None:
        if sequence < 0 or byte_length <= 0:
            raise ValueError("invalid microphone credit accounting")
        key = (utterance_id, sequence)
        async with self._lock:
            if key in self._reserved:
                raise ValueError("duplicate microphone frame reservation")
            if (
                len(self._reserved) >= self._max_frames
                or self._reserved_bytes + byte_length > self._max_bytes
            ):
                raise InputBackpressureError("microphone input credits exhausted")
            self._reserved[key] = byte_length
            self._reserved_bytes += byte_length

    async def release(self, *, utterance_id: str, sequence: int) -> bool:
        key = (utterance_id, sequence)
        async with self._lock:
            byte_length = self._reserved.pop(key, None)
            if byte_length is None:
                return False
            self._reserved_bytes -= byte_length
            return True

    async def snapshot(self) -> InputCreditSnapshot:
        async with self._lock:
            return InputCreditSnapshot(
                available_frames=self._max_frames - len(self._reserved),
                available_bytes=self._max_bytes - self._reserved_bytes,
            )

    async def release_utterance(self, utterance_id: str) -> int:
        async with self._lock:
            keys = [key for key in self._reserved if key[0] == utterance_id]
            released = 0
            for key in keys:
                released += self._reserved.pop(key)
            self._reserved_bytes -= released
            return released

    async def clear(self) -> int:
        async with self._lock:
            released = self._reserved_bytes
            self._reserved.clear()
            self._reserved_bytes = 0
            return released
