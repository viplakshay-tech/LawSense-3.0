export const DRAFT_DOCUMENT_TYPES = [
  {
    id: 'complaint-request',
    title: 'Complaint / request letter',
    summary: 'Raise an issue and ask for a response.',
    requestLabel: 'What would you like them to do?',
    requestHeading: 'Request',
  },
  {
    id: 'grievance-application',
    title: 'Grievance / application',
    summary: 'Present a concern to an office or organization.',
    requestLabel: 'What action or resolution are you seeking?',
    requestHeading: 'Requested action',
  },
  {
    id: 'refund-demand',
    title: 'Refund / demand request',
    summary: 'Set out a payment issue and request a refund.',
    requestLabel: 'What refund or payment action are you requesting?',
    requestHeading: 'Refund request',
  },
  {
    id: 'representation',
    title: 'Representation',
    summary: 'Share your position with a decision-maker.',
    requestLabel: 'What should the recipient consider or do?',
    requestHeading: 'Representation',
  },
  {
    id: 'workplace-complaint',
    title: 'Workplace complaint',
    summary: 'Document a workplace concern and request a response.',
    requestLabel: 'What response or workplace action are you requesting?',
    requestHeading: 'Requested response',
  },
  {
    id: 'response-correspondence',
    title: 'Response / request correspondence',
    summary: 'Reply to a message or request information.',
    requestLabel: 'What is your response or what information do you need?',
    requestHeading: 'Response / request',
  },
] as const;

export type DraftDocumentType = (typeof DRAFT_DOCUMENT_TYPES)[number]['id'];

export type DraftFactStatus = 'user_reported' | 'evidence_supported' | 'system_inferred' | 'assumption' | 'conflicting' | 'unknown' | 'missing';

export interface DraftFields {
  documentHeading: string;
  recipient: string;
  recipientAddress: string;
  sender: string;
  senderContact: string;
  date: string;
  subject: string;
  greeting: string;
  purpose: string;
  detailsHeading: string;
  additionalDetails: string;
  requestedAction: string;
  requestHeading: string;
  closing: string;
  signature: string;
  legalText: string;
  legalSourceLabel: string;
  legalSourceUrl: string;
}

export interface DraftState {
  version: 2;
  sourceCaseFingerprint: string;
  documentType: DraftDocumentType;
  fields: DraftFields;
  includedFactIds: string[];
  factEdits: Record<string, string>;
  hasUserEdited: boolean;
  reviewConfirmed: boolean;
  unresolvedAcknowledged: boolean;
}

export type PersistedDraftState = DraftState | (Omit<DraftState, 'version' | 'sourceCaseFingerprint'> & {
  version: 1;
  sourceCaseFingerprint?: never;
});

export interface DraftSourceFact {
  id: string;
  label: string;
  value: string;
  status: DraftFactStatus;
  sourceNotes: string[];
  canInclude: boolean;
}
