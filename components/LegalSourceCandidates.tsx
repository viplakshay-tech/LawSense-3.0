import type { CaseState, LegalKnowledgeRecordSummary } from '@/lib/api';

type LegalSourceCandidatesProps = {
  caseData: CaseState;
  records: LegalKnowledgeRecordSummary[];
  variant?: 'light' | 'dark';
  title?: string;
};

function humanize(value: string | null | undefined): string {
  if (!value) return 'Unknown';
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function recordedLocation(caseData: CaseState): string | null {
  const values = [
    caseData.jurisdiction.city,
    caseData.jurisdiction.district,
    caseData.jurisdiction.state,
    caseData.jurisdiction.country,
  ].filter((value): value is string => Boolean(value?.trim()));
  return values.length ? [...new Set(values)].join(', ') : null;
}

function geographicScopeNote(record: LegalKnowledgeRecordSummary, location: string | null): string {
  switch (record.jurisdictionMatchStatus) {
    case 'mismatch':
      return `Geographic scope mismatch: recorded case location ${location || 'not established'}; source scope ${record.jurisdictionLabel || humanize(record.jurisdiction)}.`;
    case 'matched':
      return 'The recorded geographic scope matches at the levels provided; legal applicability is still not established.';
    case 'source_jurisdiction_unmapped':
      return 'The source jurisdiction could not be resolved in the local jurisdiction catalog.';
    default:
      return 'Case jurisdiction is not established, so geographic fit cannot be checked.';
  }
}

export function LegalSourceCandidates({
  caseData,
  records,
  variant = 'light',
  title = 'Retrieved legal source candidates',
}: LegalSourceCandidatesProps) {
  if (records.length === 0) return null;

  const dark = variant === 'dark';
  const card = dark
    ? 'border-white/[0.07] bg-white/[0.02] text-slate-300'
    : 'border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300';
  const heading = dark ? 'text-slate-200' : 'text-zinc-900 dark:text-zinc-100';
  const muted = dark ? 'text-slate-500' : 'text-zinc-500 dark:text-zinc-400';
  const location = recordedLocation(caseData);

  return (
    <section aria-label={title} className="mt-4 space-y-3 border-t border-current/10 pt-4">
      <div>
        <h3 className={`text-sm font-semibold ${heading}`}>{title}</h3>
        <p className={`mt-1 text-xs leading-5 ${muted}`}>
          These are issue-category retrieval candidates. Retrieval does not establish that a source is current or applies to this case.
        </p>
      </div>
      <ul className="space-y-3">
        {records.map((record) => (
          <li key={record.id} className={`rounded-xl border p-3 ${card}`}>
            <p className={`text-sm font-medium ${heading}`}>{record.title}</p>
            <p className={`mt-1 text-[11px] leading-5 ${muted}`}>
              {[record.authority, record.jurisdictionLabel || humanize(record.jurisdiction), record.version]
                .filter(Boolean)
                .join(' · ')}
            </p>
            <dl className="mt-2 grid gap-x-4 gap-y-1 text-[11px] sm:grid-cols-2">
              <div><dt className={muted}>Catalog record</dt><dd>{humanize(record.status)}</dd></div>
              <div><dt className={muted}>Source identity</dt><dd>{humanize(record.sourceVerificationStatus)}</dd></div>
              <div><dt className={muted}>Freshness</dt><dd>{humanize(record.sourceFreshnessStatus)}</dd></div>
              <div><dt className={muted}>Applicability</dt><dd>{humanize(record.sourceApplicabilityStatus)}</dd></div>
              <div className="sm:col-span-2">
                <dt className={muted}>Geographic scope check</dt>
                <dd>{geographicScopeNote(record, location)}</dd>
              </div>
            </dl>
            {(record.reference || record.provenance[0]?.pageSectionReference || record.provenance[0]?.retrievalTime) && (
              <p className={`mt-2 text-[10px] leading-4 ${muted}`}>
                {record.reference || record.provenance[0]?.pageSectionReference
                  ? `Registered locator: ${record.reference || record.provenance[0]?.pageSectionReference}`
                  : ''}
                {record.provenance[0]?.retrievalTime
                  ? `${record.reference || record.provenance[0]?.pageSectionReference ? ' · ' : ''}Retrieved ${record.provenance[0].retrievalTime}`
                  : ''}
              </p>
            )}
            {(record.sourceUrl || record.provenance[0]?.sourceUrl) && (
              <a
                className={`mt-2 inline-block text-xs underline underline-offset-2 ${dark ? 'text-blue-200' : 'text-blue-700 dark:text-blue-300'}`}
                href={record.sourceUrl || record.provenance[0]?.sourceUrl || undefined}
                target="_blank"
                rel="noreferrer"
              >
                Open registered source
              </a>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
