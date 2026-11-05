import { sendGuideMessage, type GuideActionName, type GuideChatLanguage, type GuideChatResponse } from './api.ts';
import type { GuideAction } from '../components/guide-runtime/types';
import { getGuideConversationHistory } from './guide-session.ts';

type ModelGuideAction = Extract<GuideAction, { type: GuideActionName }>;

function isModelGuideAction(action: GuideAction): action is ModelGuideAction {
  return action.type !== 'SPEAK_RESPONSE';
}

/**
 * Build the only supported request context for a text or voice Guide turn.
 * Conversation history comes from the case-scoped session store, never from
 * caller-supplied UI state; presentation-only speech actions stay client-side.
 */
export function createGuideChatContext(
  caseId: string,
  availableActions: readonly GuideAction[],
): {
  conversationHistory: ReturnType<typeof getGuideConversationHistory>;
  availableActions: GuideActionName[];
} {
  const actionNames = new Set<GuideActionName>();
  for (const action of availableActions) {
    if (isModelGuideAction(action)) actionNames.add(action.type);
  }

  return {
    conversationHistory: getGuideConversationHistory(caseId),
    availableActions: [...actionNames],
  };
}


export interface CaseScopedGuideMessageRequest {
  caseId: string;
  message: string;
  language: GuideChatLanguage;
  availableActions: readonly GuideAction[];
  signal?: AbortSignal;
}

/**
 * Shared transport for every Guide input mode. Callers supply only the current
 * case, user message, runtime capabilities and cancellation signal; session
 * history and model-visible action names are always derived centrally.
 */
export function sendCaseScopedGuideMessage({
  caseId,
  message,
  language,
  availableActions,
  signal,
}: CaseScopedGuideMessageRequest): Promise<GuideChatResponse> {
  const context = createGuideChatContext(caseId, availableActions);
  return sendGuideMessage(
    message,
    language,
    caseId,
    context.conversationHistory,
    context.availableActions,
    signal,
  );
}
