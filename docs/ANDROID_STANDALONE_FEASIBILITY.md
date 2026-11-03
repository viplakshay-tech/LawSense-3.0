# LawSense standalone Android feasibility and implementation plan

**Status:** feasibility reviewed from the current repository; implementation has not started.  
**Goal:** install one APK, then use LawSense on the phone without a computer, USB debugging, a LAN server, paid services, or a cloud fallback.

## 1. Current state — not standalone yet

The current Android build is a Capacitor connection shell:

- `capacitor.config.ts` sets `webDir: "capacitor-shell"`; `CAPACITOR_SERVER_URL` can point the WebView at a remote development server.
- `ANDROID_LOCAL_SETUP.md` explicitly requires a computer running both the Next.js frontend and FastAPI backend on the same trusted network. The APK contains a connection screen, not the full web application.
- `next.config.ts` rewrites `/api/:path*` to the FastAPI origin. The web client expects same-origin API routes.
- The web app uses runtime case IDs under `app/case/[id]`, with the canonical case record, SQLite storage, document processing, voice, source governance, Legal Twin and journey engines in the Python API.

Therefore, copying the present APK or changing only its server URL cannot make the app standalone.

## 2. The main technical constraint

A static Capacitor bundle is a good fit for installing HTML/JS/CSS into an APK, but the current Next.js server setup cannot simply be switched to static export:

- The current configuration relies on a server-side API rewrite. Next.js static export does not support rewrites.
- Case IDs are created at runtime. A static build cannot pre-render every future `/case/[id]` path at build time.
- Any other server-dependent routes/components must be identified rather than assumed to work in a static bundle.

References: [Next.js static exports](https://nextjs.org/docs/app/guides/static-exports), [Next.js dynamic routes](https://nextjs.org/docs/app/api-reference/file-conventions/dynamic-routes).

A self-contained APK needs **both** a bundled client UI and an on-device execution path for the API/domain engines and data. It is not enough to bundle the existing connection screen.

## 3. Recommended architecture to prove first

Keep the existing Python engines as the canonical domain implementation. Do not fork legal reasoning into a second, independently maintained Kotlin implementation.

1. **Bundled client UI:** produce a phone-packaged client bundle that supports runtime case IDs and client-side navigation. Reuse existing React components where practical, but treat the current Next.js-to-static conversion as a real engineering task, not a configuration toggle.
2. **On-device API:** investigate embedding the existing Python app in the Android process (for example, with the Chaquopy Python SDK) and exposing its current API routes through a loopback-only local service. The APK must start/stop this service with the app lifecycle; no computer process or LAN origin should be required.
3. **App-private persistence:** move the database, JSON state, uploaded files, drafts, exports-in-progress and temporary document/audio files into Android app-private storage. Keep the existing privacy, deletion, retention and provenance rules. Exports to shared storage should remain an explicit user action.
4. **API URL adapter:** replace the implicit Next.js `/api` rewrite dependency with an explicit provider/base-URL adapter. The browser client in the APK calls only the local on-device service. Web development can continue using the existing Next.js rewrite.
5. **Local AI adapter:** the local Guide model remains optional and replaceable. On Android, show `available` or `unavailable` unless a compatible on-device inference runtime and model are actually bundled/configured. Never silently fall back to a cloud model.
6. **Explicit provider status:** show whether speech recognition, speech output, document rendering/OCR and the Guide model are on-device, OS/browser supplied, unavailable, or require a separately approved network operation. Typed input and source-grounded non-LLM analysis must remain usable when optional models are absent.

### Python runtime and document processing — hard feasibility gate

The API dependencies currently include FastAPI, Pydantic, `python-multipart`, `pypdf`, Pillow, `pypdfium2` and `uvicorn[standard]`. Optional voice support is separate and requires a locally installed `faster-whisper` package plus a model directory.

Chaquopy is a plausible first spike, not a guarantee that the whole API will run unchanged:
- The current Android project has `minSdkVersion = 24`, consistent with the current Chaquopy documentation's minimum SDK.
- Chaquopy packages many pure-Python and selected native dependencies, but Android-compatible wheels must be checked package-by-package.
- The `pypdfium2` project describes Android support as experimental/best-effort and says Android wheels are not included in its releases at the time of its documented platform note. The PDF renderer therefore needs an early compatibility test or a replaceable rendering adapter.
- Do not assume `uvicorn[standard]`, faster-whisper/CTranslate2/PyAV, Whisper weights, or Ollama are available on Android merely because they work on the development computer.

References: [Chaquopy Android documentation](https://chaquo.com/chaquopy/doc/current/android.html), [Chaquopy package compatibility FAQ](https://chaquo.com/chaquopy/doc/current/faq.html), [pypdfium2 platform support](https://pypdfium2-team.github.io/pypdfium2/platforms.html).

## 4. Build sequence and pass/fail gates

### Phase A — on-device backend proof of concept
Build a minimal debug APK that starts the bundled Python runtime and local service, then calls a health endpoint and performs SQLite create/read/update/delete from the phone.

**Must pass before porting more UI:**
- Works on a real Android arm64 phone after installation, without the development computer.
- API binds only to loopback; the local service survives ordinary navigation and restarts correctly after the app is reopened.
- SQLite and app-private file paths resolve inside the application sandbox.
- FastAPI/Pydantic and required request bodies work with the chosen Android runtime.
- Dependencies are proven by installation/build tests, not inferred from desktop `pip install`.

If this fails, stop and compare alternate supported embeddings before changing the domain engines.

### Phase B — PDF and file pipeline proof
Test text extraction, image validation, PDF page rendering and large-file limits using representative files. If `pypdfium2` is not viable, use a narrow renderer interface and evaluate an Android-native PDF rendering adapter. Do not silently mark a scanned document as fully processed when rendering/OCR is unavailable.

### Phase C — bundled UI and API integration
Bundle the app client; support runtime case IDs, refresh/reopen, file uploads/downloads, back navigation, deep links and all current API routes needed for the main journey. Remove all runtime dependence on the remote Next.js host and its rewrite. Keep a development API-origin override out of the release configuration.

### Phase D — persistence, Guide and safety behavior
Verify case creation/reopen, evidence/document review, analysis/advisory, source references, Legal Twin, journey, deletion/export, local Guide history and optional voice. The Guide must use the saved case state, preserve unknown/conflicting statuses and have no cloud fallback. The dedicated women’s-safety experience must remain intact and pass its regression tests.

### Phase E — offline and release checks
Test airplane mode, force-stop/reopen, low storage, interrupted uploads, malformed PDFs/images, missing optional providers, screen lock and app update/migration. Verify that no sensitive case data is sent to external services by default, backups do not silently include case content, deletion covers derived records/files, and the API is not reachable from the LAN. Build and install a signed release APK only after a real-device test.

## 5. Standalone acceptance checklist

- [ ] One installed APK opens without entering a computer address or starting a computer server.
- [ ] Create, reopen, update and delete cases entirely on-device.
- [ ] Facts, evidence, document review and analysis/advisory work using on-device storage.
- [ ] Source links and verification status remain visible; offline mode does not pretend cached law is current.
- [ ] Local Guide works only when a supported on-device model is present; otherwise it says unavailable and the non-LLM workflow remains usable.
- [ ] Speech and scanned-PDF capabilities show their real provider status, with no silent cloud fallback.
- [ ] No API port is exposed on Wi-Fi; local data remains in app-private storage.
- [ ] Women’s-safety pages/resources and emergency interaction paths pass their dedicated regression checks.
- [ ] The APK works after installation with the computer powered off and the phone in airplane mode, apart from explicitly labeled optional network actions.

## 6. Current recommendation

Start with **Phase A plus one PDF-rendering compatibility test** before converting the UI. This establishes the riskiest unknown early: whether the existing Python API and its critical runtime dependencies can be packaged reliably on the target phone.

Do not rewrite the full frontend, migrate all legal engines to Kotlin, or promise fully offline voice/OCR until these gates pass. The current repository is a useful foundation, but standalone Android is a separate productization workstream—not a small Capacitor configuration change.
