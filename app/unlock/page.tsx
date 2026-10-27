'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { LockKeyhole, ShieldCheck, ShieldAlert, LoaderCircle } from 'lucide-react';

type AccessMode = 'local-only' | 'misconfigured' | 'passphrase';

type AccessStatus = {
  mode: AccessMode;
  minimumPassphraseLength: number;
  networkAccessAllowed: boolean;
  sessionActive?: boolean;
};

function safeNextPath(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/';
  if (value.startsWith('/unlock') || value.startsWith('/api/access/') || value.startsWith('/access-control/')) return '/';
  return value;
}

export default function UnlockPage() {
  const [mode, setMode] = useState<AccessMode | null>(null);
  const [sessionActive, setSessionActive] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [isLocalBrowser, setIsLocalBrowser] = useState(false);
  const [reason, setReason] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const host = window.location.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const localBrowser = host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1' || host === '::1';
    const queryReason = new URLSearchParams(window.location.search).get('reason');
    // Apply browser-only values after mount to keep server and first-client markup aligned.
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      setIsLocalBrowser(localBrowser);
      setReason(queryReason);
    });
    void fetch('/access-control/status', {
      cache: 'no-store',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    }).then(async (response) => {
      const body: AccessStatus = await response.json();
      if (!controller.signal.aborted) {
        setMode(body.mode);
        setSessionActive(body.sessionActive === true);
      }
    }).catch(() => {
      if (!controller.signal.aborted) setError('Could not read the server access status. Check that the LawSense server is running.');
    });
    return () => controller.abort();
  }, []);

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setWorking(true);
    try {
      const query = new URLSearchParams(window.location.search);
      const next = safeNextPath(query.get('next'));
      const response = await fetch('/access-control/unlock', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ passphrase, next }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok || !body || typeof body !== 'object' || !('redirectTo' in body) || typeof body.redirectTo !== 'string') {
        const detail = body && typeof body === 'object' && 'detail' in body && typeof body.detail === 'string'
          ? body.detail
          : 'The workspace could not be unlocked. Check the server configuration and passphrase.';
        throw new Error(detail);
      }
      window.location.replace(safeNextPath(body.redirectTo));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The workspace could not be unlocked.');
      setWorking(false);
    }
  }

  async function lockSession() {
    setWorking(true);
    setError('');
    try {
      const response = await fetch('/access-control/lock', {
        method: 'POST',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error('The session could not be locked.');
      window.location.replace('/unlock?reason=locked');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The session could not be locked.');
      setWorking(false);
    }
  }

  return (
    <main className="min-h-dvh bg-[#080d14] px-4 py-10 text-slate-100 sm:grid sm:place-items-center sm:py-14">
      <section className="mx-auto w-full max-w-lg overflow-hidden rounded-3xl border border-white/[0.09] bg-[#101823] shadow-[0_30px_100px_rgba(0,0,0,0.4)]">
        <div className="border-b border-white/[0.08] bg-[radial-gradient(ellipse_at_85%_0%,rgba(217,189,140,0.16),transparent_55%)] px-6 py-7 sm:px-8">
          <div className="grid h-12 w-12 place-items-center rounded-2xl border border-[#d9bd8c]/25 bg-[#d9bd8c]/[0.08] text-[#f2dfb9]">
            <LockKeyhole aria-hidden="true" className="h-6 w-6" />
          </div>
          <p className="mt-5 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#d9bd8c]">LawSense · Private workspace</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Unlock LawSense</h1>
          <p className="mt-2 text-sm leading-6 text-slate-400">Enter your server-configured access passphrase to open case records and tools.</p>
        </div>

        <div className="space-y-5 px-6 py-6 sm:px-8 sm:py-7">
          {mode === 'local-only' && (
            <div role="status" className="rounded-2xl border border-amber-200/20 bg-amber-100/[0.045] p-4">
              <div className="flex items-start gap-3">
                <ShieldAlert aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-amber-200" />
                <div>
                  <p className="text-sm font-semibold text-amber-100">Network passphrase not configured</p>
                  <p className="mt-1 text-sm leading-6 text-slate-300">To use LawSense from a phone or another device, set <code className="rounded bg-black/20 px-1.5 py-0.5">LAWSENSE_ACCESS_PIN</code> on the web server to a generated random passphrase of at least 16 characters, then restart Next.js. Ordinary localhost development can continue without it. Without this setting, do not expose the frontend on a network; the hostname check is not a substitute for authentication.</p>
                </div>
              </div>
            </div>
          )}

          {mode === 'misconfigured' && (
            <div role="alert" className="rounded-2xl border border-rose-200/20 bg-rose-100/[0.045] p-4 text-sm leading-6 text-rose-100">
              The configured passphrase is too short. Set <code>LAWSENSE_ACCESS_PIN</code> to a random value with at least 16 characters and restart the web server.
            </div>
          )}

          {mode === 'passphrase' && (
            <div className="flex items-start gap-3 rounded-2xl border border-emerald-200/15 bg-emerald-100/[0.035] p-4">
              <ShieldCheck aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-emerald-200" />
              <p className="text-sm leading-6 text-slate-300">The server has access protection enabled. Successful unlock lasts up to 8 hours on this browser. Use HTTPS when connecting over a network.</p>
            </div>
          )}

          {reason === 'locked' && <p role="status" className="text-sm text-emerald-200">This browser session has been locked.</p>}

          <form onSubmit={unlock} className="space-y-4">
            <div>
              <label htmlFor="access-passphrase" className="mb-2 block text-sm font-medium text-slate-200">Access passphrase</label>
              <input
                id="access-passphrase"
                name="passphrase"
                type="password"
                autoComplete="current-password"
                minLength={16}
                maxLength={512}
                required
                value={passphrase}
                onChange={(event) => setPassphrase(event.target.value)}
                disabled={working || mode === 'local-only' || mode === 'misconfigured' || mode === null}
                placeholder="Enter your configured passphrase"
                className="min-h-12 w-full rounded-xl border border-white/10 bg-[#080d14] px-4 text-base text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-[#d9bd8c]/60 focus:ring-2 focus:ring-[#d9bd8c]/15 disabled:opacity-50"
              />
            </div>
            {error && <p role="alert" className="rounded-xl border border-rose-200/20 bg-rose-100/[0.05] p-3 text-sm leading-5 text-rose-100">{error}</p>}
            <button
              type="submit"
              disabled={working || mode !== 'passphrase' || passphrase.length < 16}
              className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#d9bd8c] px-4 text-sm font-semibold text-[#171a1e] transition hover:bg-[#ead5ac] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e9bd7b] disabled:cursor-not-allowed disabled:opacity-45"
            >
              {working && <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />}
              {working ? 'Unlocking…' : 'Unlock workspace'}
            </button>
          </form>

          <div className="flex flex-wrap items-center gap-3 border-t border-white/[0.08] pt-4">
            {(sessionActive || (mode === 'local-only' && isLocalBrowser)) && (
              <Link href="/" className="inline-flex min-h-10 items-center rounded-lg px-3 text-sm font-medium text-slate-300 transition hover:bg-white/[0.05] hover:text-white">
                {sessionActive ? 'Return to workspace' : 'Continue on this device'}
              </Link>
            )}
            {sessionActive && (
              <button type="button" disabled={working} onClick={() => void lockSession()} className="ml-auto inline-flex min-h-10 items-center gap-2 rounded-lg border border-white/10 px-3 text-sm font-medium text-slate-300 hover:bg-white/[0.05] disabled:opacity-50">
                <LockKeyhole aria-hidden="true" className="h-4 w-4" />
                Lock this session
              </button>
            )}
          </div>
          <p className="text-xs leading-5 text-slate-500">Passphrase protection is one shared local-workspace gate, not per-case ownership or multi-user authorization. Keep the passphrase private, use HTTPS over a network, and do not rely on this prototype for public deployment.</p>
        </div>
      </section>
    </main>
  );
}
