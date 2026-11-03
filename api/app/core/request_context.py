"""Per-request identity context used to scope local database operations."""

from contextvars import ContextVar

current_owner_id: ContextVar[str | None] = ContextVar("lawsense_current_owner_id", default=None)
