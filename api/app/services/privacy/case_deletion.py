"""Explicit, local-first case deletion across canonical records and uploaded files.

A minimal hash-only tombstone prevents stale in-flight requests from recreating
a case after deletion. Uploaded files are moved to a temporary sibling name
before the database transaction; the folder is removed after the transaction.
Unlinking is not a guarantee of forensic secure erasure, and external exports
or backups cannot be revoked by this service.
"""

from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

from app.core.config import DATA_DIR
from app.core.storage_security import ensure_private_directory
from app.db.database import delete_case_records, get_case
from app.services.privacy.deletion import delete_local_directory
from app.services.case_operation_lock import case_operation_serialized


@dataclass(frozen=True, slots=True)
class CaseDeletionResult:
    deleted: bool
    uploaded_documents_removed: bool
    cleanup_warning: str | None = None


def _case_document_key(case_id: str) -> str:
    return hashlib.sha256(case_id.encode("utf-8")).hexdigest()[:32]


@case_operation_serialized
def delete_case_locally(case_id: str, *, data_dir: Path | None = None) -> CaseDeletionResult:
    """Delete one case, its SQL-backed derivatives, and its document folder.

    Unknown case IDs are a no-op. If the database transaction fails, a moved
    document folder is restored where possible; a cleanup failure after the
    case transaction leaves the bytes in a clearly named isolated directory
    and reports that limitation instead of claiming complete removal.
    """
    if get_case(case_id) is None:
        return CaseDeletionResult(
            deleted=False,
            uploaded_documents_removed=False,
        )

    data_root = data_dir or DATA_DIR
    documents_root = ensure_private_directory(data_root / "documents")
    active_directory = documents_root / _case_document_key(case_id)
    quarantine_directory: Path | None = None

    if active_directory.is_symlink():
        raise ValueError("The case document directory is a symbolic link; deletion was stopped.")
    if active_directory.exists():
        if not active_directory.is_dir():
            raise ValueError("The case document path is not a directory; deletion was stopped.")
        quarantine_directory = documents_root / (
            f"_lawsense_deletion_pending_{_case_document_key(case_id)}_{uuid4().hex}"
        )
        # Same-filesystem rename makes the uploaded bytes disappear from the
        # active case path before the canonical database transaction.
        os.replace(active_directory, quarantine_directory)

    try:
        deleted = delete_case_records(case_id)
    except Exception:
        if quarantine_directory is not None and quarantine_directory.exists():
            try:
                if not active_directory.exists():
                    os.replace(quarantine_directory, active_directory)
            except OSError as restore_error:
                raise RuntimeError(
                    "Case deletion failed and uploaded documents could not be restored "
                    "from the temporary cleanup directory."
                ) from restore_error
        raise

    if not deleted:
        if quarantine_directory is not None and quarantine_directory.exists():
            if not active_directory.exists():
                os.replace(quarantine_directory, active_directory)
        return CaseDeletionResult(
            deleted=False,
            uploaded_documents_removed=False,
        )

    if quarantine_directory is not None:
        try:
            delete_local_directory(quarantine_directory, within=documents_root)
        except (OSError, ValueError) as exc:
            return CaseDeletionResult(
                deleted=True,
                uploaded_documents_removed=False,
                cleanup_warning=(
                    "The case record, drafts, and packages were removed, but uploaded document "
                    "bytes could not be fully deleted. They remain in a local directory named "
                    f"{quarantine_directory.name} under the configured documents folder. "
                    "Remove that folder manually. This is not secure forensic erasure."
                ),
            )

    return CaseDeletionResult(
        deleted=True,
        uploaded_documents_removed=True,
    )
