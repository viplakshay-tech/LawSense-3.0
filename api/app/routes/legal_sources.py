"""Explicit, query-only access to the free IndiaCode/eCourtsIndia source API."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import Field

from app.engines.legal_sources.india_code import (
    IndiaCodeApiAdapter,
    IndiaCodeApiError,
    OFFICIAL_VERIFICATION_PORTALS,
    jurisdiction_scope,
    official_url,
)
from app.schemas.case_analysis import AnalysisModel


router = APIRouter(prefix="/legal-sources/indiacode", tags=["legal-sources"])
_adapter = IndiaCodeApiAdapter()


class SourceProvenanceResponse(AnalysisModel):
    provider: str
    provider_kind: Literal["third_party_api"] = "third_party_api"
    provider_endpoint: str
    retrieved_at: str
    verification_status: Literal["unverified"] = "unverified"
    verification_note: str
    official_verification_portals: list[str] = Field(default_factory=list)


class IndiaCodeSearchHitResponse(AnalysisModel):
    kind: str | None = None
    title: str | None = None
    reference: str | None = None
    snippet: str | None = None
    result_use: Literal["discovery_only"] = "discovery_only"
    text_status: Literal["snippet_is_not_full_provision_text"] = "snippet_is_not_full_provision_text"
    provider_url: str | None = None
    official_source_url: str | None = None
    jurisdiction_scope: Literal["central", "state_or_ut", "unknown"] = "unknown"
    jurisdiction_raw: str | None = None
    provider_record: dict[str, Any] = Field(default_factory=dict)


class IndiaCodeSearchResponse(AnalysisModel):
    status: Literal["available"] = "available"
    query: str
    total: int | None = None
    count: int | None = None
    results: list[IndiaCodeSearchHitResponse] = Field(default_factory=list)
    source: SourceProvenanceResponse


class IndiaCodeActResponse(AnalysisModel):
    id: str | None = None
    title: str | None = None
    short_title: str | None = None
    act_number: str | None = None
    act_year: str | None = None
    ministry: str | None = None
    jurisdiction_scope: Literal["central", "state_or_ut", "unknown"] = "unknown"
    jurisdiction_raw: str | None = None
    unit: str | None = None
    section_count: int | None = None
    in_force: bool | str | None = None
    effective_or_commencement_date: str | None = None
    provider_url: str | None = None
    official_source_url: str | None = None
    verification_status: Literal["unverified"] = "unverified"
    provider_record: dict[str, Any] = Field(default_factory=dict)


class IndiaCodeActsResponse(AnalysisModel):
    status: Literal["available"] = "available"
    acts: list[IndiaCodeActResponse] = Field(default_factory=list)
    returned_count: int = 0
    result_limit: int = 100
    truncated: bool = False
    source: SourceProvenanceResponse


class IndiaCodeProvisionResponse(AnalysisModel):
    status: Literal["available"] = "available"
    act_title: str | None = None
    act_number: str | None = None
    act_year: str | None = None
    provision_unit: str
    provision_number: str | None = None
    provision_heading: str | None = None
    provision_text: str | None = None
    jurisdiction_scope: Literal["central", "state_or_ut", "unknown"] = "unknown"
    jurisdiction_raw: str | None = None
    effective_or_commencement_date: str | None = None
    provider_url: str | None = None
    official_source_url: str | None = None
    verification_status: Literal["unverified"] = "unverified"
    provider_record: dict[str, Any] = Field(default_factory=dict)
    source: SourceProvenanceResponse


def _source(data: Any) -> SourceProvenanceResponse:
    return SourceProvenanceResponse(
        provider=data.provider_name,
        provider_endpoint=data.endpoint,
        retrieved_at=data.retrieved_at.isoformat(),
        verification_note=data.verification_note,
        official_verification_portals=list(data.official_verification_portals),
    )


def _provider_url(record: dict[str, Any]) -> str | None:
    value = record.get("url")
    return value if isinstance(value, str) and value.startswith(("https://", "http://")) else None


def _jurisdiction_raw(record: dict[str, Any]) -> str | None:
    value = record.get("jurisdiction")
    return str(value) if value not in (None, "") else None


def _official_record_url(record: dict[str, Any]) -> str | None:
    for key in ("official_url", "officialUrl", "indiacode_url", "india_code_url", "gazette_url"):
        result = official_url(record.get(key))
        if result:
            return result
    candidate = record.get("url")
    return official_url(candidate)


def _first_text(record: dict[str, Any], *keys: str) -> str | None:
    for key in keys:
        value = record.get(key)
        if value is not None and value != "":
            return str(value)
    return None


def _date_field(record: dict[str, Any]) -> str | None:
    return _first_text(record, "effective_date", "effective_from", "commencement_date", "commenced_on")


def _api_failure(exc: IndiaCodeApiError) -> HTTPException:
    return HTTPException(
        status_code=503,
        detail={
            "message": str(exc),
            "fallback": "The locally curated legal library and case analysis remain available offline.",
        },
    )


@router.get("/search", response_model=IndiaCodeSearchResponse)
def search_india_code(
    q: str = Query(min_length=1, max_length=200),
    limit: int = Query(default=20, ge=1, le=100),
) -> IndiaCodeSearchResponse:
    """Search the third-party index. Search snippets are discovery-only."""
    try:
        data = _adapter.search(q, limit=limit)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except IndiaCodeApiError as exc:
        raise _api_failure(exc) from exc
    raw_results = data.payload.get("results", [])
    results = [
        IndiaCodeSearchHitResponse(
            kind=_first_text(record, "kind"),
            title=_first_text(record, "title"),
            reference=_first_text(record, "ref", "reference"),
            snippet=_first_text(record, "snippet"),
            provider_url=_provider_url(record),
            official_source_url=_official_record_url(record),
            jurisdiction_scope=jurisdiction_scope(record.get("jurisdiction")),
            jurisdiction_raw=_jurisdiction_raw(record),
            provider_record=record,
        )
        for record in raw_results
        if isinstance(record, dict)
    ] if isinstance(raw_results, list) else []
    return IndiaCodeSearchResponse(
        query=q,
        total=data.payload.get("total") if isinstance(data.payload.get("total"), int) else None,
        count=data.payload.get("count") if isinstance(data.payload.get("count"), int) else None,
        results=results,
        source=_source(data),
    )


@router.get("/acts", response_model=IndiaCodeActsResponse)
def list_india_code_acts(limit: int = Query(default=100, ge=1, le=100)) -> IndiaCodeActsResponse:
    """List text-bearing API acts; scanned /listed-acts material is excluded."""
    try:
        data = _adapter.acts()
    except IndiaCodeApiError as exc:
        raise _api_failure(exc) from exc
    raw_acts = data.payload.get("acts", [])
    acts = [
        IndiaCodeActResponse(
            id=_first_text(record, "id"),
            title=_first_text(record, "title", "short_title"),
            short_title=_first_text(record, "short_title"),
            act_number=_first_text(record, "act_number"),
            act_year=_first_text(record, "act_year"),
            ministry=_first_text(record, "ministry"),
            jurisdiction_scope=jurisdiction_scope(record.get("jurisdiction")),
            jurisdiction_raw=_jurisdiction_raw(record),
            unit=_first_text(record, "unit"),
            section_count=record.get("section_count") if isinstance(record.get("section_count"), int) else None,
            in_force=record.get("in_force") if isinstance(record.get("in_force"), (bool, str)) else None,
            effective_or_commencement_date=_date_field(record),
            provider_url=_provider_url(record),
            official_source_url=_official_record_url(record),
            provider_record=record,
        )
        for record in raw_acts
        if isinstance(record, dict)
    ][:limit] if isinstance(raw_acts, list) else []
    return IndiaCodeActsResponse(
        acts=acts,
        returned_count=len(acts),
        result_limit=limit,
        truncated=len(raw_acts) > len(acts) if isinstance(raw_acts, list) else False,
        source=_source(data),
    )


@router.get("/acts/{act_id}/{unit}/{number}", response_model=IndiaCodeProvisionResponse)
def read_india_code_provision(
    act_id: str,
    unit: Literal["section", "article", "rule"],
    number: str,
) -> IndiaCodeProvisionResponse:
    """Fetch exact provider-served provision text without promoting it to verified law."""
    try:
        data = _adapter.provision(act_id, unit, number)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except IndiaCodeApiError as exc:
        raise _api_failure(exc) from exc
    act = data.payload.get("act") if isinstance(data.payload.get("act"), dict) else {}
    provision = data.payload.get("section") if isinstance(data.payload.get("section"), dict) else {}
    jurisdiction = act.get("jurisdiction", data.payload.get("jurisdiction"))
    return IndiaCodeProvisionResponse(
        act_title=_first_text(act, "short_title", "title"),
        act_number=_first_text(act, "act_number"),
        act_year=_first_text(act, "act_year"),
        provision_unit=unit,
        provision_number=_first_text(provision, "number") or str(number),
        provision_heading=_first_text(provision, "heading"),
        provision_text=_first_text(provision, "text"),
        jurisdiction_scope=jurisdiction_scope(jurisdiction),
        jurisdiction_raw=str(jurisdiction) if jurisdiction not in (None, "") else None,
        effective_or_commencement_date=_date_field(act) or _date_field(provision),
        provider_url=_provider_url(data.payload),
        official_source_url=_official_record_url(data.payload) or _official_record_url(act),
        provider_record=data.payload,
        source=_source(data),
    )
