# Guide Presence

`GuidePresence` is the visual presentation layer for Guide Runtime state. It owns no runtime transitions, case state, evidence, conversation content, or legal reasoning. In the persistent case control surface, the visual state is mapped directly from the existing Guide Runtime snapshot.

The default `AvatarSurface` is a polished vector illustration, clearly labeled **Illustrated Guide**. It is intentionally not a photograph or synthetic video. It responds to the presentation contract with state-specific expression, gaze, head pose, and mouth shapes when externally supplied viseme timing is available. It does not perform random idle animation.

## Presentation states

`GUIDE_PRESENTATION_CONTRACT` in `presentation-contract.ts` specifies these behaviors for every state:

| State | Expression and attention | Head movement and speech | Idle, interruption, and reduced-motion behavior |
| --- | --- | --- | --- |
| `IDLE` | Calm; available gaze toward camera | Settled posture; silent until Runtime says otherwise | Open, still pose; interruption returns to rest; reduced motion uses a still portrait |
| `LISTENING` | Attentive; gentle direct gaze toward the user | One subtle lean on entry; remains quiet | No repeated nodding or scanning; speech stops on interruption; static listening pose when motion is reduced |
| `PROCESSING` | Thoughtful; gaze toward the case record | Small downward tilt; remains silent until a response is ready | Focused stillness; new state replaces it immediately; static processing pose when motion is reduced |
| `ASKING` | Curious; direct gaze toward the user | Slight inquiry tilt; speaks only while speech is active | Holds space for a reply; interruption ends speech; static clarification pose when motion is reduced |
| `EXPLAINING` | Warm; oriented toward the user | Phrase emphasis only from explicit timing; visemes come from external cues | Closes mouth when audio ends; interruption closes mouth immediately; text remains available outside the avatar |
| `EVIDENCE` | Attentive; gaze toward evidence | Settled review tilt; no animated eye scanning | Holds evidence focus; interruption ends speech; static evidence-facing gaze when motion is reduced |
| `GROUNDED` | Calmly confident; direct gaze | Upright and composed; no celebratory motion | Quiet resting expression; interruption ends speech; static grounded pose when motion is reduced |
| `UNCERTAIN` | Reflective; direct gaze | Small, held tilt; even-paced speech | Steady while details are clarified; interruption does not change Runtime state; static reflective pose when motion is reduced |
| `CONFLICT` | Composed concern; attends to evidence | Centered posture; no alternating gaze loop | Holds a neutral expression; interruption leaves conflict handling with Runtime; static pose with explicit state label |
| `SAFETY` | Compassionate; gentle attention toward the user | Grounded and still; calm, concise speech | No urgent motion or pulsing; interruption leaves state changes with Runtime; static portrait with visible safety label |
| `SPEAKING` | Warm and engaged; gaze toward the user | Uses supplied phoneme/viseme timing; gesture timing is explicit | Closes mouth on pause or completion; interruption clears visemes immediately; reduced motion disables head movement |
| `ERROR` | Calmly apologetic; direct gaze | Still posture; speaks only when an explanation is active | Error copy carries the explanation; interruption ends speech; static portrait with accessible error label |

`ACTION` remains accepted as a compatibility alias for the previous Guide Presence API and uses the `GROUNDED` visual contract.

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
