'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

type ScreenState = 'checking' | 'setup' | 'login' | 'host-setup-required';

export default function LoginExperience() {
  const router = useRouter();
  const [screen, setScreen] = useState<ScreenState>('checking');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [setupToken, setSetupToken] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    const hostname = window.location.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    const isLoopbackHost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
    // First-account creation calls the API directly, so require plain local HTTP
    // here; this lets FastAPI verify the actual client address rather than trust
    // a loopback Origin relayed through the Next.js rewrite proxy.
    const isLoopback = isLoopbackHost && window.location.protocol === 'http:';
    fetch('/api/auth/setup-status', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Unable to check account setup.');
        return (await response.json()) as { setupRequired: boolean };
      })
      .then(({ setupRequired }) => {
        if (!active) return;
        setScreen(setupRequired ? (isLoopback ? 'setup' : 'host-setup-required') : 'login');
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Unable to connect to LawSense API.');
        if (active) setScreen('login');
      });
    return () => { active = false; };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const isSetup = screen === 'setup';
      const body = JSON.stringify({ username, password, ...(isSetup ? { setupToken: setupToken.trim() } : {}) });

      if (isSetup) {
        const configuredApiOrigin = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:8000';
        const apiOrigin = configuredApiOrigin.endsWith('/') ? configuredApiOrigin.slice(0, -1) : configuredApiOrigin;
        const registerResponse = await fetch(`${apiOrigin}/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          credentials: 'include',
          cache: 'no-store',
        });
        const registerData = (await registerResponse.json().catch(() => ({}))) as { detail?: string };
        if (!registerResponse.ok) throw new Error(registerData.detail ?? 'Account setup failed.');

        // The direct API request proves loopback access but stores its cookie
        // for the API hostname. Sign in once through the same-origin rewrite so
        // subsequent browser requests carry a cookie for the web-app hostname.
        const loginResponse = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          cache: 'no-store',
        });
        const loginData = (await loginResponse.json().catch(() => ({}))) as { detail?: string };
        if (!loginResponse.ok) {
          setScreen('login');
          throw new Error(loginData.detail ?? 'Account created. Sign in with your new credentials.');
        }
      } else {
        const response = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          cache: 'no-store',
        });
        const data = (await response.json().catch(() => ({}))) as { detail?: string };
        if (!response.ok) throw new Error(data.detail ?? 'Authentication failed.');
      }

      router.replace('/');
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Authentication failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#070a11] px-4 py-10 text-slate-100">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_20%_15%,rgba(34,211,238,0.10),transparent_42%),radial-gradient(ellipse_at_90%_85%,rgba(16,185,129,0.08),transparent_40%)]" />
      <section className="relative w-full max-w-md rounded-3xl border border-white/10 bg-[#0d121d]/90 p-7 shadow-2xl shadow-black/40 backdrop-blur-xl sm:p-9">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-cyan-200/20 bg-cyan-300/10 text-sm font-semibold tracking-wide text-cyan-200">LS</div>
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.25em] text-cyan-200/80">LawSense</p>
            <p className="mt-1 text-sm text-slate-400">Your case. Your evidence. Your next step.</p>
          </div>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {screen === 'setup' ? 'Create your local account' : screen === 'host-setup-required' ? 'Complete local setup first' : 'Welcome back'}
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          {screen === 'setup'
            ? 'Set a strong password and enter the one-time setup code from the host computer. Your existing local cases will be assigned to this account.'
            : screen === 'host-setup-required'
              ? 'For safety, the first account must be created on the computer hosting LawSense. After setup, you can sign in from this device.'
              : 'Sign in to open your saved cases and continue your legal journey.'}
        </p>
        {screen === 'host-setup-required' ? (
          <div className="mt-6 rounded-2xl border border-amber-200/15 bg-amber-200/[0.05] p-4 text-sm leading-6 text-amber-100/90">
            Open a browser on the host computer, use plain HTTP at <strong>http://localhost:3000</strong> (not HTTPS), create the first account there, then return to this device to sign in.
          </div>
        ) : screen === 'checking' ? (
          <div role="status" className="mt-7 text-sm text-slate-400">Checking local account setup…</div>
        ) : (
          <form onSubmit={submit} className="mt-7 space-y-5">
            <div>
              <label htmlFor="username" className="mb-2 block text-sm font-medium text-slate-200">Username</label>
              <input id="username" name="username" autoComplete="username" required minLength={3} maxLength={32} pattern="[A-Za-z0-9._-]+" value={username} onChange={(event) => setUsername(event.target.value)} className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none transition placeholder:text-slate-600 focus:border-cyan-300/60 focus:ring-2 focus:ring-cyan-300/10" placeholder="your.username" />
            </div>
            {screen === 'setup' && (
              <div>
                <label htmlFor="setupToken" className="mb-2 block text-sm font-medium text-slate-200">Local setup code</label>
                <input
                  id="setupToken"
                  name="setupToken"
                  autoComplete="off"
                  required
                  minLength={32}
                  maxLength={128}
                  value={setupToken}
                  onChange={(event) => setSetupToken(event.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 font-mono text-sm outline-none transition placeholder:text-slate-600 focus:border-cyan-300/60 focus:ring-2 focus:ring-cyan-300/10"
                  placeholder="Paste the code from the host data folder"
                />
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  On the host computer, open <code>data/lawsense.setup-token</code> beside the local database. This code is not made available over the network.
                </p>
              </div>
            )}
            <div>
              <label htmlFor="password" className="mb-2 block text-sm font-medium text-slate-200">Password</label>
              <input id="password" name="password" type="password" autoComplete={screen === 'setup' ? 'new-password' : 'current-password'} required minLength={12} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none transition placeholder:text-slate-600 focus:border-cyan-300/60 focus:ring-2 focus:ring-cyan-300/10" placeholder="At least 12 characters" />
              <p className="mt-2 text-xs leading-5 text-slate-500">Use at least 12 characters. Your password is stored as a one-way hash, not plain text.</p>
            </div>
            {error && <p role="alert" className="rounded-xl border border-rose-300/20 bg-rose-300/[0.06] px-3 py-2 text-sm leading-5 text-rose-200">{error}</p>}
            <button type="submit" disabled={busy || screen === 'checking'} className="flex w-full items-center justify-center rounded-xl border border-cyan-200/20 bg-cyan-200/10 px-4 py-3 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-200/15 disabled:cursor-not-allowed disabled:opacity-60">
              {busy ? 'Please wait…' : screen === 'setup' ? 'Create account and secure cases' : 'Sign in securely'}
            </button>
          </form>
        )}
        <p className="mt-7 border-t border-white/[0.07] pt-5 text-xs leading-5 text-slate-500">
          LawSense runs locally. Session cookies are HttpOnly and case access is scoped to the signed-in account. Keep the host computer and its local data directory protected.
        </p>
      </section>
    </main>
  );
}
