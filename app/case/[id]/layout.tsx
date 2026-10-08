import type { ReactNode } from 'react';
import { CaseStateProvider } from './CaseStateProvider';

export default async function CaseLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CaseStateProvider key={id} caseId={id}>{children}</CaseStateProvider>;
}
