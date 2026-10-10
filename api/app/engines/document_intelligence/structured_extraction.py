"""Deterministic initial field extraction and its future-provider interface."""

from __future__ import annotations

import re
from typing import Protocol

from app.engines.document_intelligence.models import Evidence, EvidenceStatus, PageText


class StructuredExtractor(Protocol):
    """Adapter contract for deterministic rules or a future local extractor.

    Implementations can add names, addresses, document numbers, organization
    names, clauses, signature/stamp observations, and payment references by
    returning additional ``Evidence`` records with the same provenance shape.
    """

    def extract(self, *, document_id: str, page: PageText) -> list[Evidence]:
        """Return values with page-level source and extraction provenance."""


_AMOUNT = re.compile(
    r"(?<![\w])(?:(?P<currency>INR|Rs\.?|₹)\s*)"
    r"(?P<amount>\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)"
    r"|\b(?:amount|total|rent|deposit|salary|paid)\s*(?:is|of|:|=)?\s*"
    r"(?P<labelled>\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)",
    re.I,
)
_DATES = re.compile(
    r"\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{4}|"
    r"(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|"
    r"Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|"
    r"Dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?[,]?\s+\d{4})\b",
    re.I,
)


class RuleBasedExtractor:
    def extract(self, *, document_id: str, page: PageText) -> list[Evidence]:
        if not page.text.strip():
            return []
        evidence: list[Evidence] = []
        for match in _AMOUNT.finditer(page.text):
            raw_amount = match.group("amount") or match.group("labelled")
            normalized = raw_amount.replace(",", "")
            excerpt = _context(page.text, match.start(), match.end())
            evidence.append(
                Evidence(
                    document_id=document_id,
                    page_number=page.page_number,
                    text=excerpt,
                    field="amount",
                    value=normalized,
                    confidence=0.88,
                    source="document",
                    status=EvidenceStatus.EVIDENCE_SUPPORTED,
                    extraction_method=page.extraction_method,
                )
            )
            if match.group("currency"):
                evidence.append(
                    Evidence(
                        document_id=document_id,
                        page_number=page.page_number,
                        text=excerpt,
                        field="currency",
                        value="INR",
                        confidence=0.86,
                        source="document",
                        status=EvidenceStatus.EVIDENCE_SUPPORTED,
                        extraction_method=page.extraction_method,
                    )
                )

        for match in _DATES.finditer(page.text):
            evidence.append(
                Evidence(
                    document_id=document_id,
                    page_number=page.page_number,
                    text=_context(page.text, match.start(), match.end()),
                    field="date",
                    value=match.group(0).rstrip(","),
                    confidence=0.86,
                    source="document",
                    status=EvidenceStatus.EVIDENCE_SUPPORTED,
                    extraction_method=page.extraction_method,
                )
            )
        return evidence


def _context(text: str, start: int, end: int, padding: int = 60) -> str:
    return " ".join(text[max(0, start - padding) : min(len(text), end + padding)].split())
