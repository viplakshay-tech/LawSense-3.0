"""Types for user-facing safety support orchestration."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from urllib.parse import urlsplit


class SafetySituation(str, Enum):
    DOMESTIC_VIOLENCE = "domestic_violence"
    THREATS = "threats"
    STALKING = "stalking"
    SEXUAL_HARASSMENT_VIOLENCE = "sexual_harassment_violence"
    BLACKMAIL = "blackmail"
    COERCIVE_CONTROL = "coercive_control"
    FORCED_ISOLATION = "forced_isolation"
    FINANCIAL_CONTROL = "financial_control"
    WORKPLACE_HARASSMENT = "workplace_harassment"
    CHILD_SAFETY = "child_safety"
    ELDER_ABUSE = "elder_abuse"
    EXPLOITATION = "exploitation"
    CYBER_HARASSMENT = "cyber_harassment"
    INTIMATE_IMAGE_ABUSE = "intimate_image_abuse"
    DOWRY_RELATED_ABUSE = "dowry_related_abuse"


class SafetyUrgency(str, Enum):
    NONE = "none"
    ELEVATED = "elevated"
    URGENT = "urgent"


class WomenSafetyUrgency(str, Enum):
    """Women-safety urgency layered over the shared Safety assessment."""

    NORMAL = "NORMAL"
    CONCERNING = "CONCERNING"
    URGENT = "URGENT"
    IMMEDIATE_DANGER = "IMMEDIATE_DANGER"
    NOT_SURE = "NOT_SURE"


class WomenSafetyDomain(str, Enum):
    DOMESTIC_ABUSE = "domestic_abuse"
    SEXUAL_VIOLENCE = "sexual_violence"
    WORKPLACE_SEXUAL_HARASSMENT = "workplace_sexual_harassment"
    STALKING = "stalking"
    THREATS_COERCION = "threats_coercion"
    CYBER_HARASSMENT = "cyber_harassment"
    INTIMATE_IMAGE_ABUSE = "intimate_image_abuse"
    DOWRY_RELATED_ABUSE = "dowry_related_abuse"
    FINANCIAL_CONTROL_ABUSE = "financial_control_abuse"
    TRAFFICKING_EXPLOITATION = "trafficking_exploitation"


class AssessmentContext(str, Enum):
    NONE = "none"
    SENSITIVE = "sensitive"
    POTENTIALLY_UNSAFE = "potentially_unsafe"
    URGENT_SAFETY_CONTEXT = "urgent_safety_context"
    UNCERTAIN = "uncertain"


class ImmediateDangerAnswer(str, Enum):
    YES = "yes"
    NO = "no"
    NOT_SURE = "not_sure"


class SafetyLanguage(str, Enum):
    ENGLISH = "en"
    HINDI = "hi"
    HINGLISH = "hinglish"


class WorkflowDisposition(str, Enum):
    SAFETY_FIRST = "safety_first"
    SAFETY_CHECK_THEN_LEGAL = "safety_check_then_legal"
    ORDINARY_LEGAL = "ordinary_legal"


class SafetySupportTrack(str, Enum):
    """Kind of support path, separate from any external resource category."""

    IMMEDIATE_DANGER = "immediate_danger_support"


class ResourceCategory(str, Enum):
    EMERGENCY = "emergency"
    CRISIS_SUPPORT = "crisis_support"
    DOMESTIC_VIOLENCE = "domestic_violence"
    SEXUAL_VIOLENCE = "sexual_violence"
    STALKING_HARASSMENT = "stalking_harassment"
    WORKPLACE_SAFEGUARDING = "workplace_safeguarding"
    CHILD_PROTECTION = "child_protection"
    ELDER_PROTECTION = "elder_protection"
    EXPLOITATION_TRAFFICKING = "exploitation_trafficking"
    CYBER_SAFETY = "cyber_safety"
    LEGAL_AID = "legal_aid"
    POLICE_OFFICIAL = "police_official"
    WOMEN_CHILD_PROTECTION = "women_child_protection"
    CYBERCRIME = "cybercrime"
    WORKPLACE_HARASSMENT = "workplace_harassment"
    GOVERNMENT_GRIEVANCE = "government_grievance"
    CONSUMER_SUPPORT = "consumer_support"


class ResourceVerificationStatus(str, Enum):
    VERIFIED_OFFICIAL = "verified_official"
    UNVERIFIED = "unverified"
    UNAVAILABLE = "unavailable"


class ResourceAvailabilityStatus(str, Enum):
    VERIFIED_OFFICIAL = "verified_official"
    UNVERIFIED = "unverified"
    UNAVAILABLE = "unavailable"
    JURISDICTION_MISMATCH = "jurisdiction_mismatch"
    STATE_NOT_APPLICABLE = "state_not_applicable"
    JURISDICTION_UNSPECIFIED = "jurisdiction_unspecified"


@dataclass(frozen=True)
class TriggerEvidence:
    """A detector or contextual cue, tied to the exact source passage."""

    category: str
    matched_text: str
    source_text: str
    situations: tuple[SafetySituation, ...] = ()
    origin: str = "narrative"

    def as_dict(self) -> dict[str, object]:
        return {
            "category": self.category,
            "matched_text": self.matched_text,
            "source_text": self.source_text,
            "situations": [situation.value for situation in self.situations],
            "origin": self.origin,
        }


class WomenSafetyActionType(str, Enum):
    IMMEDIATE_DANGER_CHECK = "immediate_danger_check"
    EVIDENCE_PRESERVATION = "evidence_preservation"
    REVIEW_SUPPORT_RESOURCES = "review_support_resources"
    REVIEW_LEGAL_PROCEDURES = "review_legal_procedures"


@dataclass(frozen=True)
class WomenSafetyAction:
    """An optional, user-controlled action; actions never contact anyone."""

    id: str
    type: WomenSafetyActionType
    status: str
    condition: str | None = None
    requires_user_choice: bool = True
    jurisdiction_required: bool = False
    source_ids: tuple[str, ...] = ()
    automatic_contact: bool = False

    def __post_init__(self) -> None:
        if self.automatic_contact:
            raise ValueError("women-safety actions cannot contact anyone automatically")

    def as_dict(self) -> dict[str, object]:
        return {
            "id": self.id,
            "type": self.type.value,
            "status": self.status,
            "condition": self.condition,
            "requires_user_choice": self.requires_user_choice,
            "jurisdiction_required": self.jurisdiction_required,
            "source_ids": list(self.source_ids),
            "automatic_contact": False,
        }


@dataclass(frozen=True)
class WomenSafetyLegalIssueMapping:
    """A candidate mapping to issue categories already used by the legal registry."""

    domain: WomenSafetyDomain
    status: str
    candidate_issue_categories: tuple[str, ...] = ()
    matched_case_issue_ids: tuple[str, ...] = ()
    source_record_ids: tuple[str, ...] = ()

    def as_dict(self) -> dict[str, object]:
        return {
            "domain": self.domain.value,
            "status": self.status,
            "candidate_issue_categories": list(self.candidate_issue_categories),
            "matched_case_issue_ids": list(self.matched_case_issue_ids),
            "source_record_ids": list(self.source_record_ids),
        }


@dataclass(frozen=True)
class WomenSafetyDomainEvidence:
    """Detector categories that contributed to one women-safety domain tag."""

    domain: WomenSafetyDomain
    trigger_categories: tuple[str, ...]
    status: str = "system_inferred"

    def as_dict(self) -> dict[str, object]:
        return {
            "domain": self.domain.value,
            "trigger_categories": list(self.trigger_categories),
            "status": self.status,
        }


@dataclass(frozen=True)
class WomenSafetySourceReference:
    """An existing legal-knowledge provenance pointer, without copied legal text."""

    record_id: str
    source_id: str
    retrieval_time: str | None = None
    source_url: str | None = None
    provision_id: str | None = None
    page_section_reference: str | None = None
    jurisdiction: str | None = None
    verification_status: str | None = None
    freshness_status: str | None = None
    applicability_status: str | None = None
    jurisdiction_match_status: str | None = None

    def as_dict(self) -> dict[str, str | None]:
        return {
            "record_id": self.record_id,
            "source_id": self.source_id,
            "retrieval_time": self.retrieval_time,
            "source_url": self.source_url,
            "provision_id": self.provision_id,
            "page_section_reference": self.page_section_reference,
            "jurisdiction": self.jurisdiction,
            "verification_status": self.verification_status,
            "freshness_status": self.freshness_status,
            "applicability_status": self.applicability_status,
            "jurisdiction_match_status": self.jurisdiction_match_status,
        }


@dataclass(frozen=True)
class WomenSafetyProcedure:
    """A procedure record returned by the existing legal-knowledge layer."""

    record_id: str
    title: str
    jurisdiction: str | None
    verification_status: str | None
    applicability_status: str | None
    jurisdiction_match_status: str | None
    source_ids: tuple[str, ...] = ()

    def as_dict(self) -> dict[str, object]:
        return {
            "record_id": self.record_id,
            "title": self.title,
            "jurisdiction": self.jurisdiction,
            "verification_status": self.verification_status,
            "applicability_status": self.applicability_status,
            "jurisdiction_match_status": self.jurisdiction_match_status,
            "source_ids": list(self.source_ids),
            "status": "candidate_record_requires_review",
        }


@dataclass(frozen=True)
class WomenSafetyContext:
    """Structured women-safety context derived from the shared safety result."""

    domains: tuple[WomenSafetyDomain, ...]
    domain_evidence: tuple[WomenSafetyDomainEvidence, ...]
    urgency: WomenSafetyUrgency
    immediate_danger_answer: ImmediateDangerAnswer | None
    jurisdiction_status: str
    jurisdiction: str | None
    state: str | None
    legal_issue_mappings: tuple[WomenSafetyLegalIssueMapping, ...]
    procedures: tuple[WomenSafetyProcedure, ...]
    actions: tuple[WomenSafetyAction, ...]
    evidence_preservation_guidance: tuple[str, ...] = ()
    legal_sources: tuple[WomenSafetySourceReference, ...] = ()
    contacted_anyone: bool = False

    def __post_init__(self) -> None:
        if self.contacted_anyone:
            raise ValueError("women-safety assessment cannot contact anyone")

    def as_dict(self) -> dict[str, object]:
        return {
            "domains": [item.value for item in self.domains],
            "domain_evidence": [item.as_dict() for item in self.domain_evidence],
            "urgency": self.urgency.value,
            "immediate_danger_answer": (
                self.immediate_danger_answer.value if self.immediate_danger_answer else None
            ),
            "jurisdiction_status": self.jurisdiction_status,
            "jurisdiction": self.jurisdiction,
            "state": self.state,
            "legal_issue_mappings": [item.as_dict() for item in self.legal_issue_mappings],
            "procedures": [item.as_dict() for item in self.procedures],
            "actions": [item.as_dict() for item in self.actions],
            "evidence_preservation_guidance": list(self.evidence_preservation_guidance),
            "legal_sources": [item.as_dict() for item in self.legal_sources],
            "contacted_anyone": False,
        }

    def as_summary_dict(self) -> dict[str, object]:
        """Return case-safe context without persisting the user's danger choice."""
        payload = self.as_dict()
        payload.pop("immediate_danger_answer", None)
        payload["actions"] = [
            action
            for action in payload["actions"]
            if action.get("type") != WomenSafetyActionType.IMMEDIATE_DANGER_CHECK.value
        ]
        return payload


@dataclass(frozen=True)
class OfficialResource:
    """A catalog record; only verified, applicable records may be displayed."""

    name: str
    category: ResourceCategory
    jurisdiction: str
    official: bool
    url: str | None = None
    phone: str | None = None
    alternate_phone: str | None = None
    description: str | None = None
    availability_note: str | None = None
    phone_purpose: str | None = None
    accessibility_options: str | None = None
    additional_categories: tuple[ResourceCategory, ...] = ()
    verification_status: ResourceVerificationStatus | None = None
    source_url: str | None = None
    verified_on: str | None = None
    jurisdiction_scope: str = "countrywide"
    applicable_states: tuple[str, ...] = ()
    excluded_states: tuple[str, ...] = ()
    resource_id: str | None = None

    def __post_init__(self) -> None:
        # Keep old registry records compatible while making their confidence
        # explicit in every serialized result.
        if self.verification_status is None:
            inferred = (
                ResourceVerificationStatus.VERIFIED_OFFICIAL
                if self.official
                else ResourceVerificationStatus.UNVERIFIED
            )
            object.__setattr__(self, "verification_status", inferred)
        if self.official != (
            self.verification_status is ResourceVerificationStatus.VERIFIED_OFFICIAL
        ):
            raise ValueError("official must match verified_official verification_status")
        if self.jurisdiction_scope not in {"countrywide", "state_listed"}:
            raise ValueError("jurisdiction_scope must be 'countrywide' or 'state_listed'")
        if self.jurisdiction_scope == "state_listed" and not self.applicable_states:
            raise ValueError("state_listed resources must name applicable_states")
        if self.jurisdiction_scope == "countrywide" and self.applicable_states:
            raise ValueError("countrywide resources cannot set applicable_states")

    @property
    def categories(self) -> tuple[ResourceCategory, ...]:
        return tuple(dict.fromkeys((self.category, *self.additional_categories)))

    def as_dict(self) -> dict[str, object]:
        verified = (
            self.official
            and self.verification_status is ResourceVerificationStatus.VERIFIED_OFFICIAL
        )
        def https_url(value: str | None) -> str | None:
            if not value:
                return None
            candidate = value.strip()
            parsed = urlsplit(candidate)
            if parsed.scheme.casefold() != "https" or not parsed.hostname:
                return None
            return candidate

        safe_url = https_url(self.url) if verified else None
        safe_source_url = https_url(self.source_url) if verified else None
        return {
            "resource_id": self.resource_id if verified else None,
            "name": self.name if verified else None,
            "category": self.category.value,
            "categories": [category.value for category in self.categories],
            "jurisdiction": self.jurisdiction,
            "jurisdiction_scope": self.jurisdiction_scope,
            "applicable_states": list(self.applicable_states),
            "excluded_states": list(self.excluded_states),
            "official": verified,
            "verification_status": self.verification_status.value,
            "url": safe_url,
            "phone": self.phone if verified else None,
            "alternate_phone": self.alternate_phone if verified else None,
            "description": self.description if verified else None,
            "availability_note": self.availability_note if verified else None,
            "phone_purpose": self.phone_purpose if verified else None,
            "accessibility_options": self.accessibility_options if verified else None,
            "source_url": safe_source_url,
            "verified_on": self.verified_on if verified else None,
            "provenance": ([{
                "source_id": self.resource_id,
                "source_url": safe_source_url,
                "verified_on": self.verified_on,
            }] if verified and (safe_source_url or self.resource_id) else []),
        }


@dataclass(frozen=True)
class ResourceAvailability:
    """Availability of one requested category for the supplied location."""

    category: ResourceCategory
    status: ResourceAvailabilityStatus
    jurisdiction: str | None
    state: str | None

    def as_dict(self) -> dict[str, str | None]:
        return {
            "category": self.category.value,
            "status": self.status.value,
            "jurisdiction": self.jurisdiction,
            "state": self.state,
        }


@dataclass(frozen=True)
class ResourceEligibility:
    """Source-only details for a verified listing that cannot be offered as available."""

    resource_id: str
    name: str
    category: ResourceCategory
    status: ResourceAvailabilityStatus
    jurisdiction: str
    state: str | None
    source_url: str | None
    verified_on: str | None
    availability_note: str | None

    def as_dict(self) -> dict[str, str | None]:
        return {
            "resource_id": self.resource_id,
            "name": self.name,
            "category": self.category.value,
            "status": self.status.value,
            "jurisdiction": self.jurisdiction,
            "state": self.state,
            "source_url": self.source_url,
            "verified_on": self.verified_on,
            "availability_note": self.availability_note,
        }


@dataclass(frozen=True)
class SafetySupportAssessment:
    """Screening output; it is not a diagnosis or a finding of guilt."""

    context: AssessmentContext
    situations: tuple[SafetySituation, ...]
    urgency: SafetyUrgency
    trigger_evidence: tuple[TriggerEvidence, ...]
    uncertainty: tuple[str, ...]
    user_facing_safety_prompt: str | None
    evidence_preservation_guidance: tuple[str, ...]
    escalation_options: tuple[str, ...]
    resource_categories: tuple[ResourceCategory, ...]
    resources: tuple[OfficialResource, ...]
    safe_next_step_sequence: tuple[str, ...]
    language: SafetyLanguage
    workflow_disposition: WorkflowDisposition
    legal_workflow_allowed: bool
    contacted_anyone: bool = False
    support_tracks: tuple[SafetySupportTrack, ...] = ()
    resource_availability: tuple[ResourceAvailability, ...] = ()
    resource_eligibility: tuple[ResourceEligibility, ...] = ()
    women_safety_context: WomenSafetyContext | None = None

    def as_dict(self) -> dict[str, object]:
        """Return a JSON-compatible result without losing source evidence."""
        return {
            "context": self.context.value,
            "situations": [situation.value for situation in self.situations],
            "urgency": self.urgency.value,
            "trigger_evidence": [item.as_dict() for item in self.trigger_evidence],
            "uncertainty": list(self.uncertainty),
            "user_facing_safety_prompt": self.user_facing_safety_prompt,
            "evidence_preservation_guidance": list(self.evidence_preservation_guidance),
            "escalation_options": list(self.escalation_options),
            "resource_categories": [category.value for category in self.resource_categories],
            "resources": [resource.as_dict() for resource in self.resources],
            "resource_availability": [item.as_dict() for item in self.resource_availability],
            "resource_eligibility": [item.as_dict() for item in self.resource_eligibility],
            "support_tracks": [track.value for track in self.support_tracks],
            "safe_next_step_sequence": list(self.safe_next_step_sequence),
            "language": self.language.value,
            "workflow_disposition": self.workflow_disposition.value,
            "legal_workflow_allowed": self.legal_workflow_allowed,
            "contacted_anyone": self.contacted_anyone,
            "women_safety_context": (
                self.women_safety_context.as_dict() if self.women_safety_context else None
            ),
        }
