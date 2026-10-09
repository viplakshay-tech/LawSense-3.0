import type {
  LegalApplicability,
  LegalAuthority,
  LegalDocument,
  LegalKnowledgePackage,
  LegalKnowledgeSnapshot,
  LegalKnowledgePolicy,
  LegalProvision,
  LegalProvenance,
  LegalRule,
  LegalSource,
  LegalProcedure,
  OfficialSourceReference,
} from './types.ts';

export function isDateOnly(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function isTimestamp(value: string | null | undefined): value is string {
  return Boolean(value && Number.isFinite(Date.parse(value)) && /^\d{4}-\d{2}-\d{2}T/.test(value));
}

export function isSha256(value: string | null | undefined): value is string {
  return Boolean(value && /^[a-f\d]{64}$/i.test(value));
}

export function sameOfficialReference(
  left: OfficialSourceReference,
  right: OfficialSourceReference,
): boolean {
  return left.catalogId === right.catalogId && left.recordId === right.recordId;
}

export function validateOfficialReference(
  reference: OfficialSourceReference,
  policy: LegalKnowledgePolicy,
  label: string,
): string[] {
  const errors: string[] = [];
  if (!reference.catalogId.trim() || !reference.recordId.trim()) {
    errors.push(`${label}: catalog and record identifiers are required`);
    return errors;
  }

  const catalog = policy.referenceCatalogs.find((item) => item.id === reference.catalogId);
  if (!catalog || !catalog.official) {
    errors.push(`${label}: reference catalog is not configured as official`);
    return errors;
  }

  if (reference.url?.trim()) {
    try {
      const url = new URL(reference.url);
      const host = url.hostname.toLowerCase();
      const allowed = catalog.allowedHosts.some((allowedHost) => {
        const normalized = allowedHost.toLowerCase().replace(/^\.+|\.+$/g, '');
        return host === normalized || host.endsWith(`.${normalized}`);
      });
      if (url.protocol !== 'https:' || url.username || url.password || !allowed) {
        errors.push(`${label}: URL must use HTTPS and match an allowed host for its catalog`);
      }
    } catch {
      errors.push(`${label}: URL is invalid`);
    }
  }

  return errors;
}

export function validateProvenance(
  provenance: LegalProvenance[],
  policy: LegalKnowledgePolicy,
  label: string,
): string[] {
  if (provenance.length === 0) return [`${label}: provenance is required`];
  return provenance.flatMap((entry, index) => {
    const entryLabel = `${label} provenance ${index + 1}`;
    const errors = validateOfficialReference(entry.reference, policy, entryLabel);
    if (!isTimestamp(entry.capturedAt)) errors.push(`${entryLabel}: capture time must be an ISO timestamp`);
    if (!entry.recordedBy.trim()) errors.push(`${entryLabel}: recorder identifier is required`);
    if (entry.contentSha256 && !isSha256(entry.contentSha256)) {
      errors.push(`${entryLabel}: content hash must be SHA-256`);
    }
    return errors;
  });
}

function validateApplicability(value: LegalApplicability, label: string): string[] {
  if (value.state !== 'applicable') return [];
  const errors: string[] = [];
  if (!value.jurisdictionId?.trim()) errors.push(`${label}: confirmed applicability needs a jurisdiction`);
  if (!isDateOnly(value.asOf)) errors.push(`${label}: confirmed applicability needs an effective date`);
  if (!isTimestamp(value.assessedAt)) errors.push(`${label}: confirmed applicability needs an assessment timestamp`);
  if (!value.assessedBy?.trim()) errors.push(`${label}: confirmed applicability needs a reviewer`);
  if (value.method !== 'human_review') errors.push(`${label}: confirmed applicability requires human review`);
  if (!value.basisReferences?.some((reference) => reference.trim())) {
    errors.push(`${label}: confirmed applicability needs a recorded basis`);
  }
  return errors;
}

function validateAuthority(
  authority: LegalAuthority,
  snapshot: LegalKnowledgeSnapshot,
  policy: LegalKnowledgePolicy,
): string[] {
  const label = `authority ${authority.id}`;
  const errors = validateOfficialReference(authority.officialReference, policy, `${label} reference`);
  errors.push(...validateProvenance(authority.provenance, policy, label));
  if (authority.authorityLevel !== 'unknown' && authority.authorityLevelEvidence.length === 0) {
    errors.push(`${label}: authority level needs an official evidence reference`);
  }
  for (const [index, reference] of authority.authorityLevelEvidence.entries()) {
    errors.push(...validateOfficialReference(reference, policy, `${label} level evidence ${index + 1}`));
  }
  if (!authority.id.trim() || !authority.name.trim()) errors.push(`${label}: identifier and name are required`);
  if (!snapshot.jurisdictions.some((item) => item.id === authority.jurisdictionId)) {
    errors.push(`${label}: jurisdiction is not registered`);
  }
  if (!authority.provenance.some((item) => sameOfficialReference(item.reference, authority.officialReference))) {
    errors.push(`${label}: provenance must identify the official authority reference`);
  }
  return errors;
}

function validateSource(
  source: LegalSource,
  authority: LegalAuthority | undefined,
  snapshot: LegalKnowledgeSnapshot,
  policy: LegalKnowledgePolicy,
): string[] {
  const label = `source ${source.id}`;
  const errors = validateOfficialReference(source.officialReference, policy, `${label} reference`);
  errors.push(...validateProvenance(source.provenance, policy, label));
  if (!source.id.trim() || !source.canonicalKey.trim() || !source.title.trim()) {
    errors.push(`${label}: identifier, canonical key, and title are required`);
  }
  if (!authority || authority.id !== source.authorityId) errors.push(`${label}: issuing authority is not registered`);
  if (!snapshot.jurisdictions.some((item) => item.id === source.jurisdictionId)) {
    errors.push(`${label}: jurisdiction is not registered`);
  }
  if (!source.provenance.some((item) => sameOfficialReference(item.reference, source.officialReference))) {
    errors.push(`${label}: provenance must identify the official source reference`);
  }
  if (!source.version.id.trim() || !source.version.label.trim()) {
    errors.push(`${label}: version identifier and label are required`);
  }
  if (source.version.effectiveFrom !== null && !isDateOnly(source.version.effectiveFrom)) {
    errors.push(`${label}: effective-from date is invalid`);
  }
  if (source.version.effectiveUntil !== null && !isDateOnly(source.version.effectiveUntil)) {
    errors.push(`${label}: effective-until date is invalid`);
  }
  if (
    isDateOnly(source.version.effectiveFrom) &&
    isDateOnly(source.version.effectiveUntil) &&
    source.version.effectiveUntil < source.version.effectiveFrom
  ) {
    errors.push(`${label}: effective-until date precedes effective-from date`);
  }
  if (source.verification.state === 'verified_official') {
    if (!isTimestamp(source.verification.checkedAt)) errors.push(`${label}: verification timestamp is required`);
    if (!source.verification.checkedBy?.trim()) errors.push(`${label}: verification reviewer is required`);
    if (!source.verification.evidenceReference) errors.push(`${label}: verification evidence is required`);
    else errors.push(...validateOfficialReference(source.verification.evidenceReference, policy, `${label} verification evidence`));
  }
  if (source.freshness.state === 'fresh' && !isTimestamp(source.freshness.checkedAt)) {
    errors.push(`${label}: fresh status requires a check timestamp`);
  }
  return errors;
}

function validateDocument(
  document: LegalDocument,
  source: LegalSource | undefined,
  policy: LegalKnowledgePolicy,
): string[] {
  const label = `document ${document.id}`;
  const errors = validateOfficialReference(document.officialReference, policy, `${label} reference`);
  errors.push(...validateProvenance(document.provenance, policy, label));
  if (!document.id.trim() || !document.title.trim() || !document.mediaType.trim()) {
    errors.push(`${label}: identifier, title, and media type are required`);
  }
  if (!isSha256(document.contentSha256)) errors.push(`${label}: content hash must be SHA-256`);
  if (!source || source.id !== document.sourceId || source.version.id !== document.sourceVersionId) {
    errors.push(`${label}: source version is not registered`);
  }
  if (!document.provenance.some((item) => sameOfficialReference(item.reference, document.officialReference))) {
    errors.push(`${label}: provenance must identify the document reference`);
  }
  return errors;
}

function validateProvision(
  provision: LegalProvision,
  source: LegalSource | undefined,
  documents: Map<string, LegalDocument>,
  snapshot: LegalKnowledgeSnapshot,
  policy: LegalKnowledgePolicy,
): string[] {
  const label = `provision ${provision.id}`;
  const errors = validateProvenance(provision.provenance, policy, label);
  errors.push(...validateApplicability(provision.applicability, label));
  if (!provision.id.trim() || !provision.locator.trim() || !provision.text.trim()) {
    errors.push(`${label}: identifier, source locator, and text are required`);
  }
  if (!source || source.id !== provision.sourceId || source.version.id !== provision.sourceVersionId) {
    errors.push(`${label}: source version is not registered`);
  }
  if (!source || source.authorityId !== provision.authorityId) errors.push(`${label}: authority does not match its source`);
  if (!snapshot.jurisdictions.some((item) => item.id === provision.jurisdictionId)) {
    errors.push(`${label}: jurisdiction is not registered`);
  }
  if (provision.documentIds.some((id) => !documents.has(id))) {
    errors.push(`${label}: a linked document is not registered`);
  }
  return errors;
}

function validateRule(
  rule: LegalRule,
  provisions: Map<string, LegalProvision>,
  snapshot: LegalKnowledgeSnapshot,
  policy: LegalKnowledgePolicy,
): string[] {
  const label = `rule ${rule.id}`;
  const errors = validateProvenance(rule.provenance, policy, label);
  errors.push(...validateApplicability(rule.applicability, label));
  if (!rule.id.trim() || !rule.title.trim() || !rule.proposition.trim()) {
    errors.push(`${label}: identifier, title, and proposition are required`);
  }
  if (!rule.provisionIds.length || rule.provisionIds.some((id) => !provisions.has(id))) {
    errors.push(`${label}: at least one registered basis provision is required`);
  }
  if (!rule.legalIssueIds.length || rule.legalIssueIds.some((id) => !snapshot.issues.some((issue) => issue.id === id))) {
    errors.push(`${label}: at least one registered legal issue is required`);
  }
  return errors;
}

function validateProcedure(
  procedure: LegalProcedure,
  sources: Map<string, LegalSource>,
  provisions: Map<string, LegalProvision>,
  documents: Map<string, LegalDocument>,
  snapshot: LegalKnowledgeSnapshot,
  policy: LegalKnowledgePolicy,
): string[] {
  const label = `procedure ${procedure.id}`;
  const errors = validateProvenance(procedure.provenance, policy, label);
  errors.push(...validateApplicability(procedure.applicability, label));
  const source = sources.get(procedure.sourceId);
  if (!procedure.id.trim() || !procedure.title.trim() || !procedure.steps.length) {
    errors.push(`${label}: identifier, title, and at least one step are required`);
  }
  if (!source || source.version.id !== procedure.sourceVersionId) errors.push(`${label}: source version is not registered`);
  if (!source || source.authorityId !== procedure.authorityId) errors.push(`${label}: authority does not match its source`);
  if (!snapshot.jurisdictions.some((item) => item.id === procedure.jurisdictionId)) {
    errors.push(`${label}: jurisdiction is not registered`);
  }
  if (!procedure.legalIssueIds.length || procedure.legalIssueIds.some((id) => !snapshot.issues.some((issue) => issue.id === id))) {
    errors.push(`${label}: at least one registered legal issue is required`);
  }
  procedure.steps.forEach((step) => {
    if (!step.instruction.trim()) errors.push(`${label} step ${step.id}: instruction is required`);
    if (!step.basisProvisionIds.length && !step.basisDocumentIds.length) {
      errors.push(`${label} step ${step.id}: a provision or document basis is required`);
    }
    if (step.basisProvisionIds.some((id) => !provisions.has(id))) {
      errors.push(`${label} step ${step.id}: a basis provision is not registered`);
    }
    if (step.basisDocumentIds.some((id) => !documents.has(id))) {
      errors.push(`${label} step ${step.id}: a basis document is not registered`);
    }
  });
  return errors;
}

function packageNodes(knowledgePackage: LegalKnowledgePackage, snapshot: LegalKnowledgeSnapshot) {
  const authorities = new Map([...snapshot.authorities, ...(knowledgePackage.authorities ?? [])].map((item) => [item.id, item]));
  const sources = new Map([...snapshot.sources, ...(knowledgePackage.sources ?? [])].map((item) => [item.id, item]));
  const documents = new Map([...snapshot.documents, ...(knowledgePackage.documents ?? [])].map((item) => [item.id, item]));
  const provisions = new Map([...snapshot.provisions, ...(knowledgePackage.provisions ?? [])].map((item) => [item.id, item]));
  const rules = new Map([...snapshot.rules, ...(knowledgePackage.rules ?? [])].map((item) => [item.id, item]));
  const procedures = new Map([...snapshot.procedures, ...(knowledgePackage.procedures ?? [])].map((item) => [item.id, item]));
  return { authorities, sources, documents, provisions, rules, procedures };
}

export function validateKnowledgePackage(
  knowledgePackage: LegalKnowledgePackage,
  existing: LegalKnowledgeSnapshot,
  policy: LegalKnowledgePolicy,
): string[] {
  const authorities = knowledgePackage.authorities ?? [];
  const jurisdictions = knowledgePackage.jurisdictions ?? [];
  const sources = knowledgePackage.sources ?? [];
  const documents = knowledgePackage.documents ?? [];
  const provisions = knowledgePackage.provisions ?? [];
  const rules = knowledgePackage.rules ?? [];
  const procedures = knowledgePackage.procedures ?? [];
  const relationships = knowledgePackage.relationships ?? [];
  const incomingIds = [
    ...jurisdictions.map((item) => item.id),
    ...(knowledgePackage.issues ?? []).map((item) => item.id),
    ...authorities.map((item) => item.id),
    ...sources.map((item) => item.id),
    ...documents.map((item) => item.id),
    ...provisions.map((item) => item.id),
    ...rules.map((item) => item.id),
    ...procedures.map((item) => item.id),
    ...relationships.map((item) => item.id),
  ];
  const duplicateIds = incomingIds.filter((id, index) => incomingIds.indexOf(id) !== index);
  const errors = duplicateIds.map((id) => `registration package contains duplicate identifier ${id}`);
  const existingIds = new Set([
    ...existing.jurisdictions.map((item) => item.id),
    ...existing.issues.map((item) => item.id),
    ...existing.authorities.map((item) => item.id),
    ...existing.sources.map((item) => item.id),
    ...existing.documents.map((item) => item.id),
    ...existing.provisions.map((item) => item.id),
    ...existing.rules.map((item) => item.id),
    ...existing.procedures.map((item) => item.id),
    ...existing.relationships.map((item) => item.id),
  ]);
  for (const id of incomingIds) if (existingIds.has(id)) errors.push(`identifier ${id} is already registered`);

  const sourceVersionKeys = [
    ...existing.sources,
    ...sources,
  ].map((source) => `${source.canonicalKey}\u0000${source.version.id}`);
  if (new Set(sourceVersionKeys).size !== sourceVersionKeys.length) {
    errors.push('canonical source version identifiers must be unique');
  }

  const jurisdictionIds = new Set([...existing.jurisdictions, ...jurisdictions].map((item) => item.id));
  for (const jurisdiction of jurisdictions) {
    if (!jurisdiction.id.trim() || !jurisdiction.code.trim() || !jurisdiction.label.trim()) {
      errors.push(`jurisdiction ${jurisdiction.id}: identifier, code, and label are required`);
    }
    if (jurisdiction.parentId && !jurisdictionIds.has(jurisdiction.parentId)) {
      errors.push(`jurisdiction ${jurisdiction.id}: parent jurisdiction is not registered`);
    }
    if (jurisdiction.parentId === jurisdiction.id) errors.push(`jurisdiction ${jurisdiction.id}: cannot be its own parent`);
  }
  const jurisdictionMap = new Map([...existing.jurisdictions, ...jurisdictions].map((item) => [item.id, item]));
  for (const jurisdiction of jurisdictions) {
    const visited = new Set<string>();
    let current: typeof jurisdiction | undefined = jurisdiction;
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      current = current.parentId ? jurisdictionMap.get(current.parentId) : undefined;
    }
    if (current) errors.push(`jurisdiction ${jurisdiction.id}: parent chain contains a cycle`);
  }
  const issues = [...existing.issues, ...(knowledgePackage.issues ?? [])];
  for (const issue of knowledgePackage.issues ?? []) {
    if (!issue.id.trim() || !issue.domain.trim() || !issue.label.trim()) {
      errors.push(`issue ${issue.id}: identifier, domain, and label are required`);
    }
  }
  const combined = {
    ...existing,
    jurisdictions: [...existing.jurisdictions, ...jurisdictions],
    issues,
    authorities: [...existing.authorities, ...authorities],
  };
  const nodes = packageNodes(knowledgePackage, existing);
  for (const authority of authorities) errors.push(...validateAuthority(authority, combined, policy));
  for (const source of sources) errors.push(...validateSource(source, nodes.authorities.get(source.authorityId), combined, policy));
  for (const document of documents) errors.push(...validateDocument(document, nodes.sources.get(document.sourceId), policy));
  for (const provision of provisions) {
    errors.push(...validateProvision(provision, nodes.sources.get(provision.sourceId), nodes.documents, combined, policy));
  }
  for (const rule of rules) errors.push(...validateRule(rule, nodes.provisions, combined, policy));
  for (const procedure of procedures) {
    errors.push(...validateProcedure(procedure, nodes.sources, nodes.provisions, nodes.documents, combined, policy));
  }

  const knownNodes = new Set<string>([
    ...combined.issues.map((item) => `legal_issue:${item.id}`),
    ...[...nodes.authorities.keys()].map((id) => `authority:${id}`),
    ...[...nodes.sources.keys()].map((id) => `source:${id}`),
    ...[...nodes.documents.keys()].map((id) => `document:${id}`),
    ...[...nodes.provisions.keys()].map((id) => `provision:${id}`),
    ...[...nodes.rules.keys()].map((id) => `rule:${id}`),
    ...[...nodes.procedures.keys()].map((id) => `procedure:${id}`),
  ]);
  for (const relation of relationships) {
    errors.push(...validateProvenance(relation.provenance, policy, `relationship ${relation.id}`));
    for (const endpoint of [relation.from, relation.to]) {
      if (!endpoint.id.trim()) errors.push(`relationship ${relation.id}: endpoint identifier is required`);
      if (endpoint.type !== 'case_document' && !knownNodes.has(`${endpoint.type}:${endpoint.id}`)) {
        errors.push(`relationship ${relation.id}: endpoint ${endpoint.type}:${endpoint.id} is not registered`);
      }
    }
  }
  return errors;
}

export class LegalKnowledgeRegistrationError extends Error {
  readonly errors: string[];

  constructor(errors: string[]) {
    super(`Legal knowledge registration refused: ${errors.join('; ')}`);
    this.name = 'LegalKnowledgeRegistrationError';
    this.errors = errors;
  }
}

export async function ingestOfficialDocument<TInput>(
  input: TInput,
  adapter: { toLegalKnowledgePackage(input: TInput): Promise<LegalKnowledgePackage> | LegalKnowledgePackage },
  registry: {
    readSnapshot(): Promise<LegalKnowledgeSnapshot>;
    registerPackage(knowledgePackage: LegalKnowledgePackage): Promise<void>;
  },
  policy: LegalKnowledgePolicy,
): Promise<{ registered: number; sourceIds: string[]; documentIds: string[] }> {
  const knowledgePackage = await adapter.toLegalKnowledgePackage(input);
  const snapshot = await registry.readSnapshot();
  const errors = validateKnowledgePackage(knowledgePackage, snapshot, policy);
  if (errors.length) throw new LegalKnowledgeRegistrationError(errors);
  await registry.registerPackage(knowledgePackage);
  const registered = Object.values(knowledgePackage).reduce((total, records) => total + (records?.length ?? 0), 0);
  return {
    registered,
    sourceIds: (knowledgePackage.sources ?? []).map((source) => source.id),
    documentIds: (knowledgePackage.documents ?? []).map((document) => document.id),
  };
}

export function emptyKnowledgeSnapshot(): LegalKnowledgeSnapshot {
  return {
    jurisdictions: [],
    issues: [],
    authorities: [],
    sources: [],
    documents: [],
    provisions: [],
    rules: [],
    procedures: [],
    relationships: [],
  };
}
