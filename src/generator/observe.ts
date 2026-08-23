/**
 * Timing shim for GenerationObserver hooks: run `fn`, report its wall-clock
 * cost to `report`, return its value. Purely diagnostic — the report callback
 * must never influence generation.
 */
export function timed<T>(fn: () => T, report: (elapsedMs: number) => void): T {
  const start = performance.now();
  const value = fn();
  report(performance.now() - start);
  return value;
}
