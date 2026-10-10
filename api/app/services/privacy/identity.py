"""Content identity helpers. Hashes identify bytes; they do not encrypt them."""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import BinaryIO


def document_sha256(document_bytes: bytes) -> str:
    """Return the lowercase SHA-256 digest for an in-memory document."""
    return hashlib.sha256(document_bytes).hexdigest()


def file_sha256(path: str | Path, *, chunk_size: int = 1024 * 1024) -> str:
    """Hash a local file incrementally without loading its contents at once."""
    if chunk_size <= 0:
        raise ValueError("chunk_size must be greater than zero.")
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        _update_from_stream(digest, stream, chunk_size)
    return digest.hexdigest()


def stream_sha256(stream: BinaryIO, *, chunk_size: int = 1024 * 1024) -> str:
    """Hash a binary stream from its current position without closing it."""
    if chunk_size <= 0:
        raise ValueError("chunk_size must be greater than zero.")
    digest = hashlib.sha256()
    _update_from_stream(digest, stream, chunk_size)
    return digest.hexdigest()


def _update_from_stream(digest, stream: BinaryIO, chunk_size: int) -> None:
    while chunk := stream.read(chunk_size):
        digest.update(chunk)
