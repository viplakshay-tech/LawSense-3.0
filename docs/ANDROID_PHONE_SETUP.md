# Install LawSense on an Android phone without a USB cable

## What the current APK does

The current debug APK is a small Capacitor connection shell. It can be installed directly on the phone without connecting the phone to a computer by USB, but it does **not** contain the full LawSense web application, API, case database, or local language model.

The phone and the computer hosting LawSense must be on the same trusted Wi-Fi network. The host must provide an HTTPS origin whose certificate Android trusts. The APK checks that `/api/health` returns the LawSense API health response before opening the app.

## 1. Download the APK directly on the phone

1. Open the repository's **Actions** tab in a browser and sign in to GitHub if prompted.
2. Open the latest successful **LawSense quality gates** run for the branch/PR you want to install.
3. Under **Artifacts**, download `lawsense-android-debug-apk`.
4. Extract the ZIP on the phone and locate `app-debug.apk`.
5. Tap the APK and follow Android's install prompt. If Android asks, allow the browser or file manager to install this downloaded app.
6. Open **LawSense**. No USB cable or Android Debug Bridge is required for this installation path.

Workflow artifacts currently expire after 14 days. Download the APK while the artifact is available.

## 2. Prepare the computer-hosted LawSense server

1. Start the LawSense web frontend and API on the computer.
2. Put an HTTPS reverse proxy in front of the web frontend. The phone must be able to reach the HTTPS origin over the trusted Wi-Fi network.
3. Configure the web app's API upstream so that the same origin serves `/api/health` and returns JSON with `status: "ok"` and `service: "lawsense-api"`.
4. Make sure the HTTPS certificate is trusted by the Android phone. Do not bypass certificate validation or use an untrusted certificate.
5. Allow inbound traffic only from the trusted network and keep the computer's firewall enabled.

The app accepts an HTTPS **origin only** (scheme, host and optional port). It rejects HTTP, localhost, IP loopback, credentials, paths, query strings and fragments.

## 3. Connect the phone

1. Connect the phone and computer to the same trusted Wi-Fi network.
2. Open LawSense on the phone.
3. Enter the computer's HTTPS origin, for example `https://192.168.1.25:3000` (replace this example with the actual address and port configured on the computer).
4. Tap **Check connection**.
5. After the health check succeeds, LawSense opens inside the app. The origin is saved on that phone for the next launch.

To change servers later, use **Change server** in the app.

## Privacy and safety notes

- Do not expose the Ollama port (normally `11434`) directly to the phone or local network. The backend should continue to communicate with Ollama through its loopback endpoint on the computer.
- Do not connect over public or untrusted Wi-Fi.
- The app's connection check does not make the app offline-capable; it only verifies the web/API host before loading it.
- A standalone Android build still requires an on-device inference runtime, model packaging, local case-data storage, document dependencies, and real-device offline/restart tests. Those capabilities are not part of this APK.
