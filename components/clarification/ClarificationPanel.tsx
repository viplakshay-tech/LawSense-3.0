'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, Check, CircleHelp, CornerDownRight, LoaderCircle, MessageCircle, SkipForward } from 'lucide-react';
import {
  answerClarificationQuestion,
  getClarificationQuestions,
  skipClarificationQuestion,
  type CaseState,
  type ClarificationQuestions,
} from '@/lib/api';
import { GuidePresence, type GuidePresenceState } from '@/components/guide-presence';
import styles from './ClarificationPanel.module.css';

export function ClarificationPanel({
  caseId,
  updatedAt,
  revision,
  skippedClarificationIds,
  onCaseUpdate,
}: {
  caseId: string;
  updatedAt: string;
  revision: number;
  skippedClarificationIds: string[];
  onCaseUpdate: (caseState: CaseState) => void;
}) {
  return (
    <ClarificationSession
      key={caseId}
      caseId={caseId}
      updatedAt={updatedAt}
      revision={revision}
      skippedClarificationIds={skippedClarificationIds}
      onCaseUpdate={onCaseUpdate}
    />
  );
}

function ClarificationSession({
  caseId,
  updatedAt,
  revision,
  skippedClarificationIds,
  onCaseUpdate,
}: {
  caseId: string;
  updatedAt: string;
  revision: number;
  skippedClarificationIds: string[];
  onCaseUpdate: (caseState: CaseState) => void;
}) {
  const [queue, setQueue] = useState<ClarificationQuestions | null>(null);
  const [answer, setAnswer] = useState('');
  const [loadedVersion, setLoadedVersion] = useState<{
    caseId: string;
    updatedAt: string;
    revision: number;
  } | null>(null);
  const [reviewingSkipped, setReviewingSkipped] = useState(false);
  const [hiddenQuestionIds, setHiddenQuestionIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reaction, setReaction] = useState<string | null>(null);
  const [reactionKind, setReactionKind] = useState<'answer' | 'skip' | null>(null);
  const actionInFlightRef = useRef(false);
  const loading =
    loadedVersion?.caseId !== caseId ||
    loadedVersion?.updatedAt !== updatedAt ||
    loadedVersion?.revision !== revision;

  useEffect(() => {
    let active = true;

    getClarificationQuestions(caseId, { includeSkipped: true })
      .then((result) => {
        if (!active) return;
        setQueue(result);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : 'Could not load open questions.');
        }
      })
      .finally(() => {
        if (active) setLoadedVersion({ caseId, updatedAt, revision });
      });

    return () => {
      active = false;
    };
  }, [caseId, revision, updatedAt]);

  const skippedIds = new Set(skippedClarificationIds);
  const hiddenIds = new Set(hiddenQuestionIds);
  const skippedQuestions = queue?.questions.filter((question) => skippedIds.has(question.id)) ?? [];
  const openQuestions = queue?.questions.filter((question) => !skippedIds.has(question.id)) ?? [];
  const reviewQuestions = reviewingSkipped ? [...skippedQuestions, ...openQuestions] : openQuestions;
  const remainingQuestions = reviewQuestions.filter((item) => !hiddenIds.has(item.id));
  const question = remainingQuestions[0] ?? null;

  const guideState: GuidePresenceState = loading || saving
    ? 'PROCESSING'
    : error
      ? 'ERROR'
      : reactionKind === 'skip'
        ? 'UNCERTAIN'
        : reaction
          ? 'EXPLAINING'
          : question
            ? 'ASKING'
            : 'GROUNDED';
  const guideDetail = loading
    ? 'I’m checking the open details in your case.'
    : saving
      ? 'I’m adding your response as you gave it.'
      : reaction || (question ? 'One useful question at a time. You can always leave a detail unanswered.' : 'No open question is available right now.');

  async function saveAnswer(value: string) {
    if (!question || !value.trim() || actionInFlightRef.current) return;

    actionInFlightRef.current = true;
    setSaving(true);
    setError(null);
    setReaction('I’m adding your response to the case before I continue.');
    setReactionKind('answer');

    try {
      const updated = await answerClarificationQuestion(caseId, question.id, value.trim());
      onCaseUpdate(updated);
      setHiddenQuestionIds((current) => current.filter((id) => id !== question.id));
      setReviewingSkipped(false);
      setAnswer('');
      setReaction('Thanks for sharing that. I’ve added it as a user-reported answer. Let’s look at the next useful detail.');
      setReactionKind('answer');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save this answer.');
      setReaction('Your answer is still here. You can try again when you are ready.');
      setReactionKind(null);
    } finally {
      actionInFlightRef.current = false;
      setSaving(false);
    }
  }

  async function skipQuestion() {
    if (!question || actionInFlightRef.current) return;
    actionInFlightRef.current = true;
    setSaving(true);
    setAnswer('');
    setError(null);
    setReaction('I’ll leave this unanswered. It remains unknown, and I won’t fill it in for you.');
    setReactionKind('skip');
    try {
      const updated = await skipClarificationQuestion(caseId, question.id);
      onCaseUpdate(updated);
      setHiddenQuestionIds((current) => current.includes(question.id) ? current : [...current, question.id]);
      setReviewingSkipped(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not skip this question.');
      setReaction('This question is still open. You can try again when you are ready.');
      setReactionKind(null);
    } finally {
      actionInFlightRef.current = false;
      setSaving(false);
    }
  }

  function reopenSkipped() {
    setHiddenQuestionIds([]);
    setReviewingSkipped(true);
    setReaction('These questions are still open. Choose one if you want to return to it.');
    setReactionKind(null);
  }

  return (
    <section className={styles.panel} aria-labelledby="clarification-heading">
      <div className={styles.topline}>
        <div className={styles.headingBlock}>
          <p className={styles.eyebrow}><span /> A GUIDED CASE QUESTION</p>
          <h2 id="clarification-heading" tabIndex={-1}>Let’s fill in one detail at a time.</h2>
          <p className={styles.intro}>These questions come from details still open in your case. Your response is saved as user-reported information with its source.</p>
        </div>
        <GuidePresence state={guideState} size="compact" detail={guideDetail} className={styles.guidePresence} />
      </div>

      {loading ? (
        <div className={styles.loadingState} role="status">
          <LoaderCircle aria-hidden="true" className={styles.spinner} size={17} />
          Checking the case for its next useful question…
        </div>
      ) : question ? (
        <AnimatePresence mode="wait" initial={false}>
          <motion.article
            key={question.id}
            className={styles.questionCard}
            initial={{ opacity: 0, y: 12, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.99 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
          >
            <div className={styles.cardTopline}>
              <span className={styles.category}>{question.category.replaceAll('_', ' ')}</span>
              <span className={styles.questionCount}>
                <span className={styles.liveDot} />
                {remainingQuestions.length} open {remainingQuestions.length === 1 ? 'question' : 'questions'}
              </span>
            </div>

            <div className={styles.questionCopy}>
              <span className={styles.questionGlyph}><MessageCircle aria-hidden="true" size={17} /></span>
              <div>
                {question.target && <p className={styles.target}>ABOUT {question.target.replaceAll('_', ' ')}</p>}
                <h3>{question.question}</h3>
              </div>
            </div>

            {question.sources.length > 0 && (
              <div className={styles.sourceContext}>
                <span className={styles.contextLabel}><CornerDownRight aria-hidden="true" size={13} /> WHY I’M ASKING</span>
                <div className={styles.sourceList} aria-label="Question sources">
                  {question.sources.map((source, index) => (
                    <span key={source.source_id + '-' + source.source_path + '-' + index} title={source.source_path}>
                      {source.text}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <form
              className={styles.answerForm}
              onSubmit={(event) => {
                event.preventDefault();
                void saveAnswer(answer);
              }}
            >
              <label htmlFor={'clarification-answer-' + question.id}>Your answer</label>
              <textarea
                id={'clarification-answer-' + question.id}
                value={answer}
                onChange={(event) => setAnswer(event.target.value)}
                rows={3}
                maxLength={10_000}
                disabled={saving}
                placeholder="Share what you know in your own words…"
              />

              <div className={styles.answerActions}>
                <p>Your words stay attached to their source. You can leave this open instead.</p>
                <button type="submit" className={styles.answerButton} disabled={saving || !answer.trim()}>
                  {saving ? <LoaderCircle aria-hidden="true" className={styles.spinner} size={15} /> : <ArrowRight aria-hidden="true" size={15} />}
                  Answer
                </button>
              </div>
            </form>

            <div className={styles.choiceShelf} aria-label="Other ways to respond">
              <span className={styles.choiceLabel}>OR CHOOSE A RESPONSE</span>
              <div className={styles.choiceButtons}>
                <button type="button" onClick={() => void saveAnswer('I don’t know.')} disabled={saving}>
                  <CircleHelp aria-hidden="true" size={14} /> I don’t know
                </button>
                <button type="button" onClick={() => void saveAnswer('I prefer not to say.')} disabled={saving}>
                  <MessageCircle aria-hidden="true" size={14} /> Prefer not to say
                </button>
                <button type="button" onClick={skipQuestion} disabled={saving}>
                  <SkipForward aria-hidden="true" size={14} /> Skip
                </button>
              </div>
            </div>
          </motion.article>
        </AnimatePresence>
      ) : (
        <div className={styles.emptyState}>
          <span className={styles.emptyIcon}><Check aria-hidden="true" size={17} /></span>
          <div>
            <h3>No further question is ready.</h3>
            <p>Any detail you skipped is still open and remains unknown in your case.</p>
          </div>
          {skippedQuestions.length > 0 && (
            <button type="button" onClick={reopenSkipped} className={styles.reopenButton}>
              Return to {skippedQuestions.length} skipped {skippedQuestions.length === 1 ? 'question' : 'questions'}
            </button>
          )}
        </div>
      )}

      {skippedQuestions.length > 0 && question && (
        <button type="button" onClick={reopenSkipped} className={styles.skippedSummary}>
          <span><CircleHelp aria-hidden="true" size={14} /> {skippedQuestions.length} skipped {skippedQuestions.length === 1 ? 'detail is' : 'details are'} still unknown</span>
          <span>Review skipped <ArrowRight aria-hidden="true" size={13} /></span>
        </button>
      )}

      {reaction && !loading && (
        <p className={styles.reaction} role="status" aria-live="polite">
          <span className={reactionKind === 'skip' ? styles.reactionUnknown : styles.reactionMark}>
            {reactionKind === 'skip' ? <CircleHelp aria-hidden="true" size={14} /> : <Check aria-hidden="true" size={14} />}
          </span>
          {reaction}
        </p>
      )}

      {error && <p className={styles.error} role="alert">{error}</p>}
    </section>
  );
}
