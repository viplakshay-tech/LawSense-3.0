"""Local-first, source-traceable legal knowledge infrastructure."""

from app.engines.legal_knowledge.adapters import (
    FetchedLegalSource,
    LegalSourceAdapter,
    MockLegalSourceAdapter,
    ingest_discovered_sources,
)
from app.engines.legal_knowledge.models import (
    Authority,
    Jurisdiction,
    KnowledgeItem,
    KnowledgeRelationship,
    KnowledgeStatus,
    LegalDocument,
    LegalProcedure,
    LegalProvision,
    LegalRule,
    LegalSource,
    RelationshipType,
    SourceAuthorityTier,
    SourceReference,
    SourceVersion,
)
from app.engines.legal_knowledge.retrieval import get_provision, search_legal_knowledge
from app.engines.legal_knowledge.store import (
    InMemoryLegalKnowledgeStore,
    LegalKnowledgeRepository,
    LegalKnowledgeStoreError,
)
from app.engines.legal_knowledge.validation import LegalKnowledgeValidationError, validate_knowledge_item

__all__ = [
    "Authority",
    "FetchedLegalSource",
    "InMemoryLegalKnowledgeStore",
    "Jurisdiction",
    "KnowledgeItem",
    "KnowledgeRelationship",
    "KnowledgeStatus",
    "LegalDocument",
    "LegalKnowledgeStoreError",
    "LegalKnowledgeValidationError",
    "LegalKnowledgeRepository",
    "LegalProcedure",
    "LegalProvision",
    "LegalRule",
    "LegalSource",
    "LegalSourceAdapter",
    "MockLegalSourceAdapter",
    "RelationshipType",
    "SourceAuthorityTier",
    "SourceReference",
    "SourceVersion",
    "get_provision",
    "ingest_discovered_sources",
    "search_legal_knowledge",
    "validate_knowledge_item",
]
