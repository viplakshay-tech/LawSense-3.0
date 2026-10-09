# Guide Presence

`GuidePresence` is the visual presentation layer for Guide Runtime state. It owns no runtime transitions, case state, evidence, conversation content, or legal reasoning. In the persistent case control surface, the visual state is mapped directly from the existing Guide Runtime snapshot.

The default `AvatarSurface` is a polished vector illustration, clearly labeled **Illustrated Guide**. It is intentionally not a photograph or synthetic video. It responds to the presentation contract with state-specific expression, gaze, head pose, and mouth shapes when externally supplied viseme timing is available. It does not perform random idle animation.

## Presentation states

`GUIDE_PRESENTATION_CONTRACT` in `presentation-contract.ts` specifies these behaviors for every state:

| State | Expression and attention | Head movement and speech | Idle, interruption, and reduced-motion behavior |
| --- | --- | --- | --- |
| `IDLE` | Calm; available gaze toward camera | Settled posture; silent until Runtime says otherwise | Open, still pose; interruption returns to rest; reduced motion uses a still portrait |
| `LISTENING` | Attentive; gentle direct gaze toward the user | One subtle lean on entry; remains quiet | No repeated nodding or scanning; speech stops on interruption; static listening pose when motion is reduced |
| `THINKING` | Thoughtful; gaze toward the case record | Small downward tilt; remains silent until a response is ready | Focused stillness; new Runtime state replaces it; static thoughtful pose when motion is reduced |
| `SPEAKING` | Warm and engaged; gaze toward the user | Uses supplied viseme timing; does not invent mouth timing | Closes mouth on pause or completion; interruption clears visemes; reduced motion disables head movement |
| `CLARIFYING` | Curious; direct gaze toward the user | Slight inquiry tilt; speaks only while speech is active | Holds space for a reply; interruption ends speech; static clarification pose when motion is reduced |
| `UNCERTAIN` | Reflective; direct gaze | Small, held tilt; even-paced speech | Steady while details are clarified; interruption does not change Runtime state; static reflective pose when motion is reduced |
| `CONFLICT` | Composed concern; attends to evidence | Centered posture; no alternating gaze loop | Holds a neutral expression; interruption leaves conflict handling with Runtime; static pose with explicit state label |
| `ACTION_REQUIRED` | Steady; direct gaze toward the recorded action | Upright, still posture; explains only supplied action or error text | Keeps the action visible without repeated prompts; static portrait and action label when motion is reduced |
| `SAFETY` | Compassionate; gentle attention toward the user | Grounded and still; calm, concise speech | No urgent motion or pulsing; interruption leaves state changes with Runtime; static portrait with visible safety label |
| `IMMEDIATE_DANGER` | Compassionate; calm, direct attention | Grounded, still posture; uses supplied safety response and speech timing | Keeps the urgent label visible without alarm animation; assertive announcement and still portrait when motion is reduced |

Errors and recorded next steps map to `ACTION_REQUIRED`. `IMMEDIATE_DANGER` is reserved for urgent safety context supplied by the case record; ordinary sensitive safety context maps to `SAFETY`.

## Avatar surface adapter

`AvatarSurface` accepts `visualState`, `speechState`, optional `speechTiming` cues, `expression`, `emotion`, `context`, `gazeTarget`, `gestureHint`, and `reducedMotion`. All timing and interruption signals are caller-owned. No phoneme timing is inferred from a state label.

`AvatarAdapter` supplies a React surface renderer and declares whether it supports viseme timing, interruption, emotion, gaze, gestures, and live audio output. `illustratedAvatarAdapter` is the local default; its capabilities are explicit. A locally available human-avatar engine can implement this interface and receive the same presentation input without changing Guide Runtime semantics.

```tsx
import { GuidePresence } from '@/components/guide-presence';

<GuidePresence
  state="SPEAKING"
  speechState="speaking"
  speechTiming={{
    currentTimeMs: 184,
    cues: [{ startMs: 160, durationMs: 90, viseme: 'A', phoneme: 'a' }],
  }}
  detail="The response text remains available below."
  size="regular"
/>
```

The system `prefers-reduced-motion` setting is honored automatically. `reducedMotion` can force the same still presentation for a specific instance. A custom `visual` remains available for existing state-specific visualizations.
