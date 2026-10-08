'use client';

import {
  useEffect,
  useId,
  useMemo,
  useState,
} from 'react';
import {
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
} from 'lucide-react';
import {
  formatTwinTime,
  parseTwinTime,
} from './semantics';
import { TwinSnapshot } from './TwinSnapshot';
import type {
  TwinSnapshotData,
  TwinTemporalValue,
} from './types';

export interface TwinTimelineProps {
  currentTime?: TwinTemporalValue | null;
  snapshots: readonly TwinSnapshotData[];
  onTimeChange?: (
    currentTime: TwinTemporalValue | null,
  ) => void;
  onSnapshotSelect?: (
    snapshot: TwinSnapshotData,
  ) => void;
  className?: string;
}

function getGraphCounts(
  snapshot?: TwinSnapshotData,
) {
  return {
    nodes: snapshot?.graph?.nodes.length ?? 0,
    edges: snapshot?.graph?.edges.length ?? 0,
  };
}

export function TwinTimeline({
  currentTime = null,
  snapshots,
  onTimeChange,
  onSnapshotSelect,
  className = '',
}: TwinTimelineProps) {
  const id = useId().replace(
    /[^a-zA-Z0-9_-]/g,
    '',
  );

  const headingId =
    `twin-timeline-heading-${id}`;

  const rangeId =
    `twin-timeline-range-${id}`;

  const [isPlaying, setIsPlaying] =
    useState(false);

  const orderedSnapshots = useMemo(
    () =>
      [...snapshots].sort(
        (left, right) => {
          const leftTime =
            parseTwinTime(left.at);

          const rightTime =
            parseTwinTime(right.at);

          if (leftTime === null) {
            return rightTime === null
              ? 0
              : 1;
          }

          if (rightTime === null) {
            return -1;
          }

          return leftTime - rightTime;
        },
      ),
    [snapshots],
  );

  const timedSnapshots =
    orderedSnapshots.filter(
      (snapshot) =>
        parseTwinTime(snapshot.at) !== null,
    );

  const selectedTime =
    parseTwinTime(currentTime);

  const activeSnapshot =
    orderedSnapshots.find(
      (snapshot) =>
        selectedTime !== null &&
        parseTwinTime(snapshot.at) ===
          selectedTime,
    );

  const sliderIndex = useMemo(() => {
    if (
      selectedTime === null ||
      !timedSnapshots.length
    ) {
      return 0;
    }

    return timedSnapshots.reduce(
      (closestIndex, snapshot, index) => {
        const closestTime =
          parseTwinTime(
            timedSnapshots[closestIndex].at,
          ) ?? selectedTime;

        const snapshotTime =
          parseTwinTime(
            snapshot.at,
          ) ?? selectedTime;

        return Math.abs(
          snapshotTime - selectedTime,
        ) <
          Math.abs(
            closestTime - selectedTime,
          )
          ? index
          : closestIndex;
      },
      0,
    );
  }, [
    selectedTime,
    timedSnapshots,
  ]);

  const previousSnapshot =
    sliderIndex > 0
      ? timedSnapshots[
          sliderIndex - 1
        ]
      : undefined;

  const currentCounts =
    getGraphCounts(
      timedSnapshots[sliderIndex],
    );

  const previousCounts =
    getGraphCounts(
      previousSnapshot,
    );

  const nodeDelta =
    currentCounts.nodes -
    previousCounts.nodes;

  const edgeDelta =
    currentCounts.edges -
    previousCounts.edges;

  useEffect(() => {
    if (
      !isPlaying ||
      !onTimeChange ||
      timedSnapshots.length < 2
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      const currentIndex =
        sliderIndex;

      const nextIndex =
        currentIndex >=
        timedSnapshots.length - 1
          ? 0
          : currentIndex + 1;

      const nextSnapshot =
        timedSnapshots[nextIndex];

      if (nextSnapshot) {
        onTimeChange(
          nextSnapshot.at,
        );
        onSnapshotSelect?.(
          nextSnapshot,
        );
      }
    }, 1250);

    return () =>
      window.clearTimeout(timer);
  }, [
    isPlaying,
    onTimeChange,
    onSnapshotSelect,
    sliderIndex,
    timedSnapshots,
  ]);

  useEffect(() => {
    if (
      timedSnapshots.length < 2 &&
      isPlaying
    ) {
      const timer = window.setTimeout(
        () => setIsPlaying(false),
        0,
      );

      return () => window.clearTimeout(timer);
    }
  }, [
    isPlaying,
    timedSnapshots.length,
  ]);

  function selectSnapshot(
    snapshot: TwinSnapshotData,
  ) {
    onTimeChange?.(snapshot.at);
    onSnapshotSelect?.(snapshot);
  }

  function selectIndex(index: number) {
    const snapshot =
      timedSnapshots[index];

    if (!snapshot) return;

    selectSnapshot(snapshot);
  }

  function togglePlayback() {
    if (
      !onTimeChange ||
      timedSnapshots.length < 2
    ) {
      return;
    }

    if (
      !isPlaying &&
      (selectedTime === null ||
        sliderIndex >=
          timedSnapshots.length - 1)
    ) {
      selectIndex(0);
    }

    setIsPlaying(
      (current) => !current,
    );
  }

  return (
    <section
      aria-labelledby={headingId}
      className={`rounded-2xl border border-white/[0.08] bg-[#090d16] p-4 ${className}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex h-2 w-2 rounded-full bg-violet-400 shadow-[0_0_10px_rgba(167,139,250,0.7)]" />

            <h2
              id={headingId}
              className="text-sm font-semibold text-slate-100"
            >
              Legal timeline
            </h2>
          </div>

          <p className="mt-1 text-xs text-slate-400">
            {currentTime === null ||
            currentTime === undefined
              ? 'All available time states'
              : `Current view: ${formatTwinTime(
                  currentTime,
                )}`}
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={
              !onTimeChange ||
              timedSnapshots.length < 2
            }
            onClick={() =>
              selectIndex(
                Math.max(
                  0,
                  sliderIndex - 1,
                ),
              )
            }
            className="rounded-lg border border-white/10 p-2 text-slate-300 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Previous legal state"
            title="Previous legal state"
          >
            <SkipBack className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            disabled={
              !onTimeChange ||
              timedSnapshots.length < 2
            }
            onClick={togglePlayback}
            className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-400/25 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-300 transition hover:bg-cyan-400/15 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label={
              isPlaying
                ? 'Pause timeline playback'
                : 'Play timeline'
            }
          >
            {isPlaying ? (
              <Pause className="h-3.5 w-3.5" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}

            {isPlaying
              ? 'Pause'
              : 'Play Twin'}
          </button>

          <button
            type="button"
            disabled={
              !onTimeChange ||
              timedSnapshots.length < 2
            }
            onClick={() =>
              selectIndex(
                Math.min(
                  timedSnapshots.length -
                    1,
                  sliderIndex + 1,
                ),
              )
            }
            className="rounded-lg border border-white/10 p-2 text-slate-300 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Next legal state"
            title="Next legal state"
          >
            <SkipForward className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            disabled={
              !onTimeChange ||
              timedSnapshots.length < 1
            }
            onClick={() => {
              if (
                timedSnapshots[0]
              ) {
                selectSnapshot(
                  timedSnapshots[0],
                );
              }
            }}
            className="rounded-lg border border-white/10 p-2 text-slate-300 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Reset timeline"
            title="Reset timeline"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {timedSnapshots.length > 0 ? (
        <div className="mt-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] uppercase tracking-[0.14em] text-slate-500">
              Temporal state
            </span>

            <span className="text-[11px] text-slate-500">
              {sliderIndex + 1} /{' '}
              {timedSnapshots.length}
            </span>
          </div>

          <label
            htmlFor={rangeId}
            className="sr-only"
          >
            Choose a snapshot in time
          </label>

          <input
            id={rangeId}
            type="range"
            min={0}
            max={
              timedSnapshots.length - 1
            }
            step={1}
            value={sliderIndex}
            disabled={
              !onTimeChange ||
              timedSnapshots.length < 2
            }
            aria-valuetext={
              selectedTime === null
                ? 'No specific time selected'
                : formatTwinTime(
                    timedSnapshots[
                      sliderIndex
                    ]?.at,
                  )
            }
            onChange={(event) => {
              const snapshot =
                timedSnapshots[
                  Number(
                    event.currentTarget
                      .value,
                  )
                ];

              if (snapshot) {
                selectSnapshot(
                  snapshot,
                );
              }
            }}
            className="h-2 w-full cursor-pointer accent-cyan-400 disabled:cursor-default disabled:opacity-50"
          />

          <div className="mt-2 flex justify-between gap-4 text-[11px] text-slate-500">
            <span>
              {formatTwinTime(
                timedSnapshots[0].at,
              )}
            </span>

            <span>
              {formatTwinTime(
                timedSnapshots[
                  timedSnapshots.length -
                    1
                ].at,
              )}
            </span>
          </div>

          <div className="mt-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-slate-200">
                  {timedSnapshots[
                    sliderIndex
                  ]?.label ??
                    'Current state'}
                </p>

                <p className="mt-1 text-[11px] leading-5 text-slate-500">
                  {timedSnapshots[
                    sliderIndex
                  ]?.description ??
                    'The Twin is showing the case state at this point in time.'}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <span className="rounded-full border border-cyan-400/15 bg-cyan-400/[0.05] px-2 py-1 text-[10px] text-cyan-300">
                  {currentCounts.nodes} nodes
                </span>

                <span className="rounded-full border border-violet-400/15 bg-violet-400/[0.05] px-2 py-1 text-[10px] text-violet-300">
                  {currentCounts.edges} links
                </span>
              </div>
            </div>

            {previousSnapshot && (
              <div className="mt-3 flex flex-wrap gap-2 text-[10px]">
                <span
                  className={
                    nodeDelta > 0
                      ? 'rounded-full border border-emerald-400/15 bg-emerald-400/[0.04] px-2 py-1 text-emerald-300'
                      : nodeDelta < 0
                        ? 'rounded-full border border-amber-400/15 bg-amber-400/[0.04] px-2 py-1 text-amber-300'
                        : 'rounded-full border border-white/10 bg-white/[0.02] px-2 py-1 text-slate-500'
                  }
                >
                  {nodeDelta > 0
                    ? `+${nodeDelta}`
                    : nodeDelta}{' '}
                  nodes vs previous state
                </span>

                <span
                  className={
                    edgeDelta > 0
                      ? 'rounded-full border border-emerald-400/15 bg-emerald-400/[0.04] px-2 py-1 text-emerald-300'
                      : edgeDelta < 0
                        ? 'rounded-full border border-amber-400/15 bg-amber-400/[0.04] px-2 py-1 text-amber-300'
                        : 'rounded-full border border-white/10 bg-white/[0.02] px-2 py-1 text-slate-500'
                  }
                >
                  {edgeDelta > 0
                    ? `+${edgeDelta}`
                    : edgeDelta}{' '}
                  relationships vs previous
                </span>
              </div>
            )}
          </div>
        </div>
      ) : (
        <p className="mt-4 rounded-xl border border-dashed border-white/10 px-3 py-4 text-xs leading-5 text-slate-500">
          No dated snapshots were supplied.
        </p>
      )}

      {orderedSnapshots.length > 0 && (
        <div
          className="mt-4 flex gap-3 overflow-x-auto pb-1"
          aria-label="Available snapshots"
        >
          {orderedSnapshots.map(
            (snapshot) => (
              <TwinSnapshot
                key={snapshot.id}
                snapshot={snapshot}
                selected={
                  activeSnapshot?.id ===
                  snapshot.id
                }
                onSelect={
                  onTimeChange ||
                  onSnapshotSelect
                    ? selectSnapshot
                    : undefined
                }
              />
            ),
          )}
        </div>
      )}
    </section>
  );
}
