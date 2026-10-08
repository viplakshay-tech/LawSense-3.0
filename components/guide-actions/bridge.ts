import type {
  GuideActionAdapter,
  GuideActionBridge,
  GuideActionCommand,
  GuideActionHandlerOutcome,
  GuideActionResult,
} from './types';
import { validateGuideActionCommand } from './validation';

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'The action handler failed.';
}

async function invoke(
  command: GuideActionCommand,
  handler: (() => GuideActionHandlerOutcome | Promise<GuideActionHandlerOutcome>) | undefined,
): Promise<GuideActionResult> {
  if (!handler) {
    return {
      status: 'unavailable',
      command,
      reason: `No adapter is connected for ${command.type}.`,
    };
  }

  try {
    const outcome = await handler();
    if (outcome && outcome.status === 'unavailable') {
      return {
        status: 'unavailable',
        command,
        reason: outcome.reason || `The connected adapter cannot perform ${command.type}.`,
      };
    }
    return { status: 'success', command };
  } catch (cause) {
    return {
      status: 'error',
      command,
      code: 'handler_error',
      message: errorMessage(cause),
    };
  }
}

function createDispatch(adapter: GuideActionAdapter) {
  return async (command: GuideActionCommand): Promise<GuideActionResult> => {
    switch (command.type) {
      case 'navigate':
        return invoke(command, adapter.navigate ? () => adapter.navigate!(command.route) : undefined);
      case 'openEvidence':
        return invoke(command, adapter.openEvidence ? () => adapter.openEvidence!(command.evidenceId) : undefined);
      case 'openDocument':
        return invoke(command, adapter.openDocument ? () => adapter.openDocument!(command.documentId) : undefined);
      case 'highlightEvidence':
        return invoke(command, adapter.highlightEvidence ? () => adapter.highlightEvidence!(command.findingId) : undefined);
      case 'openLegalGrounding':
        return invoke(command, adapter.openLegalGrounding ? () => adapter.openLegalGrounding!(command.recordId) : undefined);
      case 'openJourney':
        return invoke(command, adapter.openJourney);
      case 'openTwin':
        return invoke(command, adapter.openTwin);
      case 'selectTwinNode':
        return invoke(command, adapter.selectTwinNode ? () => adapter.selectTwinNode!(command.nodeId) : undefined);
      case 'selectTimeline':
        return invoke(command, adapter.selectTimeline ? () => adapter.selectTimeline!(command.timestamp) : undefined);
      case 'startVoice':
        return invoke(command, adapter.startVoice);
      case 'speak':
        return invoke(command, adapter.speak ? () => adapter.speak!(command.text) : undefined);
      case 'openSafety':
        return invoke(command, adapter.openSafety);
      case 'openClarification':
        return invoke(command, adapter.openClarification);
    }
  };
}

function invalidCommandResult(message: string): GuideActionResult {
  return { status: 'error', code: 'invalid_command', message };
}

/** Creates a framework-neutral dispatcher. No handler is connected implicitly. */
export function createGuideActionBridge(adapter: GuideActionAdapter = {}): GuideActionBridge {
  const dispatchValidated = createDispatch(adapter);

  return {
    async dispatch(command) {
      const validation = validateGuideActionCommand(command);
      return validation.ok
        ? dispatchValidated(validation.command)
        : invalidCommandResult(validation.message);
    },
    async dispatchUntrusted(input) {
      const validation = validateGuideActionCommand(input);
      return validation.ok
        ? dispatchValidated(validation.command)
        : invalidCommandResult(validation.message);
    },
  };
}
