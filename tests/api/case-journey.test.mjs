import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CASE_JOURNEY_STAGES,
  getCaseJourneyStageAssessment,
  getCaseJourneyStageStatus,
} from '../../lib/case-journey.ts';

const executionStageNames = [
  'Problem',
  'Clarify',
  'Facts',
  'Evidence',
  'Law',
  'Possible Paths',
  'Document',
  'Official Resource',
  'Action',
  'Follow-up',
];

function makeCase(overrides = {}) {
  return {
    id: 'case-journey-test',
    initialStatement: 'A saved case statement.',
    facts: [],
    events: [],
    claims: [],
    evidence: [],
    documents: [],
    legalIssues: [],
    unknowns: [],
    analysis: null,
    ...overrides,
  };
}

function makeExecution(overrides = {}) {
  const { execution: executionOverrides = {}, ...responseOverrides } = overrides;
  return {
    caseId: 'case-journey-test',
    status: 'available',
    legalKnowledgeStatus: 'available',
    ...responseOverrides,
    execution: {
      id: 'execution-test',
      case_id: 'case-journey-test',
      current_stage: 'Problem',
      jurisdiction: {},
      jurisdiction_status: 'unknown',
      stage_progress: executionStageNames.map((stage) => ({
        stage,
        required_inputs: [],
        inputs: [],
        completed: false,
        completed_at: null,
      })),
      missing_information: [],
      evidence_requests: [],
      document_requests: [],
      user_actions: [],
      procedural_next_steps: [],
      timeline_events: [],
      provenance: [],
      uncertainties: [],
      completed_stages: [],
      blocked_stages: [],
      blockers: [],
      recorded_fact_count: 0,
      conflicts: [],
      assumptions: [],
      pending_evidence_reviews: [],
      safety_context: 'none',
      safety_urgency: 'none',
      safety_source_ids: [],
      legal_records_available: true,
      case_readiness: {
        score: 100,
        explanation: 'Fixture readiness.',
        dimensions: ['facts', 'evidence', 'jurisdiction', 'legal_grounding', 'documents', 'procedure', 'safety']
          .map((name) => ({ name, score: 100, level: 'ready', explanation: '', blocker_ids: [], source_ids: [] })),
        blockers: [],
      },
      action_plan: [],
      next_best_action: null,
      ...executionOverrides,
    },
  };
}

function progressFor(execution, stage) {
  return execution.execution.stage_progress.find((item) => item.stage === stage);
}

test('unmapped stages and missing execution records stay unknown', () => {
  assert.equal(CASE_JOURNEY_STAGES.length, 9);
  assert.deepEqual(CASE_JOURNEY_STAGES.map((stage) => stage.id), [
    'understand', 'clarify', 'protect', 'evidence', 'law', 'twin', 'prepare', 'act', 'monitor_update',
  ]);
  assert.equal(getCaseJourneyStageStatus(null, null, 'protect'), 'Unknown');
  assert.equal(getCaseJourneyStageStatus(null, null, 'twin'), 'Unknown');
  assert.equal(getCaseJourneyStageStatus(null, null, 'future-stage'), 'Unknown');

  const caseState = makeCase({
    analysis: {
      safetyContext: { context: 'none' },
      journey: { steps: [], unknowns: [] },
    },
  });
  const missingProgress = makeExecution({ execution: { stage_progress: [] } });
  assert.equal(getCaseJourneyStageStatus(caseState, missingProgress, 'evidence'), 'Unknown');
  assert.equal(getCaseJourneyStageStatus(caseState, missingProgress, 'protect'), 'Available');
  assert.equal(getCaseJourneyStageStatus(caseState, missingProgress, 'twin'), 'Available');
  assert.equal(getCaseJourneyStageStatus(caseState, missingProgress, 'monitor_update'), 'Available');
  assert.equal(getCaseJourneyStageStatus(null, missingProgress, 'monitor_update'), 'Unknown');
});

test('incomplete saved cases report current and blocked stages without false completion', () => {
  const caseState = makeCase({ unknowns: ['When did the refund request happen?'] });
  const execution = makeExecution({
    execution: {
      blocked_stages: ['Clarify', 'Facts', 'Evidence', 'Follow-up'],
      blockers: [
        { stage: 'Clarify', message: 'Resolve or record the open refund timing question.' },
        { stage: 'Evidence', message: 'Evidence request remains unaddressed: Order confirmation.' },
      ],
      missing_information: [{
        id: 'unknown-date',
        question: 'When did the refund request happen?',
        status: 'open',
        related_to: null,
      }],
    },
  });

  assert.equal(getCaseJourneyStageStatus(caseState, execution, 'understand'), 'In progress');
  assert.equal(getCaseJourneyStageStatus(caseState, execution, 'clarify'), 'Blocked');
  assert.equal(getCaseJourneyStageStatus(caseState, execution, 'evidence'), 'Blocked');
  assert.equal(getCaseJourneyStageStatus(caseState, execution, 'monitor_update'), 'Blocked');
  assert.notEqual(getCaseJourneyStageStatus(caseState, execution, 'prepare'), 'Complete');
  assert.deepEqual(
    getCaseJourneyStageAssessment(caseState, execution, 'clarify').unknowns,
    ['When did the refund request happen?'],
  );
  assert.match(getCaseJourneyStageAssessment(caseState, execution, 'evidence').blockers[0], /unaddressed/);
});

test('updated saved evidence clears its old blocker and refreshes stage progress', () => {
  const originalCase = makeCase();
  const originalExecution = makeExecution({
    execution: {
      blocked_stages: ['Evidence'],
      blockers: [{ stage: 'Evidence', message: 'Evidence request remains unaddressed: Order confirmation.' }],
      evidence_requests: [{
        id: 'request-order',
        item: 'Order confirmation',
        purpose: 'Confirm the purchase.',
        status: 'not_confirmed',
        notes: null,
        source_ids: [],
        provenance_ids: [],
      }],
      case_readiness: {
        score: 20,
        explanation: 'Evidence is not confirmed.',
        dimensions: ['facts', 'evidence', 'jurisdiction', 'legal_grounding', 'documents', 'procedure', 'safety']
          .map((name) => ({ name, score: name === 'evidence' ? 20 : 100, level: name === 'evidence' ? 'blocked' : 'ready', explanation: '', blocker_ids: [], source_ids: [] })),
        blockers: [],
      },
    },
  });
  assert.equal(getCaseJourneyStageStatus(originalCase, originalExecution, 'evidence'), 'Blocked');

  const savedEvidence = { id: 'evidence-order', title: 'Order confirmation', status: 'evidence_supported' };
  const updatedCase = makeCase({ evidence: [savedEvidence] });
  const updatedExecution = makeExecution({
    execution: {
      stage_progress: executionStageNames.map((stage) => stage === 'Evidence'
        ? { stage, required_inputs: ['evidence:request-order'], inputs: [{ key: 'evidence:request-order', value: 'available', source_ids: [savedEvidence.id], provenance_ids: [], recorded_at: '2026-10-09' }], completed: false, completed_at: null }
        : { stage, required_inputs: [], inputs: [], completed: false, completed_at: null }),
      evidence_requests: [{
        id: 'request-order',
        item: 'Order confirmation',
        purpose: 'Confirm the purchase.',
        status: 'available',
        notes: 'Saved evidence is user-confirmed.',
        source_ids: [savedEvidence.id],
        provenance_ids: [],
      }],
      case_readiness: {
        score: 55,
        explanation: 'Evidence is recorded.',
        dimensions: ['facts', 'evidence', 'jurisdiction', 'legal_grounding', 'documents', 'procedure', 'safety']
          .map((name) => ({ name, score: name === 'evidence' ? 55 : 100, level: name === 'evidence' ? 'partial' : 'ready', explanation: '', blocker_ids: [], source_ids: [] })),
        blockers: [],
      },
    },
  });

  assert.equal(getCaseJourneyStageStatus(updatedCase, updatedExecution, 'evidence'), 'In progress');
  assert.deepEqual(getCaseJourneyStageAssessment(updatedCase, updatedExecution, 'evidence').unknowns, []);
});

test('a stage is complete only when its saved execution progress and completion list agree', () => {
  const caseState = makeCase();
  const execution = makeExecution({
    execution: {
      stage_progress: executionStageNames.map((stage) => stage === 'Problem'
        ? { stage, required_inputs: ['problem_summary'], inputs: [{ key: 'problem_summary', value: 'Saved summary.', source_ids: [], provenance_ids: [], recorded_at: '2026-10-09' }], completed: true, completed_at: '2026-10-09' }
        : { stage, required_inputs: [], inputs: [], completed: false, completed_at: null }),
      completed_stages: ['Problem'],
    },
  });

  assert.equal(getCaseJourneyStageStatus(caseState, execution, 'understand'), 'Complete');

  const inconsistent = makeExecution({
    execution: {
      stage_progress: [progressFor(execution, 'Problem')],
      completed_stages: [],
    },
  });
  assert.notEqual(getCaseJourneyStageStatus(caseState, inconsistent, 'understand'), 'Complete');
});
