import type { GuideActionCommand, GuideRoute } from './types';

export type GuideActionValidation =
  | { ok: true; command: GuideActionCommand }
  | { ok: false; message: string };

const IDENTIFIER_LIMIT = 512;
const SPEECH_TEXT_LIMIT = 10_000;
const TIMESTAMP_LIMIT = 128;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string'
    && value.trim().length > 0
    && value.length <= IDENTIFIER_LIMIT
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function parseRoute(value: unknown): GuideRoute | null {
  if (!isRecord(value) || typeof value.kind !== 'string') return null;

  if (value.kind === 'home') return { kind: 'home' };

  if (
    (value.kind === 'case'
      || value.kind === 'documents'
      || value.kind === 'guide'
      || value.kind === 'journey'
      || value.kind === 'twin'
      || value.kind === 'voice'
      || value.kind === 'safety')
    && isIdentifier(value.caseId)
  ) {
    return { kind: value.kind, caseId: value.caseId };
  }

  return null;
}

function isTimestamp(value: unknown): value is string | number {
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'string' || value.length > TIMESTAMP_LIMIT || !ISO_TIMESTAMP.test(value)) return false;
  return Number.isFinite(Date.parse(value));
}

function invalid(message: string): GuideActionValidation {
  return { ok: false, message };
}

/** Validates and copies only recognized command fields; extra properties are discarded. */
export function validateGuideActionCommand(input: unknown): GuideActionValidation {
  if (!isRecord(input) || typeof input.type !== 'string') {
    return invalid('A command object with a known type is required.');
  }

  switch (input.type) {
    case 'navigate': {
      const route = parseRoute(input.route);
      return route
        ? { ok: true, command: { type: 'navigate', route } }
        : invalid('navigate requires a supported route and any required caseId.');
    }
    case 'openEvidence':
      return input.evidenceId === undefined || isIdentifier(input.evidenceId)
        ? { ok: true, command: { type: 'openEvidence', ...(input.evidenceId ? { evidenceId: input.evidenceId } : {}) } }
        : invalid('openEvidence evidenceId must be a non-empty identifier.');
    case 'openJourney':
    case 'openTwin':
    case 'startVoice':
    case 'openSafety':
    case 'openClarification':
      return { ok: true, command: { type: input.type } };
    case 'openDocument':
      return isIdentifier(input.documentId)
        ? { ok: true, command: { type: 'openDocument', documentId: input.documentId } }
        : invalid('openDocument requires a non-empty documentId.');
    case 'highlightEvidence':
      return isIdentifier(input.findingId)
        ? { ok: true, command: { type: 'highlightEvidence', findingId: input.findingId } }
        : invalid('highlightEvidence requires a non-empty findingId.');
    case 'openLegalGrounding':
      return isIdentifier(input.recordId)
        ? { ok: true, command: { type: 'openLegalGrounding', recordId: input.recordId } }
        : invalid('openLegalGrounding requires a non-empty recordId.');
    case 'selectTwinNode':
      return isIdentifier(input.nodeId)
        ? { ok: true, command: { type: 'selectTwinNode', nodeId: input.nodeId } }
        : invalid('selectTwinNode requires a non-empty nodeId.');
    case 'selectTimeline':
      return isTimestamp(input.timestamp)
        ? { ok: true, command: { type: 'selectTimeline', timestamp: input.timestamp } }
        : invalid('selectTimeline requires a finite number or a valid ISO date/time string.');
    case 'speak':
      return typeof input.text === 'string'
        && input.text.trim().length > 0
        && input.text.length <= SPEECH_TEXT_LIMIT
        ? { ok: true, command: { type: 'speak', text: input.text } }
        : invalid(`speak requires non-empty text of at most ${SPEECH_TEXT_LIMIT} characters.`);
    default:
      return invalid(`Unsupported command type: ${input.type}.`);
  }
}
