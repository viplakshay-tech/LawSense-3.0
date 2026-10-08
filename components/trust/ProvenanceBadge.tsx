import { FileSearch, MapPin } from 'lucide-react';
import { SourceBadge } from './SourceBadge';
import { hasTrustSource, type TrustSource } from './types';

export interface ProvenanceBadgeProps {
  source?: TrustSource | null;
  className?: string;
}

export function ProvenanceBadge({ source, className = '' }: ProvenanceBadgeProps) {
  if (!hasTrustSource(source)) {
    return <SourceBadge status="UNKNOWN" className={className} />;
  }

  const sourceName = source?.label || source?.documentName || 'Source details supplied';
  const location = [
    source?.pageNumber != null ? `page ${source.pageNumber}` : null,
    source?.locator,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <span
      aria-label={`Source: ${sourceName}${location ? `, ${location}` : ''}`}
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full border border-white/[0.09] bg-white/[0.035] px-2.5 py-1 text-[11px] text-zinc-300 ${className}`}
      title={location ? `${sourceName} · ${location}` : sourceName}
    >
      {source?.pageNumber != null || source?.locator ? (
        <MapPin aria-hidden="true" className="h-3 w-3 shrink-0 text-zinc-400" />
      ) : (
        <FileSearch aria-hidden="true" className="h-3 w-3 shrink-0 text-zinc-400" />
      )}
      <span className="truncate">{sourceName}</span>
      {location && <span className="shrink-0 text-zinc-500">· {location}</span>}
    </span>
  );
}
