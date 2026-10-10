"""Legal source registry and provider-neutral source governance contracts."""

from app.engines.legal_knowledge.models import (
    Authority,
    Jurisdiction,
    KnowledgeStatus,
    LegalSource,
    SourceAuthorityTier,
)

from app.engines.legal_sources.models import (
    RegistrySourceVersion,
    SourceRegistryEntry,
    SourceType,
)
from app.engines.legal_sources.registry import (
    LegalSourceRegistry,
    SourceRegistry,
    SourceRegistryError,
    SourceRegistryRepository,
)
from app.engines.legal_sources.governance_models import (
    GovernedLegalSource,
    RetrievedSourceMaterial,
    SourceApplicabilityStatus,
    SourceFreshnessStatus,
    SourceVerificationStatus,
)
from app.engines.legal_sources.governance import (
    DuplicateSourceIdError,
    LegalSourceIngestionAdapter,
    SourceGovernanceError,
    SourceGovernanceRegistry,
    SourceGovernanceValidationError,
    record_retrieval,
    validate_governed_source,
    validate_source_jurisdiction,
)
from app.engines.legal_sources.validation import (
    SourceRegistryValidationError,
    validate_registry_catalog,
    validate_registry_version,
    validate_source_identity,
)

__all__ = [
    "Authority",
    "Jurisdiction",
    "KnowledgeStatus",
    "LegalSource",
    "LegalSourceIngestionAdapter",
    "LegalSourceRegistry",
    "GovernedLegalSource",
    "RetrievedSourceMaterial",
    "RegistrySourceVersion",
    "SourceAuthorityTier",
    "SourceRegistry",
    "SourceRegistryEntry",
    "SourceRegistryError",
    "SourceRegistryRepository",
    "SourceRegistryValidationError",
    "SourceApplicabilityStatus",
    "SourceFreshnessStatus",
    "SourceVerificationStatus",
    "SourceGovernanceError",
    "SourceGovernanceRegistry",
    "SourceGovernanceValidationError",
    "DuplicateSourceIdError",
    "SourceType",
    "validate_registry_catalog",
    "validate_registry_version",
    "validate_source_identity",
    "validate_governed_source",
    "record_retrieval",
    "validate_source_jurisdiction",
]
