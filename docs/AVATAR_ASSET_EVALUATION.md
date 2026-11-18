# Realistic avatar asset evaluation

## Selected local candidate

**HumanForge 0.8.1**, pinned to upstream commit `2226df1f50a04c5a8e1c02ea33780d28337dfbb1`.

- Source: https://github.com/abdulrehman043/humanforge
- Package: https://www.npmjs.com/package/humanforge
- Code licence: MIT
- Human mesh, skin, hair, clothing, rig and expression assets: CC0 1.0, subject to the upstream per-item asset register
- Runtime: Three.js, MakeHuman-derived human mesh, Mixamo skeleton and named facial expression morphs
- Upstream manifest: 26,756 body triangles; the full asset tree contains 327 files / 32,202,070 bytes

The upstream project describes its realistic-human renderer as using photoreal skin, eyes, hair cards and clothing. The code and asset licences make it a viable zero-cost candidate, but the project is new and has not yet been validated inside LawSense on a Windows laptop or Android phone.

## LawSense integration

The feature branch now includes:

- A lockfile-complete Three.js type dependency tree, including the nested meshoptimizer version required by @types/three.

- A pinned HumanForge Git dependency, Three.js and the Three.js type package.
- Next.js package transpilation for the upstream TypeScript source.
- `HumanAvatarRenderer`, implementing the existing `AvatarAdapter` boundary.
- Female professional avatar configuration, local face framing and HumanForge expression-morph mapping.
- Existing Guide viseme cues mapped to facial morph targets; the renderer also maps Guide state to subtle head/neck pose and blink behavior.
- A local asset setup script: `npm run setup:avatar`.
- A fallback to the existing illustrated guide when assets are absent or WebGL 2 is unavailable.

The app does not load avatar models from a third-party CDN. After the one-time setup script downloads the pinned CC0 asset pack, the renderer reads assets from the same-origin `/lawsense-human` path. No model or texture request is made to an external host during consultation.

## One-time setup

From the LawSense repository root, after `npm ci` and while an internet connection is available for the one-time asset preparation:

```powershell
npm run setup:avatar
npm run dev
```

The script reads the GitHub asset tree at the pinned commit, downloads the 32 MB CC0 asset pack from `raw.githubusercontent.com`, verifies every file size, and writes a readiness marker in `public/lawsense-human`. Existing matching files are reused on reruns. The pinned Git dependency provides the renderer code; the separate setup script prepares the asset files once.

The asset directory is approximately 32 MB. It is served locally after setup. Do not commit the generated `public/lawsense-human` directory unless the team explicitly chooses to distribute the full asset pack in the application repository.

## Explicit limitations

1. Milestone 6 is implemented at the adapter/setup level, not signed off. It requires a successful asset setup, a visual check of the actual female model, loading/error testing and a local-network trace confirming no avatar CDN requests.
2. The current renderer supports face expressions, viseme morphs, blinks and subtle head/neck orientation. It does not yet provide full-body hand gestures or independent eye-ball gaze.
3. The avatar renderer does not own or play speech audio. Guide Runtime and the voice pipeline remain authoritative.
4. The upstream package's React Native components are not used. Capacitor/Android currently hosts the web renderer; WebGL performance and texture decoding must be checked on physical devices.
5. No selfie, camera, face fitting or photo upload feature is enabled.
6. Reduced-motion mode suppresses automatic blink and head movement. The illustrated renderer remains available as a fallback.

## Acceptance checklist

- [ ] `npm ci` completes with the pinned Git dependency and lockfile.
- [ ] `npm run setup:avatar` copies all required files and writes `READY.json`.
- [ ] The consultation route loads the realistic female avatar from local assets.
- [ ] Network inspection shows no external avatar, texture or model requests.
- [ ] Missing assets and WebGL 2 failure return to the illustrated guide without breaking consultation.
- [ ] Hindi and English TTS playback drives the correct viseme timeline.
- [ ] Interrupted/paused speech returns the mouth to rest immediately.
- [ ] Reduced-motion behavior, keyboard access and screen-reader labels remain correct.
- [ ] Windows laptop and Android phone performance are acceptable under sustained consultation use.

Until these checks pass, describe the realistic renderer as integrated but pending local-device acceptance, not production-ready.
