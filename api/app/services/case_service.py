"""Case creation and retrieval orchestration."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from app.db.database import get_case, save_case
from app.engines.case_state import extract_case_state
from app.schemas.case_state import CaseState
from app.services.analysis_service import build_case_analysis
from app.services.clarification import normalize_unanswered_clarification_records
from app.services.document_case.service import normalize_unconfirmed_document_evidence


def create_case_from_statement(
    *,
    initial_statement: str,
    title: str | None = None,
    language: str | None = None,
    person_name: str | None = None,
    source_id: str = "initial-statement",
    source_title: str = "Initial user statement",
) -> CaseState:
    """Extract and persist a canonical CaseState without rewriting its source."""
    if not isinstance(initial_statement, str) or not initial_statement.strip():
        raise ValueError("initialStatement must not be empty")

    case_id = str(uuid4())
    now = datetime.now(timezone.utc).isoformat()
    case = extract_case_state(
        initial_statement,
        case_id=case_id,
        source_id=source_id,
        source_type="user",
        source_title=source_title,
        language=language,
        created_at=now,
    )

    # This field is the verbatim source record. Extracted fields may be
    # normalized, but must never replace or translate the user's statement.
    case.initialStatement = initial_statement
    case.title = title
    if person_name and person_name.strip() and not case.person.name:
        case.person.name = person_name
    case.metadata.updatedAt = now
    case.analysis = build_case_analysis(case)
    # The persisted version timestamp follows its derived analysis snapshot.
    case.metadata.updatedAt = datetime.now(timezone.utc).isoformat()

    save_case(case)
    return case


def get_case_state(case_id: str) -> CaseState | None:
    """Read a previously persisted canonical CaseState."""
    case_state = get_case(case_id)
    if case_state is None:
        return None

    case_state = normalize_unconfirmed_document_evidence(case_state)
    case_state, removed_legacy_unanswered = normalize_unanswered_clarification_records(case_state)
    if removed_legacy_unanswered:
        case_state.analysis = build_case_analysis(case_state)
        save_case(case_state)
    return case_state
