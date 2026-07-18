/**
 * Solve-time sharing: challenge links, their checksum, and the banner image.
 *
 * A challenge link carries the puzzle (the same public `p=` deep link that
 * already exists), the solve time, a display name, and a checksum — never
 * the solution. The checksum is SHA-256 over a salted canonical string,
 * truncated to 8 hex chars. The salt ships in this bundle, so this is a
 * tamper *deterrent* (editing `t=` in the URL breaks it), not cryptographic
 * proof — real proof would need a server to hold the secret.
 *
 * Links point at `challenge.html`, a tiny static page whose only jobs are
 * (a) carrying Open Graph tags + a static preview image so chat apps like
 * WhatsApp render a proper card (their crawlers don't run JS, so the card
 * can't be personalized), and (b) redirecting the human who clicks it into
 * the player, params intact — where the personalized banner renders live.
 */

import { formatTime } from './timer';

const SALT = 'pentopia-challenge-v1';

/** Max display-name length, enforced on both ends (build and parse). */
export const MAX_NAME_LENGTH = 24;

export interface Challenge {
  /** Solve time in ms. */
  timeMs: number;
  /** Display name, already length-capped. */
  name: string;
  /** The 8-hex-char checksum as carried by the link. */
  checksum: string;
}

function subtle(): SubtleCrypto {
  // globalThis.crypto covers both browsers and Node >= 20 (vitest).
  return globalThis.crypto.subtle;
}

/** Canonical checksum input — any change here invalidates all existing links. */
function checksumInput(puzzleKey: string, timeMs: number, name: string): string {
  return `${SALT}|${puzzleKey}|${timeMs}|${name}`;
}

/** SHA-256 over the salted canonical string, truncated to 8 hex chars. */
export async function challengeChecksum(puzzleKey: string, timeMs: number, name: string): Promise<string> {
  const bytes = new TextEncoder().encode(checksumInput(puzzleKey, timeMs, name));
  const digest = await subtle().digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest).slice(0, 4))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function sanitizeName(raw: string): string {
  return raw.trim().slice(0, MAX_NAME_LENGTH);
}

/**
 * Build the absolute challenge URL for the current deployment. `baseHref`
 * is the app's directory URL (e.g. "https://daromaj.github.io/pentopia/");
 * callers in the browser pass `appBaseHref()`.
 */
export async function buildChallengeUrl(
  baseHref: string,
  puzzleKey: string,
  timeMs: number,
  name: string,
): Promise<string> {
  const c = await challengeChecksum(puzzleKey, timeMs, name);
  const params = new URLSearchParams({ p: puzzleKey, t: String(timeMs), n: name, c });
  return `${baseHref}challenge.html?${params.toString()}`;
}

/** The directory URL the app is served from, with a trailing slash. */
export function appBaseHref(): string {
  const dir = location.pathname.replace(/[^/]*$/, '');
  return `${location.origin}${dir}`;
}

/**
 * Parse challenge params out of a query string. Returns null unless all
 * three (`t`, `n`, `c`) are present and well-formed. The puzzle itself
 * comes from the ordinary `p=` startup path, not from here.
 */
export function parseChallenge(search: string): Challenge | null {
  const params = new URLSearchParams(search);
  const t = params.get('t');
  const n = params.get('n');
  const c = params.get('c');
  if (!t || !n || !c) return null;
  const timeMs = Number(t);
  if (!Number.isInteger(timeMs) || timeMs <= 0 || timeMs >= 1e9) return null;
  if (!/^[0-9a-f]{8}$/.test(c)) return null;
  const name = sanitizeName(n);
  if (!name) return null;
  return { timeMs, name, checksum: c };
}

/** Whether a parsed challenge's checksum matches this puzzle + time + name. */
export async function verifyChallenge(puzzleKey: string, ch: Challenge): Promise<boolean> {
  return (await challengeChecksum(puzzleKey, ch.timeMs, ch.name)) === ch.checksum;
}

// --- Banner image -----------------------------------------------------------

/** Pentomino silhouettes for the banner motif (cell coords, arbitrary pieces). */
const MOTIF_SHAPES: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [[0, 0], [1, 0], [2, 0], [3, 0], [3, 1]], // L
  [[0, 0], [0, 1], [0, 2], [1, 1], [2, 1]], // T
  [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0]], // P
  [[0, 0], [1, 0], [1, 1], [2, 1], [3, 1]], // N
];

const MOTIF_COLORS = ['#2b6cb0', '#1f7a3f', '#b7791f', '#805ad5'];

export interface BannerOptions {
  name: string;
  timeMs: number;
  /** e.g. "8×8". */
  sizeText: string;
  dark: boolean;
}

/** Draw the 1200×630 share banner onto `canvas` (resizes it). */
export function drawBanner(canvas: HTMLCanvasElement, opts: BannerOptions): void {
  const W = 1200;
  const H = 630;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const bg = opts.dark ? '#16171a' : '#faf9f6';
  const fg = opts.dark ? '#e9e9e6' : '#1a1a1a';
  const soft = opts.dark ? '#a4a49e' : '#55554f';
  const accent = opts.dark ? '#5b9bd5' : '#2b6cb0';
  const green = opts.dark ? '#2f9e57' : '#1f7a3f';

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Faint grid backdrop — the game's graph paper.
  ctx.strokeStyle = opts.dark ? 'rgba(233,233,230,0.07)' : 'rgba(26,26,26,0.06)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 42) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let y = 0; y <= H; y += 42) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }

  // Pentomino motif, right side.
  const u = 27;
  ctx.save();
  ctx.translate(W - 320, 140);
  MOTIF_SHAPES.forEach((shape, i) => {
    ctx.save();
    ctx.translate((i % 2) * 150, Math.floor(i / 2) * 175);
    ctx.rotate((i - 1.5) * 0.12);
    ctx.fillStyle = MOTIF_COLORS[i]!;
    ctx.globalAlpha = 0.9;
    for (const [r, c] of shape) ctx.fillRect(c * u, r * u, u - 3, u - 3);
    ctx.restore();
  });
  ctx.restore();

  const stack = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.fillStyle = accent;
  ctx.font = `600 30px ${stack}`;
  ctx.fillText('PENTOPIA', 70, 110);
  ctx.fillStyle = fg;
  ctx.font = `700 58px ${stack}`;
  ctx.fillText(`${opts.name} solved it in`, 70, 235);
  ctx.fillStyle = green;
  ctx.font = `800 150px ${stack}`;
  ctx.fillText(formatTime(opts.timeMs), 70, 400);
  ctx.fillStyle = fg;
  ctx.font = `600 44px ${stack}`;
  ctx.fillText('Can you beat it?', 70, 490);
  ctx.fillStyle = soft;
  ctx.font = `400 28px ${stack}`;
  ctx.fillText(`${opts.sizeText} pentomino deduction puzzle`, 70, 558);
}

// --- Share action -----------------------------------------------------------

export type ShareOutcome = 'shared' | 'copied' | 'failed';

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

/**
 * Share `url` + the banner image the best way this device can: the native
 * share sheet with the PNG attached (mobile — lands the personalized banner
 * straight in WhatsApp & friends), else copy the link to the clipboard.
 */
export async function shareChallenge(
  url: string,
  bannerCanvas: HTMLCanvasElement,
  opts: { name: string; timeMs: number },
): Promise<ShareOutcome> {
  const text = `I solved this Pentopia puzzle in ${formatTime(opts.timeMs)} — can you beat me? ${url}`;

  const blob = await canvasToPngBlob(bannerCanvas);
  if (blob && typeof navigator.canShare === 'function') {
    const file = new File([blob], 'pentopia-challenge.png', { type: 'image/png' });
    const payload = { text, files: [file] };
    if (navigator.canShare(payload)) {
      try {
        await navigator.share(payload);
        return 'shared';
      } catch (err) {
        // AbortError = user closed the sheet; fall through to clipboard.
        if ((err as DOMException).name === 'AbortError') return 'failed';
      }
    }
  }

  try {
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch {
    return 'failed';
  }
}

/** Trigger a download of the banner as a PNG file. */
export function downloadBanner(bannerCanvas: HTMLCanvasElement): void {
  const a = document.createElement('a');
  a.download = 'pentopia-challenge.png';
  a.href = bannerCanvas.toDataURL('image/png');
  a.click();
}
