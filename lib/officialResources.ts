import type { CaseState } from './api';

export type RequestedOfficialResourceCategory =
  | 'legal_aid'
  | 'consumer_support'
  | 'workplace_safeguarding'
  | 'workplace_harassment'
  | 'cybercrime'
  | 'cyber_safety';

const OFFICIAL_HOST_SUFFIXES = ['.gov.in', '.nic.in'];

/** Restrict links from the official-resource API to HTTPS Indian government hosts. */
export function verifiedOfficialResourceUrl(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLocaleLowerCase();
    const officialHost = OFFICIAL_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
    return url.protocol === 'https:' && officialHost ? url.toString() : null;
  } catch {
    return null;
  }
}

function textValue(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) return value.map(textValue).join(' ');
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).map(textValue).join(' ');
  }
  return '';
}

function caseSearchText(caseState: CaseState): string {
  return [
    caseState.title,
    caseState.initialStatement,
    ...caseState.legalIssues.flatMap((issue) => [issue.category, issue.subcategory]),
    ...caseState.facts.flatMap((fact) => [fact.key, textValue(fact.value)]),
    ...caseState.claims.map((claim) => claim.text),
  ].filter(Boolean).join(' ').toLocaleLowerCase();
}

/**
 * Pick registry categories from case text and inferred screening signals.
 * These are search hints only; callers must describe them as suggestions.
 */
export function selectRequestedOfficialResourceCategories(
  caseState: CaseState | null | undefined,
): RequestedOfficialResourceCategory[] {
  if (!caseState) return [];

  const text = caseSearchText(caseState);
  const domains = caseState.analysis?.safetyContext?.womenSafetyContext?.domains ?? [];
  const indicators = caseState.analysis?.safetyContext?.indicators.map((item) => item.category) ?? [];
  const selected: RequestedOfficialResourceCategory[] = [];
  const add = (category: RequestedOfficialResourceCategory) => {
    if (!selected.includes(category)) selected.push(category);
  };

  if (
    caseState.legalIssues.length > 0 ||
    caseState.unknowns.length > 0 ||
    caseState.jurisdiction.basis === 'unknown'
  ) {
    add('legal_aid');
  }

  if (/\b(?:consumer|refund|warranty|defective product|purchase|seller|e-commerce|billing grievance|product complaint)\b/i.test(text)) {
    add('consumer_support');
  }

  const workplaceSexual = domains.includes('workplace_sexual_harassment') ||
    indicators.includes('workplace_sexual_harassment_concern') ||
    /\b(?:at work|workplace|office|supervisor|manager|colleague)\b.{0,80}\b(?:sexual|sexually|sexual harassment)\b|\b(?:sexual|sexually|sexual harassment)\b.{0,80}\b(?:at work|workplace|office|supervisor|manager|colleague)\b/i.test(text);
  if (workplaceSexual) {
    add('workplace_safeguarding');
    add('workplace_harassment');
  }

  const cyber = domains.some((domain) => domain === 'cyber_harassment' || domain === 'intimate_image_abuse') ||
    indicators.some((category) => ['cyber_harassment_context', 'intimate_image_abuse', 'blackmail'].includes(category)) ||
    /\b(?:cybercrime|cyber fraud|online financial fraud|phishing|hacked|intimate image|non-consensual image)\b/i.test(text);
  if (cyber) {
    add('cybercrime');
    add('cyber_safety');
  }

  return selected;
}
