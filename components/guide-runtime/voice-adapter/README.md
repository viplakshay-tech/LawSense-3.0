# Guide voice adapter

This adapter connects the case voice controls to the existing Guide Runtime. It owns the interaction visual state and forwards canonical Guide events through the runtime controller. It does not add facts, change the backend voice pipeline, or treat a transcript preview as saved case state.

## User flow

```text
Guide prompt
  -> capture_started (LISTENING)
  -> transcript_received / transcript_edited (ASKING)
  -> review_started (PROCESSING)
  -> review_ready (ASKING; preview only)
  -> confirmation_requested (user opens the confirmation step)
  -> confirmation_accepted (user activates the final commit)
  -> case_state_updated (only after CaseStateProvider accepts the response)
  -> Guide response_ready
  -> speech_started / speech_paused / speech_finished / speech_failed
```

Capture cancellation discards the active take and keeps any earlier text in the editor. Review errors and commit errors leave the transcript available. Editing invalidates the old review. TTS never starts automatically; the user activates play or replay, and the response text stays visible when browser synthesis is unavailable.

## Event and runtime boundary

`events.ts` defines the granular Guide voice events. `runtime.ts` implements `createGuideVoiceRuntimeAdapter`, which translates them into the shared Guide Runtime's `GUIDE_USER_INPUT_STARTED`, `GUIDE_PROCESSING_STARTED`, `GUIDE_SPEECH_*`, `GUIDE_ERROR`, and canonical `CASE_STATE_UPDATED` events. It keeps the voice interaction visual (`LISTENING`, `PROCESSING`, `ASKING`, `SPEAKING`, or `ERROR`) separate from the runtime's case-analysis state. After the provider accepts a new CaseState revision, the case-level `GuideRuntimeProvider` creates `GUIDE_RESPONSE_READY`; the voice page uses that same response text for browser speech.

Only the explicit final **Confirm and add statement** button emits `confirmation_accepted` and calls the case update API. The preview `CaseState` is used only to render draft details. `case_state_updated` is emitted after the provider exposes the exact returned case snapshot, and its revision is the provider revision. The Guide response is constructed from that accepted snapshot and then passed to the runtime. Speech is user activated and its browser lifecycle is reported back through the adapter.

The browser speech recognition and speech synthesis APIs are independent. Voice input uses local speech-to-text only when the provider status reports it available; otherwise it uses browser recognition when supported, which may rely on a browser-managed service. Typed input remains available when recognition is unsupported. The transcript stays in review until the user confirms it. Output retains readable response text when synthesis is unsupported or fails. No backend endpoint, payload, or pipeline behavior is changed.
