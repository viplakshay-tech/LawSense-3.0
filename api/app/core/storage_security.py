"""Best-effort private permissions for local case data on POSIX systems.

These helpers do not encrypt files or configure Windows ACLs. They reduce
read access to the current OS user on POSIX filesystems and fail rather than
silently following symlinks at sensitive storage paths.
"""

from __future__ import annotations

import os
from pathlib import Path


_PRIVATE_DIRECTORY_MODE = 0o700
_PRIVATE_FILE_MODE = 0o600


def ensure_private_directory(path: str | Path) -> Path:
    """Create a storage directory and restrict permissions where supported."""
    target = Path(path)
    if target.is_symlink():
        raise ValueError("Sensitive storage directories must not be symbolic links.")
    target.mkdir(parents=True, exist_ok=True, mode=_PRIVATE_DIRECTORY_MODE)
    if target.is_symlink() or not target.is_dir():
        raise ValueError("Sensitive storage path must be a real directory.")
    if os.name == "posix":
        target.chmod(_PRIVATE_DIRECTORY_MODE)
    return target


def prepare_private_file(path: str | Path) -> Path:
    """Create a private file if absent and restrict an existing file on POSIX."""
    target = Path(path)
    ensure_private_directory(target.parent)
    if target.is_symlink():
        raise ValueError("Sensitive storage files must not be symbolic links.")

    if os.name == "posix":
        try:
            descriptor = os.open(
                target,
                os.O_CREAT | os.O_EXCL | os.O_RDWR,
                _PRIVATE_FILE_MODE,
            )
        except FileExistsError:
            pass
        else:
            os.close(descriptor)

        if target.is_symlink() or not target.is_file():
            raise ValueError("Sensitive storage path must be a regular file.")
        target.chmod(_PRIVATE_FILE_MODE)

    return target


def private_file_mode() -> int:
    """Expose the intended POSIX mode for narrow tests/documentation."""
    return _PRIVATE_FILE_MODE


def private_directory_mode() -> int:
    """Expose the intended POSIX mode for narrow tests/documentation."""
    return _PRIVATE_DIRECTORY_MODE
