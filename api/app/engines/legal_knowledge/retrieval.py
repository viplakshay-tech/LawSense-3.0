"""Public retrieval functions; no LLM or remote service is involved."""

from __future__ import annotations

from collections.abc import Mapping

from app.engines.legal_knowledge.models import Jurisdiction, KnowledgeItem, LegalProvision
from app.engines.legal_knowledge.store import LegalKnowledgeRepository


def search_legal_knowledge(
    query: str,
    jurisdiction: str | Jurisdiction | None = None,
    filters: Mapping[str, object] | None = None,
    *,
    repository: LegalKnowledgeRepository | None = None,
) -> tuple[KnowledgeItem, ...]:
    """Search a supplied local repository; with no repository, return no records."""
    if repository is None:
        return ()
    return repository.search(query, jurisdiction=jurisdiction, filters=filters)


def get_provision(
    provision_id: str,
    *,
    repository: LegalKnowledgeRepository | None = None,
) -> LegalProvision | None:
    """Fetch a provision by stable ID from a supplied local repository."""
    if repository is None:
        return None
    return repository.get_provision(provision_id)
