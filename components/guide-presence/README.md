# Guide Presence

`GuidePresence` is the visual presentation layer for the shared Guide Runtime. It owns no case state, evidence, conversation content, legal reasoning, or runtime transitions.

## Current visual identity

All active Guide surfaces use the same professional, AI-generated feminine portrait:

`/guide/lawsense-guide-feminine.webp`

It is a static image, not an animated cartoon, talking-head simulation, or source of speech. The active component does not mount the legacy illustrated renderer. The Guide's actual listening, processing, speaking, safety, and clarification states are communicated through the accessible status label and conversation controls.

The portrait is shared by the case Guide page, turn-based voice page, and Legal Twin companion so the experience remains visually consistent across routes.

## Runtime states

The `state` prop comes from the existing Guide Runtime snapshot. The visual surface displays the supplied state and detail without inferring additional facts or changing runtime behavior.

- `IDLE`: calm, ready state
- `LISTENING`: microphone capture is active
- `THINKING`: the local Guide request is processing
- `SPEAKING`: a spoken reply is being played
- `CLARIFYING`: a detail is being reviewed
- `UNCERTAIN` / `CONFLICT`: the case record contains unresolved or conflicting information
- `SAFETY` / `IMMEDIATE_DANGER`: safety context supplied by the case runtime

## Accessibility and motion

The section exposes the current state through an accessible status or alert announcement. The image is decorative within that labelled section, so it uses an empty alt attribute rather than repeating the status text.

The portrait itself is static. `prefers-reduced-motion` is honored, and the state treatment does not depend on animation. The compact, regular, and hero sizes use the same portrait asset with responsive framing.

## Implementation boundary

Conversation input, browser or device speech recognition, speech output, Ollama availability, action proposals, and legal advisory are handled by their respective runtime and workspace components. The portrait must never be treated as evidence that microphone capture or local model inference is available.
