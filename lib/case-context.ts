export type CaseContextKind =
  | 'fact'
  | 'evidence'
  | 'issue'
  | 'source'
  | 'journey'
  | 'document'
  | 'twin'
  | 'safety';

export function buildCaseContextHref(
  pathname: string,
  currentSearch: string,
  kind: CaseContextKind,
  recordId?: string,
  hash = '',
): string {
  const params = new URLSearchParams(currentSearch);
  params.set('context', kind);
  if (recordId) params.set('record', recordId);
  else params.delete('record');
  const query = params.toString();
  return `${pathname}${query ? `?${query}` : ''}${hash ? (hash.startsWith('#') ? hash : `#${hash}`) : ''}`;
}

export function buildCaseSurfaceHref(
  caseId: string,
  surface: 'documents' | 'guide' | 'twin' | 'safety' | 'case',
  options: { documentId?: string; focus?: string; context?: CaseContextKind; recordId?: string } = {},
): string {
  const basePath = `/case/${encodeURIComponent(caseId)}`;
  const path = surface === 'case' ? basePath : `${basePath}/${surface}`;
  const params = new URLSearchParams();
  if (options.documentId) params.set('documentId', options.documentId);
  if (options.focus) params.set('focus', options.focus);
  if (options.context) {
    params.set('context', options.context);
    if (options.recordId) params.set('record', options.recordId);
  }
  const query = params.toString();
  return `${path}${query ? `?${query}` : ''}${surface === 'documents' && options.documentId ? '#document-preview' : ''}`;
}
