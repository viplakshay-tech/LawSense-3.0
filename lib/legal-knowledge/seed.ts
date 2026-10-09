import type { LegalKnowledgeSnapshot } from './types.ts';

/** Topic labels organize intake; they contain no legal rule, citation, or procedure. */
export const INITIAL_LEGAL_KNOWLEDGE_SEED: LegalKnowledgeSnapshot = {
  jurisdictions: [
    { id: 'IN', kind: 'country', code: 'IN', label: 'India', parentId: null },
  ],
  issues: [
    { id: 'tenancy-security-deposit', domain: 'tenancy', label: 'Tenancy and security deposits', kind: 'topic' },
    { id: 'consumer-refund', domain: 'consumer', label: 'Consumer refunds', kind: 'topic' },
    { id: 'workplace', domain: 'workplace', label: 'Workplace issues', kind: 'topic' },
    { id: 'cyber-issues', domain: 'cyber', label: 'Cyber issues', kind: 'topic' },
  ],
  authorities: [],
  sources: [],
  documents: [],
  provisions: [],
  rules: [],
  procedures: [],
  relationships: [],
};

export const INITIAL_LEGAL_KNOWLEDGE_SEED_REPORT = {
  topicCount: INITIAL_LEGAL_KNOWLEDGE_SEED.issues.length,
  sourceCount: INITIAL_LEGAL_KNOWLEDGE_SEED.sources.length,
  authorityCount: INITIAL_LEGAL_KNOWLEDGE_SEED.authorities.length,
  documentCount: INITIAL_LEGAL_KNOWLEDGE_SEED.documents.length,
  provisionCount: INITIAL_LEGAL_KNOWLEDGE_SEED.provisions.length,
  ruleCount: INITIAL_LEGAL_KNOWLEDGE_SEED.rules.length,
  procedureCount: INITIAL_LEGAL_KNOWLEDGE_SEED.procedures.length,
  relationshipCount: INITIAL_LEGAL_KNOWLEDGE_SEED.relationships.length,
  sourceCorpusStatus: 'unpopulated' as const,
  reason: 'No legal documents or official-source reference catalogs are configured in this repository.',
  extensionReadyDomains: ['women_safety'] as const,
};
