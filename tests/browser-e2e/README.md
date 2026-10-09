# LawSense browser E2E

This Playwright suite drives the real Next.js UI in the integration checkout and
the pinned FastAPI source at `C:\LawSense\apps\api`. Its default configuration
builds and starts the production web app and a disposable API process; SQLite
and uploaded documents live under a unique OS temporary directory, separate
from normal development data. Python removes it on normal exit; if Playwright
force-terminates the runner on Windows, the synthetic sandbox may remain under
`%TEMP%`. No success response is mocked in the flagship flow. The
loading check delays one real case response, the Twin timeline check delays one
real snapshot response, and the failure check aborts one case read before the
retry reaches the real API.

## Pinned source

- Frontend application baseline: `60a29ed9f40ee4de47c9a8e94d4ae2ce995174e9`
  (`lawsense-3-integration`). The harness and these path fixes are versioned in
  the subsequent integration commit.
- API source revision: `756df0b8cb37207770b93ac7342be255016be485` in its own
  local Git repository. The runner checks this revision and requires a clean
  API worktree before starting.
- Frontend root: the integration checkout root, where its `next.config.ts` and
  `package.json` live.

## Run

Requirements: Node.js/npm, the pinned API checkout with its `.venv` and
`requirements.txt` installed, and Playwright Chromium. From this directory:

```powershell
$env:LAWSENSE_API_ROOT = 'C:\LawSense\apps\api'
npm ci
npx playwright install chromium
npm test
```

To show the browser, run `npm run test:headed`. Set `LAWSENSE_PYTHON` to a
Python executable with the API requirements installed if the API venv is
elsewhere. `LAWSENSE_API_ROOT` is passed explicitly to the isolated Python
runner; if omitted from the shell, the Playwright configs derive it as
`C:\LawSense\apps\api` from this checkout's location. The runner requires the
API revision above and rejects a dirty API worktree. The frontend rewrite target
is set to `http://127.0.0.1:8001` before the production build and web startup.
The test runner uses port 3012 for Next.js and port 8001 for the isolated API.
Set `LAWSENSE_E2E_WEB_PORT` to use another available web port. Browser requests
to the app's same-origin `/api/*` contract are forwarded to that isolated API
without modifying the live API server or its data.
The harness keeps its production build in `.next-e2e-production` and the
home-regression development build in `.next-e2e-home`; this lets either config
run alongside a regular Next.js development server.

## Flagship test record

- Case narrative: `Mere landlord ne ₹30,000 security deposit return nahi kiya. Agreement bhi hai.`
- Agreement: generated in-memory as a one-page synthetic PDF with a fictional
  refundable security deposit of INR 30,000. It contains no real names,
  addresses, contact details, or account data.
- Browser: Playwright Chromium, desktop viewport 1365 × 900.
- Motion: `prefers-reduced-motion: reduce` is enabled in the flagship flow.
- Assertions cover the CaseState narrative/facts/unknowns, document upload and
  returned findings, explicit amount confirmation, state refresh across
  navigation, Living Twin graph and timeline projection, loading, failed API
  recovery, missing case ID, and reduced-motion playback behavior.

## Selectors and accessibility

The suite prefers accessible roles and labels for navigation, actions, file
input, findings, timeline controls, and graph regions. The home textarea is
currently located by `textarea` because its placeholder is not a programmatic
label. That is an accessibility issue surfaced by the selectors; this test does
not modify app code. The review renders both amount and currency findings with
the same checkbox accessible name, “Select finding: Amount”; the test scopes
the checkbox to the amount extraction card by its visible returned field note.

Playwright reports and traces are written under this directory's
`playwright-report/` and `test-results/` folders.
