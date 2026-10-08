'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { buildCaseContextHref, type CaseContextKind } from '@/lib/case-context';

export function CaseContextLink({
  kind,
  recordId,
  children,
  className,
  hash,
  ariaLabel,
}: {
  kind: CaseContextKind;
  recordId?: string;
  children: ReactNode;
  className?: string;
  hash?: string;
  ariaLabel?: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const href = buildCaseContextHref(pathname, searchParams.toString(), kind, recordId, hash);

  return (
    <Link href={href} scroll={false} className={className} aria-label={ariaLabel}>
      {children}
    </Link>
  );
}
