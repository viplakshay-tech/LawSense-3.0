'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { LockKeyhole } from 'lucide-react';

type AccessStatus = {
  mode?: string;
};

export function AccessSessionControl() {
  const pathname = usePathname();
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (pathname === '/unlock') {
      setEnabled(false);
      return;
    }
    const controller = new AbortController();
    void fetch('/access-control/status', {
      cache: 'no-store',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    }).then(async (response) => {
      if (!response.ok) return;
      const body: AccessStatus = await response.json();
      if (!controller.signal.aborted) setEnabled(body.mode === 'passphrase');
    }).catch(() => undefined);
    return () => controller.abort();
  }, [pathname]);

  if (!enabled || pathname === '/unlock') return null;

  async function lock() {
    try {
      await fetch('/access-control/lock', {
        method: 'POST',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
    } catch {
      // Redirecting still takes the user to the unlock screen if the lock
      // request fails because the session expired or the network disconnected.
    } finally {
      window.location.replace('/unlock?reason=locked');
    }
  }

  return (
    <button
      type="button"
      onClick={() => void lock()}
      aria-label="Lock LawSense session"
      title="Lock LawSense session"
      className="inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-white/[0.12] bg-white/[0.035] px-2.5 text-[11px] font-semibold text-slate-300 transition hover:border-[#d9bd8c]/40 hover:bg-white/[0.07] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#e9bd7b]"
    >
      <LockKeyhole aria-hidden="true" className="h-3.5 w-3.5" />
      <span className="hidden xl:inline">Lock</span>
    </button>
  );
}
