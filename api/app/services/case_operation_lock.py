"""Serialize sensitive filesystem mutations per case within this API process.

The local FastAPI development setup runs as one server process by default.
These locks prevent concurrent upload/deletion races between request threads in
that process. They are not cross-process locks and do not replace DB tombstones,
network restrictions, authentication, or per-case authorization.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from functools import wraps
from threading import Lock, RLock
from typing import Any, TypeVar, cast


F = TypeVar("F", bound=Callable[..., Any])


@dataclass(slots=True)
class _CaseLockEntry:
    lock: RLock = field(default_factory=RLock)
    users: int = 0


_registry_guard = Lock()
_registry: dict[str, _CaseLockEntry] = {}


@contextmanager
def _lock_case(case_id: str) -> Iterator[None]:
    key = str(case_id)
    with _registry_guard:
        entry = _registry.get(key)
        if entry is None:
            entry = _CaseLockEntry()
            _registry[key] = entry
        # Count holders and waiters so the registry entry cannot disappear
        # while another operation is waiting for this case's lock.
        entry.users += 1

    try:
        with entry.lock:
            yield
    finally:
        with _registry_guard:
            entry.users -= 1
            if entry.users == 0 and _registry.get(key) is entry:
                del _registry[key]


def case_operation_serialized(function: F) -> F:
    """Run a mutating case operation exclusively against the same case ID."""
    @wraps(function)
    def wrapped(*args: Any, **kwargs: Any) -> Any:
        if args:
            case_id = args[0]
        else:
            case_id = kwargs.get("case_id")
        if case_id is None:
            raise TypeError("A serialized case operation requires a case_id argument.")
        with _lock_case(str(case_id)):
            return function(*args, **kwargs)

    return cast(F, wrapped)
