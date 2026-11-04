# Legal source review workflow

The source catalog at `data/knowledge/source_catalog/sources.json` is the persistent source of truth for legal-source identity verification and freshness review. The backend seed reads this catalog when it builds the legal knowledge registry.

**Important:** the review command records a human review; it does not fetch, compare, or independently verify a source. Never mark a source current merely because its URL opens.

## Review procedure

1. Find the exact `id` and `officialUrl` in the source catalog.
2. Open the official primary publication. For legislation, inspect the official Act text and all relevant amendment, commencement, repeal/savings and corrigendum notifications. For State law, use the relevant State government's official publication.
3. Compare the official version with the text and provision metadata actually stored in LawSense. Check section numbering, definitions, commencement dates, amendments and whether the local source snapshot needs updating.
4. Record the exact source version and the retrieval/review times. Include what was checked and what was not checked in the evidence.
5. Commit the source catalog change and any necessary seed-text/provision corrections together. Have the review evidence checked before merging.

## Record a current review

Use this only when the local LawSense source snapshot has been retrieved from the official source and compared with the current official publication.

PowerShell example:

```powershell
python scripts/review_legal_source.py `
  --source-id "source-india-code-consumer-protection-act-2019" `
  --status current `
  --retrieved-at "2026-11-04T12:20:00+05:30" `
  --checked-at "2026-11-04T12:30:00+05:30" `
  --version "Act No. 35 of 2019; India Code record 123456789/16103" `
  --evidence "Compared the local section text with the current official India Code Act record and reviewed the applicable amendment and commencement notifications; no text difference was found."
```

For `current`, the command requires:
- a timezone-aware retrieval time for the matching official snapshot;
- a timezone-aware review-completion time;
- the exact version string that matches the local record; and
- specific evidence of what was compared.

If the official source has changed, update the local legal text/provision data and version metadata before recording it as current.

## Record a stale review

Use `--status stale` when the official source has a newer or different version than the local LawSense snapshot. Preserve the old `retrievedAt` and `version`; the evidence should identify the newer official publication and what must be updated.

```powershell
python scripts/review_legal_source.py `
  --source-id "source-india-code-code-on-wages-2019" `
  --status stale `
  --checked-at "2026-11-04T12:30:00+05:30" `
  --evidence "The official record includes a later amendment/notification not reflected in the local snapshot; the affected sections and commencement need to be reconciled."
```

## Known stale snapshot (reviewed 2026-11-04)

The catalog marks `source-india-code-code-on-wages-2019` as `stale`. The India Code consolidated PDF is labelled as on 21 November 2025 and still contains the ₹15,000/month wording in section 2(z)(d). Gazette S.O. 454(E), dated 30 January 2026, sets the supervisory-worker ceiling at ₹18,000/month. The exact Gazette PDF is recorded in the catalog's `freshnessEvidence`.

Keep this source stale until the local consolidated snapshot and affected provision metadata are updated and reviewed against the official publication. Do not infer that the separate 2025 commencement Gazette is stale; it is a distinct source record.

## Reset to unknown

If the review cannot be substantiated, clear the freshness review and keep the source unavailable for legal drafting:

```powershell
python scripts/review_legal_source.py --source-id "source-india-code-consumer-protection-act-2019" --status unknown
```

## Status meanings and safety boundaries

- `verificationStatus` / `verificationNote`: identity and official provenance of the source record.
- `freshnessStatus` / `freshnessCheckedAt` / `freshnessEvidence`: whether the local snapshot was compared with the official version at a recorded time.
- `unknown`: no defensible freshness review is recorded.
- `stale`: a mismatch or newer official version is known.
- `current`: the local snapshot was compared with the specified official version and supported by evidence.

A current source is **not** proof that the provision applies to a particular person's facts. Jurisdiction and applicability remain separate checks. PIB announcements are institutional context, not substitutes for Acts or Gazette commencement notifications. Do not mark a source current based only on a search result, a publisher landing page, or an unreviewed link.

The command performs no network access and does not change source identity verification or case-specific applicability. Legal drafting remains gated by the separate source freshness and jurisdiction checks.
