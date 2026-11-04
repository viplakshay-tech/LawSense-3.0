#!/usr/bin/env python3
"""Record a human-reviewed legal source freshness assessment; never fetches sources."""

from __future__ import annotations

import argparse
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "api"))

from app.engines.legal_sources.source_catalog import (  # noqa: E402
    SourceCatalogError,
    default_source_catalog_path,
    record_source_freshness_review,
)


def _aware_datetime(value: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise argparse.ArgumentTypeError("Use an ISO-8601 datetime, for example 2026-11-04T12:30:00+05:30.") from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise argparse.ArgumentTypeError("The datetime must include a timezone offset.")
    return parsed


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Record a manually completed legal-source freshness review. "
            "This command does not download, compare or verify legal sources."
        )
    )
    parser.add_argument("--source-id", required=True, help="Exact id from source_catalog/sources.json")
    parser.add_argument("--status", required=True, choices=("current", "stale", "unknown"))
    parser.add_argument("--checked-at", type=_aware_datetime, help="Timezone-aware time the review was completed")
    parser.add_argument("--evidence", help="What official text, amendments, commencement and version were checked")
    parser.add_argument("--retrieved-at", type=_aware_datetime, help="Required for current: time the matching official snapshot was retrieved")
    parser.add_argument("--version", help="Required for current: exact source snapshot/version that matches the local record")
    parser.add_argument("--catalog", type=Path, default=default_source_catalog_path())
    args = parser.parse_args()

    if args.status == "unknown":
        if any((args.checked_at, args.evidence, args.retrieved_at, args.version)):
            parser.error("For --status unknown, omit --checked-at, --evidence, --retrieved-at and --version.")
    else:
        if args.checked_at is None or not args.evidence:
            parser.error("For current/stale, provide --checked-at and --evidence.")
        if args.status == "current" and (args.retrieved_at is None or not args.version):
            parser.error("For current, provide --retrieved-at and --version after comparing the official snapshot.")
        if args.status == "stale" and (args.retrieved_at is not None or args.version is not None):
            parser.error("For stale, preserve the old snapshot version; omit --retrieved-at and --version.")

    try:
        record = record_source_freshness_review(
            args.source_id,
            args.status,
            checked_at=args.checked_at,
            evidence=args.evidence,
            retrieved_at=args.retrieved_at,
            version=args.version,
            path=args.catalog,
        )
    except SourceCatalogError as exc:
        parser.error(str(exc))

    print(f"Recorded {record.freshness_status.value} freshness for {record.source_id}.")
    print("This records the supplied human review only; it does not fetch or independently verify the source.")
    print(f"Catalog: {args.catalog}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
