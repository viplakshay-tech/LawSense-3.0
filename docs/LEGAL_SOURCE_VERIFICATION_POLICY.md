# Legal-source verification and advisory safety policy

This policy describes what LawSense source metadata does and does not establish. It is an engineering control, not a legal opinion.

## 1. Keep the assessments separate

LawSense must not collapse these questions into one boolean:

1. **Identity and origin:** Is this the exact source published by the named authority?
2. **Version and freshness:** Is this the relevant text, with amendments and supersession accounted for as of the requested date?
3. **Commencement and force:** Has the provision actually commenced, and is it currently in force?
4. **Territorial jurisdiction:** Does the source apply in the relevant State/UT, district, court, or other jurisdiction?
5. **Case applicability:** Do the user's facts satisfy the legal conditions and exceptions?

A positive answer to one question does not answer the others.

## 2. Meaning of the existing status fields

- `KnowledgeStatus.VERIFIED` is a recorded review state for a curated knowledge record. It is not a live network check and does not, by itself, establish current force or case applicability.
- `SourceAuthorityTier` ranks the kind of publisher. An official publisher does not make every linked document current or applicable.
- The provider-neutral governance model deliberately keeps verification, freshness, and applicability as separate fields. Retrieval updates retrieval facts only; it must not promote a source to verified, current, or applicable.
- The registry's `is_authoritative` result is a source-quality classification, not a legal conclusion that a provision governs a user's case.
- The IndiaCode/eCourtsIndia API adapter is a third-party discovery interface. Its results remain `unverified` and `discovery_only`; snippets are not full statutory text.

## 3. Current seed limitations that must remain visible

- The curated seed contains a small number of selected Acts, notices, and provisions. It is not a complete Indian law corpus.
- The Uttarakhand Tenancy Act record expressly does not establish commencement under section 1(3). Its security-deposit summary must not be presented as operative law until the relevant State Gazette commencement notification and current status are checked.
- The Code on Wages commencement record relies on the cited Gazette notification. Any later amendment, stay, replacement, or subsequent notification still requires a date-specific check.
- The catalog's `verificationDate` is a recorded project review date, not proof that the URL was checked during the current request.
- Registry snapshots may record an explicit freshness status, review timestamp and evidence. `current` or `stale` requires both a timezone-aware review timestamp and non-empty evidence; retrieval time alone leaves freshness `unknown`.
- A missing commencement date must remain unknown; do not infer it from an enactment date, upload date, or third-party API result.

## 4. Advisory-use gate

Before a provision is used to support a case-specific advisory, the system should require:

- a resolvable source, authority, jurisdiction, and version snapshot;
- a direct official source locator and a precise provision reference;
- date-aware version and commencement review;
- no unresolved stale, withdrawn, superseded, or unverified status;
- a jurisdiction match; and
- a separate human/fact-based applicability review.

If any required element is missing or contradictory, show the missing item and withhold the legal conclusion. The interface may still show a clearly labelled research lead, official portal, or question to clarify.

## 5. Confidence values

Do not attach a numeric probability to a legal summary merely because it has an official citation. A numeric confidence score may be shown only when its meaning, calibration method, inputs, and limitations are defined and tested. Until then, omit the score and communicate uncertainty in plain language.

## 6. Required presentation

When showing legal material, distinguish:

- source identity / authority;
- provision and version;
- publication and effective/commencement dates (or explicitly unknown);
- jurisdiction;
- last recorded retrieval/review time;
- official source link;
- verification and applicability state; and
- why the material is or is not being used for the current case.

Never describe a third-party discovery result as an official verified source. Never imply that a portal's existence verifies the content of every record linked from it.
