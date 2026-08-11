/**
 * Pixel surface + drawing primitives for Project Psyche's art pipeline.
 *
 * Everything is hard-edged: no anti-aliasing, no sub-pixel maths, no blur.
 * Alpha compositing is the only blending that happens, so a sprite drawn at
 * 100% alpha writes exact palette values.
 */
import { hex } from './palette.js';

export type RGBA = [number, number, number, number];

export class Surface {
  readonly w: number;
  readonly h: number;
  readonly data: Uint8Array; // RGBA

  constructor(w: number, h: number, fill?: string) {
    this.w = w;
    this.h = h;
    this.data = new Uint8Array(w * h * 4);
    if (fill) this.fill(fill);
  }

  static from(w: number, h: number, draw: (s: Surface) => void): Surface {
    const s = new Surface(w, h);
    draw(s);
    return s;
  }

  clone(): Surface {
    const s = new Surface(this.w, this.h);
    s.data.set(this.data);
    return s;
  }

  fill(color: string): this {
    const c = hex(color);
    for (let i = 0; i < this.w * this.h; i++) {
      this.data[i * 4] = c[0];
      this.data[i * 4 + 1] = c[1];
      this.data[i * 4 + 2] = c[2];
      this.data[i * 4 + 3] = c[3];
    }
    return this;
  }

  clear(): this {
    this.data.fill(0);
    return this;
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  /** Source-over composite of a single pixel. */
  px(x: number, y: number, color: string | RGBA, alpha = 1): this {
    x = x | 0;
    y = y | 0;
    if (!this.inside(x, y)) return this;
    const c = typeof color === 'string' ? hex(color) : color;
    const sa = (c[3] / 255) * alpha;
    if (sa <= 0) return this;
    const i = (y * this.w + x) * 4;
    if (sa >= 1) {
      this.data[i] = c[0];
      this.data[i + 1] = c[1];
      this.data[i + 2] = c[2];
      this.data[i + 3] = 255;
      return this;
    }
    const da = this.data[i + 3] / 255;
    const oa = sa + da * (1 - sa);
    if (oa <= 0) return this;
    for (let k = 0; k < 3; k++) {
      this.data[i + k] = Math.round((c[k] * sa + this.data[i + k] * da * (1 - sa)) / oa);
    }
    this.data[i + 3] = Math.round(oa * 255);
    return this;
  }

  /** Write a pixel only where the surface is currently transparent. */
  pxBehind(x: number, y: number, color: string): this {
    if (!this.inside(x | 0, y | 0)) return this;
    if (this.data[((y | 0) * this.w + (x | 0)) * 4 + 3] !== 0) return this;
    return this.px(x, y, color);
  }

  /** Overwrite a pixel only where the surface already has content. */
  pxOver(x: number, y: number, color: string, alpha = 1): this {
    if (!this.inside(x | 0, y | 0)) return this;
    if (this.data[((y | 0) * this.w + (x | 0)) * 4 + 3] === 0) return this;
    return this.px(x, y, color, alpha);
  }

  get(x: number, y: number): RGBA {
    if (!this.inside(x | 0, y | 0)) return [0, 0, 0, 0];
    const i = ((y | 0) * this.w + (x | 0)) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]];
  }

  alphaAt(x: number, y: number): number {
    if (!this.inside(x | 0, y | 0)) return 0;
    return this.data[((y | 0) * this.w + (x | 0)) * 4 + 3];
  }

  rect(x: number, y: number, w: number, h: number, color: string, alpha = 1): this {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, color, alpha);
    return this;
  }

  rectOutline(x: number, y: number, w: number, h: number, color: string, alpha = 1): this {
    for (let i = 0; i < w; i++) {
      this.px(x + i, y, color, alpha);
      this.px(x + i, y + h - 1, color, alpha);
    }
    for (let j = 0; j < h; j++) {
      this.px(x, y + j, color, alpha);
      this.px(x + w - 1, y + j, color, alpha);
    }
    return this;
  }

  hline(x: number, y: number, w: number, color: string, alpha = 1): this {
    for (let i = 0; i < w; i++) this.px(x + i, y, color, alpha);
    return this;
  }

  vline(x: number, y: number, h: number, color: string, alpha = 1): this {
    for (let j = 0; j < h; j++) this.px(x, y + j, color, alpha);
    return this;
  }

  line(x0: number, y0: number, x1: number, y1: number, color: string, alpha = 1): this {
    x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.px(x0, y0, color, alpha);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
    return this;
  }

  /** Filled ellipse inscribed in the box (x,y,w,h). */
  ellipse(x: number, y: number, w: number, h: number, color: string, alpha = 1): this {
    const rx = w / 2, ry = h / 2;
    const cx = x + rx - 0.5, cy = y + ry - 0.5;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const nx = (x + i - cx) / rx;
        const ny = (y + j - cy) / ry;
        if (nx * nx + ny * ny <= 1.02) this.px(x + i, y + j, color, alpha);
      }
    }
    return this;
  }

  ellipseOutline(x: number, y: number, w: number, h: number, color: string, alpha = 1): this {
    const mask = new Surface(this.w, this.h);
    mask.ellipse(x, y, w, h, '#ffffff');
    for (let j = 0; j < this.h; j++) {
      for (let i = 0; i < this.w; i++) {
        if (mask.alphaAt(i, j) === 0) continue;
        if (
          mask.alphaAt(i - 1, j) === 0 || mask.alphaAt(i + 1, j) === 0 ||
          mask.alphaAt(i, j - 1) === 0 || mask.alphaAt(i, j + 1) === 0
        ) this.px(i, j, color, alpha);
      }
    }
    return this;
  }

  /** Filled polygon (even-odd scanline). Points are [x,y] pairs. */
  poly(points: Array<[number, number]>, color: string, alpha = 1): this {
    let minY = Infinity, maxY = -Infinity;
    for (const p of points) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
      const xs: number[] = [];
      for (let i = 0; i < points.length; i++) {
        const a = points[i], b = points[(i + 1) % points.length];
        if (a[1] === b[1]) continue;
        const yc = y + 0.5;
        if ((yc >= a[1] && yc < b[1]) || (yc >= b[1] && yc < a[1])) {
          xs.push(a[0] + ((yc - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
        }
      }
      xs.sort((p, q) => p - q);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        for (let x = Math.round(xs[i]); x < Math.round(xs[i + 1]); x++) this.px(x, y, color, alpha);
      }
    }
    return this;
  }

  /** Composite another surface at (x,y). */
  blit(src: Surface, x = 0, y = 0, alpha = 1): this {
    for (let j = 0; j < src.h; j++) {
      for (let i = 0; i < src.w; i++) {
        const c = src.get(i, j);
        if (c[3] === 0) continue;
        this.px(x + i, y + j, c, alpha);
      }
    }
    return this;
  }

  /** Composite only where the destination is transparent. */
  blitBehind(src: Surface, x = 0, y = 0): this {
    for (let j = 0; j < src.h; j++) {
      for (let i = 0; i < src.w; i++) {
        const c = src.get(i, j);
        if (c[3] === 0) continue;
        if (this.alphaAt(x + i, y + j) !== 0) continue;
        this.px(x + i, y + j, c);
      }
    }
    return this;
  }

  /** Composite only where the destination already has content (clipped). */
  blitInside(src: Surface, x = 0, y = 0, alpha = 1): this {
    for (let j = 0; j < src.h; j++) {
      for (let i = 0; i < src.w; i++) {
        const c = src.get(i, j);
        if (c[3] === 0) continue;
        if (this.alphaAt(x + i, y + j) === 0) continue;
        this.px(x + i, y + j, c, alpha);
      }
    }
    return this;
  }

  sub(x: number, y: number, w: number, h: number): Surface {
    const s = new Surface(w, h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const c = this.get(x + i, y + j);
      if (c[3]) s.px(i, j, c);
    }
    return s;
  }

  flipX(): Surface {
    const s = new Surface(this.w, this.h);
    for (let j = 0; j < this.h; j++) for (let i = 0; i < this.w; i++) {
      const c = this.get(this.w - 1 - i, j);
      if (c[3]) s.px(i, j, c);
    }
    return s;
  }

  flipY(): Surface {
    const s = new Surface(this.w, this.h);
    for (let j = 0; j < this.h; j++) for (let i = 0; i < this.w; i++) {
      const c = this.get(i, this.h - 1 - j);
      if (c[3]) s.px(i, j, c);
    }
    return s;
  }

  /** Shift contents by (dx,dy) into a fresh surface of the same size. */
  offset(dx: number, dy: number): Surface {
    const s = new Surface(this.w, this.h);
    s.blit(this, dx, dy);
    return s;
  }

  /** Add a 1px outline around all opaque pixels (outside the silhouette). */
  outline(color: string, diagonals = false): this {
    const src = this.clone();
    const n: Array<[number, number]> = diagonals
      ? [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]
      : [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (let j = 0; j < this.h; j++) {
      for (let i = 0; i < this.w; i++) {
        if (src.alphaAt(i, j) !== 0) continue;
        for (const [dx, dy] of n) {
          if (src.alphaAt(i + dx, j + dy) > 128) { this.px(i, j, color); break; }
        }
      }
    }
    return this;
  }

  /** Darken the inside edge of the silhouette — cheap, effective form shading. */
  innerShade(color: string, alpha = 0.5, dirs: Array<[number, number]> = [[0, 1], [1, 0]]): this {
    const src = this.clone();
    for (let j = 0; j < this.h; j++) {
      for (let i = 0; i < this.w; i++) {
        if (src.alphaAt(i, j) === 0) continue;
        for (const [dx, dy] of dirs) {
          if (src.alphaAt(i + dx, j + dy) === 0) { this.px(i, j, color, alpha); break; }
        }
      }
    }
    return this;
  }

  /** Tint every opaque pixel toward a colour. */
  tint(color: string, amount: number): this {
    const c = hex(color);
    for (let i = 0; i < this.w * this.h; i++) {
      if (this.data[i * 4 + 3] === 0) continue;
      for (let k = 0; k < 3; k++) {
        this.data[i * 4 + k] = Math.round(this.data[i * 4 + k] + (c[k] - this.data[i * 4 + k]) * amount);
      }
    }
    return this;
  }

  /** Multiply brightness of every opaque pixel. */
  brightness(f: number): this {
    for (let i = 0; i < this.w * this.h; i++) {
      if (this.data[i * 4 + 3] === 0) continue;
      for (let k = 0; k < 3; k++) {
        this.data[i * 4 + k] = Math.max(0, Math.min(255, Math.round(this.data[i * 4 + k] * f)));
      }
    }
    return this;
  }

  /** Replace one exact colour with another (palette swapping for NPC variants). */
  swap(from: string, to: string): this {
    const a = hex(from), b = hex(to);
    for (let i = 0; i < this.w * this.h; i++) {
      if (this.data[i * 4] === a[0] && this.data[i * 4 + 1] === a[1] && this.data[i * 4 + 2] === a[2] && this.data[i * 4 + 3] > 0) {
        this.data[i * 4] = b[0];
        this.data[i * 4 + 1] = b[1];
        this.data[i * 4 + 2] = b[2];
      }
    }
    return this;
  }

  swapRamp(from: readonly string[], to: readonly string[]): this {
    const n = Math.min(from.length, to.length);
    const pairs = [];
    for (let i = 0; i < n; i++) pairs.push([hex(from[i]), hex(to[i])] as const);
    for (let i = 0; i < this.w * this.h; i++) {
      if (this.data[i * 4 + 3] === 0) continue;
      for (const [a, b] of pairs) {
        if (this.data[i * 4] === a[0] && this.data[i * 4 + 1] === a[1] && this.data[i * 4 + 2] === a[2]) {
          this.data[i * 4] = b[0];
          this.data[i * 4 + 1] = b[1];
          this.data[i * 4 + 2] = b[2];
          break;
        }
      }
    }
    return this;
  }

  /** Trim fully transparent margins; returns the offset that was removed. */
  bounds(): { x: number; y: number; w: number; h: number } {
    let x0 = this.w, y0 = this.h, x1 = -1, y1 = -1;
    for (let j = 0; j < this.h; j++) for (let i = 0; i < this.w; i++) {
      if (this.alphaAt(i, j) === 0) continue;
      if (i < x0) x0 = i;
      if (j < y0) y0 = j;
      if (i > x1) x1 = i;
      if (j > y1) y1 = j;
    }
    if (x1 < 0) return { x: 0, y: 0, w: 0, h: 0 };
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }
}

// ── Deterministic randomness ────────────────────────────────────────────────

/** Small, fast, seedable PRNG (mulberry32). Art must be reproducible. */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (lo: number, hi: number) => lo + next() * (hi - lo),
    int: (lo: number, hi: number) => Math.floor(lo + next() * (hi - lo + 1)),
    pick: <T>(arr: readonly T[]): T => arr[Math.floor(next() * arr.length)],
    chance: (p: number) => next() < p,
  };
}
export type Rng = ReturnType<typeof rng>;

/**
 * Seamlessly tiling value noise.
 *
 * The lattice wraps every `period` cells, so sampling x in [0, period*scale)
 * produces a texture whose left edge matches its right edge. Non-periodic noise
 * is why procedural terrain tiles show visible seams.
 */
export function periodicNoise(seed: number, period: number) {
  const h = (x: number, y: number) => {
    const px = ((x % period) + period) % period;
    const py = ((y % period) + period) % period;
    let n = (px * 374761393 + py * 668265263 + seed * 1442695041) | 0;
    n = (n ^ (n >>> 13)) * 1274126177;
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  return (x: number, y: number, scale: number) => {
    const fx = x / scale, fy = y / scale;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const a = h(x0, y0), b = h(x0 + 1, y0), c = h(x0, y0 + 1), d = h(x0 + 1, y0 + 1);
    const top = a + (b - a) * sx;
    const bot = c + (d - c) * sx;
    return top + (bot - top) * sy;
  };
}

/**
 * Quantise a field of values into ramp indices by RANK, not by threshold.
 *
 * This guarantees every variant of a tiling texture has exactly the same
 * proportion of each shade. Threshold-based quantisation lets one variant come
 * out slightly darker than its neighbour, which reads as a checkerboard across
 * a grass field — the single most common failure in procedural tilesets.
 *
 * `weights` are the target proportions, one per ramp index supplied.
 */
export function rankQuantise(
  values: number[],
  weights: number[],
): number[] {
  const order = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const total = weights.reduce((a, b) => a + b, 0);
  const out = new Array<number>(values.length).fill(0);
  let cursor = 0;
  weights.forEach((wgt, band) => {
    const count = Math.round((wgt / total) * values.length);
    const end = band === weights.length - 1 ? values.length : Math.min(values.length, cursor + count);
    for (let i = cursor; i < end; i++) out[order[i][1]] = band;
    cursor = end;
  });
  return out;
}

/** Value noise on an integer lattice — used for terrain mottling. */
export function valueNoise(seed: number) {
  const h = (x: number, y: number) => {
    let n = (x * 374761393 + y * 668265263 + seed * 1442695040888963407) | 0;
    n = (n ^ (n >>> 13)) * 1274126177;
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  return (x: number, y: number, scale = 4) => {
    const fx = x / scale, fy = y / scale;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const a = h(x0, y0), b = h(x0 + 1, y0), c = h(x0, y0 + 1), d = h(x0 + 1, y0 + 1);
    return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
  };
}

// ── Common pixel-art helpers ────────────────────────────────────────────────

/** 4x4 Bayer matrix — ordered dithering between two ramp steps. */
const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

export function ditherFill(
  s: Surface, x: number, y: number, w: number, h: number,
  colorA: string, colorB: string, mixAmount: number,
): Surface {
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const t = (BAYER4[(y + j) & 3][(x + i) & 3] + 0.5) / 16;
      s.px(x + i, y + j, mixAmount > t ? colorB : colorA);
    }
  }
  return s;
}

/** Scatter n speckles of `color` inside a rect, deterministically. */
export function speckle(
  s: Surface, r: Rng, x: number, y: number, w: number, h: number,
  color: string, n: number, alpha = 1,
): Surface {
  for (let i = 0; i < n; i++) s.px(x + r.int(0, w - 1), y + r.int(0, h - 1), color, alpha);
  return s;
}

/** Vertical gradient across a ramp, top = last index (lit) → bottom = first. */
export function rampColumn(ramp: readonly string[], t: number): string {
  const i = Math.max(0, Math.min(ramp.length - 1, Math.round(t * (ramp.length - 1))));
  return ramp[i];
}

/** Scale a surface by an integer factor (for inspection sheets only). */
export function upscale(src: Surface, factor: number): Surface {
  const s = new Surface(src.w * factor, src.h * factor);
  for (let j = 0; j < src.h; j++) for (let i = 0; i < src.w; i++) {
    const c = src.get(i, j);
    if (c[3] === 0) continue;
    for (let b = 0; b < factor; b++) for (let a = 0; a < factor; a++) s.px(i * factor + a, j * factor + b, c);
  }
  return s;
}
