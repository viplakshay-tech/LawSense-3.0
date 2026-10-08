/** Allowlisted destinations understood by the Guide action bridge. */
export type GuideRoute =
  | { kind: 'home' }
  | { kind: 'case'; caseId: string }
  | { kind: 'documents'; caseId: string }
  | { kind: 'guide'; caseId: string }
  | { kind: 'journey'; caseId: string }
  | { kind: 'twin'; caseId: string }
  | { kind: 'voice'; caseId: string }
  | { kind: 'safety'; caseId: string };

/** Closed command set. Payload values must come from the caller or application state. */
export type GuideActionCommand =
  | { type: 'navigate'; route: GuideRoute }
  | { type: 'openEvidence'; evidenceId?: string }
  | { type: 'openDocument'; documentId: string }
  | { type: 'highlightEvidence'; findingId: string }
  | { type: 'openLegalGrounding'; recordId: string }
  | { type: 'openJourney' }
  | { type: 'openTwin' }
  | { type: 'selectTwinNode'; nodeId: string }
  | { type: 'selectTimeline'; timestamp: string | number }
  | { type: 'startVoice' }
  | { type: 'speak'; text: string }
  | { type: 'openSafety' }
  | { type: 'openClarification' };

export type GuideActionStatus = 'success' | 'unavailable' | 'error';

export type GuideActionResult =
  | { status: 'success'; command: GuideActionCommand }
  | { status: 'unavailable'; command: GuideActionCommand; reason: string }
  | {
      status: 'error';
      command?: GuideActionCommand;
      code: 'invalid_command' | 'handler_error';
      message: string;
    };

export type GuideActionHandlerOutcome =
  | void
  | { status: 'unavailable'; reason?: string };

export type GuideActionHandler = () => GuideActionHandlerOutcome | Promise<GuideActionHandlerOutcome>;

/** Optional handlers allow an adapter to expose only capabilities the UI currently supports. */
export interface GuideActionAdapter {
  navigate?: (route: GuideRoute) => GuideActionHandlerOutcome | Promise<GuideActionHandlerOutcome>;
  openEvidence?: (evidenceId?: string) => GuideActionHandlerOutcome | Promise<GuideActionHandlerOutcome>;
  openDocument?: (documentId: string) => GuideActionHandlerOutcome | Promise<GuideActionHandlerOutcome>;
  highlightEvidence?: (findingId: string) => GuideActionHandlerOutcome | Promise<GuideActionHandlerOutcome>;
  openLegalGrounding?: (recordId: string) => GuideActionHandlerOutcome | Promise<GuideActionHandlerOutcome>;
  openJourney?: GuideActionHandler;
  openTwin?: GuideActionHandler;
  selectTwinNode?: (nodeId: string) => GuideActionHandlerOutcome | Promise<GuideActionHandlerOutcome>;
  selectTimeline?: (timestamp: string | number) => GuideActionHandlerOutcome | Promise<GuideActionHandlerOutcome>;
  startVoice?: GuideActionHandler;
  speak?: (text: string) => GuideActionHandlerOutcome | Promise<GuideActionHandlerOutcome>;
  openSafety?: GuideActionHandler;
  openClarification?: GuideActionHandler;
}

export interface GuideActionBridge {
  /** Dispatches a compile-time checked command and revalidates it at runtime. */
  dispatch(command: GuideActionCommand): Promise<GuideActionResult>;
  /** Boundary for commands received from an untyped source such as a future model response. */
  dispatchUntrusted(input: unknown): Promise<GuideActionResult>;
}
