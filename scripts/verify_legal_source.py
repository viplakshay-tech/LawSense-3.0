#!/usr/bin/env python3
"""Record a human-reviewed legal source identity check; never fetches sources."""

from __future__ import annotations

import argparse
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "api"))

from app.engines.legal_sources.source_catalog import (  # noqa: E402
    SourceCatalogError,
    default_source_catalog_path,
    record_source_identity_review,
)


def _calendar_date(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("Use an ISO calendar date, for example 2026-11-04.") from exc


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Record a manually completed legal-source identity review. "
            "This command does not download, compare or independently verify legal sources."
        )
    )
    parser.add_argument("--source-id", required=True, help="Exact id from source_catalog/sources.json")
    parser.add_argument("--verification-date", required=True, type=_calendar_date, help="Calendar date the official identity review was completed")
    parser.add_argument("--evidence", required=True, help="What official title, issuing authority and citation were matched")
    parser.add_argument("--catalog", type=Path, default=default_source_catalog_path())
    args = parser.parse_args()

    try:
        record = record_source_identity_review(
            args.source_id,
            verification_date=args.verification_date,
            evidence=args.evidence,
            path=args.catalog,
        )
    except SourceCatalogError as exc:
        parser.error(str(exc))

    print(f"Recorded official identity review for {record.source_id} on {record.verification_date}.")
    print(f"Freshness remains {record.freshness_status.value}; identity verification does not establish that the text is current.")
    print("This records the supplied human review only; it does not fetch or independently verify the source.")
    print(f"Catalog: {args.catalog}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
