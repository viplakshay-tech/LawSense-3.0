import assert from 'node:assert/strict';
import test from 'node:test';
import {
  selectRequestedOfficialResourceCategories,
  verifiedOfficialResourceUrl,
} from '../../lib/officialResources.ts';

function caseState(overrides = {}) {
  return {
    id: 'case-test',
    title: 'Case',
    initialStatement: '',
    person: {},
    parties: [],
    facts: [],
    events: [],
    evidence: [],
    documents: [],
    claims: [],
    jurisdiction: { basis: 'user_reported' },
    legalIssues: [],
    unknowns: [],
    skippedClarificationIds: [],
    assumptions: [],
    conflicts: [],
    metadata: { createdAt: '', updatedAt: '' },
    ...overrides,
  };
}

test('resource selection follows case context and leaves unrelated cases unclassified', () => {
  assert.deepEqual(selectRequestedOfficialResourceCategories(caseState()), []);
  assert.deepEqual(
    selectRequestedOfficialResourceCategories(caseState({
      initialStatement: 'I bought a defective product and the seller will not issue a refund.',
    })),
    ['consumer_support'],
  );
});

test('workplace reporting is suggested for sexual harassment and not generic workplace concerns', () => {
  const relevant = selectRequestedOfficialResourceCategories(caseState({
    initialStatement: 'My supervisor sends unwanted sexual messages at work.',
  }));
  const generic = selectRequestedOfficialResourceCategories(caseState({
    initialStatement: 'My supervisor repeatedly criticizes my work.',
  }));

  assert.ok(relevant.includes('workplace_safeguarding'));
  assert.ok(relevant.includes('workplace_harassment'));
  assert.ok(!generic.includes('workplace_safeguarding'));
});

test('resource links require HTTPS and an Indian government host', () => {
  assert.equal(
    verifiedOfficialResourceUrl('https://wcd.gov.in/women/help'),
    'https://wcd.gov.in/women/help',
  );
  assert.equal(
    verifiedOfficialResourceUrl('https://shebox.wcd.gov.in/'),
    'https://shebox.wcd.gov.in/',
  );
  assert.equal(verifiedOfficialResourceUrl('http://wcd.gov.in/women/help'), null);
  assert.equal(verifiedOfficialResourceUrl('javascript:alert(1)'), null);
  assert.equal(verifiedOfficialResourceUrl('https://example.com/resource'), null);
});
