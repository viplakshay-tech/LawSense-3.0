# Guide Runtime

The case layout mounts `GuideRuntimeProvider` inside `CaseStateProvider`. It subscribes to the canonical `CaseState` and revision, updates the deterministic runtime, keeps a small accessible activity transcript, and exposes typed events and actions to the persistent Guide control surface.

Case-derived states prioritize safety, conflict, evidence processing, clarification requests, uncertainty, legal source records, evidence, and recorded next actions. Listening, processing, speaking, explanation, and error states come from typed lifecycle events. The voice route forwards its existing capture, review, confirmation, and playback events to the same runtime.

## Source integrity

The runtime preserves unknowns, assumptions, conflicts, and fact, claim, evidence, and document statuses separately. The presentation model shows case text and values from `CaseState` with their supplied statuses; it does not infer legal facts or fill missing values. When no case-specific next step exists, the Guide says so and keeps the record informative.

The speech response is assembled from record counts and status text for presentation. It does not create a legal conclusion. Clarification questions still come from the existing clarification API, whose panel owns answer submission and case mutation.

## Action integration

The provider exposes one case-derived state, action list, and presentation model to the Legal Guide page and case control surface. The page uses those values for its state, case summary, and available controls; its selected actions are revalidated by the runtime and executed through `components/guide-actions`. Connected commands navigate to existing case routes or call browser speech synthesis. Voice capture opens its existing page; the microphone starts only after the user activates its capture control. Commands that need unavailable page-local selections are not exposed as Guide actions.

`GuidePresence` visualizes runtime state. The case shell mounts the Guide surface once so its state and activity remain available across case routes.
