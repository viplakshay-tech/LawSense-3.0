import json
import os
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Optional

from app.core.config import DB_PATH
from app.schemas.case_state import CaseState


def _restrict_database_file_permissions() -> None:
    """Limit SQLite files to the current OS account on POSIX systems.

    The parent data directory is private as well, which protects newly created
    WAL/SHM files between this check and their eventual cleanup. Windows uses
    inherited NTFS ACLs and is intentionally not modified here.
    """
    if os.name == "nt":
        return
    database_path = DB_PATH
    if database_path.exists():
        database_path.chmod(0o600)
    for suffix in ("-wal", "-shm", "-journal"):
        sidecar = database_path.with_name(database_path.name + suffix)
        if sidecar.exists():
            sidecar.chmod(0o600)


@contextmanager
def get_connection() -> Iterator[sqlite3.Connection]:
    connection = sqlite3.connect(DB_PATH)
    try:
        _restrict_database_file_permissions()
    except Exception:
        connection.close()
        raise
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
