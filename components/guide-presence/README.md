# Guide Presence

`GuidePresence` is the state visualization used by the persistent Guide control surface. It receives a typed state and optional detail text, then presents system instrumentation and an accessible status. It does not own state transitions, legal rules, evidence, or conversation content. The Guide is an interface layer; the visual is not a character or assistant avatar.

```tsx
import { GuidePresence } from '@/components/guide-presence';

<GuidePresence
  state="EVIDENCE"
  detail="Three documents are being compared."
  size="regular"
/>
```

Supported states are `IDLE`, `LISTENING`, `PROCESSING`, `EXPLAINING`, `ASKING`, `EVIDENCE`, `GROUNDED`, `ACTION`, `UNCERTAIN`, `CONFLICT`, `SAFETY`, `SPEAKING`, and `ERROR`.

The `visual` prop is a visual-only extension point for a custom state visualization. State captions remain announced separately. `reducedMotion` can force still rendering; the system's reduced-motion preference is honored automatically.
