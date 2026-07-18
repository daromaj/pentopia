/**
 * Web Worker entry (roadmap §5.5: keep the CPU-bound minimize loop off the main
 * thread). Protocol:
 *   in:  { type: 'generate', opts: GenerateOptions }
 *   out: { type: 'done', result: { puzzleUrl, stats } } | { type: 'error', message }
 *
 * Kept DOM-free in its type surface (cast `self` to a minimal `Worker`) so it
 * type-checks under the node-oriented tsconfig; it is bundled as a worker for
 * the browser and never imported by Node code (importing it would touch `self`).
 * NOT re-exported from index.ts for that reason.
 */

import { generatePuzzle, type GenerateOptions, type GenerateStats } from './generate';

interface GenerateRequest {
  readonly type: 'generate';
  readonly opts: GenerateOptions;
}

interface DoneResponse {
  readonly type: 'done';
  readonly result: { readonly puzzleUrl: string; readonly stats: GenerateStats };
}

interface ErrorResponse {
  readonly type: 'error';
  readonly message: string;
}

export type WorkerRequest = GenerateRequest;
export type WorkerResponse = DoneResponse | ErrorResponse;

const ctx = self as unknown as {
  onmessage: ((ev: { data: WorkerRequest }) => void) | null;
  postMessage(msg: WorkerResponse): void;
};

ctx.onmessage = (ev): void => {
  const data = ev.data;
  if (!data || data.type !== 'generate') return;
  try {
    const result = generatePuzzle(data.opts);
    ctx.postMessage({ type: 'done', result: { puzzleUrl: result.url, stats: result.stats } });
  } catch (e) {
    ctx.postMessage({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
};
