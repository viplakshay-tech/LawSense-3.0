"""Deterministic local JSON export helpers. No network operations are used."""

from __future__ import annotations

import json
import os
import tempfile
from dataclasses import asdict, is_dataclass
from datetime import date, datetime
from enum import Enum
from pathlib import Path
from typing import Any

from .models import SecureDataReference


def reference_export_metadata(reference: SecureDataReference) -> dict[str, Any]:
    """Return reference metadata for a local export, never the referenced bytes."""
    return {
        "reference_id": reference.reference_id,
        "sha256": reference.sha256,
        "size_bytes": reference.size_bytes,
        "media_type": reference.media_type,
        "classification": {
            "categories": sorted(item.value for item in reference.classification.categories),
            "sensitivity_level": reference.classification.sensitivity_level.value,
            "signals": list(reference.classification.signals),
        },
        "created_at": reference.created_at.isoformat(),
        "retention": _json_value(reference.retention) if reference.retention else None,
        "storage_key": reference.storage_key,
    }


def to_export_json(value: Any) -> str:
    """Serialize caller-selected local export data in stable, readable JSON."""
    return json.dumps(
        value,
        default=_json_value,
        sort_keys=True,
        indent=2,
        ensure_ascii=False,
        allow_nan=False,
    ) + "\n"


def write_local_export(path: str | Path, value: Any, *, overwrite: bool = False) -> Path:
    """Write a local JSON export; defaults to exclusive creation to avoid clobbering."""
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    serialized = to_export_json(value)
    if not overwrite:
        descriptor: int | None = None
        created = False
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0)
        try:
            descriptor = os.open(target, flags, 0o600)
            created = True
            with os.fdopen(descriptor, "w", encoding="utf-8", newline="\\n") as stream:
                descriptor = None
                stream.write(serialized)
        except Exception:
            if descriptor is not None:
                os.close(descriptor)
            if created:
                target.unlink(missing_ok=True)
            raise
        return target

    temporary_path: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            newline="\n",
            dir=target.parent,
            prefix=f".{target.name}.",
            suffix=".tmp",
            delete=False,
        ) as stream:
            temporary_path = stream.name
            stream.write(serialized)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary_path, target)
    except Exception:
        if temporary_path is not None:
            try:
                Path(temporary_path).unlink()
            except FileNotFoundError:
                pass
        raise
    return target


def _json_value(value: Any) -> Any:
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, (set, frozenset)):
        return sorted(value, key=lambda item: str(item))
    if isinstance(value, tuple):
        return list(value)
    if is_dataclass(value) and not isinstance(value, type):
        return asdict(value)
    raise TypeError(f"Cannot export value of type {type(value).__name__} to JSON.")
