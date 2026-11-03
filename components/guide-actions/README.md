# Guide action bridge

The bridge is the typed boundary between Guide intents and case-workspace handlers. The case layout supplies an explicit adapter that maps commands to fixed `router.push` destinations or browser speech synthesis. It never accepts a raw URL, invents record IDs, or treats a missing handler as success.

## Connected Guide actions

- `ASK_CLARIFICATION` opens the case clarification panel. The panel fetches its real open-question IDs and owns the existing answer/save flow.
- `SHOW_EVIDENCE` opens the document/evidence workspace and focuses a single known evidence record when that target is unambiguous; if exactly one document is referenced with no evidence IDs, it opens that saved document. Record IDs are checked against the active `CaseState` before routing. Ambiguous targets open the workspace without pretending a particular item was selected.
- `SHOW_LEGAL_GROUNDING` opens the Legal Guide page.
- `OPEN_JOURNEY` moves to the Journey section in the case overview.
- `SHOW_TWIN` and `OPEN_SAFETY` open their existing case pages.
- `START_VOICE` opens voice capture. The user must still start the microphone on that page.
- `OPEN_DRAFTING` opens the existing document studio for the active case. It does not create, fill, review, download, or print a document; those steps remain under the user's control.
- `SPEAK_RESPONSE` uses the browser speech engine when available and reports unsupported or failed playback as unavailable/error.
- `NAVIGATE` maps the typed route to a fixed case-workspace path, encoding the case ID as one segment.

The runtime now supports the document workspace's existing `?evidenceId=` and `?documentId=` selection contract. Finding highlighting still returns `unavailable` because its end-to-end page callback has not been connected. The case-level Guide adapter now supports read-only Legal Twin node focus (`?focus=`) and timeline snapshot navigation (`?at=`). Node identifiers and timestamps are validated before navigation; the Twin reports when a requested node is absent from the returned projection. These commands do not mutate CaseState. Bridge commands without connected handlers return `unavailable`. The Guide does not send arbitrary events or call legal/document services directly.

`createGuideActionBridge(adapter).dispatch(command)` is typed for application code and revalidates the closed command shape. `dispatchUntrusted(input)` is available for untyped input boundaries. `createRecordingGuideActionAdapter()` remains a test-only adapter and is not mounted in the application.
