import json
import logging
import os
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Optional

from app.core.config import DB_PATH
from app.schemas.case_state import CaseState


@contextmanager
def get_connection() -> Iterator[sqlite3.Connection]:
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    try:
        yield connection
    finally:
        connection.close()


def init_db() -> None:
    with get_connection() as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS cases (
                id TEXT PRIMARY KEY,
                title TEXT,
                state_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS document_drafts (
                id TEXT PRIMARY KEY,
                case_id TEXT NOT NULL,
                draft_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_document_drafts_case_id ON document_drafts(case_id)"
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS document_packages (
                id TEXT PRIMARY KEY,
                case_id TEXT NOT NULL,
                package_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_document_packages_case_id ON document_packages(case_id)"
        )
        connection.commit()

    _secure_local_storage_permissions()


def _secure_local_storage_permissions() -> None:
    """Restrict the database and its dedicated directory to the current OS user.

    This is a defence-in-depth measure for single-user local deployments. It
    does not encrypt records, provide application-level authentication, or
    replace platform ACL review on Windows.
    """
    if os.name == "nt":
        return

    try:
        # Avoid chmod following a deliberately substituted database symlink.
        # The storage path must be a regular file in a real data directory.
        if DB_PATH.parent.is_symlink() or DB_PATH.is_symlink():
            raise OSError("database path or parent is a symbolic link")

        # Restrict the directory first so SQLite sidecar/journal files inherit
        # a private directory boundary as well as the database file mode.
        DB_PATH.parent.chmod(0o700)
        if DB_PATH.exists():
            DB_PATH.chmod(0o600)
    except OSError:
        # Do not put filesystem paths or user data into logs. The runtime can
        # continue, but operators must treat storage permissions as unverified.
        logging.getLogger("lawsense.privacy").warning(
            "local_storage_permissions_unverified"
        )


def save_case(case: CaseState) -> None:
    with get_connection() as connection:
        connection.execute(
            """
            INSERT OR REPLACE INTO cases
            (id, title, state_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                case.id,
                case.title,
                json.dumps(case.model_dump(mode="json")),
                case.metadata.createdAt,
                case.metadata.updatedAt,
            ),
        )
        connection.commit()


def get_case(case_id: str) -> Optional[CaseState]:
    with get_connection() as connection:
        row = connection.execute(
            "SELECT state_json FROM cases WHERE id = ?",
            (case_id,),
        ).fetchone()

    if row is None:
        return None

    return CaseState.model_validate(json.loads(row["state_json"]))


def save_document_draft(draft) -> None:
    with get_connection() as connection:
        connection.execute(
            """
            INSERT OR REPLACE INTO document_drafts
            (id, case_id, draft_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                draft.id,
                draft.caseId,
                json.dumps(draft.model_dump(mode="json"), ensure_ascii=False),
                draft.createdAt,
                draft.updatedAt,
            ),
        )
        connection.commit()
    sync_document_to_packages(draft)


def get_document_draft(case_id: str, draft_id: str):
    from app.engines.document_compiler.models import DocumentDraft

    with get_connection() as connection:
        row = connection.execute(
            "SELECT draft_json FROM document_drafts WHERE case_id = ? AND id = ?",
            (case_id, draft_id),
        ).fetchone()
    if row is None:
        return None
    return DocumentDraft.model_validate(json.loads(row["draft_json"]))


def list_document_drafts(case_id: str):
    from app.engines.document_compiler.models import DocumentDraft

    with get_connection() as connection:
        rows = connection.execute(
            "SELECT draft_json FROM document_drafts WHERE case_id = ? ORDER BY created_at, id",
            (case_id,),
        ).fetchall()
    return [DocumentDraft.model_validate(json.loads(row["draft_json"])) for row in rows]


def save_document_package(package) -> None:
    with get_connection() as connection:
        connection.execute(
            """
            INSERT OR REPLACE INTO document_packages
            (id, case_id, package_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                package.id,
                package.caseId,
                json.dumps(package.model_dump(mode="json"), ensure_ascii=False),
                package.createdAt,
                package.updatedAt,
            ),
        )
        connection.commit()


def get_document_package(case_id: str, package_id: str):
    from app.engines.document_compiler.models import DocumentPackage

    with get_connection() as connection:
        row = connection.execute(
            "SELECT package_json FROM document_packages WHERE case_id = ? AND id = ?",
            (case_id, package_id),
        ).fetchone()
    if row is None:
        return None
    return DocumentPackage.model_validate(json.loads(row["package_json"]))


def list_document_packages(case_id: str):
    from app.engines.document_compiler.models import DocumentPackage

    with get_connection() as connection:
        rows = connection.execute(
            "SELECT package_json FROM document_packages WHERE case_id = ? ORDER BY created_at, id",
            (case_id,),
        ).fetchall()
    return [DocumentPackage.model_validate(json.loads(row["package_json"])) for row in rows]


def sync_document_to_packages(draft) -> None:
    """Keep package snapshots aligned when an included draft is edited or reviewed."""
    from app.engines.document_compiler.models import DocumentPackage

    with get_connection() as connection:
        rows = connection.execute(
            "SELECT id, package_json, created_at FROM document_packages WHERE case_id = ?",
            (draft.caseId,),
        ).fetchall()
        for row in rows:
            package = DocumentPackage.model_validate(json.loads(row["package_json"]))
            changed = False
            for index, item in enumerate(package.documents):
                if item.id == draft.id:
                    package.documents[index] = draft
                    package.updatedAt = draft.updatedAt
                    changed = True
            if changed:
                connection.execute(
                    "UPDATE document_packages SET package_json = ?, updated_at = ? WHERE id = ?",
                    (
                        json.dumps(package.model_dump(mode="json"), ensure_ascii=False),
                        draft.updatedAt,
                        row["id"],
                    ),
                )
        connection.commit()
