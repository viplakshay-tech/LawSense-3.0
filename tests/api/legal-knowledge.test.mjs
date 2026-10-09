import assert from 'node:assert/strict';
import test from 'node:test';
import { assessRecordedApplicability, jurisdictionMatch, resolveSourceVersion } from '../../lib/legal-knowledge/applicability.ts';
import { evaluateRuleUse } from '../../lib/legal-knowledge/eligibility.ts';
import { INITIAL_LEGAL_KNOWLEDGE_SEED, INITIAL_LEGAL_KNOWLEDGE_SEED_REPORT } from '../../lib/legal-knowledge/seed.ts';
import { emptyKnowledgeSnapshot, ingestOfficialDocument, validateKnowledgePackage } from '../../lib/legal-knowledge/validation.ts';

const policy = {
  referenceCatalogs: [{ id: 'test-only-catalog', official: true, allowedHosts: [] }],
};

const ref = (recordId) => ({ catalogId: 'test-only-catalog', recordId });
const provenance = (recordId) => [{
  kind: 'official_reference',
  reference: ref(recordId),
  capturedAt: '2025-01-02T00:00:00.000Z',
  recordedBy: 'test-only-registrar',
}];
const applicability = {
  state: 'applicable',
  jurisdictionId: 'IN',
  asOf: '2025-06-01',
  assessedAt: '2025-06-02T00:00:00.000Z',
  assessedBy: 'test-only-reviewer',
  method: 'human_review',
  basisReferences: ['test-only-review-record'],
};

function makeFixture() {
  const authority = {
    id: 'fixture-authority',
    name: 'Test-only authority record',
    kind: 'other',
    authorityLevel: 'binding',
    authorityLevelEvidence: [ref('fixture-authority-level-evidence')],
    jurisdictionId: 'IN',
    officialReference: ref('fixture-authority-reference'),
    provenance: provenance('fixture-authority-reference'),
  };
  const source = {
    id: 'fixture-source-v1',
    canonicalKey: 'fixture-source',
    title: 'Test-only source record',
    kind: 'other_official_material',
    authorityId: authority.id,
    jurisdictionId: 'IN',
    officialReference: ref('fixture-source-reference-v1'),
    version: { id: 'fixture-version-v1', label: 'test-only version 1', effectiveFrom: '2020-01-01', effectiveUntil: null },
    verification: {
      state: 'verified_official',
      checkedAt: '2025-01-02T00:00:00.000Z',
      checkedBy: 'test-only-reviewer',
      evidenceReference: ref('fixture-source-reference-v1'),
    },
    freshness: { state: 'fresh', checkedAt: '2025-01-02T00:00:00.000Z' },
    provenance: provenance('fixture-source-reference-v1'),
  };
  const document = {
    id: 'fixture-document',
    sourceId: source.id,
    sourceVersionId: source.version.id,
    title: 'Test-only document record',
    mediaType: 'text/plain',
    contentSha256: 'a'.repeat(64),
    officialReference: ref('fixture-document-reference'),
    provenance: provenance('fixture-document-reference'),
  };
  const provision = {
    id: 'fixture-provision',
    sourceId: source.id,
    sourceVersionId: source.version.id,
    authorityId: authority.id,
    jurisdictionId: 'IN',
    locator: 'test-only locator; not a legal citation',
    text: 'TEST FIXTURE TEXT — not law',
    documentIds: [document.id],
    applicability: structuredClone(applicability),
    provenance: provenance('fixture-source-reference-v1'),
  };
  const rule = {
    id: 'fixture-rule',
    title: 'Test-only rule record',
    proposition: 'TEST FIXTURE PROPOSITION — not law',
    legalIssueIds: ['tenancy-security-deposit'],
    provisionIds: [provision.id],
    applicability: structuredClone(applicability),
    provenance: provenance('fixture-source-reference-v1'),
  };
  const knowledgePackage = {
    authorities: [authority],
    sources: [source],
    documents: [document],
    provisions: [provision],
    rules: [rule],
    relationships: [
      {
        id: 'fixture-link-issue-provision',
        kind: 'supports',
        from: { type: 'provision', id: provision.id },
        to: { type: 'legal_issue', id: 'tenancy-security-deposit' },
        provenance: provenance('fixture-source-reference-v1'),
      },
      {
        id: 'fixture-link-provision-authority',
        kind: 'issued_by',
        from: { type: 'provision', id: provision.id },
        to: { type: 'authority', id: authority.id },
        provenance: provenance('fixture-source-reference-v1'),
      },
    ],
  };
  const snapshot = {
    ...structuredClone(INITIAL_LEGAL_KNOWLEDGE_SEED),
    ...Object.fromEntries(Object.entries(knowledgePackage).map(([key, value]) => [key, structuredClone(value)])),
  };
  return { authority, source, document, provision, rule, knowledgePackage, snapshot };
}

test('seed contains topics only and reports no populated legal corpus', () => {
  assert.deepEqual(INITIAL_LEGAL_KNOWLEDGE_SEED.issues.map((issue) => issue.id), [
    'tenancy-security-deposit', 'consumer-refund', 'workplace', 'cyber-issues',
  ]);
  assert.equal(INITIAL_LEGAL_KNOWLEDGE_SEED_REPORT.sourceCorpusStatus, 'unpopulated');
  assert.equal(INITIAL_LEGAL_KNOWLEDGE_SEED.sources.length, 0);
  assert.equal(INITIAL_LEGAL_KNOWLEDGE_SEED.provisions.length, 0);
});

test('registration requires a configured official source and matching issuer authority', () => {
  const { knowledgePackage } = makeFixture();
  assert.deepEqual(validateKnowledgePackage(knowledgePackage, INITIAL_LEGAL_KNOWLEDGE_SEED, policy), []);

  const wrongIssuer = structuredClone(knowledgePackage);
  wrongIssuer.sources[0].authorityId = 'missing-authority';
  assert.ok(validateKnowledgePackage(wrongIssuer, INITIAL_LEGAL_KNOWLEDGE_SEED, policy)
    .some((error) => error.includes('issuing authority is not registered')));

  const unconfigured = structuredClone(knowledgePackage);
  unconfigured.sources[0].officialReference.catalogId = 'unconfigured-catalog';
  assert.ok(validateKnowledgePackage(unconfigured, INITIAL_LEGAL_KNOWLEDGE_SEED, policy)
    .some((error) => error.includes('reference catalog is not configured as official')));
});

test('registration rejects provenance that does not point to its official source reference', () => {
  const { knowledgePackage } = makeFixture();
  const changed = structuredClone(knowledgePackage);
  changed.sources[0].provenance = provenance('different-test-reference');
  assert.ok(validateKnowledgePackage(changed, INITIAL_LEGAL_KNOWLEDGE_SEED, policy)
    .some((error) => error.includes('provenance must identify the official source reference')));
});

test('jurisdiction matching follows registered parents and refuses unknown or unrelated locations', () => {
  const jurisdictions = [
    ...INITIAL_LEGAL_KNOWLEDGE_SEED.jurisdictions,
    { id: 'test-child', kind: 'state', code: 'test-child', label: 'Test-only child jurisdiction', parentId: 'IN' },
    { id: 'test-other', kind: 'country', code: 'test-other', label: 'Test-only other jurisdiction', parentId: null },
  ];
  assert.equal(jurisdictionMatch('test-child', 'IN', jurisdictions), 'matched');
  assert.equal(jurisdictionMatch('test-other', 'IN', jurisdictions), 'mismatch');
  assert.equal(jurisdictionMatch('missing-test-location', 'IN', jurisdictions), 'unknown');
});

test('source version resolution selects the version effective on the requested date', () => {
  const { source } = makeFixture();
  const v1 = { ...source, version: { ...source.version, effectiveUntil: '2022-12-31' } };
  const v2 = {
    ...source,
    id: 'fixture-source-v2',
    officialReference: ref('fixture-source-reference-v2'),
    version: { id: 'fixture-version-v2', label: 'test-only version 2', effectiveFrom: '2023-01-01', effectiveUntil: null },
  };
  assert.equal(resolveSourceVersion([v1, v2], source.canonicalKey, '2021-06-01').source.id, v1.id);
  assert.equal(resolveSourceVersion([v1, v2], source.canonicalKey, '2024-06-01').source.id, v2.id);
  assert.equal(resolveSourceVersion([v1, v2], source.canonicalKey, '2019-12-31').state, 'unknown');
  assert.equal(resolveSourceVersion([v1, { ...v2, version: { ...v2.version, effectiveFrom: '2022-01-01' } }], source.canonicalKey, '2022-06-01').state, 'ambiguous');
});

test('automated applicability checks stop at a fact review', () => {
  const { source } = makeFixture();
  const jurisdictions = [
    ...INITIAL_LEGAL_KNOWLEDGE_SEED.jurisdictions,
    { id: 'test-child', kind: 'state', code: 'test-child', label: 'Test-only child jurisdiction', parentId: 'IN' },
    { id: 'test-other', kind: 'country', code: 'test-other', label: 'Test-only other jurisdiction', parentId: null },
  ];
  assert.equal(assessRecordedApplicability(source, {
    jurisdictionId: 'test-child', asOf: '2025-06-01', evaluatedAt: '2025-06-02T00:00:00.000Z',
  }, jurisdictions).state, 'requires_fact_assessment');
  assert.equal(assessRecordedApplicability(source, {
    jurisdictionId: 'test-other', asOf: '2025-06-01', evaluatedAt: '2025-06-02T00:00:00.000Z',
  }, jurisdictions).state, 'not_applicable');
  assert.equal(assessRecordedApplicability(source, { evaluatedAt: '2025-06-02T00:00:00.000Z' }, jurisdictions).state, 'unassessed');
});

test('an unreviewed applicability state cannot pass the rule-use gate', () => {
  const { snapshot } = makeFixture();
  snapshot.rules[0].applicability = {
    state: 'requires_fact_assessment',
    jurisdictionId: 'IN',
    asOf: '2025-06-01',
  };
  const result = evaluateRuleUse({
    ruleId: 'fixture-rule', legalIssueId: 'tenancy-security-deposit', jurisdictionId: 'IN', asOf: '2025-06-01',
  }, snapshot, policy);
  assert.equal(result.status, 'refused');
  assert.ok(result.reasons.includes('applicability_requires_review'));
});

test('missing provenance and stale source status prevent rule use', () => {
  const { snapshot } = makeFixture();
  snapshot.provisions[0].provenance = [];
  snapshot.sources[0].freshness = { state: 'stale', checkedAt: '2025-01-02T00:00:00.000Z' };
  const result = evaluateRuleUse({
    ruleId: 'fixture-rule', legalIssueId: 'tenancy-security-deposit', jurisdictionId: 'IN', asOf: '2025-06-01',
  }, snapshot, policy);
  assert.equal(result.status, 'refused');
  assert.ok(result.reasons.includes('provenance_insufficient'));
  assert.ok(result.reasons.includes('source_not_fresh'));
});

test('the rule-use gate permits review only when source, authority, version, jurisdiction, and human applicability all match', () => {
  const { snapshot } = makeFixture();
  const result = evaluateRuleUse({
    ruleId: 'fixture-rule', legalIssueId: 'tenancy-security-deposit', jurisdictionId: 'IN', asOf: '2025-06-01',
  }, snapshot, policy);
  assert.deepEqual(result, { status: 'eligible_for_review', ruleId: 'fixture-rule', provisionIds: ['fixture-provision'] });
});

test('insufficient source information produces an explicit refusal', () => {
  const result = evaluateRuleUse({ ruleId: 'not-registered' }, INITIAL_LEGAL_KNOWLEDGE_SEED, policy);
  assert.equal(result.status, 'refused');
  assert.ok(result.reasons.includes('missing_issue'));
  assert.ok(result.reasons.includes('missing_jurisdiction'));
  assert.ok(result.reasons.includes('missing_effective_date'));
  assert.ok(result.reasons.includes('rule_not_registered'));
});

test('the document adapter registers a validated package through the registry port', async () => {
  const { knowledgePackage } = makeFixture();
  const calls = [];
  const registry = {
    async readSnapshot() { return structuredClone(INITIAL_LEGAL_KNOWLEDGE_SEED); },
    async registerPackage(value) { calls.push(value); },
  };
  const result = await ingestOfficialDocument(
    { package: knowledgePackage },
    { toLegalKnowledgePackage: (input) => input.package },
    registry,
    policy,
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(result.sourceIds, ['fixture-source-v1']);
  assert.deepEqual(result.documentIds, ['fixture-document']);
  assert.equal(result.registered, 7);
});

test('the registry refuses an adapter package with no configured source provenance', async () => {
  const { knowledgePackage } = makeFixture();
  const registry = {
    async readSnapshot() { return emptyKnowledgeSnapshot(); },
    async registerPackage() { assert.fail('invalid package must not be registered'); },
  };
  await assert.rejects(
    ingestOfficialDocument({}, { toLegalKnowledgePackage: () => knowledgePackage }, registry, { referenceCatalogs: [] }),
    /reference catalog is not configured as official/,
  );
});
