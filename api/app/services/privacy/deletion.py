"""Local deletion helpers; unlinking is not a secure-erasure guarantee."""

from __future__ import annotations

import shutil
from datetime import datetime, timezone
from pathlib import Path

from .models import RetentionPolicy


def delete_local_file(path: str | Path) -> bool:
    """Unlink one local file or symlink; return whether a directory entry existed."""
    target = Path(path)
    try:
        target.unlink()
        return True
    except FileNotFoundError:
        return False


def delete_local_directory(path: str | Path, *, within: str | Path) -> bool:
    """Remove a directory tree only when it is a strict child of ``within``.

    Symlink targets are rejected so the resolved safety check cannot authorize
    deleting content elsewhere. The allowed root itself is never removed.
    """
    root = Path(within).resolve(strict=True)
    target = Path(path)
    if target.is_symlink():
        raise ValueError("Refusing to recursively delete a symlink.")
    resolved = target.resolve(strict=False)
    if resolved == root or not resolved.is_relative_to(root):
        raise ValueError("Deletion target must be a strict child of the allowed root.")
    if not target.exists():
        return False
    if not target.is_dir():
        raise ValueError("Deletion target must be a directory.")
    shutil.rmtree(target)
    return True


def delete_expired_local_file(
    path: str | Path,
    policy: RetentionPolicy,
    *,
    created_at: datetime,
    now: datetime | None = None,
) -> bool:
    """Delete a local file only when its supplied retention policy has expired."""
    current = now or datetime.now(timezone.utc)
    if not policy.is_expired(created_at, now=current):
        return False
    return delete_local_file(path)
