'use client';

import { useEffect, useState } from 'react';
import { CircleHelp, Loader2, Send } from 'lucide-react';
import {
  answerClarificationQuestion,
  getClarificationQuestions,
  type CaseState,
  type ClarificationQuestions,
} from '@/lib/api';

export function ClarificationPanel({
  caseId,
  updatedAt,
  revision,
  onCaseUpdate,
}: {
  caseId: string;
  updatedAt: string;
  revision: number;
  onCaseUpdate: (caseState: CaseState) => void;
}) {
  const [queue, setQueue] = useState<ClarificationQuestions | null>(null);
  const [answer, setAnswer] = useState('');
  const [loadedVersion, setLoadedVersion] = useState<{
    caseId: string;
    updatedAt: string;
    revision: number;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const loading =
    loadedVersion?.caseId !== caseId ||
    loadedVersion?.updatedAt !== updatedAt ||
    loadedVersion?.revision !== revision;

  useEffect(() => {
    let active = true;

    getClarificationQuestions(caseId)
      .then((result) => {
        if (!active) return;
        setQueue(result);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(
            cause instanceof Error
              ? cause.message
              : 'Could not load open questions.',
          );
        }
      })
      .finally(() => {
        if (active) {
        setLoadedVersion({ caseId, updatedAt, revision });
        }
      });

    return () => {
      active = false;
    };
  }, [caseId, revision, updatedAt]);

  const question = queue?.questions[0] ?? null;

  async function submitAnswer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!question || !answer.trim()) return;

    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      const updated = await answerClarificationQuestion(
        caseId,
        question.id,
        answer.trim(),
      );

      onCaseUpdate(updated);
      setAnswer('');
      setNotice('Answer saved to the case. The workspace and Legal Twin are updating from the returned case state.');
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not save this answer.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      aria-labelledby="clarification-heading"
      className="rounded-3xl border border-violet-200 bg-white p-6 shadow-sm dark:border-violet-900/60 dark:bg-[#111] sm:p-8"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-violet-50 text-violet-600 dark:bg-violet-900/30 dark:text-violet-300">
          <CircleHelp aria-hidden="true" className="h-5 w-5" />
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-violet-600 dark:text-violet-300">
            Clarify this case
          </p>

          <h2
            id="clarification-heading"
            className="mt-1 text-lg font-semibold"
          >
            Questions from open case details
          </h2>

          <p className="mt-1 text-sm leading-6 text-zinc-500 dark:text-zinc-400">
            Each question is tied to an unknown in this case or its current
            journey. Your answer is saved as user-reported information with
            its source.
          </p>
        </div>
      </div>

      {loading ? (
        <p className="mt-5 flex items-center gap-2 text-sm text-zinc-500">
          <Loader2
            aria-hidden="true"
            className="h-4 w-4 animate-spin"
          />
          Checking open questions…
        </p>
      ) : question ? (
        <form
          onSubmit={submitAnswer}
          className="mt-5 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800 sm:p-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="rounded-full bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700 dark:bg-violet-950/50 dark:text-violet-200">
              {question.category.replaceAll('_', ' ')}
            </span>

            <span className="text-xs text-zinc-500">
              {queue?.questions.length ?? 1} open question
              {(queue?.questions.length ?? 1) === 1 ? '' : 's'}
            </span>
          </div>

          <p className="mt-4 font-medium leading-6">{question.question}</p>

          <div
            className="mt-3 flex flex-wrap gap-2"
            aria-label="Question sources"
          >
            {question.sources.map((source, index) => (
              <span
                key={`${source.source_id ?? 'source'}-${source.source_path ?? 'unknown'}-${index}`}
                title={source.source_path}
                className="rounded-full border border-zinc-200 px-2.5 py-1 text-xs text-zinc-500 dark:border-zinc-700 dark:text-zinc-400"
              >
                {source.text}
              </span>
            ))}
          </div>

          <label
            htmlFor="clarification-answer"
            className="mt-4 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            Your answer
          </label>

          <textarea
            id="clarification-answer"
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            rows={3}
            maxLength={10_000}
            disabled={saving}
            placeholder="Type what you know. You can also say that you do not know or prefer not to share."
            className="mt-2 w-full resize-y rounded-xl border border-zinc-200 bg-transparent p-3 text-sm leading-6 outline-none focus:border-violet-400 dark:border-zinc-700 dark:focus:border-violet-500"
          />

          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-zinc-500">
              Only this answer is added. It does not change your original
              statement.
            </p>

            <button
              type="submit"
              disabled={saving || !answer.trim()}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-zinc-900 px-4 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {saving ? (
                <Loader2
                  aria-hidden="true"
                  className="h-4 w-4 animate-spin"
                />
              ) : (
                <Send aria-hidden="true" className="h-4 w-4" />
              )}
              Save answer
            </button>
          </div>
        </form>
      ) : (
        <p className="mt-5 rounded-2xl border border-dashed border-zinc-200 px-4 py-5 text-sm text-zinc-500 dark:border-zinc-800">
          No open questions are currently grounded in this case.
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
        >
          {error}
        </p>
      )}

      {notice && (
        <p
          role="status"
          className="mt-3 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200"
        >
          {notice}
        </p>
      )}
    </section>
  );
}
