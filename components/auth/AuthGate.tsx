'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

type AuthUser = { userId: string; username: string };

export function AuthGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checking, setChecking] = useState(true);
  const isPublic = pathname === '/login' || pathname === '/women-safety';

  useEffect(() => {
    if (isPublic) return;
    let active = true;
    fetch('/api/auth/me', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('unauthenticated');
        return (await response.json()) as AuthUser;
      })
      .then((account) => {
        if (active) {
          setUser(account);
          setChecking(false);
        }
      })
      .catch(() => {
        if (active) {
          setUser(null);
          setChecking(false);
          router.replace('/login');
        }
      });
    return () => { active = false; };
  }, [isPublic, pathname, router]);

  const signOut = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', cache: 'no-store' });
    } finally {
      setUser(null);
      router.replace('/login');
    }
  }, [router]);

  if (isPublic) return <>{children}</>;
  if (checking || !user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#080b12] px-6 text-slate-200">
        <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-4 text-sm">
          <span className="h-2 w-2 animate-pulse rounded-full bg-cyan-300" />
          Checking your secure LawSense session…
        </div>
      </main>
    );
  }
  return (
    <>
      {children}
      <div className="fixed bottom-3 right-3 z-[90] flex max-w-[calc(100vw-1.5rem)] items-center gap-2 rounded-full border border-white/10 bg-[#0a0f19]/95 px-3 py-2 text-xs text-slate-300 shadow-xl backdrop-blur">
        <span className="max-w-[42vw] truncate" title={user.username}>
          Signed in as <strong className="font-medium text-slate-100">{user.username}</strong>
        </span>
        <button type="button" onClick={signOut} className="rounded-full border border-white/15 px-3 py-1.5 font-medium text-cyan-200 transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">
          Sign out
        </button>
      </div>
    </>
  );
}
