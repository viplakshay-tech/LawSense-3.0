import type { GuideActionAdapter, GuideActionCommand } from './types';

function copyCommand(command: GuideActionCommand): GuideActionCommand {
  return command.type === 'navigate'
    ? { type: 'navigate', route: { ...command.route } }
    : { ...command };
}

/** Test-only adapter that records calls and performs no application actions. */
export function createRecordingGuideActionAdapter(): {
  adapter: GuideActionAdapter;
  calls: GuideActionCommand[];
} {
  const calls: GuideActionCommand[] = [];
  const record = (command: GuideActionCommand) => {
    calls.push(copyCommand(command));
  };

  const adapter: GuideActionAdapter = {
    navigate: (route) => record({ type: 'navigate', route }),
    openEvidence: () => record({ type: 'openEvidence' }),
    openDocument: (documentId) => record({ type: 'openDocument', documentId }),
    highlightEvidence: (findingId) => record({ type: 'highlightEvidence', findingId }),
    openLegalGrounding: (recordId) => record({ type: 'openLegalGrounding', recordId }),
    openJourney: () => record({ type: 'openJourney' }),
    openTwin: () => record({ type: 'openTwin' }),
    selectTwinNode: (nodeId) => record({ type: 'selectTwinNode', nodeId }),
    selectTimeline: (timestamp) => record({ type: 'selectTimeline', timestamp }),
    startVoice: () => record({ type: 'startVoice' }),
    speak: (text) => record({ type: 'speak', text }),
    openSafety: () => record({ type: 'openSafety' }),
    openClarification: () => record({ type: 'openClarification' }),
  };

  return { adapter, calls };
}
