import type { ReactNode } from 'react';
import { CaseStateProvider } from './CaseStateProvider';
import { CaseShell } from '@/components/case-shell/CaseShell';
import { GuideRuntimeProvider } from '@/components/guide-runtime';

export default async function CaseLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <CaseStateProvider key={id} caseId={id}>
      <GuideRuntimeProvider caseId={id}>
        <CaseShell caseId={id}>{children}</CaseShell>
      </GuideRuntimeProvider>
    </CaseStateProvider>
  );
}
