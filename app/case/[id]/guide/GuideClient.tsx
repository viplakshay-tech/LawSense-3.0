'use client';

import Link from 'next/link';
import {
  ArrowUpRight,
  BookOpenCheck,
  CircleHelp,
  FileStack,
  FileText,
  Loader2,
  Mic,
  Network,
  Route,
  Scale,
  ShieldAlert,
  Sparkles,
  VideoOff,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { type CaseState, type JourneySummary } from '@/lib/api';
import { useCaseState } from '../CaseStateProvider';
import { guidePresenceStateFromSnapshot, guideStateLabel, useGuideRuntime } from '@/components/guide-runtime';
import type { GuideAction } from '@/components/guide-runtime';
import { GUIDE_PRESENCE_LABELS, GuidePresence } from '@/components/guide-presence';
import { TrustNotice } from '@/components/TrustNotice';
import styles from './GuideClient.module.css';

const completedStatuses = new Set(['complete', 'completed', 'done', 'finished']);

function humanize(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function guideActionLabel(action: GuideAction): string {
  switch (action.type) {
    case 'ASK_CLARIFICATION': return 'Answer an open case question';
    case 'SHOW_EVIDENCE': return 'Open the Evidence Map';
    case 'SHOW_LEGAL_GROUNDING': return 'Review legal grounding';
    case 'OPEN_JOURNEY': return 'Open the Journey plan';
    case 'SHOW_TWIN': return 'Open the Living Twin';
    case 'START_VOICE': return 'Add information by voice';
    case 'SPEAK_RESPONSE': return 'Read the case summary aloud';
    case 'OPEN_SAFETY': return 'Review safety information';
    case 'NAVIGATE': return action.payload.target === 'case'
      ? 'Open the case overview'
      : `Open ${action.payload.target}`;
    default: {
      const exhaustiveAction: never = action;
      return exhaustiveAction;
    }
  }
}

function RoomHeader({ id, title }: { id: string; title?: string }) {
  return (
    <header className={styles.header}>
      <div className={styles.brand}>
        <span className={styles.brandMark} aria-hidden="true"><BookOpenCheck /></span>
        <div className={styles.brandCopy}>
          <p className={styles.eyebrow}>LawSense 3.0</p>
          <h1 className={styles.title}>Private legal room</h1>
          <p className={styles.caseTitle}>{title?.trim() || `Case ${id}`}</p>
        </div>
      </div>
      <div className={styles.roomIndicators}>
        <span className={styles.cameraOff}>
          <VideoOff aria-hidden="true" />
          <span>Camera off</span>
          <span className={styles.visuallyHidden}>Your camera is off. This room does not request camera access.</span>
        </span>
        <span className={styles.privateLabel}>Private consultation</span>
      </div>
    </header>
  );
}

function WorkspaceNavigation({ caseId }: { caseId: string }) {
  const base = `/case/${encodeURIComponent(caseId)}`;
  const links = [
    { label: 'Evidence', href: `${base}/documents`, Icon: FileStack },
    { label: 'Law', href: `${base}#analysis`, Icon: Scale },
    { label: 'Journey', href: `${base}#journey`, Icon: Route },
    { label: 'Documents', href: `${base}#upload-heading`, Icon: FileText },
    { label: 'Safety', href: `${base}/safety`, Icon: ShieldAlert },
    { label: 'Twin', href: `${base}/twin`, Icon: Network },
  ];

  return (
    <nav aria-label="Case workspaces" className={styles.workspaceNav}>
      {links.map(({ label, href, Icon }) => (
        <Link key={label} href={href} className={styles.workspaceLink}>
          <Icon aria-hidden="true" />
          <span>{label}</span>
          <ArrowUpRight aria-hidden="true" className={styles.workspaceArrow} />
        </Link>
      ))}
    </nav>
  );
}

function JourneyStatus({ journey }: { journey: JourneySummary }) {
  const currentStep = journey.steps.find((step) => ['active', 'current', 'in_progress', 'started'].includes(step.status.toLocaleLowerCase()))
    ?? journey.steps.find((step) => !completedStatuses.has(step.status.toLocaleLowerCase()));
  const completedCount = journey.steps.filter((step) => completedStatuses.has(step.status.toLocaleLowerCase())).length;

  return (
    <section aria-labelledby="room-journey-heading" className={styles.detailCard}>
      <h2 id="room-journey-heading" className={styles.cardEyebrow}>Journey status</h2>
      {currentStep && <p className={styles.cardTitle}>{currentStep.title}</p>}
      <p className={styles.cardCopy}>
        {journey.steps.length > 0
          ? `${completedCount} of ${journey.steps.length} steps complete · status from the current case analysis`
          : 'No journey steps were returned for this case.'}
      </p>
      {journey.nextActions[0] && <p className={styles.cardNote}>Next recorded step · {journey.nextActions[0].action}</p>}
    </section>
  );
}

function SafetySummary({ caseData }: { caseData: CaseState }) {
  const safety = caseData.analysis?.safetyContext;
  const journey = caseData.analysis?.journey;
  if (!safety || safety.context === 'none') return null;

  return (
    <section aria-labelledby="room-safety-heading" className={`${styles.detailCard} ${styles.safetyCard}`}>
      <div className={styles.cardHeadingWithIcon}>
        <ShieldAlert aria-hidden="true" />
        <h2 id="room-safety-heading" className={styles.cardTitle}>Safety context in the case record</h2>
      </div>
      <p className={styles.cardCopy}>
        {humanize(safety.context)} · {humanize(safety.urgency)} urgency · assessment marked as {humanize(safety.assessmentStatus)}
      </p>
      {safety.indicators.length > 0 && (
        <ul className={styles.detailList}>
          {safety.indicators.map((indicator, index) => (
            <li key={`${indicator.category}-${index}`}>
              {humanize(indicator.category)} · {humanize(indicator.confidence)} confidence
            </li>
          ))}
        </ul>
      )}
      {journey?.escalationPoints && journey.escalationPoints.length > 0 && (
        <div className={styles.cardDivider}>
          <p className={styles.cardEyebrow}>Recorded escalation information</p>
          <ul className={styles.detailList}>
            {journey.escalationPoints.map((risk) => (
              <li key={risk.id}>
                {risk.description}
                {risk.escalationTrigger && <span className={styles.cardNote}>{risk.escalationTrigger}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function UnknownsSummary({ items }: { items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="room-unknowns-heading" className={styles.detailCard}>
      <h2 id="room-unknowns-heading" className={styles.cardEyebrow}>Information still unknown</h2>
      <ul className={styles.detailList}>
        {items.map((question, index) => <li key={`${question}-${index}`}>{question}</li>)}
      </ul>
    </section>
  );
}

function EvidenceSummary({ caseData, journey }: { caseData: CaseState; journey?: JourneySummary }) {
  const requestedEvidence = journey?.requiredEvidence ?? [];
  const requestedDocuments = journey?.requiredDocuments ?? [];
  if (caseData.evidence.length === 0 && caseData.documents.length === 0 && requestedEvidence.length === 0 && requestedDocuments.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby="room-evidence-heading" className={styles.detailCard}>
      <h2 id="room-evidence-heading" className={styles.cardEyebrow}>Evidence and documents</h2>
      <p className={styles.cardCopy}>
        {caseData.evidence.length} evidence item{caseData.evidence.length === 1 ? '' : 's'} · {caseData.documents.length} document{caseData.documents.length === 1 ? '' : 's'} attached to this case.
      </p>
      {(requestedEvidence.length > 0 || requestedDocuments.length > 0) && (
        <p className={styles.cardNote}>
          The journey lists {requestedEvidence.length} evidence item{requestedEvidence.length === 1 ? '' : 's'} and {requestedDocuments.length} document{requestedDocuments.length === 1 ? '' : 's'} to consider.
        </p>
      )}
    </section>
  );
}

function LegalSummary({ caseData }: { caseData: CaseState }) {
  const knowledge = caseData.analysis?.legalKnowledge;
  const journey = caseData.analysis?.journey;
  if (!knowledge && caseData.legalIssues.length === 0) return null;

  return (
    <section aria-labelledby="room-law-heading" className={styles.detailCard}>
      <h2 id="room-law-heading" className={styles.cardEyebrow}>Legal grounding</h2>
      <p className={styles.cardCopy}>
        {journey?.legalKnowledgeStatus || 'Candidate issues and returned source metadata from the case record'}
        {knowledge ? ` · source records ${knowledge.status === 'records_found' ? 'found' : 'not returned'}` : ''}
      </p>
      <p className={styles.cardNote}>Issue candidates and source details are kept with the case record. Returned records remain subject to jurisdiction and applicability checks.</p>
    </section>
  );
}

function CaseStateStrip({ caseData, openQuestionCount }: { caseData: CaseState; openQuestionCount: number }) {
  const journey = caseData.analysis?.journey;
  const completedCount = journey?.steps.filter((step) => completedStatuses.has(step.status.toLocaleLowerCase())).length ?? 0;
  const journeyStatus = journey && journey.steps.length > 0
    ? `${completedCount} / ${journey.steps.length}`
    : 'Not reported';
  const stats = [
    { label: 'Facts', value: caseData.facts.length },
    { label: 'Evidence', value: caseData.evidence.length },
    { label: 'Documents', value: caseData.documents.length },
    { label: 'Open questions', value: openQuestionCount },
    { label: 'Journey steps', value: journeyStatus },
  ];

  return (
    <section className={styles.caseStrip} aria-label="Live case state">
      <div className={styles.caseStripHeading}>
        <span className={styles.liveDot} aria-hidden="true" />
        <h2>Live case state</h2>
      </div>
      <dl className={styles.caseStats}>
        {stats.map((stat) => (
          <div key={stat.label} className={styles.caseStat}>
            <dt>{stat.label}</dt>
            <dd>{stat.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function CameraOffIndicator() {
  return (
    <div className={styles.cameraIndicator}>
      <VideoOff aria-hidden="true" />
      <span>Camera off</span>
      <span className={styles.visuallyHidden}>Your camera is off. Camera access is not requested in this room.</span>
    </div>
  );
}

function RoomError({ id, title, message, onRetry }: { id: string; title: string; message: string; onRetry?: () => void }) {
  return (
    <main className={styles.room}>
      <div className={styles.roomShell}>
        <RoomHeader id={id} title={title} />
        <TrustNotice variant="dark" />
        <section className={`${styles.detailCard} ${styles.errorCard}`} role="alert">
          <ShieldAlert aria-hidden="true" />
          <div>
            <h2 className={styles.cardTitle}>{title}</h2>
            <p className={styles.cardCopy}>{message}</p>
            {onRetry && <button type="button" className={styles.secondaryButton} onClick={onRetry}>Try again</button>}
          </div>
        </section>
      </div>
    </main>
  );
}

export default function GuidePage({ id }: { id: string }) {
  const { caseState: caseData, loading, error, refreshCaseState } = useCaseState();
  const {
    snapshot,
    presentation,
    contextualMessage,
    messages,
    actionRunning,
    runAction,
    interruptSpeech,
  } = useGuideRuntime();
  const base = `/case/${encodeURIComponent(id)}`;
  const voiceAction = snapshot.availableActions.find((action) => action.type === 'START_VOICE');
  const speakAction = snapshot.availableActions.find((action) => action.type === 'SPEAK_RESPONSE');
  const secondaryActions = snapshot.availableActions.filter((action) => action.type !== 'START_VOICE' && action.type !== 'SPEAK_RESPONSE');
  const runtimeReady = Boolean(caseData && snapshot.caseState === caseData);

  if (loading) {
    return (
      <main className={styles.room}>
        <div className={styles.roomShell}>
          <RoomHeader id={id} />
          <TrustNotice variant="dark" />
          <div className={styles.loadingCard} role="status">
            <Loader2 aria-hidden="true" />
            <span>Opening the room and loading the saved case record…</span>
          </div>
        </div>
      </main>
    );
  }

  if (!caseData) {
    return (
      <RoomError
        id={id}
        title="Case unavailable"
        message={error ?? 'The case service did not return a case record.'}
        onRetry={() => void refreshCaseState().catch(() => undefined)}
      />
    );
  }

  if (!runtimeReady) {
    return (
      <main className={styles.room}>
        <div className={styles.roomShell}>
          <RoomHeader id={id} title={caseData.title ?? undefined} />
          <TrustNotice variant="dark" />
          <div className={styles.loadingCard} role="status">
            <Loader2 aria-hidden="true" />
            <span>Syncing the Guide with the latest CaseState…</span>
          </div>
        </div>
      </main>
    );
  }

  const journey = caseData.analysis?.journey;
  const presenceState = guidePresenceStateFromSnapshot(snapshot);
  const presenceLabel = GUIDE_PRESENCE_LABELS[presenceState];
  const safetyActive = presenceState === 'SAFETY' || presenceState === 'IMMEDIATE_DANGER';
  const casePriorityState = safetyActive || presenceState === 'CONFLICT';
  const stateLabel = casePriorityState ? presenceLabel : guideStateLabel(snapshot.state.name);
  const visualState = safetyActive ? 'safety' : presenceState === 'CONFLICT' ? 'conflict' : snapshot.state.name;
  const statusDetail = contextualMessage.text;
  const speechActive = snapshot.speechState === 'speaking' || snapshot.speechState === 'paused';

  return (
    <main className={styles.room}>
      <div className={styles.roomShell}>
        <RoomHeader id={id} title={caseData.title ?? undefined} />

        {error && (
          <div role="alert" className={styles.refreshError}>
            <span>Showing the last saved case state. Refresh failed: {error}</span>
            <button type="button" onClick={() => void refreshCaseState().catch(() => undefined)}>Retry refresh</button>
          </div>
        )}

        <TrustNotice variant="dark" />
        <WorkspaceNavigation caseId={id} />
        <CaseStateStrip caseData={caseData} openQuestionCount={presentation.unknowns.length} />

        <div className={styles.roomColumns}>
          <section className={styles.consultation} aria-label="Consultation with the Guide">
            <div className={styles.stageCard}>
              <div className={styles.stageHeading}>
                <div>
                  <p className={styles.eyebrow}>Your consultation</p>
                  <p className={styles.stageSubheading}>The Guide follows the current case record</p>
                </div>
                <span className={styles.statePill} data-state={visualState}>
                  <span className={styles.stateDot} aria-hidden="true" />{stateLabel}
                </span>
              </div>

              <div className={styles.guideStage} data-guide-state={visualState}>
                <div className={styles.stageGlow} aria-hidden="true" />
                <CameraOffIndicator />
                <GuidePresence
                  state={presenceState}
                  size="hero"
                  accessibleLabel={`Guide state: ${presenceLabel}`}
                  speechState={snapshot.speechState}
                />
              </div>

              <div className={styles.summaryCard}>
                <div className={styles.summaryIcon} aria-hidden="true"><Sparkles /></div>
                <div className={styles.summaryCopy}>
                  <p className={styles.cardEyebrow}>{safetyActive ? 'Safety context' : 'From the case record'}</p>
                  <p>{statusDetail}</p>
                </div>
              </div>

              {snapshot.state.error && <p role="alert" className={styles.inlineError}>{snapshot.state.error}</p>}

              <div className={styles.controls} aria-label="Consultation controls">
                <button
                  type="button"
                  className={`${styles.controlButton} ${styles.controlPrimary}`}
                  disabled={!voiceAction || actionRunning}
                  onClick={() => voiceAction && void runAction(voiceAction)}
                >
                  <Mic aria-hidden="true" />
                  <span>Speak</span>
                  <small>Open voice capture</small>
                </button>
                <Link href={`${base}/voice#voice-transcript`} className={styles.controlButton}>
                  <span className={styles.controlIcon} aria-hidden="true">T</span>
                  <span>Type</span>
                  <small>Review before saving</small>
                </Link>
                <Link href={`${base}#upload-heading`} className={styles.controlButton}>
                  <FileText aria-hidden="true" />
                  <span>Upload</span>
                  <small>PDF or image document</small>
                </Link>
                {speakAction && (
                  <button
                    type="button"
                    className={`${styles.controlButton} ${styles.controlSecondary}`}
                    disabled={actionRunning}
                    onClick={() => void runAction(speakAction)}
                  >
                    <Volume2 aria-hidden="true" />
                    <span>Hear summary</span>
                    <small>Play the current case summary</small>
                  </button>
                )}
                {speechActive && (
                  <button
                    type="button"
                    className={`${styles.controlButton} ${styles.controlSecondary}`}
                    onClick={interruptSpeech}
                    aria-label="Stop Guide speech"
                  >
                    <VolumeX aria-hidden="true" />
                    <span>Stop speech</span>
                    <small>Interrupt current playback</small>
                  </button>
                )}
              </div>
              <p className={styles.cameraNotice}>Camera stays off. This room does not request camera access.</p>
            </div>

            <section className={styles.activityCard} aria-labelledby="room-activity-heading">
              <div className={styles.activityHeading}>
                <h2 id="room-activity-heading">Guide activity</h2>
                <span>CaseState · GuideRuntime</span>
              </div>
              <div role="log" aria-label="Recent Guide activity" aria-live="polite" aria-relevant="additions" className={styles.activityList}>
                {messages.length > 0 ? messages.slice(-3).map((message) => (
                  <p key={message.id} data-kind={message.kind}>{message.text}</p>
                )) : (
                  <p>The room is showing the latest case record. Updates and completed actions will appear here.</p>
                )}
              </div>
            </section>
          </section>

          <aside className={styles.caseAside} aria-label="Case details and available actions">
            <section className={styles.caseIntro} aria-labelledby="case-record-heading">
              <div className={styles.asideHeading}>
                <span className={styles.asideIcon} aria-hidden="true"><BookOpenCheck /></span>
                <div>
                  <p className={styles.cardEyebrow}>Current case</p>
                  <h2 id="case-record-heading">Case record</h2>
                </div>
              </div>
              <p className={styles.caseStatement}>
                {presentation.understanding.initialAccount || 'No initial statement is saved in this case yet.'}
              </p>
              {presentation.understanding.facts.length > 0 && (
                <ul className={styles.detailList} aria-label="Recorded case facts">
                  {presentation.understanding.facts.map((fact) => (
                    <li key={fact.id}>
                      <strong>{fact.label}:</strong> {fact.value} <span className={styles.cardNote}>{humanize(fact.status)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className={styles.cardCopy}>{presentation.whyItMatters}</p>
              {presentation.uncertainty.relevant && (
                <div className={styles.uncertaintyNote}>
                  <CircleHelp aria-hidden="true" />
                  <div>
                    <p>{presentation.uncertainty.label}</p>
                    <span>{presentation.uncertainty.detail}</span>
                  </div>
                </div>
              )}
            </section>

            {safetyActive && <SafetySummary caseData={caseData} />}
            {journey && <JourneyStatus journey={journey} />}
            <UnknownsSummary items={presentation.unknowns} />
            <EvidenceSummary caseData={caseData} journey={journey} />
            <LegalSummary caseData={caseData} />

            <section className={styles.actionCard} aria-labelledby="room-actions-heading">
              <div className={styles.actionHeading}>
                <h2 id="room-actions-heading">Available next steps</h2>
                <span>{secondaryActions.length}</span>
              </div>
              {secondaryActions.length > 0 ? (
                <div className={styles.actionList}>
                  {secondaryActions.map((action) => (
                    <button
                      key={`${action.type}-${JSON.stringify(action.payload)}`}
                      type="button"
                      disabled={actionRunning}
                      onClick={() => void runAction(action)}
                    >
                      <span>{guideActionLabel(action)}</span>
                      <ArrowUpRight aria-hidden="true" />
                    </button>
                  ))}
                </div>
              ) : (
                <p className={styles.cardCopy}>
                  {snapshot.availableActions.length > 0
                    ? 'Voice and summary controls are ready above. No other case-specific workspace action is available right now.'
                    : 'No case-specific action is available yet.'}
                </p>
              )}
              {presentation.nextAction && <p className={styles.cardNote}>Recorded next step · {presentation.nextAction.label}</p>}
            </section>
          </aside>
        </div>

        <footer className={styles.roomFooter}>
          <span>Guide states, case counts, and activity are supplied by the shared runtime.</span>
          <Link href={base}>
            Case overview <ArrowUpRight aria-hidden="true" />
          </Link>
        </footer>
      </div>
    </main>
  );
}
