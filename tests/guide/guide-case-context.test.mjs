import assert from 'node:assert/strict';
import test from 'node:test';

import { buildGuideCaseContext, sendGuideMessage } from '../../lib/api.ts';

function makeCaseState() {
  return {
    id: 'case-private-id-not-sent',
    title: 'Rental deposit',
    initialStatement: 'My landlord has not returned the security deposit.',
    intent: { objective: 'Understand my options', urgency: 'medium' },
    jurisdiction: {
      country: 'India',
      state: 'Uttarakhand',
      district: 'Haridwar',
      city: null,
      locationText: null,
      basis: 'user_reported',
    },
    facts: Array.from({ length: 8 }, (_, index) => ({
      id: `fact-${index}`,
      key: `fact ${index}`,
      value: index === 0 ? { amount: 30000, currency: 'INR' } : `value ${index}`,
      status: index === 0 ? 'user_reported' : 'system_inferred',
      confidence: index === 0 ? 'medium' : 'unknown',
      sourceIds: [],
      provenance: [],
    })),
    unknowns: ['Was there a written agreement?'],
    assumptions: ['The landlord received the full deposit.'],
    conflicts: ['Two recorded dates differ.'],
    evidence: [{
      id: 'evidence-private-id',
      title: 'Rental agreement',
      source: 'document',
      status: 'unknown',
      documentId: 'document-private-id',
      extractedFacts: [],
      supportsClaimIds: [],
      conflictsWithClaimIds: [],
    }],
    documents: [{ id: 'document-private-id', filename: 'private-agreement.pdf' }],
    claims: [],
    legalIssues: [{ id: 'issue-1', category: 'housing', confidence: 'medium', rationale: [] }],
    person: { name: 'Private Name', contact: '9999999999' },
    parties: [],
    events: [],
    skippedClarificationIds: [],
    metadata: { createdAt: '2026-01-01', updatedAt: '2026-01-02' },
    analysis: {
      safetyContext: { context: 'none', urgency: 'none' },
      legalKnowledge: {
        status: 'records_found',
        records: [{
          id: 'law-private-id',
          title: 'Candidate tenancy provision',
          type: 'legal_provision',
          status: 'verified',
          jurisdiction: 'Uttarakhand',
          sourceVerificationStatus: 'verified',
          sourceFreshnessStatus: 'unknown',
          sourceApplicabilityStatus: 'unknown',
          provenance: [],
        }],
      },
      journey: {
        unknowns: [{ id: 'journey-unknown-1', question: 'When was the deposit due?' }],
      },
    },
  };
}

test('Guide case context is compact, bounded, and preserves uncertainty labels', () => {
  const caseState = makeCaseState();
  const context = buildGuideCaseContext(caseState);

  assert.equal(context.jurisdiction, 'Haridwar, Uttarakhand, India');
  assert.equal(context.jurisdictionBasis, 'user_reported');
  assert.equal(context.facts.length, 6);
  assert.equal(context.facts[0].status, 'user_reported');
  assert.equal(context.facts[1].status, 'system_inferred');
  assert.equal(context.documentCount, 1);
  assert.deepEqual(context.openQuestions, [
    'Was there a written agreement?',
    'When was the deposit due?',
  ]);
  assert.equal(context.legalKnowledgeStatus, 'records_found');
  assert.equal(context.legalSources[0].applicabilityStatus, 'unknown');
  assert.equal(context.safetyContext, 'none');

  const serialized = JSON.stringify(context);
  assert.equal(serialized.includes('Private Name'), false);
  assert.equal(serialized.includes('9999999999'), false);
  assert.equal(serialized.includes('private-agreement.pdf'), false);
  assert.equal(serialized.includes('case-private-id-not-sent'), false);
  assert.equal(serialized.includes('document-private-id'), false);
  assert.equal(serialized.includes('law-private-id'), false);
});

test('Guide chat sends the same status-preserving context using the API schema', async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl;
  let capturedBody;
  globalThis.fetch = async (url, init) => {
    capturedUrl = url;
    capturedBody = JSON.parse(init.body);
    return new Response(JSON.stringify({
      reply: 'Pehle agreement ki date confirm karte hain.',
      status: 'ok',
      model: 'test-local-model',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const context = buildGuideCaseContext(makeCaseState());
    const history = Array.from({ length: 10 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `${index}:${'x'.repeat(1_998)}`,
    }));
    const response = await sendGuideMessage('What should I clarify first?', 'hinglish', context, history);

    assert.equal(capturedUrl, '/api/guide/chat');
    assert.equal(capturedBody.language, 'hinglish');
    assert.equal(capturedBody.conversation_history.length, 4);
    assert.equal(capturedBody.conversation_history.reduce((sum, turn) => sum + turn.content.length, 0), 8_000);
    assert.equal(capturedBody.conversation_history[0].content.startsWith('6:'), true);
    assert.equal(capturedBody.conversation_history[3].content.startsWith('9:'), true);
    assert.deepEqual(capturedBody.conversation_history.map((turn) => turn.role), ['user', 'assistant', 'user', 'assistant']);
    assert.equal(capturedBody.case_context.initial_statement, 'My landlord has not returned the security deposit.');
    assert.equal(capturedBody.case_context.user_objective, 'Understand my options');
    assert.equal(capturedBody.case_context.objective_urgency, 'medium');
    assert.equal(capturedBody.case_context.facts[0].status, 'user_reported');
    assert.equal(capturedBody.case_context.facts[1].status, 'system_inferred');
    assert.equal(capturedBody.case_context.legal_sources[0].applicability_status, 'unknown');
    assert.equal(capturedBody.case_context.safety_context, 'none');
    assert.equal(response.status, 'ok');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
