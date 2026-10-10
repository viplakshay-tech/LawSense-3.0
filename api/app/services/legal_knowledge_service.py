"""Application boundary for local, source-traceable legal knowledge lookup."""

from __future__ import annotations

from collections.abc import Mapping

from app.engines.legal_knowledge.models import Jurisdiction, KnowledgeItem, LegalProvision
from app.engines.legal_knowledge.retrieval import (
    get_provision as get_engine_provision,
    search_legal_knowledge as search_engine,
)
from app.engines.legal_knowledge.store import LegalKnowledgeRepository
from app.engines.legal_knowledge.seed import build_authoritative_legal_knowledge_seed


def search_legal_knowledge(
    query: str,
    jurisdiction: str | Jurisdiction | None = None,
    filters: Mapping[str, object] | None = None,
    *,
    repository: LegalKnowledgeRepository | None = None,
) -> tuple[KnowledgeItem, ...]:
    """Search the local authoritative seed unless a repository is supplied."""
    selected_repository = (
        repository if repository is not None else build_authoritative_legal_knowledge_seed()
    )
    return search_engine(query, jurisdiction, filters, repository=selected_repository)


def get_provision(
    provision_id: str,
    *,
    repository: LegalKnowledgeRepository | None = None,
) -> LegalProvision | None:
    """Retrieve a provision from the local authoritative seed by default."""
    selected_repository = (
        repository if repository is not None else build_authoritative_legal_knowledge_seed()
    )
    return get_engine_provision(provision_id, repository=selected_repository)
