/**
 * Solve timer: pure logic, no DOM, injectable clock — the same testability
 * contract as persist.ts. A timer is a plain object of accumulated ms plus
 * an optional "running since" timestamp; app.ts owns starting it on the
 * first edit, pausing it on tab-hide, and freezing it on solve.
 */

export interface SolveTimer {
  /** Milliseconds accumulated over completed running stretches. */
  accumulatedMs: number;
  /** Epoch ms when the current running stretch started, or null while paused. */
  runningSince: number | null;
}

export function createTimer(initialMs = 0): SolveTimer {
  return { accumulatedMs: initialMs, runningSince: null };
}

/** Start (or resume) the timer. No-op if already running. */
export function startTimer(t: SolveTimer, now = Date.now()): void {
  t.runningSince ??= now;
}

/** Pause the timer, folding the current stretch into `accumulatedMs`. No-op if not running. */
export function pauseTimer(t: SolveTimer, now = Date.now()): void {
  if (t.runningSince === null) return;
  t.accumulatedMs += Math.max(0, now - t.runningSince);
  t.runningSince = null;
}

export function isRunning(t: SolveTimer): boolean {
  return t.runningSince !== null;
}

/** Total elapsed ms including the in-flight stretch (if running). */
export function elapsedMs(t: SolveTimer, now = Date.now()): number {
  return t.accumulatedMs + (t.runningSince !== null ? Math.max(0, now - t.runningSince) : 0);
}

/**
 * Human display: "3:42.6" under an hour (tenths matter when comparing
 * times), "1:02:07" above it (nobody needs tenths after an hour).
 */
export function formatTime(ms: number): string {
  const clamped = Math.max(0, ms);
  if (clamped >= 3_600_000) {
    const totalS = Math.floor(clamped / 1000);
    const h = Math.floor(totalS / 3600);
    const m = Math.floor((totalS % 3600) / 60);
    const s = totalS % 60;
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  const tenths = Math.floor(clamped / 100);
  const m = Math.floor(tenths / 600);
  const s = Math.floor(tenths / 10) % 60;
  const d = tenths % 10;
  return `${m}:${String(s).padStart(2, '0')}.${d}`;
}
