"""Conservative review rules built on document-intelligence outputs.

This layer consumes the upstream classification, page text, structured
evidence, and OCR status. It does not perform OCR or claim that a candidate is
authentic evidence or a legal conclusion.
"""

from __future__ import annotations

import hashlib
import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any, Iterable

from app.engines.document_intelligence.models import (
    DocumentProcessingStatus,
    DocumentResult,
    Evidence,
    PageText,
)
from app.engines.document_review.models import (
    DocumentReview,
    ReviewFinding,
    ReviewProvenance,
    TextLocation,
)
from app.schemas.case_state import CaseState


_PARTY_LABEL = re.compile(
    r"(?im)^\s*(?P<role>landlord|tenant|lessor|lessee|employer|employee|"
    r"buyer|seller|plaintiff|defendant|licensor|licensee|borrower|lender)"
    r"\s*[:\-]\s*(?P<name>[^\n,;]{2,100})"
)
_BETWEEN_PARTIES = re.compile(
    r"\bbetween\s+(?P<first>[^,.;\n]{2,80}?)\s+and\s+"
    r"(?P<second>[^,.;\n]{2,80})",
    re.I,
)
_IDENTIFIER = re.compile(
    r"\b(?P<label>case\s*(?:no\.?|number)|suit\s*(?:no\.?|number)|"
    r"invoice\s*(?:no\.?|number)|agreement\s*(?:no\.?|number)|"
    r"contract\s*(?:no\.?|number)|policy\s*(?:no\.?|number)|"
    r"registration\s*(?:no\.?|number)|transaction\s*(?:id|no\.?|number)|"
    r"reference\s*(?:no\.?|number)|passport\s*(?:no\.?|number)|"
    r"aadhaar|aadhar|pan)\s*[:#\-]?\s*"
    r"(?P<value>[A-Z0-9][A-Z0-9./-]{1,}[A-Z0-9])",
    re.I,
)
_CLAUSE = re.compile(
    r"\b(?P<label>clause|section|article)\s+"
    r"(?P<number>\d+(?:\.\d+)*)\b(?P<tail>[^\n]{0,900})",
    re.I,
)
_OBLIGATION = re.compile(
    r"\b(?:shall\s+(?:not\s+)?\w+|must\s+(?:not\s+)?\w+|"
    r"required\s+to\s+\w+|agrees?\s+to\s+\w+|undertakes?\s+to\s+\w+|"
    r"is\s+obligated\s+to\s+\w+|will\s+(?:pay|deliver|provide|return|give|submit))\b",
    re.I,
)
_NOTICE = re.compile(
    r"\b(?:legal notice|notice to vacate|notice period|notice of termination|"
    r"notice of breach|written notice|served notice|notice is hereby given)\b",
    re.I,
)
_IMPORTANT_TERM = re.compile(
    r"\b(?:security deposit|deposit|rent|termination|renewal|confidentiality|"
    r"indemnity|governing law|jurisdiction|notice period|late fee|interest|"
    r"arbitration|force majeure|liability|warranty|effective date|consideration|"
    r"payment terms|non.?compete|intellectual property)\b",
    re.I,
)
_EVIDENCE_MARKER = re.compile(
    r"\b(?:signature|signed|witness(?:es)?|seal|stamp|receipt|proof of payment|"
    r"annexure|exhibit|attachment|email|e-?mail|WhatsApp message|photograph|"
    r"bank statement|acknowledg(?:e)?ment)\b",
    re.I,
)
_SENTENCE = re.compile(r"[^.!?;\r\n]+(?:[.!?;]+|$)", re.M)
_TARGET_CATEGORIES = (
    "party",
    "date",
    "amount",
    "identifier",
    "clause",
    "obligation",
    "notice",
    "important_term",
    "evidence_candidate",
)


def review_document(
    result: DocumentResult,
    case_state: CaseState | None = None,
) -> DocumentReview:
    """Build higher-level findings from a document-intelligence result.

    Upstream structured fields are copied from ``result.evidence`` rather
    than re-extracted. Additional rules only inspect available page text.
    OCR-required pages stay empty and produce explicit uncertainty findings.
    """
    findings: list[ReviewFinding] = []
    pages = {page.page_number: page for page in result.pages}

    type_provenance = _classification_provenance(result)
    findings.append(
        _finding(
            result.document_id,
            "document_type",
            result.classification.category,
            result.classification.signals[0] if result.classification.signals else None,
            type_provenance,
            result.classification.confidence,
            "interpretation",
            "uncertain" if result.classification.category == "unknown" else "candidate",
            "Classification is a text-based category, not a verified legal characterization."
            if result.classification.category != "unknown"
            else "No document type was classified from the available extracted text.",
        )
    )

    # Preserve the upstream extractor's values, confidence, page, and method.
    for item in result.evidence:
        page = pages.get(item.page_number)
        location = _locate_evidence(item, page)
        provenance = ReviewProvenance(
            source="document",
            document_id=result.document_id,
            page_number=item.page_number,
            location=location,
            extraction_method=item.extraction_method,
            text=item.text,
        )
        findings.append(
            _finding(
                result.document_id,
                _evidence_category(item),
                item.value,
                item.text,
                (provenance,),
                item.confidence,
                "extraction",
                "extracted",
                f"Reused document_intelligence field '{item.field}'.",
                upstream_status=item.status.value,
            )
        )

    readable_pages = [page for page in result.pages if page.text.strip()]
    for page in readable_pages:
        findings.extend(_extract_page_findings(result.document_id, page))

    findings.extend(_page_processing_findings(result))

    # Report coverage gaps only when page text exists to inspect. If no text is
    # available, the explicit OCR/status finding above is more accurate.
    if readable_pages:
        present = {_coverage_category(item.category) for item in findings}
        for category in _TARGET_CATEGORIES:
            if category in present:
                continue
            findings.append(
                _finding(
                    result.document_id,
                    "extraction_gap",
                    {"category": category, "result": "not_found_in_available_text"},
                    None,
                    (ReviewProvenance(source="document", document_id=result.document_id),),
                    0.35,
                    "interpretation",
                    "uncertain",
                    "No matching text was found by the review rules; this does not establish that the item is absent from the document.",
                )
            )

    if case_state is not None:
        findings.extend(_find_conflicts(result, findings, case_state))

    return DocumentReview(
        document_id=result.document_id,
        findings=tuple(findings),
        processing_status=str(result.status),
        errors=tuple(result.errors),
    )


def _extract_page_findings(document_id: str, page: PageText) -> list[ReviewFinding]:
    text = page.text
    output: list[ReviewFinding] = []

    for match in _PARTY_LABEL.finditer(text):
        name = _clean_party_name(match.group("name"))
        if name:
            output.append(
                _text_finding(
                    document_id, page, "party", {"role": match.group("role").casefold(), "name": name},
                    match.start("name"), match.end("name"), 0.83, "extraction", "extracted",
                    "Role and name follow an explicit role label in the document text.",
                )
            )

    for match in _BETWEEN_PARTIES.finditer(text):
        first = _clean_party_name(match.group("first"))
        second = _clean_party_name(match.group("second"))
        if first and second:
            for key, value, start_group, end_group in (
                ("first", first, "first", "first"), ("second", second, "second", "second")
            ):
                output.append(
                    _text_finding(
                        document_id, page, "party", {"role": "party", "name": value},
                        match.start(start_group), match.end(end_group), 0.72, "extraction", "candidate",
                        "A name-like value appears in an explicit 'between ... and ...' phrase; party roles are not stated by this match.",
                    )
                )

    for match in _IDENTIFIER.finditer(text):
        label = " ".join(match.group("label").casefold().split())
        output.append(
            _text_finding(
                document_id, page, "identifier", {"label": label, "value": match.group("value")},
                match.start(), match.end(), 0.84, "extraction", "extracted",
                "Identifier copied from text following an explicit identifier label.",
            )
        )

    for match in _CLAUSE.finditer(text):
        end = _bounded_text_end(text, match.end(), 900)
        excerpt = text[match.start():end].strip()
        output.append(
            _text_finding(
                document_id, page, "clause",
                {"reference": f"{match.group('label').casefold()} {match.group('number')}", "text": excerpt},
                match.start(), end, 0.78, "extraction", "candidate",
                "Text follows an explicit clause, section, or article reference; legal effect is not determined.",
            )
        )

    for sentence_match in _SENTENCE.finditer(text):
        sentence = sentence_match.group(0).strip()
        if not sentence:
            continue
        sentence_start = sentence_match.start() + len(sentence_match.group(0)) - len(sentence_match.group(0).lstrip())
        sentence_end = sentence_start + len(sentence)
        if _OBLIGATION.search(sentence):
            output.append(
                _text_finding(
                    document_id, page, "obligation", sentence, sentence_start, sentence_end,
                    0.78, "interpretation", "candidate",
                    "The sentence contains explicit mandatory or undertaking language; enforceability is not assessed.",
                )
            )
        if _NOTICE.search(sentence):
            output.append(
                _text_finding(
                    document_id, page, "notice", sentence, sentence_start, sentence_end,
                    0.77, "interpretation", "candidate",
                    "The text explicitly refers to a notice; issuance, delivery, and legal sufficiency are not verified.",
                )
            )

    for pattern, category, note in (
        (_IMPORTANT_TERM, "important_term", "Term selected by a conservative review keyword rule; context should be reviewed."),
        (_EVIDENCE_MARKER, "evidence_candidate", "Document text mentions a possible evidence type or marker; this does not verify an attached item or its authenticity."),
    ):
        for match in pattern.finditer(text):
            start = match.start()
            end = match.end()
            output.append(
                _text_finding(
                    document_id, page, category, match.group(0), start, end,
                    0.66, "interpretation", "candidate", note,
                )
            )
    return output


def _page_processing_findings(result: DocumentResult) -> list[ReviewFinding]:
    output: list[ReviewFinding] = []
    errors_by_page: dict[int, list[str]] = {}
    for error in result.errors:
        match = re.match(r"Page\s+(\d+)\s*:\s*(.*)", error, re.I)
        if match:
            errors_by_page.setdefault(int(match.group(1)), []).append(match.group(2))

    for page in result.pages:
        if page.status in {DocumentProcessingStatus.OCR_REQUIRED, DocumentProcessingStatus.FAILED}:
            messages = errors_by_page.get(page.page_number, [])
            if page.status == DocumentProcessingStatus.OCR_REQUIRED:
                outcome = "ocr_required"
                fallback = "OCR is required for this page, but no extracted text is available."
            else:
                outcome = "failed"
                fallback = "Page processing failed; no extracted text is available."
            note = "; ".join(messages) or fallback
            provenance = ReviewProvenance(
                source="document", document_id=result.document_id,
                page_number=page.page_number,
                extraction_method=page.extraction_method,
                text=None,
            )
            output.append(
                _finding(
                    result.document_id, "extraction_gap",
                    {"category": "page_text", "result": outcome, "page_number": page.page_number},
                    None, (provenance,), 0.0, "interpretation", "uncertain", note,
                )
            )
    if result.status == DocumentProcessingStatus.FAILED and not output:
        output.append(
            _finding(
                result.document_id, "extraction_gap", {"category": "document", "result": "failed"},
                None, (ReviewProvenance(source="document", document_id=result.document_id),),
                0.0, "interpretation", "uncertain", "; ".join(result.errors) or "Document processing failed.",
            )
        )
    return output


def _find_conflicts(
    result: DocumentResult,
    current_findings: Iterable[ReviewFinding],
    case_state: CaseState,
) -> list[ReviewFinding]:
    findings = list(current_findings)
    conflicts: list[ReviewFinding] = []
    doc_amounts = _unique_numeric_values(
        item.value for item in findings if item.category == "amount" and item.nature == "extraction"
    )
    case_amounts = _unique_numeric_values(
        fact.value for fact in case_state.facts if fact.key.casefold() in {"amount_inr", "amount", "rent", "deposit"}
    )
    if len(doc_amounts) == len(case_amounts) == 1 and doc_amounts[0] != case_amounts[0]:
        document_finding = next(
            item for item in findings if item.category == "amount" and _numeric(item.value) == doc_amounts[0]
        )
        conflicts.append(
            _conflict_finding(
                result, case_state, "amount", doc_amounts[0], case_amounts[0], document_finding,
                "A single document amount differs from the single comparable CaseState amount; amounts may refer to different events or purposes.",
            )
        )

    doc_dates = _unique_date_values(
        item.value for item in findings if item.category == "date" and item.nature == "extraction"
    )
    case_dates = _unique_date_values(
        event.date for event in case_state.events if event.date and event.datePrecision == "exact"
    )
    if len(doc_dates) == len(case_dates) == 1 and doc_dates[0] != case_dates[0]:
        document_finding = next(
            item for item in findings
            if item.category == "date" and _normalize_date(item.value) == doc_dates[0]
        )
        conflicts.append(
            _conflict_finding(
                result, case_state, "date", doc_dates[0].isoformat(), case_dates[0].isoformat(), document_finding,
                "A single exact document date differs from the single exact CaseState event date; confirm both dates describe the same event.",
            )
        )

    doc_parties = [
        item for item in findings
        if item.category == "party" and isinstance(item.value, dict) and item.value.get("role") != "party"
    ]
    for role in {str(item.value.get("role", "")).casefold() for item in doc_parties}:
        matching_documents = [item for item in doc_parties if str(item.value.get("role", "")).casefold() == role]
        matching_cases = [party for party in case_state.parties if party.role.casefold() == role and party.name]
        if len(matching_documents) == len(matching_cases) == 1:
            document_name = str(matching_documents[0].value.get("name", ""))
            case_name = str(matching_cases[0].name or "")
            if _normalize_name(document_name) != _normalize_name(case_name):
                conflicts.append(
                    _conflict_finding(
                        result, case_state, f"party:{role}", document_name, case_name, matching_documents[0],
                        "The one explicitly labeled document party differs from the one CaseState party with the same role; identity and role mapping need review.",
                    )
                )

    for finding in findings:
        if finding.category != "identifier" or not isinstance(finding.value, dict):
            continue
        label = _identifier_key(str(finding.value.get("label", "")))
        doc_value = str(finding.value.get("value", ""))
        matching_facts = [
            fact for fact in case_state.facts
            if _identifier_key(fact.key) == label and fact.value is not None
        ]
        if len(matching_facts) == 1 and _normalize_identifier(str(matching_facts[0].value)) != _normalize_identifier(doc_value):
            conflicts.append(
                _conflict_finding(
                    result, case_state, f"identifier:{label}", doc_value, str(matching_facts[0].value), finding,
                    "An identifier differs from a CaseState fact with a matching normalized key; verify the field mapping and source.",
                )
            )
    return conflicts


def _conflict_finding(
    result: DocumentResult,
    case_state: CaseState,
    field: str,
    document_value: Any,
    case_value: Any,
    document_finding: ReviewFinding,
    note: str,
) -> ReviewFinding:
    case_confidence = 0.65
    return _finding(
        result.document_id,
        "conflict",
        {"field": field, "document_value": document_value, "case_state_value": case_value},
        document_finding.text,
        (*document_finding.provenance, ReviewProvenance(source="case_state", case_state_id=case_state.id)),
        min(document_finding.confidence, case_confidence),
        "interpretation",
        "potential_conflict",
        note,
    )


def _classification_provenance(result: DocumentResult) -> tuple[ReviewProvenance, ...]:
    for signal in result.classification.signals:
        for page in result.pages:
            start = page.text.casefold().find(signal.casefold())
            if start >= 0:
                return (
                    ReviewProvenance(
                        source="document", document_id=result.document_id,
                        page_number=page.page_number,
                        location=TextLocation(start, start + len(signal)),
                        extraction_method=page.extraction_method,
                        text=signal,
                    ),
                )
    return (ReviewProvenance(source="document", document_id=result.document_id),)


def _text_finding(
    document_id: str,
    page: PageText,
    category: str,
    value: Any,
    start: int,
    end: int,
    confidence: float,
    nature: str,
    status: str,
    note: str,
) -> ReviewFinding:
    source_text = page.text[start:end]
    provenance = ReviewProvenance(
        source="document",
        document_id=document_id,
        page_number=page.page_number,
        location=TextLocation(start, end),
        extraction_method=page.extraction_method,
        text=source_text,
    )
    return _finding(
        document_id, category, value, source_text, (provenance,), confidence, nature, status, note
    )


def _finding(
    document_id: str,
    category: str,
    value: Any,
    text: str | None,
    provenance: tuple[ReviewProvenance, ...],
    confidence: float,
    nature: str,
    status: str,
    note: str | None,
    *,
    upstream_status: str | None = None,
) -> ReviewFinding:
    identity = repr((category, value, text, provenance, nature, status))
    finding_id = hashlib.sha256(f"{document_id}|{identity}".encode("utf-8")).hexdigest()[:24]
    return ReviewFinding(
        id=f"finding_{finding_id}",
        category=category,
        value=value,
        text=text,
        source="+".join(dict.fromkeys(item.source for item in provenance)),
        provenance=provenance,
        confidence=max(0.0, min(1.0, float(confidence))),
        nature=nature,  # type: ignore[arg-type]
        status=status,  # type: ignore[arg-type]
        note=note,
        upstream_status=upstream_status,
    )


def _locate_evidence(item: Evidence, page: PageText | None) -> TextLocation | None:
    if page is None or not page.text:
        return None
    if item.text:
        start = page.text.find(item.text)
        if start >= 0:
            return TextLocation(start, start + len(item.text))
    literal = str(item.value)
    if literal:
        start = page.text.find(literal)
        if start >= 0:
            return TextLocation(start, start + len(literal))
    # Amount values from the upstream extractor are normalized (commas removed).
    if item.field == "amount":
        for match in re.finditer(
            r"(?<!\d)\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|"
            r"(?<!\d)\d+(?:\.\d{1,2})?(?!\d)",
            page.text,
        ):
            if _numeric(match.group(0)) == _numeric(literal):
                return TextLocation(match.start(), match.end())
    return None


def _evidence_category(item: Evidence) -> str:
    if item.field in {"amount", "currency"}:
        return "amount"
    if item.field.casefold() in {"date", "identifier", "party", "clause", "obligation", "notice"}:
        return item.field.casefold()
    return item.field


def _coverage_category(category: str) -> str:
    return category


def _clean_party_name(value: str) -> str:
    cleaned = re.sub(r"\s+", " ", value).strip(" \t:-–—")
    cleaned = re.sub(r"^(?:the\s+)?(?:parties|following parties)\s+", "", cleaned, flags=re.I)
    return cleaned[:100].strip()


def _bounded_text_end(text: str, start: int, limit: int) -> int:
    end = min(len(text), start + limit)
    boundary = re.search(r"[.!?](?:\s|$)|\r?\n", text[start:end])
    return start + boundary.end() if boundary else end


def _unique_numeric_values(values: Iterable[Any]) -> list[Decimal]:
    unique: list[Decimal] = []
    for value in values:
        normalized = _numeric(value)
        if normalized is not None and normalized not in unique:
            unique.append(normalized)
    return unique


def _numeric(value: Any) -> Decimal | None:
    if isinstance(value, dict):
        value = value.get("amount", value.get("value"))
    try:
        return Decimal(str(value).replace(",", "").strip())
    except (InvalidOperation, ValueError):
        return None


def _unique_date_values(values: Iterable[Any]) -> list[date]:
    unique: list[date] = []
    for value in values:
        normalized = _normalize_date(value)
        if normalized is not None and normalized not in unique:
            unique.append(normalized)
    return unique


def _normalize_date(value: Any) -> date | None:
    if not isinstance(value, str):
        return None
    text = value.strip().rstrip(",")
    for fmt in ("%Y-%m-%d", "%B %d, %Y", "%B %d %Y", "%b %d, %Y", "%b %d %Y", "%d %B %Y", "%d %b %Y"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


def _normalize_name(value: str) -> str:
    return " ".join(value.casefold().split()).strip(" .,")


def _identifier_key(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "", value.casefold())
    return normalized.removesuffix("no").removesuffix("number")


def _normalize_identifier(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.casefold())
