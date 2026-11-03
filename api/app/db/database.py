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
from app.core.request_context import current_owner_id

class CaseAccessDeniedError(RuntimeError):
    """An authenticated user attempted to access a case owned by another account."""


class CasePermanentlyDeletedError(RuntimeError):
    """A stale operation attempted to recreate or mutate a permanently deleted case."""


def _assert_case_access(connection: sqlite3.Connection, case_id: str) -> None:
    owner_id = current_owner_id.get()
    row = connection.execute(
        "SELECT owner_user_id FROM cases WHERE id = ?",
        (case_id,),
    ).fetchone()
    if owner_id is not None:
        if row is None or row["owner_user_id"] != owner_id:
            raise CaseAccessDeniedError("Case not found.")
    elif row is not None and row["owner_user_id"] is not None:
        # Unscoped internal operations cannot read or mutate an owned case.
        raise CaseAccessDeniedError("Case not found.")


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
                owner_user_id TEXT,
                title TEXT,
                state_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        case_columns = {row["name"] for row in connection.execute("PRAGMA table_info(cases)").fetchall()}
        if "owner_user_id" not in case_columns:
            connection.execute("ALTER TABLE cases ADD COLUMN owner_user_id TEXT")
        connection.execute("CREATE INDEX IF NOT EXISTS idx_cases_owner_user_id ON cases(owner_user_id)")
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS auth_users (
                id TEXT PRIMARY KEY,
                username TEXT NOT NULL UNIQUE,
                password_salt TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS auth_sessions (
                token_hash TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL
            )
            """
        )
        connection.execute("CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions(user_id)")
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
    owner_id = current_owner_id.get()
    with get_connection() as connection:
        # Serialize the ownership/tombstone checks with writes and deletion.
        connection.execute("BEGIN IMMEDIATE")
        _assert_case_not_deleted(connection, case.id)
        existing = connection.execute(
            "SELECT owner_user_id FROM cases WHERE id = ?",
            (case.id,),
        ).fetchone()
        state_json = json.dumps(case.model_dump(mode="json"))
        if owner_id is None:
            if existing is not None and existing["owner_user_id"] is not None:
                raise CaseAccessDeniedError("Case not found.")
            connection.execute(
                """
                INSERT OR REPLACE INTO cases
                (id, owner_user_id, title, state_json, created_at, updated_at)
                VALUES (?, NULL, ?, ?, ?, ?)
                """,
                (
                    case.id,
                    case.title,
                    state_json,
                    case.metadata.createdAt,
                    case.metadata.updatedAt,
                ),
            )
        elif existing is not None:
            if existing["owner_user_id"] != owner_id:
                raise CaseAccessDeniedError("Case not found.")
            connection.execute(
                """
                UPDATE cases
                SET title = ?, state_json = ?, created_at = ?, updated_at = ?
                WHERE id = ? AND owner_user_id = ?
                """,
                (
                    case.title,
                    state_json,
                    case.metadata.createdAt,
                    case.metadata.updatedAt,
                    case.id,
                    owner_id,
                ),
            )
        else:
            connection.execute(
                """
                INSERT INTO cases
                (id, owner_user_id, title, state_json, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    case.id,
                    owner_id,
                    case.title,
                    state_json,
                    case.metadata.createdAt,
                    case.metadata.updatedAt,
                ),
            )
        connection.commit()


def get_case(case_id: str) -> Optional[CaseState]:
    owner_id = current_owner_id.get()
    with get_connection() as connection:
        if owner_id is None:
            row = connection.execute(
                "SELECT state_json FROM cases WHERE id = ? AND owner_user_id IS NULL",
                (case_id,),
            ).fetchone()
        else:
            row = connection.execute(
                "SELECT state_json FROM cases WHERE id = ? AND owner_user_id = ?",
                (case_id, owner_id),
            ).fetchone()

    if row is None:
        return None

    return CaseState.model_validate(json.loads(row["state_json"]))


def save_document_draft(draft) -> None:
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        _assert_case_access(connection, draft.caseId)
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
        _assert_case_access(connection, case_id)
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
        _assert_case_access(connection, case_id)
        rows = connection.execute(
            "SELECT draft_json FROM document_drafts WHERE case_id = ? ORDER BY created_at, id",
            (case_id,),
        ).fetchall()
    return [DocumentDraft.model_validate(json.loads(row["draft_json"])) for row in rows]


def save_document_package(package) -> None:
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        _assert_case_access(connection, package.caseId)
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
        _assert_case_access(connection, case_id)
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
        _assert_case_access(connection, case_id)
        rows = connection.execute(
            "SELECT package_json FROM document_packages WHERE case_id = ? ORDER BY created_at, id",
            (case_id,),
        ).fetchall()
    return [DocumentPackage.model_validate(json.loads(row["package_json"])) for row in rows]


def delete_case_records(case_id: str) -> bool:
    """Delete one case and its SQL derivatives if it belongs to the current owner."""
    owner_id = current_owner_id.get()
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        try:
            if owner_id is None:
                row = connection.execute(
                    "SELECT 1 FROM cases WHERE id = ? AND owner_user_id IS NULL",
                    (case_id,),
                ).fetchone()
            else:
                row = connection.execute(
                    "SELECT 1 FROM cases WHERE id = ? AND owner_user_id = ?",
                    (case_id, owner_id),
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
            if owner_id is None:
                connection.execute("DELETE FROM cases WHERE id = ? AND owner_user_id IS NULL", (case_id,))
            else:
                connection.execute(
                    "DELETE FROM cases WHERE id = ? AND owner_user_id = ?",
                    (case_id, owner_id),
                )
            connection.commit()
            return True
        except Exception:
            connection.rollback()
            raise


def sync_document_to_packages(draft) -> None:
    """Keep package snapshots aligned when an included draft is edited or reviewed."""
    from app.engines.document_compiler.models import DocumentPackage

    with get_connection() as connection:
        _assert_case_access(connection, draft.caseId)
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
