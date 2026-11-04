"""Persistent, human-reviewed legal source catalog metadata.

This module never fetches or verifies a source over the network. It only
validates and records review evidence supplied by an authorized maintainer.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from app.engines.legal_sources.governance_models import SourceFreshnessStatus


class SourceCatalogError(ValueError):
    """Raised when the persistent legal source catalog is invalid."""


@dataclass(frozen=True, slots=True)
class SourceCatalogRecord:
    source_id: str
    title: str
    official_url: str
    version: str
    verification_status: str
    verification_date: date | None
    verification_evidence: str | None
    retrieved_at: datetime | None
    freshness_status: SourceFreshnessStatus
    freshness_checked_at: datetime | None
    freshness_evidence: str | None


def default_source_catalog_path() -> Path:
    return Path(__file__).resolve().parents[4] / "data" / "knowledge" / "source_catalog" / "sources.json"


def _parse_date(value: Any, field_name: str) -> date | None:
    if value in (None, ""):
        return None
    if not isinstance(value, str):
        raise SourceCatalogError(f"{field_name} must be an ISO date string.")
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise SourceCatalogError(f"{field_name} must be an ISO date string.") from exc


def _parse_datetime(value: Any, field_name: str) -> datetime | None:
    if value in (None, ""):
        return None
    if not isinstance(value, str):
        raise SourceCatalogError(f"{field_name} must be an ISO datetime string.")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise SourceCatalogError(f"{field_name} must be an ISO datetime string.") from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise SourceCatalogError(f"{field_name} must include a timezone.")
    return parsed


def _parse_record(raw: Any) -> SourceCatalogRecord:
    if not isinstance(raw, dict):
        raise SourceCatalogError("Each source catalog entry must be an object.")

    source_id = raw.get("id")
    title = raw.get("title")
    official_url = raw.get("officialUrl")
    version = raw.get("version")
    if not isinstance(source_id, str) or not source_id.strip():
        raise SourceCatalogError("Every source catalog entry requires a non-empty id.")
    if not isinstance(title, str) or not title.strip():
        raise SourceCatalogError(f"{source_id}: title is required.")
    if not isinstance(official_url, str) or not official_url.strip():
        raise SourceCatalogError(f"{source_id}: officialUrl is required.")
    parsed_url = urlsplit(official_url)
    if parsed_url.scheme != "https" or not parsed_url.netloc:
        raise SourceCatalogError(f"{source_id}: officialUrl must be an absolute HTTPS URL.")
    if not isinstance(version, str) or not version.strip():
        raise SourceCatalogError(f"{source_id}: version is required.")

    verification_status = raw.get("verificationStatus", "unverified")
    if verification_status not in {"verified_official", "unverified"}:
        raise SourceCatalogError(f"{source_id}: unsupported verificationStatus.")
    verification_date = _parse_date(raw.get("verificationDate"), "verificationDate")
    verification_evidence = raw.get("verificationNote")
    if verification_evidence is not None and (
        not isinstance(verification_evidence, str) or not verification_evidence.strip()
    ):
        raise SourceCatalogError(f"{source_id}: verificationNote must be non-empty text.")
    if verification_status == "verified_official" and (
        verification_date is None or not verification_evidence
    ):
        raise SourceCatalogError(
            f"{source_id}: verified_official requires verificationDate and verificationNote."
        )

    retrieved_at = _parse_datetime(raw.get("retrievedAt"), "retrievedAt")
    try:
        freshness_status = SourceFreshnessStatus(raw.get("freshnessStatus", "unknown"))
    except ValueError as exc:
        raise SourceCatalogError(f"{source_id}: unsupported freshnessStatus.") from exc
    freshness_checked_at = _parse_datetime(raw.get("freshnessCheckedAt"), "freshnessCheckedAt")
    freshness_evidence = raw.get("freshnessEvidence")
    if freshness_evidence is not None and (
        not isinstance(freshness_evidence, str) or not freshness_evidence.strip()
    ):
        raise SourceCatalogError(f"{source_id}: freshnessEvidence must be non-empty text.")

    if freshness_status is SourceFreshnessStatus.UNKNOWN:
        if freshness_checked_at is not None or freshness_evidence is not None:
            raise SourceCatalogError(
                f"{source_id}: unknown freshness must not carry a review timestamp or evidence."
            )
    else:
        if verification_status != "verified_official":
            raise SourceCatalogError(
                f"{source_id}: freshness cannot be reviewed before source identity is verified."
            )
        if retrieved_at is None or freshness_checked_at is None or not freshness_evidence:
            raise SourceCatalogError(
                f"{source_id}: reviewed freshness requires retrievedAt, freshnessCheckedAt and freshnessEvidence."
            )
        if freshness_checked_at < retrieved_at:
            raise SourceCatalogError(
                f"{source_id}: freshnessCheckedAt cannot precede retrievedAt."
            )

    return SourceCatalogRecord(
        source_id=source_id,
        title=title,
        official_url=official_url,
        version=version.strip(),
        verification_status=verification_status,
        verification_date=verification_date,
        verification_evidence=verification_evidence.strip() if verification_evidence else None,
        retrieved_at=retrieved_at,
        freshness_status=freshness_status,
        freshness_checked_at=freshness_checked_at,
        freshness_evidence=freshness_evidence.strip() if freshness_evidence else None,
    )


def load_source_catalog(path: Path | None = None) -> dict[str, SourceCatalogRecord]:
    catalog_path = path or default_source_catalog_path()
    try:
        raw_catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SourceCatalogError(f"Unable to read legal source catalog: {catalog_path}") from exc
    if not isinstance(raw_catalog, dict) or not isinstance(raw_catalog.get("sources"), list):
        raise SourceCatalogError("Legal source catalog must contain a sources array.")

    records: dict[str, SourceCatalogRecord] = {}
    for raw in raw_catalog["sources"]:
        record = _parse_record(raw)
        if record.source_id in records:
            raise SourceCatalogError(f"Duplicate source catalog id: {record.source_id}")
        records[record.source_id] = record
    return records


def record_source_freshness_review(
    source_id: str,
    status: SourceFreshnessStatus | str,
    *,
    checked_at: datetime | str | None = None,
    evidence: str | None = None,
    retrieved_at: datetime | str | None = None,
    path: Path | None = None,
) -> SourceCatalogRecord:
    """Persist a human-entered review; this function performs no source fetch."""
    catalog_path = path or default_source_catalog_path()
    records = load_source_catalog(catalog_path)
    record = records.get(source_id)
    if record is None:
        raise SourceCatalogError(f"Unknown legal source id: {source_id}")
    if record.verification_status != "verified_official":
        raise SourceCatalogError("Verify the source identity before recording freshness.")

    try:
        freshness_status = SourceFreshnessStatus(status)
    except ValueError as exc:
        raise SourceCatalogError("Freshness status must be unknown, current or stale.") from exc

    raw_catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    raw_record = next(item for item in raw_catalog["sources"] if item["id"] == source_id)
    if freshness_status is SourceFreshnessStatus.UNKNOWN:
        raw_record["freshnessStatus"] = "unknown"
        raw_record["freshnessCheckedAt"] = None
        raw_record["freshnessEvidence"] = None
    else:
        parsed_checked_at = _parse_datetime(
            checked_at.isoformat() if isinstance(checked_at, datetime) else checked_at,
            "freshnessCheckedAt",
        )
        parsed_retrieved_at = _parse_datetime(
            retrieved_at.isoformat() if isinstance(retrieved_at, datetime) else retrieved_at,
            "retrievedAt",
        )
        if parsed_checked_at is None or parsed_retrieved_at is None:
            raise SourceCatalogError(
                "Current or stale freshness requires timezone-aware checked_at and retrieved_at values."
            )
        if parsed_checked_at < parsed_retrieved_at:
            raise SourceCatalogError("Freshness review must not precede the retrieved source snapshot.")
        if not isinstance(evidence, str) or len(evidence.strip()) < 30:
            raise SourceCatalogError("Freshness evidence must describe the review in at least 30 characters.")
        if freshness_status is SourceFreshnessStatus.CURRENT:
            raw_record["retrievedAt"] = parsed_retrieved_at.isoformat()
        raw_record["freshnessStatus"] = freshness_status.value
        raw_record["freshnessCheckedAt"] = parsed_checked_at.isoformat()
        raw_record["freshnessEvidence"] = evidence.strip()

    raw_catalog["catalogVersion"] = (
        parsed_checked_at.date().isoformat()
        if freshness_status is not SourceFreshnessStatus.UNKNOWN
        else date.today().isoformat()
    )
    temporary_path = catalog_path.with_suffix(catalog_path.suffix + ".tmp")
    temporary_path.write_text(json.dumps(raw_catalog, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    temporary_path.replace(catalog_path)
    return load_source_catalog(catalog_path)[source_id]


__all__ = [
    "SourceCatalogError",
    "SourceCatalogRecord",
    "default_source_catalog_path",
    "load_source_catalog",
    "record_source_freshness_review",
]
