/**
 * The "Solved!" dialog: final time, a display-name field, a live preview of
 * the share banner, and the share/download actions. Built fresh on every
 * open (native <dialog>, so Esc/backdrop dismissal and focus trapping come
 * for free) and removed from the DOM on close.
 */

import { formatTime } from './timer';
import {
  appBaseHref,
  buildChallengeUrl,
  drawBanner,
  downloadBanner,
  sanitizeName,
  shareChallenge,
  MAX_NAME_LENGTH,
} from './share';

export interface ChallengeContext {
  name: string;
  timeMs: number;
  verified: boolean;
}

export interface SolvedDialogOptions {
  /** Canonical `encodeUrl(puzzle)` string. */
  puzzleKey: string;
  timeMs: number;
  /** e.g. "8×8". */
  sizeText: string;
  /** The challenge this solve was racing against, if any. */
  challenge?: ChallengeContext | null;
  getName: () => string;
  setName: (name: string) => void;
}

function isDarkTheme(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
}

export function showSolvedDialog(opts: SolvedDialogOptions): void {
  const dialog = document.createElement('dialog');
  dialog.className = 'solved-dialog';

  const title = document.createElement('div');
  title.className = 'solved-title';
  title.textContent = 'Solved!';

  const time = document.createElement('div');
  time.className = 'solved-time';
  time.textContent = formatTime(opts.timeMs);

  const meta = document.createElement('div');
  meta.className = 'solved-meta';
  meta.textContent = opts.sizeText;

  dialog.append(title, time, meta);

  if (opts.challenge) {
    const vs = document.createElement('div');
    vs.className = 'solved-vs';
    const theirs = opts.challenge.timeMs;
    const beat = opts.timeMs < theirs;
    vs.textContent = beat
      ? `You beat ${opts.challenge.name}'s ${formatTime(theirs)} 🏆`
      : `${opts.challenge.name}'s ${formatTime(theirs)} still stands — rematch?`;
    dialog.appendChild(vs);
  }

  const nameLabel = document.createElement('label');
  nameLabel.className = 'solved-name-label';
  nameLabel.textContent = 'Your name on the challenge';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.maxLength = MAX_NAME_LENGTH;
  nameInput.placeholder = 'Anonymous';
  nameInput.value = opts.getName();
  nameLabel.appendChild(nameInput);
  dialog.appendChild(nameLabel);

  const banner = document.createElement('canvas');
  banner.className = 'solved-banner';
  dialog.appendChild(banner);

  const currentName = (): string => sanitizeName(nameInput.value) || 'Anonymous';
  const redraw = (): void =>
    drawBanner(banner, {
      name: currentName(),
      timeMs: opts.timeMs,
      sizeText: opts.sizeText,
      dark: isDarkTheme(),
    });
  redraw();
  nameInput.addEventListener('input', redraw);

  const status = document.createElement('div');
  status.className = 'solved-status';
  status.hidden = true;

  const shareBtn = document.createElement('button');
  shareBtn.type = 'button';
  shareBtn.className = 'btn-primary';
  shareBtn.textContent = 'Share & challenge friends';

  const downloadBtn = document.createElement('button');
  downloadBtn.type = 'button';
  downloadBtn.textContent = 'Download banner';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = 'Close';

  const buttons = document.createElement('div');
  buttons.className = 'solved-buttons';
  buttons.append(shareBtn, downloadBtn, closeBtn);
  dialog.append(buttons, status);

  function showStatus(msg: string): void {
    status.textContent = msg;
    status.hidden = false;
  }

  shareBtn.addEventListener('click', () => {
    const name = currentName();
    opts.setName(name);
    shareBtn.disabled = true;
    void (async () => {
      try {
        const url = await buildChallengeUrl(appBaseHref(), opts.puzzleKey, opts.timeMs, name);
        const outcome = await shareChallenge(url, banner, { name, timeMs: opts.timeMs });
        if (outcome === 'copied') showStatus('Challenge link copied — paste it anywhere.');
        else if (outcome === 'shared') showStatus('Shared!');
        else showStatus('Sharing was cancelled.');
      } catch {
        showStatus('Could not build the share link.');
      } finally {
        shareBtn.disabled = false;
      }
    })();
  });

  downloadBtn.addEventListener('click', () => {
    opts.setName(currentName());
    downloadBanner(banner);
  });

  closeBtn.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    opts.setName(currentName());
    dialog.remove();
  });
  // Backdrop click closes (native dialog only does Esc by itself).
  dialog.addEventListener('click', (ev) => {
    if (ev.target === dialog) dialog.close();
  });

  document.body.appendChild(dialog);
  dialog.showModal();
}
