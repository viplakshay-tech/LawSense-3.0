# LawSense Android app (private local server)

This is a Capacitor shell for personal use. The current Next.js app uses dynamic `/case/[id]` routes and a server-side `/api` rewrite, so its frontend and API are not a self-contained static bundle. The APK opens the existing web app in a WebView and requires the user's own computer to run both services. This avoids a frontend rewrite but is not offline or standalone operation.

The shell asks for an HTTPS origin such as `https://192.168.1.25:3000`, checks `${origin}/api/health`, and opens the app only after it receives a healthy LawSense API response. It rejects phone-local `localhost` addresses. The phone makes same-origin requests to the web server; the web server's upstream API origin is configurable on the computer with `NEXT_PUBLIC_API_URL` (for a backend on that same computer, `http://127.0.0.1:8000` is a server-side setting, not the phone's backend address).

## Local run requirements

1. Keep the computer and phone on the same trusted Wi-Fi network.
2. From the `api` directory, run FastAPI bound to loopback: `uvicorn app.main:app --host 127.0.0.1 --port 8000`. The API rejects non-loopback clients by default even if the process is accidentally bound to a LAN interface. The phone should reach the app through the HTTPS Next.js server on port `3000`, not by connecting directly to port `8000`.
3. Set `NEXT_PUBLIC_API_URL` for the Next.js process to the desired API upstream. The default `http://127.0.0.1:8000` means the API on the same computer as Next.js.

The API's local-only network boundary is not authentication. If a separately hosted reverse proxy must call FastAPI from a non-loopback address, an operator can explicitly set `LAWSENSE_ALLOW_REMOTE_API=true`; do so only on a restricted trusted network after adding proper authentication/authorization and firewall rules. This opt-in bypasses the network boundary—it does not create those protections.
4. Serve the Next.js app on the computer's LAN interface over HTTPS on port `3000`. Use a certificate the Android WebView trusts. The app accepts system certificates and user-installed certificate authorities for HTTPS; do not bypass certificate validation. The app will not accept plain HTTP.
5. In the APK's connection screen, enter the computer's HTTPS address and press **Check connection**. The check calls `/api/health` and confirms the expected API service before opening the frontend.

Do not expose the web or API ports to the public Internet. A trusted local HTTPS certificate is needed for microphone access and the health-check request from the bundled shell. If you use a private CA, install its public certificate on the phone as a CA certificate; the APK trusts user-installed CAs but keeps cleartext traffic disabled. Browser speech recognition support depends on Android WebView; text input remains available if voice recognition is unavailable.

## Build and install

The Android build requires Node.js 22 or later, a Java JDK supported by the generated Gradle project, Android SDK command-line tools, an Android platform, and Android build tools. From this directory, install npm dependencies, run `npx cap add android` once, run `npx cap sync android`, then build the debug APK with `android\gradlew.bat assembleDebug`. The APK is produced at `android\app\build\outputs\apk\debug\app-debug.apk`.

Install it with `adb install -r android\app\build\outputs\apk\debug\app-debug.apk`, or copy the APK to the phone and open it after allowing installation from that file source. The debug APK is for personal testing and is not a Play Store release.

## Limitations

- The frontend is served by the user's computer over the local network; the APK itself contains only the connection screen.
- No public hosting, cloud backend, paid service, or offline support is included.
- The real Android device connection and microphone flow must be verified after installing on the target phone.
