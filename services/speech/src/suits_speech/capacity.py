"""Process-local fail-closed capacity leases for speech resources."""

from __future__ import annotations

from dataclasses import dataclass
from threading import Lock


@dataclass(frozen=True, slots=True)
class CapacitySnapshot:
    """Immutable diagnostic view of one bounded process resource."""

    limit: int
    active: int

    @property
    def available(self) -> int:
        return self.limit - self.active


class CapacityLease:
    """An idempotently releasable claim on one bounded resource slot."""

    __slots__ = ("_pool", "_token")

    def __init__(self, *, pool: BoundedLeasePool, token: object) -> None:
        self._pool = pool
        self._token = token

    @property
    def released(self) -> bool:
        return not self._pool._contains(self._token)

    def release(self) -> bool:
        """Release once, returning whether this call owned the release."""

        return self._pool._release(self._token)


class BoundedLeasePool:
    """A thread-safe bounded counter with non-blocking acquisition."""

    def __init__(self, *, limit: int) -> None:
        if limit < 1:
            raise ValueError("capacity limit must be positive")
        self._limit = limit
        self._active_tokens: set[object] = set()
        self._lock = Lock()

    @property
    def snapshot(self) -> CapacitySnapshot:
        with self._lock:
            return CapacitySnapshot(limit=self._limit, active=len(self._active_tokens))

    def try_acquire(self) -> CapacityLease | None:
        """Claim a slot immediately or fail closed without waiting."""

        with self._lock:
            if len(self._active_tokens) >= self._limit:
                return None
            token = object()
            self._active_tokens.add(token)
        return CapacityLease(pool=self, token=token)

    def _contains(self, token: object) -> bool:
        with self._lock:
            return token in self._active_tokens

    def _release(self, token: object) -> bool:
        with self._lock:
            if token not in self._active_tokens:
                return False
            self._active_tokens.remove(token)
            return True
