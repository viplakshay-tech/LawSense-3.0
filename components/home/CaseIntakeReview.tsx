'use client';

import { useState } from 'react';
import { ArrowRight, Check, CircleHelp, FileCheck2, LoaderCircle, Pencil, ShieldAlert } from 'lucide-react';
import { addVoiceStatement, type CaseFact, type CaseState } from '@/lib/api';
import { GuidePresence } from '@/components/guide-presence';
import { deriveGuideState } from '@/components/guide-runtime/state';
import type { GuidePresenceState } from '@/components/guide-presence/types';

type ReviewMark = 'confirmed' | 'uncertain';

interface ReviewItem {
  id: string;
  title: string;
  text: string;
  source?: string;
}

function displayValue(value: unknown): string {
  if (typeof value === 'string') return value.trim() || 'No detail provided.';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null || value === undefined) return 'No detail provided.';

  try {
    return JSON.stringify(value) ?? 'No detail provided.';
  } catch {
    return 'Detail could not be displayed.';
  }
}

function factItem(fact: CaseFact, caseState: CaseState): ReviewItem {
  const sources = fact.sourceIds.map((sourceId) => {
    const evidence = caseState.evidence.find((item) => item.id === sourceId);
    if (evidence) return evidence.title;
    const document = caseState.documents.find((item) => item.id === sourceId);
    return document?.filename;
  }).filter((source): source is string => Boolean(source));

  return {
    id: fact.id,
    title: fact.key.replaceAll('_', ' '),
    text: displayValue(fact.value),
    source: sources.length > 0 ? sources.join(' · ') : undefined,
  };
}

function IntakeItemCard({
  item,
  mark,
  correctionOpen,
  correctionText,
  saving,
  onMark,
  onCorrect,
  onCorrectionText,
  onSaveCorrection,
}: {
  item: ReviewItem;
  mark?: ReviewMark;
  correctionOpen: boolean;
  correctionText: string;
  saving: boolean;
  onMark: (mark: ReviewMark) => void;
  onCorrect: () => void;
  onCorrectionText: (value: string) => void;
  onSaveCorrection: () => void;
}) {
  return (
    <article className="intakeItemCard">
      <div className="intakeItemHeading">
        <span>{item.title}</span>
        {mark && (
          <span className={`intakeMark intakeMark${mark === 'confirmed' ? 'Confirmed' : 'Uncertain'}`}>
            {mark === 'confirmed' ? <Check aria-hidden="true" size={12} /> : <CircleHelp aria-hidden="true" size={12} />}
            {mark === 'confirmed' ? 'Confirmed in review' : 'Marked uncertain'}
          </span>
        )}
      </div>
      <p className="intakeItemText">{item.text}</p>
      {item.source && <p className="intakeItemSource">Source · {item.source}</p>}
      <div className="intakeItemActions" role="group" aria-label={`Review ${item.title}`}>
        <button type="button" aria-pressed={mark === 'confirmed'} className={mark === 'confirmed' ? 'intakeActionSelected' : ''} onClick={() => onMark('confirmed')}>
          <Check aria-hidden="true" size={14} /> Confirm
        </button>
        <button type="button" aria-pressed={correctionOpen} className={correctionOpen ? 'intakeActionSelected' : ''} onClick={onCorrect}>
          <Pencil aria-hidden="true" size={14} /> Correct
        </button>
        <button type="button" aria-pressed={mark === 'uncertain'} className={mark === 'uncertain' ? 'intakeActionSelected' : ''} onClick={() => onMark('uncertain')}>
          <CircleHelp aria-hidden="true" size={14} /> Mark uncertain
        </button>
      </div>
      {correctionOpen && (
        <div className="intakeCorrection">
          <label htmlFor={`correction-${item.id}`}>What should I understand differently?</label>
          <textarea
            id={`correction-${item.id}`}
            value={correctionText}
            maxLength={5000}
            rows={3}
            onChange={(event) => onCorrectionText(event.target.value)}
            placeholder="Add the correction in your own words…"
            disabled={saving}
          />
          <p>This adds a new user-reported statement. Your earlier account remains available as its own source.</p>
          <button type="button" onClick={onSaveCorrection} disabled={saving || !correctionText.trim()}>
            {saving ? <LoaderCircle aria-hidden="true" className="intakeSpinner" size={15} /> : <ArrowRight aria-hidden="true" size={15} />}
            {saving ? 'Adding correction…' : 'Add correction to my case'}
          </button>
        </div>
      )}
    </article>
  );
}

export function CaseIntakeReview({
  caseState,
  onCaseUpdate,
  onContinue,
}: {
  caseState: CaseState;
  onCaseUpdate: (caseState: CaseState) => void;
  onContinue: () => void;
}) {
  const [marks, setMarks] = useState<Record<string, ReviewMark>>({});
  const [correctionFor, setCorrectionFor] = useState<string | null>(null);
  const [correctionText, setCorrectionText] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const userFacts = caseState.facts.filter((fact) => fact.status === 'user_reported');
  const evidenceFacts = caseState.facts.filter((fact) => fact.status === 'evidence_supported');
  const userItems: ReviewItem[] = [
    ...(caseState.initialStatement?.trim()
      ? [{ id: 'original-account', title: 'Your original account', text: caseState.initialStatement.trim() }]
      : []),
    ...userFacts.map((fact) => factItem(fact, caseState)),
  ];
  const unknownItems = [
    ...caseState.unknowns,
    ...caseState.facts
      .filter((fact) => fact.status === 'unknown')
      .map((fact) => `${fact.key.replaceAll('_', ' ')}: ${displayValue(fact.value)}`),
  ].filter((item, index, all) => all.indexOf(item) === index);
  const guideState = deriveGuideState(caseState).name.toUpperCase() as GuidePresenceState;

  function markItem(item: ReviewItem, mark: ReviewMark) {
    setMarks((current) => ({ ...current, [item.id]: mark }));
    setCorrectionFor(null);
    setCorrectionText('');
    setError(null);
    setMessage(
      mark === 'confirmed'
        ? 'Marked confirmed in this review. The case continues to show the source and its original status.'
        : 'Marked uncertain in this review. This does not change the saved case facts.',
    );
  }

  function openCorrection(item: ReviewItem) {
    setCorrectionFor(item.id);
    setCorrectionText('');
    setMessage(null);
    setError(null);
  }

  async function saveCorrection(item: ReviewItem) {
    const correction = correctionText.trim();
    if (!correction) return;

    setSavingId(item.id);
    setError(null);
    setMessage(null);
    try {
      const result = await addVoiceStatement(
        caseState.id,
        `Correction to ${item.title}: ${correction}`,
        'text',
      );
      onCaseUpdate(result.caseState);
      setMarks((current) => {
        const updated = { ...current };
        delete updated[item.id];
        return updated;
      });
      setCorrectionFor(null);
      setCorrectionText('');
      setMessage('Your correction was added as a separate user-reported statement.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The correction could not be added. You can try again.');
    } finally {
      setSavingId(null);
    }
  }

  const itemProps = (item: ReviewItem) => ({
    item,
    mark: marks[item.id],
    correctionOpen: correctionFor === item.id,
    correctionText: correctionFor === item.id ? correctionText : '',
    saving: savingId === item.id,
    onMark: (mark: ReviewMark) => markItem(item, mark),
    onCorrect: () => openCorrection(item),
    onCorrectionText: setCorrectionText,
    onSaveCorrection: () => void saveCorrection(item),
  });

  return (
    <section id="intake-review" className="intakeReview" aria-labelledby="intake-review-heading">
      <div className="intakeReviewTop">
        <div className="intakeReviewCopy">
          <p className="sectionEyebrow"><span className="eyebrowRule" /> YOUR FIRST REVIEW</p>
          <h2 id="intake-review-heading" tabIndex={-1}>Here’s what I understood.</h2>
          <p>Take a moment to check each detail. You can confirm it, correct it, or mark it uncertain before we move to a question.</p>
        </div>
        <GuidePresence
          state={guideState}
          size="compact"
          detail={deriveGuideState(caseState).reason.replaceAll('_', ' ')}
          className="intakeGuidePresence"
        />
      </div>

      <div className="intakeUnderstandingGrid">
        <section className="intakeColumn intakeReported" aria-labelledby="intake-reported-heading">
          <div className="intakeColumnHeading">
            <span className="intakeColumnIcon"><Pencil aria-hidden="true" size={15} /></span>
            <div><p>01 / FROM YOU</p><h3 id="intake-reported-heading">User-reported</h3></div>
            <span className="intakeCount">{userItems.length}</span>
          </div>
          {userItems.length ? (
            <div className="intakeItems">{userItems.map((item) => <IntakeItemCard key={item.id} {...itemProps(item)} />)}</div>
          ) : (
            <p className="intakeEmpty">Your account is available in the case record.</p>
          )}
        </section>

        <section className="intakeColumn intakeSupported" aria-labelledby="intake-supported-heading">
          <div className="intakeColumnHeading">
            <span className="intakeColumnIcon"><FileCheck2 aria-hidden="true" size={15} /></span>
            <div><p>02 / FROM EVIDENCE</p><h3 id="intake-supported-heading">Evidence-supported</h3></div>
            <span className="intakeCount">{evidenceFacts.length}</span>
          </div>
          {evidenceFacts.length ? (
            <div className="intakeItems">{evidenceFacts.map((fact) => <IntakeItemCard key={fact.id} {...itemProps(factItem(fact, caseState))} />)}</div>
          ) : (
            <p className="intakeEmpty">No document-supported detail has been confirmed in this case yet. Uploaded material stays separate until it is reviewed.</p>
          )}
        </section>

        <section className="intakeColumn intakeUnknown" aria-labelledby="intake-unknown-heading">
          <div className="intakeColumnHeading">
            <span className="intakeColumnIcon"><ShieldAlert aria-hidden="true" size={15} /></span>
            <div><p>03 / STILL OPEN</p><h3 id="intake-unknown-heading">Unknown</h3></div>
            <span className="intakeCount">{unknownItems.length}</span>
          </div>
          {unknownItems.length ? (
            <ul className="intakeUnknownList">{unknownItems.map((unknown, index) => <li key={`${unknown}-${index}`}>{unknown}</li>)}</ul>
          ) : (
            <p className="intakeEmpty">No unanswered details were returned yet. We’ll keep gaps visible as they come up.</p>
          )}
          <p className="intakeUnknownNote"><CircleHelp aria-hidden="true" size={14} /> Unknown details stay unknown until you tell us more.</p>
        </section>
      </div>

      {(message || error) && (
        <p className={`intakeReviewMessage ${error ? 'intakeReviewError' : ''}`} role={error ? 'alert' : 'status'}>
          {error || message}
        </p>
      )}

      <div className="intakeContinueRow">
        <p>Your review choices stay distinct from source-backed case information. A correction is added as a new statement.</p>
        <button type="button" onClick={onContinue} className="intakeContinueButton">
          Continue to guided questions <ArrowRight aria-hidden="true" size={16} />
        </button>
      </div>
    </section>
  );
}
