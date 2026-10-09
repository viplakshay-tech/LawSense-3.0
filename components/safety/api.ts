import type { SafetySupportRequest, SafetySupportResponse } from './types';
import type { WomenSafetyContextSummary } from '@/lib/api';

const SAFETY_API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:8000').replace(/\/$/, '');

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function readField(record: JsonObject, snake: string, camel: string): unknown {
  return record[snake] ?? record[camel];
}

function normalizeWomenSafetyContext(value: unknown): WomenSafetyContextSummary | undefined {
  if (value === null || value === undefined) return undefined;
  const record = asObject(value);
  const objectList = (items: unknown, aliases: Array<[string, string]>) =>
    (Array.isArray(items) ? items : []).map((item) => {
      const source = asObject(item);
      return Object.fromEntries(aliases.map(([snake, camel]) => [
        camel,
        readField(source, snake, camel),
      ]));
    });

  return {
    domains: (record.domains ?? []) as WomenSafetyContextSummary['domains'],
    domainEvidence: objectList(
      readField(record, 'domain_evidence', 'domainEvidence'),
      [['trigger_categories', 'triggerCategories'], ['domain', 'domain'], ['status', 'status']],
    ) as WomenSafetyContextSummary['domainEvidence'],
    urgency: record.urgency as WomenSafetyContextSummary['urgency'],
    immediateDangerAnswer: readField(record, 'immediate_danger_answer', 'immediateDangerAnswer') as WomenSafetyContextSummary['immediateDangerAnswer'],
    jurisdictionStatus: readField(record, 'jurisdiction_status', 'jurisdictionStatus') as WomenSafetyContextSummary['jurisdictionStatus'],
    jurisdiction: record.jurisdiction as string | null | undefined,
    state: record.state as string | null | undefined,
    legalIssueMappings: objectList(
      readField(record, 'legal_issue_mappings', 'legalIssueMappings'),
      [
        ['domain', 'domain'], ['status', 'status'],
        ['candidate_issue_categories', 'candidateIssueCategories'],
        ['matched_case_issue_ids', 'matchedCaseIssueIds'], ['source_record_ids', 'sourceRecordIds'],
      ],
    ) as WomenSafetyContextSummary['legalIssueMappings'],
    procedures: objectList(record.procedures, [
      ['record_id', 'recordId'], ['title', 'title'], ['jurisdiction', 'jurisdiction'],
      ['verification_status', 'verificationStatus'], ['applicability_status', 'applicabilityStatus'],
      ['jurisdiction_match_status', 'jurisdictionMatchStatus'], ['source_ids', 'sourceIds'], ['status', 'status'],
    ]) as WomenSafetyContextSummary['procedures'],
    evidencePreservationGuidance: (readField(record, 'evidence_preservation_guidance', 'evidencePreservationGuidance') ?? []) as string[],
    actions: objectList(record.actions, [
      ['id', 'id'], ['type', 'type'], ['status', 'status'], ['condition', 'condition'],
      ['requires_user_choice', 'requiresUserChoice'], ['jurisdiction_required', 'jurisdictionRequired'],
      ['source_ids', 'sourceIds'], ['automatic_contact', 'automaticContact'],
    ]) as WomenSafetyContextSummary['actions'],
    legalSources: objectList(
      readField(record, 'legal_sources', 'legalSources'),
      [
        ['record_id', 'recordId'], ['source_id', 'sourceId'], ['retrieval_time', 'retrievalTime'],
        ['source_url', 'sourceUrl'], ['provision_id', 'provisionId'],
        ['page_section_reference', 'pageSectionReference'], ['jurisdiction', 'jurisdiction'],
        ['verification_status', 'verificationStatus'], ['freshness_status', 'freshnessStatus'],
        ['applicability_status', 'applicabilityStatus'],
        ['jurisdiction_match_status', 'jurisdictionMatchStatus'],
      ],
    ) as WomenSafetyContextSummary['legalSources'],
    contactedAnyone: readField(record, 'contacted_anyone', 'contactedAnyone') as false,
  };
}

function normalizeTriggerEvidence(value: unknown): SafetySupportResponse['assessment']['trigger_evidence'] {
  return (Array.isArray(value) ? value : []).map((item) => {
    const record = asObject(item);
    return {
      category: String(record.category ?? ''),
      matched_text: String(readField(record, 'matched_text', 'matchedText') ?? ''),
      situations: (record.situations ?? []) as string[],
      origin: String(record.origin ?? ''),
      source_type: readField(record, 'source_type', 'sourceType') as 'case_state' | 'request',
      source_id: String(readField(record, 'source_id', 'sourceId') ?? ''),
      source_path: String(readField(record, 'source_path', 'sourcePath') ?? ''),
    };
  });
}

function normalizeSafetyResponse(value: unknown): SafetySupportResponse {
  const raw = asObject(value);
  const assessment = asObject(raw.assessment);
  return {
    case_id: String(readField(raw, 'case_id', 'caseId') ?? ''),
    status: raw.status as 'available',
    resource_status: readField(raw, 'resource_status', 'resourceStatus') as 'available' | 'unavailable',
    contacted_anyone: readField(raw, 'contacted_anyone', 'contactedAnyone') as false,
    assessment: {
      context: String(assessment.context ?? ''),
      situations: (assessment.situations ?? []) as string[],
      urgency: String(assessment.urgency ?? ''),
      trigger_evidence: normalizeTriggerEvidence(readField(assessment, 'trigger_evidence', 'triggerEvidence')),
      uncertainty: (assessment.uncertainty ?? []) as string[],
      user_facing_safety_prompt: readField(assessment, 'user_facing_safety_prompt', 'userFacingSafetyPrompt') as string | null,
      evidence_preservation_guidance: (readField(assessment, 'evidence_preservation_guidance', 'evidencePreservationGuidance') ?? []) as string[],
      escalation_options: (readField(assessment, 'escalation_options', 'escalationOptions') ?? []) as string[],
      resource_categories: (readField(assessment, 'resource_categories', 'resourceCategories') ?? []) as string[],
      resources: (assessment.resources ?? []) as SafetySupportResponse['assessment']['resources'],
      resource_availability: (readField(assessment, 'resource_availability', 'resourceAvailability') ?? []) as SafetySupportResponse['assessment']['resource_availability'],
      safe_next_step_sequence: (readField(assessment, 'safe_next_step_sequence', 'safeNextStepSequence') ?? []) as string[],
      language: assessment.language as SafetySupportResponse['assessment']['language'],
      workflow_disposition: readField(assessment, 'workflow_disposition', 'workflowDisposition') as string,
      legal_workflow_allowed: readField(assessment, 'legal_workflow_allowed', 'legalWorkflowAllowed') as boolean,
      contacted_anyone: readField(assessment, 'contacted_anyone', 'contactedAnyone') as false,
      women_safety_context: normalizeWomenSafetyContext(readField(assessment, 'women_safety_context', 'womenSafetyContext')),
    },
  };
}

export async function getSafetySupport(
  caseId: string,
  request: SafetySupportRequest = {},
): Promise<SafetySupportResponse> {
  const response = await fetch(
    `${SAFETY_API_BASE}/cases/${encodeURIComponent(caseId)}/safety-support`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
      cache: 'no-store',
    },
  );

  if (!response.ok) {
    throw new Error('Safety support is temporarily unavailable.');
  }

  const result = normalizeSafetyResponse(await response.json());
  if (
    result.contacted_anyone !== false ||
    result.assessment?.contacted_anyone !== false ||
    (result.assessment?.women_safety_context !== undefined &&
      result.assessment.women_safety_context.contactedAnyone !== false) ||
    (result.assessment?.women_safety_context?.actions ?? []).some((action) => action.automaticContact !== false) ||
    result.status !== 'available'
  ) {
    throw new Error('The safety response could not be verified.');
  }

  return result;
}
