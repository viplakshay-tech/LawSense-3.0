import type { CaseState } from '@/lib/api';

export type VoiceInputMethod = 'voice' | 'text';
export type VoiceRecognitionProvider = 'browser' | 'server' | 'typed';
export type VoiceLanguage = 'english' | 'hindi' | 'hinglish' | null;

/** Explicit user-visible milestones in the Guide voice transaction. */
export type GuideVoiceEvent =
  | { type: 'capture_started'; draftId: string; captureId: string; provider: Exclude<VoiceRecognitionProvider, 'typed'>; language: VoiceLanguage }
  | { type: 'capture_cancelled'; draftId: string; captureId: string; transcriptRetained: boolean }
  | { type: 'capture_failed'; draftId: string; captureId: string; detail: string }
  | { type: 'transcript_received'; draftId: string; captureId: string; transcript: string; provider: Exclude<VoiceRecognitionProvider, 'typed'>; language: VoiceLanguage }
  | { type: 'transcript_edited'; draftId: string; transcript: string; inputMethod: VoiceInputMethod }
  | { type: 'review_started'; draftId: string; transcript: string }
  | { type: 'review_ready'; draftId: string; transcript: string; language: VoiceLanguage; extractedFactCount: number; unknownCount: number }
  | { type: 'review_failed'; draftId: string; transcript: string; detail: string }
  | { type: 'confirmation_requested'; draftId: string; transcript: string; inputMethod: VoiceInputMethod; initiatedBy: 'user' }
  | { type: 'confirmation_accepted'; draftId: string; transcript: string; inputMethod: VoiceInputMethod; initiatedBy: 'user' }
  | { type: 'commit_failed'; draftId: string; detail: string }
  | { type: 'case_state_updated'; draftId: string; caseId: string; revision: number; caseState: CaseState; inputMethod: VoiceInputMethod }
  | { type: 'speech_started'; responseId: string }
  | { type: 'speech_paused'; responseId: string }
  | { type: 'speech_finished'; responseId: string }
  | { type: 'speech_cancelled'; responseId: string }
  | { type: 'speech_failed'; responseId: string; detail: string }
  | { type: 'speech_unavailable'; responseId: string };

/** Commands from the Guide UI to the voice controls. Commands never auto-play. */
export type GuideVoiceCommand =
  | { type: 'guide.capture_control'; action: 'start' | 'stop' | 'cancel'; captureId: string; language: VoiceLanguage; initiatedBy: 'user' | 'runtime' }
  | { type: 'guide.response_ready'; responseId: string; text: string; language: VoiceLanguage }
  | { type: 'guide.playback_control'; action: 'play' | 'pause' | 'resume' | 'replay' | 'cancel'; responseId: string; initiatedBy: 'user' | 'runtime' };
