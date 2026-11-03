# LawSense Guide Agent — Integration Contract

**Status:** Architecture contract and compatibility audit. This document defines the boundaries for the next implementation phase; it does not claim that the unified agent or standalone Android application is already complete.

## 1. Product contract

The Guide is the user's interactive control layer for LawSense, not a general-purpose chatbot and not an autonomous legal decision-maker.

The experience combines:

- An expressive, illustrated female Guide avatar in the dedicated Guide workspace.
- A functional workspace beside the Guide: conversation, case-state context, evidence, legal grounding, journey, document preparation and approved actions.
- Text and voice as two input/output modes of the same conversation. The user can switch modes at any time without losing the active turn, reviewed transcript or available context.
- A persistent, case-aware control surface across ordinary case routes, without repeating decorative avatar artwork across every page.
- A quick, clearly visible **Legal Advisory — based on information so far** path. It must use the current case record, show missing/conflicting information and source status, and say when no responsible advisory can yet be produced.

The user-facing camera remains off and is never requested by default. Microphone capture begins only after an explicit user action. The avatar is a presentation adapter; it does not own legal reasoning, case facts or permissions.

## 2. Current implementation audit

The integration branch already provides useful foundations:

- `CaseStateProvider` supplies the canonical case record and revision.
- `GuideRuntimeProvider` derives Guide state and a typed action list from that record.
- `components/guide-actions` validates and executes a constrained command set.
- `GuidePresence` renders runtime state through an avatar adapter and respects reduced-motion preferences.
- `/guide/chat` can call a configured loopback Ollama service. It has no cloud fallback and receives a bounded case context.
- Guide chat may propose only actions supplied by the frontend allowlist. The user must click to execute a proposal.
- The voice route retains its own microphone capture, transcript review, confirmation and playback lifecycle; confirmed turns, language and a monotonic request sequence are shared with the floating text Guide through the case-scoped session. A newer request or session clear invalidates older pending responses across modes.
- `OPEN_DRAFTING` opens the active case's existing document studio only after user approval.
- `SHOW_LEGAL_GROUNDING` focuses one exact source record when unambiguous; with zero or multiple candidate records, it opens the persistent Legal Advisory for the active case.
- `OPEN_LEGAL_ADVISORY` is a distinct, always-available, read-only action for opening the existing case-scoped Legal Advisory; it does not create or approve advice.
- The case-level Guide action adapter supports read-only document finding focus when both a finding ID and an active-case document ID are supplied, plus Legal Twin node focus and timeline snapshot navigation through validated `?focus=` and `?at=` deep links. The document review page verifies that the finding exists before selecting it; the Twin checks requested nodes against the returned projection. These actions do not mutate CaseState.

Important gaps confirmed by the current code:

1. Confirmed turns and language are shared between the floating text Guide and dedicated voice workspace in case-scoped `sessionStorage`; active microphone capture and unreviewed transcript drafts remain route-local.
2. The shared session survives route changes and page refresh within the same browser tab, but is not durable across tabs/devices or stored as a canonical case record.
3. Voice capture, transcript review and case mutation are implemented as a separate workflow. They are not yet a mode adapter over the same agent turn/session.
4. The current action registry is navigation and read-only inspection, including validated document finding and Legal Twin node/time deep links. It does not constitute unrestricted app control or permission to change facts, evidence, documents or case records.
5. The local assistant is an optional laptop/Ollama integration. It is not an embedded Android model or a standalone phone runtime.
6. The current Capacitor APK is a connection shell that relies on a computer-hosted frontend/API. It is not the requested standalone, cable-free Android application.

These gaps must remain visible in product status and release notes. Do not describe the current Guide as a fully unified autonomous agent.

## 3. Layered architecture and ownership

| Layer | Owns | Must not own |
|---|---|---|
| Guide experience | Layout, avatar presentation, text/voice controls, status, accessible interaction | Legal conclusions, canonical facts, permission decisions |
| Agent session controller | Turn lifecycle, shared text/voice session, bounded conversation context, cancellation and retry | Direct database writes or source verification |
| Local model adapter | Optional local-language response and structured action proposal | Authority to execute actions or establish legal truth |
| Legal intelligence | Source retrieval, provenance, jurisdiction, effective dates, applicability checks and advisory status | Unverified model-generated citations |
| Case-state service | Canonical facts, claims, evidence, documents, unknowns, assumptions, conflicts and revisions | Silent promotion of model suggestions into confirmed facts |
| Action policy/bridge | Typed action allowlist, availability checks, confirmation and execution result | Arbitrary code execution or bypassing user approval |
| Document service | Draft generation, review, versioning and explicit export | Silent signing, filing, sending or external submission |
| Local data/platform adapter | App-private database/files, retention, deletion and provider availability | Cloud fallback or LAN-exposed API by default |

The existing `GuideRuntimeProvider`, `createGuideRuntime`, action registry and bridge should be reused where they satisfy this contract. Avoid introducing a second canonical case model or a second legal-reasoning engine.

## 4. Shared turn/session contract

Text and voice must call the same agent-session interface. Input modality is metadata, not a separate conversation product.

A logical turn should carry:

- `sessionId`, `caseId`, `turnId`, and a monotonic client request sequence.
- `inputMode`: `text` or `voice`.
- `language`: `english`, `hindi`, or `hinglish` (plus `auto` only where the provider supports it).
- User-provided text/transcript and its capture/provider metadata where relevant.
- A bounded prior-turn window with explicit untrusted-context treatment.
- A read-only snapshot of the current case revision and its information-status distinctions.
- The current server-approved action allowlist.
- A response containing user-facing text, status/provider metadata, optional structured action proposal and source references when supplied by legal services.

The session controller must reject stale responses after a newer turn, case switch, cancellation or session reset. It must not let browser-supplied history or model output override system rules, source status, case ownership or action policy.

### Mode switching

- Switching text to voice or voice to text preserves the active session and confirmed conversation turns.
- An in-progress microphone capture can be paused/stopped before mode switching; an unreviewed transcript remains an editable draft.
- Speech output can be interrupted at any time without deleting the text response.
- If a device/provider cannot support voice, typed interaction remains available and the provider status is explicit.
- A route change must not silently submit a transcript or mutate the case.

### Conversation retention

Conversation text is not automatically a case fact. The active session may retain the minimum context needed to switch modes and navigate routes. Any longer-term save/attach-to-case behavior must be an explicit, user-visible action with a clear retention/deletion rule. The canonical case record remains separate.

## 5. Action and permission contract

All agent actions use a closed, typed registry. Every action is checked against the current case, current route and current policy immediately before execution.

### Safe without a case mutation

- Navigate to an existing case section.
- Open evidence, legal grounding, journey, Legal Twin, safety resources or document studio.
- Read back an existing case summary.
- Ask the user a clarification question.
- Offer a legal-advisory view using already available information.

### Requires explicit confirmation and a reviewable preview

- Add or amend a case statement/fact.
- Attach, replace or delete evidence/documents.
- Accept extracted findings as user-confirmed facts.
- Generate or materially revise a document draft using case data.
- Export, print, share or submit a document.
- Delete a case or change privacy/retention settings.

The model may propose an action, but it cannot grant itself permission. The frontend must display the action and its consequences, the user must confirm, and the action bridge must revalidate the proposal. Destructive or external actions require a separate confirmation appropriate to their impact.

No silent contact with police, family, employers, lawyers or other third parties. No autonomous filing, signing, payment or external submission.

## 6. Legal advisory contract

The Guide must distinguish these outputs:

1. **Information summary:** what the user reported and what the current record contains.
2. **Clarification:** facts or documents still needed.
3. **Legal-source context:** candidate laws/rules/orders with official source links, jurisdiction and effective-date/verification metadata.
4. **Possible routes:** options and prerequisites returned by the deterministic legal/journey services.
5. **Advisory status:** whether the available information is sufficient for a responsible, limited next-step advisory.

The advisory view must always be reachable from the current case context using the label **Legal Advisory — based on information so far**. It must refresh against the latest case revision and show when it was generated.

Do not invent statutory sections, case law, official links, helplines, confidence percentages or legal outcomes. A numeric confidence is shown only when a documented and calibrated method supplies it; otherwise use a plain status such as `insufficient information`, `source not verified`, or `no advisory possible yet`. A language model's self-reported confidence is not a calibrated confidence score.

If sources are missing, stale, conflicting or not jurisdictionally applicable, say so and avoid presenting a definitive legal conclusion. Keep professional review and official verification visible.

## 7. Document workflow contract

The Guide may help the user reach document drafting and prepare a draft from reviewed case information. Before a draft is created or materially changed, show the source fields and proposed content for review. Keep extracted/unconfirmed values marked as such.

The user remains responsible for editing and approving the final document. Export, print, share, sign, file or send are separate explicit actions. A navigation proposal such as `OPEN_DRAFTING` only opens the document studio; it does not create or export anything.

## 8. Local-first and Android contract

The target mobile product is one installable Android APK that works on the phone without a USB cable, a development computer, a LAN server or a cloud fallback.

The current APK does not meet this target. The next Android work must be gated rather than assumed:

1. Prove an on-device API/runtime and app-private SQLite/file storage on a real arm64 phone.
2. Prove PDF rendering and required document dependencies on Android.
3. Bundle a client UI that supports runtime case IDs and local API access.
4. Integrate the shared Guide session and optional local model/provider adapters.
5. Test offline operation, app restart, deletion, backups, local network exposure and missing-provider behavior.
6. Produce and install a signed release APK only after the acceptance gates pass.

The existing Python domain engines remain the canonical implementation unless a measured Android compatibility blocker requires a narrow adapter. Do not silently move legal logic into a second implementation. No external model or cloud service is used unless separately disclosed and explicitly enabled.

## 9. Visual and interaction contract

- The dedicated Guide workspace is the primary home for the expressive avatar and interactive work surface.
- The workspace should expose conversation, case context, evidence, legal grounding, journey, documents and next actions without forcing users through unrelated pages.
- Ordinary case pages should not receive repeated decorative female-avatar images. The shared Guide control surface can remain accessible, but it should be compact and functional.
- Text remains visible and editable when voice is active. Voice is optional, interruptible and never the only path.
- Use responsive layouts designed for phone first, with clear focus order, keyboard access, screen-reader labels and reduced-motion support.
- Keep women’s-safety pages and their dedicated flows out of this UI overhaul. The Guide may route to them but this contract does not authorize redesigning them.

## 10. Implementation sequence and acceptance gates

### Phase 1 — session unification

- Introduce one typed session/turn controller used by both the floating text Guide and dedicated voice workspace.
- Preserve confirmed turns across text/voice switches and case-route navigation.
- Keep drafts separate from submitted turns and canonical case state.
- Add tests for mode switching, stale-response rejection, interruption, case switching and refresh behavior.

**Pass condition:** a user can start in text, switch to voice, return to text and continue the same active conversation without duplicate or lost confirmed turns; no case mutation occurs without the existing review/confirmation flow.

### Phase 2 — agent workspace and action coverage

- Refactor the dedicated Guide page into a responsive avatar + interactive workspace.
- Add case-aware, typed action proposals for the existing app capabilities, starting with navigation and read-only inspection.
- Add preview/confirmation contracts for case/document mutations only after each target service has a safe, tested API.
- Keep the existing action registry as the permission boundary.

**Pass condition:** every visible action has a real implementation, current-case validation, a clear outcome and a test. No decorative or inert controls.

### Phase 3 — advisory and source integrity

- Add the always-available advisory entry point against the latest case revision.
- Verify official source links, provenance, jurisdiction, effective dates and unsupported/insufficient-information behavior.
- Add regression fixtures for missing, conflicting, stale and unverified sources.

**Pass condition:** no unsupported legal citations or definitive conclusions appear in the tested scenarios; insufficient information is stated plainly.

### Phase 4 — standalone Android

- Complete and review the Android runtime, document-rendering and on-device storage feasibility plan before converting the UI or promising offline capability. The current `ANDROID_LOCAL_SETUP.md` describes the computer-hosted development shell, not standalone operation.
- Keep women’s-safety routes unchanged and run their regression tests.

**Pass condition:** one installed APK works after the development computer is powered off, with the phone offline, and the API is not reachable from the LAN.

## 11. Non-goals and release honesty

This contract does not authorize:

- Replacing the current legal/domain engines with a generic LLM/RAG chatbot.
- Treating model output, speech recognition or document extraction as confirmed facts.
- Unrestricted autonomous control, hidden background actions or silent external communications.
- Cloud fallback when a local model/provider is unavailable.
- Redesigning the dedicated women’s-safety pages in this workstream.
- Claiming that the current laptop/Ollama setup is an on-device Android model.
- Claiming the current Capacitor shell is a standalone Android app.

Every release note must separate implemented, tested, experimental and planned capabilities.
