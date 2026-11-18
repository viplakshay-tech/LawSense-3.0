# LawSense 3.0 — Virtual AI Lawyer: 15-Milestone Delivery Plan

**Working branch:** `feature/virtual-lawyer-consultation`  
**Base branch:** `lawsense-3-integration`  
**Product decision:** realistic 3D female guide, warm natural Indian voice, Hindi/English/Hinglish, voice and text switchable in one consultation session.  
**Operating constraints:** local-first, zero mandatory API spend, no silent cloud fallback, preserve existing legal intelligence and women-safety routes.

This plan is an execution contract. A milestone is complete only when its acceptance checks pass on the repository and supported local devices. A GitHub commit or a passing static check alone is not proof of runtime completion.

## Architecture rules

1. The Guide is a conversational and presentation layer, not an autonomous legal decision-maker.
2. Existing CaseState, GuideRuntime, guide action allowlist, legal-source governance, case pipeline, document compiler and safety services remain authoritative.
3. Text and voice are input/output modes of one case-scoped session. They must not create competing conversation histories.
4. Avatar animation receives presentation events only; it never owns case facts, legal conclusions, or permissions.
5. Microphone capture requires an explicit user action. Camera access is never requested for the avatar experience.
6. Audio is ephemeral by default. Persist a transcript or attach it to a case only through an explicit, reviewable user action.
7. Ollama remains loopback-only. No hosted AI, speech, analytics, or avatar service may be required.
8. No existing women-safety route or behavior may be removed or redesigned as part of this work.
9. Reduced-motion, keyboard, screen-reader, permission-denied and provider-unavailable states are first-class.
10. Any proposed app action must use the existing closed action registry and explicit user confirmation.

## 15 milestones

| # | Milestone | Deliverable | Acceptance gate |
|---|---|---|---|
| 1 | Repository baseline and safety boundary | Feature branch, architecture audit, baseline tests and protected-scope inventory | Base branch unchanged; women-safety and legal-source boundaries documented |
| 2 | Conversation personality and plain-language contract | Revised local assistant instructions, short replies, one question per turn, language matching | Prompt tests cover English, Hindi, Hinglish, jargon avoidance and legal boundaries |
| 3 | Shared conversation session | One turn/session controller for text and voice, cancellation and stale-response protection | Switching input mode preserves confirmed turns; old requests cannot overwrite new turns |
| 4 | Dedicated consultation route | Full-screen case-scoped consultation webpage | Route opens only for the selected case and reuses existing case access controls |
| 5 | Consultation workspace UI | Video-call layout, transcript, language selector, text/voice controls, case progress drawer | Desktop and narrow mobile layouts are keyboard accessible and usable |
| 6 | Realistic avatar renderer | Replaceable human-avatar adapter and locally hosted avatar asset pipeline | Avatar loads without a third-party runtime or network call after setup |
| 7 | Avatar state, expression and gesture system | Idle/listening/thinking/speaking/interrupted states, eye/head motion, safe gestures | Avatar presentation follows GuideRuntime events and reduced-motion preference |
| 8 | Local speech-to-text | Configurable on-disk faster-whisper model integration | Hindi and English audio transcribe locally; missing model is reported without download |
| 9 | Local text-to-speech | Benchmark and integrate a locally installed Hindi/English voice provider | Voice is natural enough in agreed test set; no remote provider fallback |
| 10 | Streaming speech and interruption | Chunked TTS playback, cancellation, barge-in and audio lifecycle | User can interrupt playback; no stale audio continues after a new turn |
| 11 | Lip synchronization | Audio-timed viseme/blendshape mapping for the 3D avatar | Mouth animation follows actual audio timing, returns to rest on pause/end |
| 12 | Legal case workflow integration | Reviewed transcript → explicit case update → existing legal advisory and document pathways | No transcript is silently promoted to fact; source status and uncertainty remain visible |
| 13 | Privacy and security hardening | Session controls, retention/deletion behavior, local-only boundaries and audio cleanup | No default audio retention; auth, case ownership, input limits and local network guards pass |
| 14 | Android and offline readiness | Capacitor integration, permissions, performance fallback and documented on-device limits | Real-device tests pass without USB tethering; offline claims limited to verified capabilities |
| 15 | Full regression, release and handoff | Automated tests, manual test matrix, setup docs, known limitations and release notes | Required suites pass; no regressions in case, legal-source, document or women-safety flows |

## Implementation sequence and dependencies

- Milestones 1–3 are the conversation foundation.
- Milestones 4–7 build the consultation experience and avatar.
- Milestones 8–11 deliver the local real-time voice/avatar pipeline.
- Milestones 12–14 integrate legal workflows, privacy and Android.
- Milestone 15 is a release gate, not a documentation-only sign-off.

Do not start a dependent milestone by bypassing a failed acceptance gate. Keep changes in small commits on the working branch and use pull-request review before merging into the integration branch.

## Baseline observations from repository audit

- Next.js App Router and React are already in place; the repository's agent instructions require reading the installed Next.js 16 documentation before changing Next.js code.
- FastAPI already exposes a local Ollama Guide endpoint and a separate voice case service.
- The local assistant is explicitly non-authoritative and its Ollama URL is restricted to loopback.
- Voice transcription supports an optional local faster-whisper adapter with on-disk model loading.
- Current speech output can use a local provider or browser speech synthesis; browser voice availability and quality vary by device.
- Avatar presentation already has a renderer adapter contract and viseme timing types, but the default renderer is illustrated, not a realistic 3D human.
- Existing Guide sessions are case-scoped in browser session storage; they are not durable across tabs/devices.
- The current Android shell is not a standalone offline AI runtime. Do not represent it as one without on-device inference and real-device offline verification.

## Current execution note

Milestone 1's repository audit and feature-branch isolation are underway. Milestone 2 begins with the plain-language assistant contract. No milestone should be marked complete until its tests and runtime acceptance checks have been performed.
