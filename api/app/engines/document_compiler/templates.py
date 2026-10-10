"""Small, neutral document structures with no embedded legal conclusions."""

from __future__ import annotations

from app.engines.document_compiler.models import (
    DocumentFieldTemplate,
    DocumentTemplate,
    DocumentTemplateSection,
    DocumentType,
)


def _field(
    field_id: str,
    label: str,
    *,
    required: bool = False,
    material: bool = False,
    multiline: bool = False,
) -> DocumentFieldTemplate:
    return DocumentFieldTemplate(
        id=field_id,
        label=label,
        required=required,
        material=material,
        multiline=multiline,
    )


_LETTER_FIELDS = [
    _field("sender_name", "Sender / applicant name", required=True, material=True),
    _field("sender_contact", "Sender contact details"),
    _field("recipient_name", "Recipient name or office", required=True, material=True),
    _field("recipient_address", "Recipient address"),
    _field("document_date", "Date", required=True),
    _field("subject", "Subject", required=True, material=True),
    _field("case_narrative", "Facts supplied for this document", required=True, material=True, multiline=True),
    _field("selected_case_facts", "Other selected case facts and events", material=True, multiline=True),
    _field("additional_context", "Additional context supplied by you", material=True, multiline=True),
    _field("relevant_date", "Relevant date", material=True),
    _field("claimed_amount", "Claimed amount", material=True),
    _field("deposit_amount", "Deposit amount", material=True),
    _field("requested_action", "Requested action", required=True, material=True, multiline=True),
    _field("jurisdiction", "Location / jurisdiction", material=True),
    _field("legal_text", "Legal wording with verified source", material=True, multiline=True),
    _field("signature_name", "Signature name", required=True),
]

_LETTER_SECTIONS = [
    DocumentTemplateSection(heading="Parties and document details", fieldIds=[
        "sender_name", "sender_contact", "recipient_name", "recipient_address", "document_date", "subject",
    ]),
    DocumentTemplateSection(heading="Facts and dates", fieldIds=[
        "case_narrative", "selected_case_facts", "additional_context", "relevant_date", "claimed_amount", "deposit_amount", "jurisdiction",
    ]),
    DocumentTemplateSection(heading="Your requested action", fieldIds=["requested_action"]),
    DocumentTemplateSection(heading="Legal wording supplied with a verified source", fieldIds=["legal_text"]),
    DocumentTemplateSection(heading="Signature", fieldIds=["signature_name"]),
]


DOCUMENT_TEMPLATES: tuple[DocumentTemplate, ...] = (
    DocumentTemplate(
        id="formal-demand-representation",
        documentType=DocumentType.FORMAL_DEMAND_REPRESENTATION,
        title="Formal demand / representation",
        description="A structured letter for facts, a requested action, and source-linked optional legal wording.",
        fields=_LETTER_FIELDS,
        sections=_LETTER_SECTIONS,
    ),
    DocumentTemplate(
        id="complaint-draft",
        documentType=DocumentType.COMPLAINT_DRAFT,
        title="Complaint draft",
        description="A factual complaint draft with explicit spaces for the recipient and requested action.",
        fields=_LETTER_FIELDS,
        sections=_LETTER_SECTIONS,
    ),
    DocumentTemplate(
        id="grievance-application",
        documentType=DocumentType.GRIEVANCE_APPLICATION,
        title="Grievance / application",
        description="An application structure that keeps case facts and the requested outcome traceable.",
        fields=_LETTER_FIELDS,
        sections=_LETTER_SECTIONS,
    ),
    DocumentTemplate(
        id="notice-response",
        documentType=DocumentType.NOTICE_RESPONSE,
        title="Notice response",
        description="A response structure. The notice details and response position must be supplied or mapped from the case.",
        fields=[
            _field("sender_name", "Sender name", required=True, material=True),
            _field("recipient_name", "Recipient name or office", required=True, material=True),
            _field("document_date", "Date", required=True),
            _field("notice_reference", "Notice reference", required=True, material=True),
            _field("notice_date", "Date of notice", material=True),
            _field("notice_details", "Notice details", required=True, material=True, multiline=True),
            _field("case_narrative", "Case facts relevant to this response", material=True, multiline=True),
            _field("selected_case_facts", "Other selected case facts and events", material=True, multiline=True),
            _field("additional_context", "Additional context supplied by you", material=True, multiline=True),
            _field("response_position", "Your response", required=True, material=True, multiline=True),
            _field("requested_action", "Requested action", material=True, multiline=True),
            _field("jurisdiction", "Location / jurisdiction", material=True),
            _field("legal_text", "Legal wording with verified source", material=True, multiline=True),
            _field("signature_name", "Signature name", required=True),
        ],
        sections=[
            DocumentTemplateSection(heading="Parties and notice", fieldIds=[
                "sender_name", "recipient_name", "document_date", "notice_reference", "notice_date", "jurisdiction",
            ]),
            DocumentTemplateSection(heading="Notice details and response", fieldIds=["notice_details", "case_narrative", "selected_case_facts", "additional_context", "response_position"]),
            DocumentTemplateSection(heading="Requested action", fieldIds=["requested_action"]),
            DocumentTemplateSection(heading="Legal wording supplied with a verified source", fieldIds=["legal_text"]),
            DocumentTemplateSection(heading="Signature", fieldIds=["signature_name"]),
        ],
    ),
    DocumentTemplate(
        id="supporting-statement-chronology",
        documentType=DocumentType.SUPPORTING_STATEMENT_CHRONOLOGY,
        title="Supporting statement / chronology",
        description="A statement structure and dated events from the case record, with their source status shown.",
        fields=[
            _field("declarant_name", "Declarant name", required=True, material=True),
            _field("case_narrative", "Statement supplied for this document", required=True, material=True, multiline=True),
            _field("chronology", "Chronology from recorded events", required=True, material=True, multiline=True),
            _field("selected_case_facts", "Other selected case facts", material=True, multiline=True),
            _field("additional_context", "Additional context supplied by you", material=True, multiline=True),
            _field("jurisdiction", "Location / jurisdiction", material=True),
        ],
        sections=[
            DocumentTemplateSection(heading="Declarant", fieldIds=["declarant_name", "jurisdiction"]),
            DocumentTemplateSection(heading="Statement", fieldIds=["case_narrative", "selected_case_facts", "additional_context"]),
            DocumentTemplateSection(heading="Chronology", fieldIds=["chronology"]),
        ],
    ),
    DocumentTemplate(
        id="evidence-index",
        documentType=DocumentType.EVIDENCE_INDEX,
        title="Evidence index",
        description="An index of evidence records already attached to the case; the index does not assert authenticity or truth.",
        fields=[
            _field("selected_case_facts", "Selected case facts", material=True, multiline=True),
            _field("evidence_items", "Recorded evidence items", required=True, multiline=True),
        ],
        sections=[
            DocumentTemplateSection(heading="Selected case facts", fieldIds=["selected_case_facts"]),
            DocumentTemplateSection(heading="Evidence recorded in the case", fieldIds=["evidence_items"]),
        ],
    ),
    DocumentTemplate(
        id="filing-checklist",
        documentType=DocumentType.FILING_CHECKLIST,
        title="Filing checklist",
        description="A neutral review checklist. It does not state filing rules, deadlines, fees, or legal requirements.",
        fields=[
            _field("selected_case_facts", "Selected case facts", material=True, multiline=True),
            _field("jurisdiction", "Location / jurisdiction", material=True),
            _field("checklist_items", "Review checklist", required=True, multiline=True),
            _field("missing_information", "Information still to confirm", multiline=True),
            _field("evidence_items", "Evidence recorded in the case", multiline=True),
        ],
        sections=[
            DocumentTemplateSection(heading="Selected case facts", fieldIds=["selected_case_facts"]),
            DocumentTemplateSection(heading="Case location", fieldIds=["jurisdiction"]),
            DocumentTemplateSection(heading="Review before filing", fieldIds=["checklist_items"]),
            DocumentTemplateSection(heading="Information still to confirm", fieldIds=["missing_information"]),
            DocumentTemplateSection(heading="Evidence records", fieldIds=["evidence_items"]),
        ],
    ),
)


TEMPLATE_BY_ID = {template.id: template for template in DOCUMENT_TEMPLATES}
TEMPLATE_BY_TYPE = {template.documentType: template for template in DOCUMENT_TEMPLATES}

