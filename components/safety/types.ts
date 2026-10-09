import type { WomenSafetyContextSummary } from '@/lib/api';

export type ImmediateDangerAnswer = 'yes' | 'no' | 'not_sure';
export type SafetyLanguage = 'en' | 'hi' | 'hinglish';
export type SafetyLanguagePreference = 'auto' | SafetyLanguage;

export interface SafetySupportResource {
  resource_id?: string | null;
  name?: string | null;
  category?: string | null;
  jurisdiction?: string | null;
  official?: boolean;
  verification_status?: string | null;
  url?: string | null;
  phone?: string | null;
  description?: string | null;
  provenance?: Array<{
    source_id?: string | null;
    source_url?: string | null;
    verified_on?: string | null;
  }>;
}

export interface SafetyResourceAvailability {
  category: string;
  status: string;
  jurisdiction: string | null;
  state: string | null;
}

export interface SafetySupportAssessment {
  context: string;
  situations: string[];
  urgency: string;
  trigger_evidence: Array<{
    category: string;
    matched_text: string;
    situations: string[];
    origin: string;
    source_type: 'case_state' | 'request';
    source_id: string;
    source_path: string;
  }>;
  uncertainty: string[];
  user_facing_safety_prompt: string | null;
  evidence_preservation_guidance: string[];
  escalation_options: string[];
  resource_categories: string[];
  resources: SafetySupportResource[];
  resource_availability?: SafetyResourceAvailability[];
  safe_next_step_sequence: string[];
  language: SafetyLanguage;
  workflow_disposition: string;
  legal_workflow_allowed: boolean;
  contacted_anyone: false;
  women_safety_context?: WomenSafetyContextSummary;
}

export interface SafetySupportResponse {
  case_id: string;
  status: 'available';
  resource_status: 'available' | 'unavailable';
  contacted_anyone: false;
  assessment: SafetySupportAssessment;
}

export interface SafetySupportRequest {
  immediate_danger?: ImmediateDangerAnswer;
  language?: SafetyLanguage;
}
