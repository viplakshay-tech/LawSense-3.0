import hashlib
import json
import sqlite3
from collections.abc import Iterator
from datetime import datetime, timezone
from contextlib import contextmanager
from typing import Optional

from app.core.config import DB_PATH
from app.core.storage_security import prepare_private_file
from app.schemas.case_state import CaseState

class CasePermanentlyDeletedError(RuntimeError):
    """A stale operation attempted to recreate or mutate a permanently deleted case."""


def _case_tombstone_hash(case_id: str) -> str:
    return hashlib.sha256(case_id.encode("utf-8")).hexdigest()


def _assert_case_not_deleted(connection: sqlite3.Connection, case_id: str) -> None:
    row = connection.execute(
        "SELECT 1 FROM deleted_case_tombstones WHERE case_hash = ?",
        (_case_tombstone_hash(case_id),),
    ).fetchone()
    if row is not None:
        raise CasePermanentlyDeletedError(
            "This case was permanently deleted. Start a new case instead of restoring stale data."
        )




@contextmanager
def get_connection() -> Iterator[sqlite3.Connection]:
    prepare_private_file(DB_PATH)
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
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS deleted_case_tombstones (
                case_hash TEXT PRIMARY KEY,
                deleted_at TEXT NOT NULL
            )
            """
        )
        connection.commit()


def save_case(case: CaseState) -> None:
    with get_connection() as connection:
        # Serialize the tombstone check and write against concurrent deletion.
        connection.execute("BEGIN IMMEDIATE")
        _assert_case_not_deleted(connection, case.id)
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
        connection.execute("BEGIN IMMEDIATE")
        _assert_case_not_deleted(connection, draft.caseId)
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
        connection.execute("BEGIN IMMEDIATE")
        _assert_case_not_deleted(connection, package.caseId)
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


def delete_case_records(case_id: str) -> bool:
    """Delete a case and all SQL-backed derivatives in one SQLite transaction.

    A hash-only tombstone is retained so an already-running request cannot
    silently recreate the same case ID after this transaction commits.
    """
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        try:
            row = connection.execute(
                "SELECT 1 FROM cases WHERE id = ?",
                (case_id,),
            ).fetchone()
            if row is None:
                connection.rollback()
                return False

            connection.execute(
                """
                INSERT OR IGNORE INTO deleted_case_tombstones (case_hash, deleted_at)
                VALUES (?, ?)
                """,
                (
                    _case_tombstone_hash(case_id),
                    datetime.now(timezone.utc).isoformat(),
                ),
            )
            connection.execute("DELETE FROM document_drafts WHERE case_id = ?", (case_id,))
            connection.execute("DELETE FROM document_packages WHERE case_id = ?", (case_id,))
            connection.execute("DELETE FROM cases WHERE id = ?", (case_id,))
            connection.commit()
            return True
        except Exception:
            connection.rollback()
            raise


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
