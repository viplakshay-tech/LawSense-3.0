export type GuideConversationLanguage = 'English' | 'Hindi' | 'Hinglish';
export type GuideConversationStatus =
  | 'idle'
  | 'requesting_permission'
  | 'listening'
  | 'processing'
  | 'speaking'
  | 'paused'
  | 'ended'
  | 'permission_denied'
  | 'unsupported'
  | 'error';

export interface GuideConversationPresentation {
  status: GuideConversationStatus;
  visualState: 'IDLE' | 'LISTENING' | 'THINKING' | 'SPEAKING' | 'CLARIFYING' | 'ACTION_REQUIRED';
  speechState: 'idle' | 'speaking' | 'paused';
  detail: string;
}

export interface GuideSpeechVoice {
  name: string;
  lang: string;
  default?: boolean;
  voiceURI?: string;
}

/** Prefer a language-matched voice that identifies itself as feminine, when one is installed. */
export function selectGuideSpeechVoice<T extends GuideSpeechVoice>(
  voices: readonly T[],
  language: GuideConversationLanguage,
): T | undefined {
  const languagePrefix = language === 'English' ? 'en' : 'hi';
  const languageVoices = voices.filter((voice) => voice.lang.toLowerCase().startsWith(languagePrefix));
  const feminineVoice = languageVoices.find((voice) => /\b(female|feminine|woman)\b/i.test(`${voice.name} ${voice.voiceURI ?? ''}`));
  return feminineVoice ?? languageVoices.find((voice) => voice.default) ?? languageVoices[0];
}

export function guideConversationPresentation(
  status: GuideConversationStatus,
  detail?: string,
): GuideConversationPresentation {
  const state = status === 'listening'
    ? 'LISTENING'
    : status === 'processing'
      ? 'THINKING'
      : status === 'speaking'
        ? 'SPEAKING'
        : status === 'requesting_permission'
          ? 'CLARIFYING'
          : status === 'permission_denied' || status === 'unsupported' || status === 'error'
            ? 'ACTION_REQUIRED'
            : 'IDLE';

  const defaultDetail = status === 'requesting_permission'
    ? 'Waiting for the microphone permission you requested.'
    : status === 'listening'
      ? 'Listening. Nothing will be sent until you review and confirm the transcript.'
      : status === 'processing'
        ? 'Preparing a response from the local LawSense Guide.'
        : status === 'speaking'
          ? 'The Guide is speaking through the available device voice.'
          : status === 'paused'
            ? 'Your microphone is off while the transcript is ready for review.'
            : status === 'ended'
              ? 'Voice mode ended. Your draft transcript remains available.'
              : status === 'permission_denied'
                ? 'Microphone permission was denied. You can continue by typing.'
                : status === 'unsupported'
                  ? 'Live voice is not supported here. You can continue by typing.'
                  : status === 'error'
                    ? 'Voice input needs attention. Your text draft remains available.'
                    : 'Ready. Tap to speak when you are ready; the microphone stays off until then.';

  return {
    status,
    visualState: state,
    speechState: status === 'speaking' ? 'speaking' : status === 'paused' ? 'paused' : 'idle',
    detail: detail ?? defaultDetail,
  };
}

/** Builds a short, case-aware follow-up without presenting legal conclusions. */
export function createGuideConversationResponse(
  statement: string,
  openQuestion: string | undefined,
  language: GuideConversationLanguage,
): string {
  const heard = statement.trim().slice(0, 500);

  if (language === 'Hindi') {
    const nextStep = openQuestion
      ? `केस रिकॉर्ड में अभी यह सवाल खुला है: ${openQuestion}`
      : 'आप आगे क्या बताना चाहेंगे?';
    return `धन्यवाद। मैंने यह सुना: “${heard}।” ${nextStep} यह अभी ड्राफ़्ट है; केस में जोड़ने से पहले आप इसकी समीक्षा करके पुष्टि कर सकते हैं।`;
  }

  if (language === 'Hinglish') {
    const nextStep = openQuestion
      ? `Case record mein abhi yeh detail clear karni hai: ${openQuestion}`
      : 'Aap aage kya batana chahenge?';
    return `Thank you, maine yeh suna: “${heard}.” ${nextStep} Yeh abhi draft hai; case mein add karne se pehle aap review karke confirm kar sakte hain.`;
  }

  const nextStep = openQuestion
    ? `The case record still has this open question: ${openQuestion}`
    : 'What would you like me to understand next?';
  return `Thank you. I heard: “${heard}.” ${nextStep} This stays a draft until you review and confirm it.`;
}
