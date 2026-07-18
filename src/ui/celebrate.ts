/**
 * Solve celebrations: four effects, one picked at random per solve.
 *
 *  - "parade":    each placed pentomino pops in sequence, then a gold wave
 *                 sweeps the board (pure CSS on the existing SVG rects).
 *  - "confetti":  canvas overlay of tiny tumbling pentominoes bursting from
 *                 the board's center.
 *  - "stamp":     a shine sweeps the grid, then a rubber-stamp SOLVED thumps
 *                 down over it (DOM overlays).
 *  - "fireworks": rockets that burst into pentomino-shaped sparks (canvas).
 *
 * Everything cleans up after itself: overlays self-remove on completion and
 * the rect classes vanish with the next board re-render. Honors
 * prefers-reduced-motion by skipping the show entirely.
 */

import type { Puzzle } from '../core/types';
import { computeShadedComponents } from './state';

export type EffectName = 'parade' | 'confetti' | 'stamp' | 'fireworks';

const EFFECT_NAMES: readonly EffectName[] = ['parade', 'confetti', 'stamp', 'fireworks'];

/** Distinct per-piece colors, reused round-robin for boards with many pieces. */
const PIECE_COLORS = ['#2b6cb0', '#1f7a3f', '#b7791f', '#805ad5', '#d9605f', '#2c7a7b', '#b83280'];

/** Tiny pentomino silhouettes used as confetti / firework particles. */
const MINI_SHAPES: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [[0, 0], [1, 0], [2, 0], [3, 0], [3, 1]], // L
  [[0, 0], [0, 1], [0, 2], [1, 1], [2, 1]], // T
  [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0]], // P
  [[0, 0], [1, 0], [1, 1], [2, 1], [3, 1]], // N
  [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]], // X
];

function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Play a random celebration over the just-solved board. `host` is the
 * board-host element (positioned container), `svg` the current board SVG
 * inside it. Returns the suggested delay in ms before showing the solved
 * dialog, so the effect gets its moment first.
 */
export function playCelebration(
  host: HTMLElement,
  svg: SVGSVGElement,
  puzzle: Puzzle,
  cellState: Uint8Array,
): number {
  if (reducedMotion()) return 0;
  const effect = EFFECT_NAMES[Math.floor(Math.random() * EFFECT_NAMES.length)]!;
  switch (effect) {
    case 'parade':
      return playParade(svg, puzzle, cellState);
    case 'confetti':
      return playConfetti(host, svg);
    case 'stamp':
      return playStamp(host, svg);
    case 'fireworks':
      return playFireworks(host, svg);
  }
}

// --- Parade (CSS on the board rects) ----------------------------------------

function playParade(svg: SVGSVGElement, puzzle: Puzzle, cellState: Uint8Array): number {
  // Map cell index -> its shaded rect, keyed off the rect's grid position.
  const rectByCell = new Map<number, SVGRectElement>();
  svg.querySelectorAll<SVGRectElement>('rect.cell-shaded').forEach((rect) => {
    const x = Math.round(Number(rect.getAttribute('x')));
    const y = Math.round(Number(rect.getAttribute('y')));
    const cell = Math.round(y / 40) * puzzle.cols + Math.round(x / 40);
    rectByCell.set(cell, rect);
  });

  // Pop pieces left-to-right so the parade reads as a sweep.
  const components = computeShadedComponents(puzzle, cellState)
    .slice()
    .sort((a, b) => Math.min(...a.cells.map((c) => c % puzzle.cols)) - Math.min(...b.cells.map((c) => c % puzzle.cols)));

  const STAGGER = 150;
  components.forEach((comp, i) => {
    const color = PIECE_COLORS[i % PIECE_COLORS.length]!;
    setTimeout(() => {
      for (const cell of comp.cells) {
        const rect = rectByCell.get(cell);
        if (!rect) continue;
        rect.style.setProperty('--pc', color);
        rect.classList.add('cel-pop');
      }
    }, i * STAGGER);
  });

  // Gold wave sweeping by column once the last piece has popped.
  const waveAt = components.length * STAGGER + 250;
  setTimeout(() => {
    svg.classList.add('cel-settle');
    for (const [cell, rect] of rectByCell) {
      rect.style.animationDelay = `${(cell % puzzle.cols) * 25}ms`;
      rect.classList.remove('cel-pop');
      rect.classList.add('cel-wave');
    }
  }, waveAt);

  return waveAt + 700;
}

// --- Canvas overlay plumbing ------------------------------------------------

interface Overlay {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  done: () => void;
}

/** Mount a DPR-scaled canvas exactly over the board SVG's box inside `host`. */
function mountCanvas(host: HTMLElement, svg: SVGSVGElement): Overlay | null {
  const hostBox = host.getBoundingClientRect();
  const box = svg.getBoundingClientRect();
  const canvas = document.createElement('canvas');
  canvas.className = 'cel-canvas';
  canvas.style.left = `${box.left - hostBox.left}px`;
  canvas.style.top = `${box.top - hostBox.top}px`;
  canvas.style.width = `${box.width}px`;
  canvas.style.height = `${box.height}px`;
  const dpr = devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(box.width * dpr));
  canvas.height = Math.max(1, Math.round(box.height * dpr));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  host.appendChild(canvas);
  return { ctx, w: box.width, h: box.height, done: () => canvas.remove() };
}

interface MiniPiece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vrot: number;
  shape: ReadonlyArray<readonly [number, number]>;
  color: string;
  /** Cell size of the mini piece, px. */
  u: number;
  /** Epoch-relative ms of birth (performance.now domain). */
  born: number;
}

function drawMini(ctx: CanvasRenderingContext2D, p: MiniPiece): void {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.rot);
  ctx.fillStyle = p.color;
  for (const [r, c] of p.shape) {
    ctx.fillRect(c * p.u - p.u, r * p.u - 2 * p.u, p.u - 0.5, p.u - 0.5);
  }
  ctx.restore();
}

// --- Confetti ---------------------------------------------------------------

function playConfetti(host: HTMLElement, svg: SVGSVGElement): number {
  const overlay = mountCanvas(host, svg);
  if (!overlay) return 0;
  const { ctx, w, h } = overlay;

  const parts: MiniPiece[] = [];
  for (let i = 0; i < 70; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 60 + Math.random() * 240;
    parts.push({
      x: w / 2,
      y: h * 0.45,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 150,
      rot: Math.random() * Math.PI * 2,
      vrot: (Math.random() - 0.5) * 8,
      shape: MINI_SHAPES[i % MINI_SHAPES.length]!,
      color: PIECE_COLORS[i % PIECE_COLORS.length]!,
      u: 3 + Math.random() * 3,
      born: 0,
    });
  }

  const DURATION = 2600;
  const start = performance.now();
  let last = start;
  const frame = (now: number): void => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const life = (now - start) / DURATION;
    ctx.clearRect(0, 0, w, h);
    if (life >= 1) {
      overlay.done();
      return;
    }
    ctx.globalAlpha = life > 0.7 ? 1 - (life - 0.7) / 0.3 : 1;
    for (const p of parts) {
      p.vy += 380 * dt;
      p.vx *= 0.995;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vrot * dt;
      drawMini(ctx, p);
    }
    ctx.globalAlpha = 1;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  return 900;
}

// --- Stamp ------------------------------------------------------------------

function playStamp(host: HTMLElement, svg: SVGSVGElement): number {
  const hostBox = host.getBoundingClientRect();
  const box = svg.getBoundingClientRect();

  const sweep = document.createElement('div');
  sweep.className = 'cel-sweep';
  sweep.style.left = `${box.left - hostBox.left}px`;
  sweep.style.top = `${box.top - hostBox.top}px`;
  sweep.style.width = `${box.width}px`;
  sweep.style.height = `${box.height}px`;

  const stamp = document.createElement('div');
  stamp.className = 'cel-stamp';
  stamp.textContent = 'Solved';
  stamp.style.left = `${box.left - hostBox.left + box.width / 2}px`;
  stamp.style.top = `${box.top - hostBox.top + box.height * 0.42}px`;

  host.append(sweep, stamp);
  setTimeout(() => stamp.classList.add('cel-stamp-in'), 600);
  setTimeout(() => {
    sweep.remove();
    stamp.remove();
  }, 2600);
  return 1500;
}

// --- Fireworks (pentomino-shaped sparks) ------------------------------------

interface Rocket {
  launchAt: number;
  fromX: number;
  toX: number;
  toY: number;
  color: string;
  burst: MiniPiece[] | null;
}

function playFireworks(host: HTMLElement, svg: SVGSVGElement): number {
  const overlay = mountCanvas(host, svg);
  if (!overlay) return 0;
  const { ctx, w, h } = overlay;

  const rockets: Rocket[] = [0, 1, 2].map((i) => ({
    launchAt: i * 380,
    fromX: w * (0.25 + 0.25 * i),
    toX: w * (0.22 + 0.28 * i),
    toY: h * (0.16 + 0.1 * (i % 2)),
    color: PIECE_COLORS[(i * 2) % PIECE_COLORS.length]!,
    burst: null,
  }));

  const FLIGHT = 500;
  const SPARK_LIFE = 1300;
  const DURATION = 3100;
  const start = performance.now();
  let last = start;

  const frame = (now: number): void => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = now - start;
    ctx.clearRect(0, 0, w, h);
    if (t >= DURATION) {
      overlay.done();
      return;
    }

    for (const r of rockets) {
      if (t < r.launchAt) continue;
      if (!r.burst) {
        const k = Math.min(1, (t - r.launchAt) / FLIGHT);
        const ease = 1 - (1 - k) * (1 - k);
        const x = r.fromX + (r.toX - r.fromX) * ease;
        const y = h + (r.toY - h) * ease;
        ctx.fillStyle = r.color;
        ctx.beginPath();
        ctx.arc(x, y, 2.4, 0, Math.PI * 2);
        ctx.fill();
        if (k >= 1) {
          // Burst: a ring of tiny pentominoes, tumbling outward.
          r.burst = [];
          const count = 18;
          for (let i = 0; i < count; i++) {
            const angle = (i / count) * Math.PI * 2;
            const speed = 60 + Math.random() * 80;
            r.burst.push({
              x,
              y,
              vx: Math.cos(angle) * speed,
              vy: Math.sin(angle) * speed,
              rot: Math.random() * Math.PI * 2,
              vrot: (Math.random() - 0.5) * 10,
              shape: MINI_SHAPES[i % MINI_SHAPES.length]!,
              color: r.color,
              u: 2.5 + Math.random() * 1.5,
              born: t,
            });
          }
        }
      } else {
        for (const p of r.burst) {
          const age = (t - p.born) / SPARK_LIFE;
          if (age >= 1) continue;
          p.vy += 120 * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.rot += p.vrot * dt;
          ctx.globalAlpha = 1 - age;
          drawMini(ctx, p);
        }
        ctx.globalAlpha = 1;
      }
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  return 1700;
}
