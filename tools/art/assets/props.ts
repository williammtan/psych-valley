/**
 * TOWN PROPS — Lumen Vale's texture layer.
 *
 * Everything here is an atlas sprite `prop/town/<name>`, anchored bottom-centre
 * on its tile and drawn in the same three-quarter view as the terrain.
 *
 * House rules applied throughout:
 *   - light from the upper-left; lower-right of every form goes dark
 *   - scenery is outlined on its LOWER and RIGHT edges only (`rim`), never all
 *     the way round — a full outline turns a town into clip-art
 *   - every prop sits on a squashed `contact` shadow at ~30% alpha
 *   - anything a map author will repeat ships with 3+ silhouette variants
 */
import { Surface, rng, valueNoise, speckle, type Rng } from '../lib/pixel.js';
import { ArtBuild } from '../lib/registry.js';
import * as P from '../lib/palette.js';

type Ramp = readonly string[];

// ── shared helpers ─────────────────────────────────────────────────────────

/** Squashed contact shadow, painted *behind* whatever is already on the surface. */
function contact(s: Surface, cx: number, baseY: number, w: number, h = Math.max(3, Math.round(w * 0.32)), alpha = 0.3) {
  const sh = new Surface(s.w, s.h);
  sh.ellipse(Math.round(cx - w / 2), Math.round(baseY - h + 1), w, h, P.OUTLINE, alpha);
  s.blitBehind(sh);
}

/** Mask of the transparent region connected to the border — i.e. "outside the prop". */
function exterior(s: Surface): Surface {
  const o = new Surface(s.w, s.h);
  const stack: number[] = [];
  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= s.w || y >= s.h) return;
    if (o.alphaAt(x, y) || s.alphaAt(x, y) > 0) return;
    o.px(x, y, '#ffffff');
    stack.push(x, y);
  };
  for (let i = 0; i < s.w; i++) { push(i, 0); push(i, s.h - 1); }
  for (let j = 0; j < s.h; j++) { push(0, j); push(s.w - 1, j); }
  while (stack.length) {
    const y = stack.pop()!, x = stack.pop()!;
    push(x - 1, y); push(x + 1, y); push(x, y - 1); push(x, y + 1);
  }
  return o;
}

/**
 * Dark rim on the lower and right OUTER edges only — scenery, not clip-art.
 * Skipped inside narrow crevices (a 2px notch in a canopy must not grow a black
 * dash across the leaves), so the rim only ever traces the real silhouette.
 */
function rim(
  s: Surface, color = P.OUTLINE, alpha = 1,
  sides: { below?: boolean; right?: boolean } = {},
): Surface {
  const doBelow = sides.below !== false, doRight = sides.right !== false;
  const src = s.clone();
  const out = exterior(src);
  const open = (x: number, y: number) => out.alphaAt(x, y) > 0;
  for (let j = 0; j < s.h; j++) {
    for (let i = 0; i < s.w; i++) {
      if (!out.alphaAt(i, j)) continue;
      const below = doBelow && src.alphaAt(i, j - 1) > 128 && (open(i, j + 1) || j >= s.h - 1) && (open(i, j + 2) || j >= s.h - 2);
      const right = doRight && src.alphaAt(i - 1, j) > 128 && (open(i + 1, j) || i >= s.w - 1) && (open(i + 2, j) || i >= s.w - 2);
      if (below || right) s.px(i, j, color, alpha);
    }
  }
  return s;
}

/** Ramp index for a column at fraction `u` across a cylindrical form, lit upper-left. */
function cylIndex(u: number): number {
  if (u < 0.09) return 1;
  if (u < 0.28) return 3;
  if (u < 0.40) return 4;
  if (u < 0.70) return 2;
  if (u < 0.87) return 1;
  return 0;
}

/** Vertical cylinder body: barrels, churns, pots, posts. */
function cylBody(s: Surface, x: number, y: number, w: number, h: number, ramp: Ramp, alpha = 1) {
  for (let i = 0; i < w; i++) {
    const c = ramp[cylIndex((i + 0.5) / w)];
    for (let j = 0; j < h; j++) s.px(x + i, y + j, c, alpha);
  }
}

/** A lid / top face: squashed ellipse, lit on its upper-left. */
function topFace(s: Surface, x: number, y: number, w: number, h: number, ramp: Ramp) {
  s.ellipse(x, y, w, h, ramp[3]);
  const m = new Surface(s.w, s.h);
  m.ellipse(x, y, w, h, '#ffffff');
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      if (!m.alphaAt(x + i, y + j)) continue;
      const u = (i + 0.5) / w - 0.5, v = (j + 0.5) / h - 0.5;
      const d = -(u * 0.6 + v * 0.8);
      s.px(x + i, y + j, d > 0.28 ? ramp[4] : d > -0.05 ? ramp[3] : d > -0.32 ? ramp[2] : ramp[1]);
    }
  }
}

/** Plank texture across a rectangle: grain lines plus a lit top lip. */
function planks(s: Surface, x: number, y: number, w: number, h: number, ramp: Ramp, vertical: boolean, pitch = 4, seed = 1) {
  const n = valueNoise(seed);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const v = n(x + i, y + j, 3.0);
      s.px(x + i, y + j, v > 0.66 ? ramp[3] : v < 0.32 ? ramp[1] : ramp[2]);
    }
  }
  if (vertical) {
    for (let i = pitch; i < w; i += pitch) {
      for (let j = 0; j < h; j++) { s.px(x + i - 1, y + j, ramp[0], 0.75); s.px(x + i, y + j, ramp[4], 0.35); }
    }
  } else {
    for (let j = pitch; j < h; j += pitch) {
      for (let i = 0; i < w; i++) { s.px(x + i, y + j - 1, ramp[0], 0.75); s.px(x + i, y + j, ramp[4], 0.35); }
    }
  }
}

/** Build a prop: draw, rim it, drop it onto a contact shadow. */
function prop(
  w: number, h: number, draw: (s: Surface, r: Rng) => void,
  opts: { seed?: number; shadow?: number | false; shadowH?: number; shadowY?: number; cx?: number; alpha?: number; rimSides?: { below?: boolean; right?: boolean } } = {},
): Surface {
  const s = new Surface(w, h);
  draw(s, rng(opts.seed ?? 1234));
  rim(s, P.OUTLINE, 1, opts.rimSides ?? {});
  if (opts.shadow !== false) {
    const sw = typeof opts.shadow === 'number' ? opts.shadow : Math.max(6, Math.round(w * 0.66));
    contact(s, opts.cx ?? w / 2, opts.shadowY ?? h - 1, sw, opts.shadowH ?? Math.max(3, Math.round(sw * 0.32)), opts.alpha ?? 0.3);
  }
  return s;
}

/** Close interior transparent pockets in a mask. */
function fillHoles(m: Surface): Surface {
  const out = exterior(m);
  for (let j = 0; j < m.h; j++) {
    for (let i = 0; i < m.w; i++) {
      if (!m.alphaAt(i, j) && !out.alphaAt(i, j)) m.px(i, j, '#ffffff');
    }
  }
  return m;
}

/** Erase everything inside an ellipse (masks are built additively then bitten into). */
function eraseEllipse(m: Surface, x: number, y: number, w: number, h: number) {
  const e = new Surface(m.w, m.h);
  e.ellipse(x, y, w, h, '#ffffff');
  for (let j = 0; j < m.h; j++) {
    for (let i = 0; i < m.w; i++) {
      if (e.alphaAt(i, j)) m.data[(j * m.w + i) * 4 + 3] = 0;
    }
  }
}

/** 4-neighbour dilation of a mask. */
function dilate(m: Surface): Surface {
  const o = new Surface(m.w, m.h);
  for (let j = 0; j < m.h; j++) {
    for (let i = 0; i < m.w; i++) {
      if (
        m.alphaAt(i, j) || m.alphaAt(i - 1, j) || m.alphaAt(i + 1, j) ||
        m.alphaAt(i, j - 1) || m.alphaAt(i, j + 1)
      ) o.px(i, j, '#ffffff');
    }
  }
  return o;
}

// ── foliage ────────────────────────────────────────────────────────────────

interface Clump { x: number; y: number; rx: number; ry: number; bias?: number }

/**
 * A single leaf mass: an ellipse whose rim is broken up by small blobs and
 * bitten by a few notches, so the silhouette never reads as a smooth balloon.
 */
function clumpMask(w: number, h: number, c: Clump, r: Rng, bumps = 10, bites = 3): Surface {
  const m = new Surface(w, h);
  m.ellipse(Math.round(c.x - c.rx), Math.round(c.y - c.ry), Math.round(c.rx * 2), Math.round(c.ry * 2), '#ffffff');
  for (let i = 0; i < bumps; i++) {
    const a = (i / bumps) * Math.PI * 2 + r.range(-0.3, 0.3);
    const br = r.range(2.0, 4.0);
    const px = c.x + Math.cos(a) * (c.rx - br * 0.35);
    const py = c.y + Math.sin(a) * (c.ry - br * 0.35);
    m.ellipse(Math.round(px - br), Math.round(py - br), Math.round(br * 2), Math.round(br * 2), '#ffffff');
  }
  for (let i = 0; i < bites; i++) {
    const a = r.range(0, Math.PI * 2);
    const br = r.range(1.6, 3.0);
    const px = c.x + Math.cos(a) * (c.rx + br * 0.35);
    const py = c.y + Math.sin(a) * (c.ry + br * 0.35);
    eraseEllipse(m, Math.round(px - br), Math.round(py - br), Math.round(br * 2), Math.round(br * 2));
  }
  return m;
}

/**
 * A canopy: several leaf masses painted back-to-front, each dome-shaded from its
 * own centre, each creased with a dark ring against the masses behind it, and the
 * whole thing lit from the upper-left so the crown is bright and the skirt is not.
 */
function canopy(
  W: number, H: number, clumps: Clump[], ramp: Ramp, sun: string, seed: number, r: Rng,
  opts: {
    bumps?: number; bites?: number; noise?: number; contrast?: number;
    vgrad?: number; dapple?: boolean; dappleT?: number;
  } = {},
): Surface {
  const masks = clumps.map((c) => clumpMask(W, H, c, r, opts.bumps ?? 10, opts.bites ?? 3));
  const union = new Surface(W, H);
  for (const m of masks) union.blit(m);
  fillHoles(union);
  const bb = union.bounds();
  const midY = bb.y + bb.h / 2, halfY = Math.max(1, bb.h / 2);
  const midX = bb.x + bb.w / 2, halfX = Math.max(1, bb.w / 2);

  const n = valueNoise(seed);
  const n2 = valueNoise(seed + 77);
  const amp = opts.noise ?? 0.17;
  const k = opts.contrast ?? 0.46;
  const vg = opts.vgrad ?? 0.16;

  const shadeAt = (i: number, j: number, c: Clump, extra = 0): string => {
    const ox = (i - c.x) / c.rx;
    const oy = (j - c.y) / c.ry;
    const lit = -(ox * 0.56 + oy * 0.83);
    const grain = (n(i, j, 2.6) * 0.62 + n2(i, j, 1.2) * 0.38 - 0.5) * amp;
    const gy = Math.max(-1, Math.min(1, (midY - j) / halfY));
    const gx = Math.max(-1, Math.min(1, (midX - i) / halfX));
    const v = 0.5 + lit * k + (c.bias ?? 0) + grain + gy * vg + gx * 0.05 + extra;
    if (v > 0.93) return sun;
    if (v > 0.775) return ramp[4];
    if (v > 0.585) return ramp[3];
    if (v > 0.40) return ramp[2];
    if (v > 0.215) return ramp[1];
    return ramp[0];
  };

  const s = new Surface(W, H);
  masks.forEach((m, ci) => {
    const c = clumps[ci];
    const ring = dilate(dilate(m));
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        if (!ring.alphaAt(i, j) || m.alphaAt(i, j)) continue;
        s.pxOver(i, j, ramp[0], 0.72);
      }
    }
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        if (!m.alphaAt(i, j) || !union.alphaAt(i, j)) continue;
        s.px(i, j, shadeAt(i, j, c));
      }
    }
  });
  // crevices the masses left behind: shade from the nearest mass, one step down
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      if (!union.alphaAt(i, j) || s.alphaAt(i, j)) continue;
      let best = clumps[0], bd = Infinity;
      for (const c of clumps) {
        const d = Math.hypot((i - c.x) / c.rx, (j - c.y) / c.ry);
        if (d < bd) { bd = d; best = c; }
      }
      s.px(i, j, shadeAt(i, j, best, -0.16));
    }
  }
  // dappled sun: broad soft patches on the upper-left, one ramp step brighter
  if (opts.dapple !== false) {
    const n3 = valueNoise(seed + 511);
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        if (!s.alphaAt(i, j)) continue;
        const gy = Math.max(-1, Math.min(1, (midY - j) / halfY));
        const gx = Math.max(-1, Math.min(1, (midX - i) / halfX));
        if (gy * 0.7 + gx * 0.5 < -0.15) continue;
        if (n3(i, j, 5.5) < (opts.dappleT ?? 0.60)) continue;
        stepUp(s, i, j, ramp, sun);
      }
    }
  }
  return s;
}

/** Nudge a pixel one step up its ramp (used for dappled light). */
function stepUp(s: Surface, i: number, j: number, ramp: Ramp, top: string) {
  const c = s.get(i, j);
  if (c[3] < 255) return;
  for (let k = 0; k < ramp.length; k++) {
    const h = P.hex(ramp[k]);
    if (c[0] === h[0] && c[1] === h[1] && c[2] === h[2]) {
      s.px(i, j, k === ramp.length - 1 ? top : ramp[k + 1]);
      return;
    }
  }
}

/** Nudge a pixel one step down its ramp. */
function stepDown(s: Surface, i: number, j: number, ramp: Ramp) {
  const c = s.get(i, j);
  if (c[3] < 255) return;
  for (let k = 0; k < ramp.length; k++) {
    const h = P.hex(ramp[k]);
    if (c[0] === h[0] && c[1] === h[1] && c[2] === h[2]) {
      s.px(i, j, ramp[Math.max(0, k - 1)]);
      return;
    }
  }
}

/**
 * Individual leaf marks: 2–3px dashes that step the local colour up on the lit
 * side and down on the shaded side. This is what stops small foliage reading as
 * a smooth green blob — the dome shading alone never does it.
 */
function leafMarks(s: Surface, ramp: Ramp, sun: string, r: Rng, count: number, litAxis = 0.9, steps = 1) {
  const bb = s.bounds();
  if (!bb.w) return;
  const src = s.clone();
  for (let k = 0; k < count; k++) {
    const x = r.int(bb.x, bb.x + bb.w - 1);
    const y = r.int(bb.y, bb.y + bb.h - 1);
    if (!src.alphaAt(x, y)) continue;
    const u = (x - bb.x) / bb.w, v = (y - bb.y) / bb.h;
    const lit = u * 0.45 + v * litAxis < 0.62;
    const len = r.int(2, 3);
    const dy = r.chance(0.5) ? 0 : -1;
    for (let i = 0; i < len; i++) {
      const px = x + i, py = y + (i === len - 1 ? dy : 0);
      if (!src.alphaAt(px, py)) break;
      for (let t = 0; t < steps; t++) {
        if (lit) stepUp(s, px, py, ramp, sun);
        else stepDown(s, px, py, ramp);
      }
    }
  }
}

/** Darken the underside of a canopy: the last 3 rows of every column go to shadow. */
function canopyUnderside(s: Surface, ramp: Ramp) {
  const src = s.clone();
  for (let j = 0; j < s.h; j++) {
    for (let i = 0; i < s.w; i++) {
      if (!src.alphaAt(i, j)) continue;
      if (!src.alphaAt(i, j + 1)) s.px(i, j, ramp[0], 0.85);
      else if (!src.alphaAt(i, j + 2)) s.px(i, j, ramp[0], 0.5);
      else if (!src.alphaAt(i, j + 3)) s.px(i, j, ramp[1], 0.45);
    }
  }
}

/**
 * Individual leaves poking off the silhouette so the outline stays ragged.
 * Each leaf borrows the colour of the edge pixel it grows from, so the fringe
 * never reads as speckle noise sitting on top of the canopy.
 */
function leafFringe(s: Surface, ramp: Ramp, sun: string, r: Rng, count: number) {
  const src = s.clone();
  const edge: Array<[number, number, number, number]> = []; // x, y, outward dx, dy
  for (let j = 1; j < s.h - 1; j++) {
    for (let i = 1; i < s.w - 1; i++) {
      if (!src.alphaAt(i, j)) continue;
      const dx = !src.alphaAt(i - 1, j) ? -1 : !src.alphaAt(i + 1, j) ? 1 : 0;
      const dy = !src.alphaAt(i, j - 1) ? -1 : !src.alphaAt(i, j + 1) ? 1 : 0;
      if (dx || dy) edge.push([i, j, dx, dy]);
    }
  }
  if (!edge.length) return;
  for (let k = 0; k < count; k++) {
    const [ex, ey, dx, dy] = edge[r.int(0, edge.length - 1)];
    const base = src.get(ex, ey);
    if (base[3] < 255) continue;
    const px = ex + dx, py = ey + dy;
    s.px(px, py, base);
    if (dx && dy) { s.px(ex + dx, ey, base); s.px(ex, ey + dy, base); }
    if (r.chance(0.45)) s.px(px + dx, py, base);
    if (r.chance(0.3)) s.px(px, py + dy, base);
    // sunlit side of the tree: tip the new leaves one step brighter
    if (ey < s.h * 0.5 && dx <= 0) { stepUp(s, px, py, ramp, sun); stepUp(s, ex, ey, ramp, sun); }
  }
}

/** A tapering trunk with bark striations and a root flare at the base. */
function trunk(
  s: Surface, cx: number, topY: number, baseY: number, ramp: Ramp, seed: number,
  opts: { topHalf?: number; baseHalf?: number; flare?: number; lean?: number } = {},
) {
  const { topHalf = 2.4, baseHalf = 3.6, flare = 4.2, lean = 0 } = opts;
  const r = rng(seed);
  const n = valueNoise(seed + 31);
  const h = baseY - topY;
  const cols: Array<[number, number, number]> = []; // y, x0, x1
  for (let y = topY; y <= baseY; y++) {
    const t = (y - topY) / h;
    let hw = topHalf + (baseHalf - topHalf) * t * t;
    const fromBase = baseY - y;
    if (fromBase < 8) hw += Math.pow((8 - fromBase) / 8, 2.1) * flare;
    const off = lean * Math.sin((1 - t) * 1.5) ;
    const x0 = Math.round(cx + off - hw);
    const x1 = Math.round(cx + off + hw);
    cols.push([y, x0, x1]);
    for (let x = x0; x <= x1; x++) {
      const u = (x - x0) / Math.max(1, x1 - x0);
      let c: string;
      if (u < 0.10) c = ramp[1];
      else if (u < 0.30) c = ramp[3];
      else if (u < 0.42) c = ramp[4];
      else if (u < 0.72) c = ramp[2];
      else if (u < 0.88) c = ramp[1];
      else c = ramp[0];
      s.px(x, y, c);
    }
  }
  // bark: broken vertical striations, biased to the shaded side
  for (const [y, x0, x1] of cols) {
    for (let x = x0 + 1; x < x1; x++) {
      const v = n(x * 2, y, 3.0);
      const u = (x - x0) / Math.max(1, x1 - x0);
      if (v > 0.70 && u > 0.35) s.px(x, y, ramp[0], 0.55);
      else if (v < 0.28 && u > 0.2 && u < 0.7) s.px(x, y, ramp[1], 0.5);
    }
  }
  // one knot, small enough not to read as an eye
  {
    const [y, x0, x1] = cols[r.int(Math.round(cols.length * 0.2), Math.round(cols.length * 0.6))];
    if (x1 - x0 >= 5) {
      const kx = r.int(x0 + 2, x1 - 2);
      s.px(kx, y, ramp[0]); s.px(kx + 1, y, ramp[0]);
      s.px(kx, y + 1, ramp[1]); s.px(kx + 1, y + 1, ramp[0]);
      s.px(kx, y - 1, ramp[4], 0.8);
    }
  }
  // root flare: wedges that grow OUT of the trunk edge, lit on top, dark beneath
  const [, bx0, bx1] = cols[cols.length - 1];
  const fingers: Array<[number, number, number]> = [ // dir, length, y-offset from base
    [-1, 5, -3], [-1, 4, 0], [1, 4, -2], [1, 3, 1],
  ];
  for (const [dir, len0, dy] of fingers) {
    const len = len0 + r.int(0, 2);
    const sx = dir < 0 ? bx0 + 1 : bx1 - 1;
    const y0 = baseY - 2 + dy;
    for (let i = 0; i < len; i++) {
      const x = sx + dir * i;
      const yy = y0 + Math.round(i * 0.55);
      const thick = Math.max(1, 3 - Math.floor((i * 2) / len));
      s.px(x, yy, dir < 0 ? ramp[3] : ramp[2]);
      for (let t = 1; t < thick; t++) s.px(x, yy + t, t === thick - 1 ? ramp[0] : ramp[1]);
    }
  }
}

// ── trees ──────────────────────────────────────────────────────────────────

function oakTree(variant: number): Surface {
  const W = 48, H = 64;
  const s = new Surface(W, H);
  const r = rng(7100 + variant * 911);
  const warm = variant === 1 || variant === 3;
  const ramp = warm ? P.TREE_WARM : P.TREE_DARK;
  const sun = warm ? P.LEAF_SUN_WARM : P.LEAF_SUN_COOL;

  const layouts: Clump[][] = [
    [
      { x: 12, y: 27, rx: 10, ry: 8.5, bias: -0.10 },
      { x: 36, y: 26, rx: 9.5, ry: 8, bias: -0.12 },
      { x: 24, y: 31, rx: 11, ry: 7.5, bias: -0.16 },
      { x: 16, y: 15, rx: 11, ry: 9, bias: 0.05 },
      { x: 33, y: 17, rx: 10, ry: 8.5, bias: -0.02 },
      { x: 24, y: 9, rx: 10, ry: 7.5, bias: 0.08 },
    ],
    [ // taller and narrower — a young oak that has run for the light
      { x: 15, y: 28, rx: 8.5, ry: 7.5, bias: -0.15 },
      { x: 33, y: 27, rx: 8.5, ry: 7.5, bias: -0.12 },
      { x: 24, y: 30, rx: 9.5, ry: 7, bias: -0.17 },
      { x: 14, y: 17, rx: 8.5, ry: 7.5, bias: 0.00 },
      { x: 34, y: 16, rx: 9, ry: 7.5, bias: -0.02 },
      { x: 22, y: 12, rx: 10, ry: 8, bias: 0.05 },
      { x: 28, y: 5, rx: 8, ry: 5.5, bias: 0.09 },
    ],
    [
      { x: 11, y: 24, rx: 9, ry: 8.5, bias: -0.12 },
      { x: 37, y: 28, rx: 9, ry: 8, bias: -0.14 },
      { x: 25, y: 30, rx: 10.5, ry: 8, bias: -0.15 },
      { x: 18, y: 16, rx: 10.5, ry: 8.5, bias: 0.04 },
      { x: 35, y: 18, rx: 9, ry: 8, bias: -0.03 },
      { x: 26, y: 8, rx: 11, ry: 7.5, bias: 0.09 },
      { x: 13, y: 9, rx: 6.5, ry: 5.5, bias: 0.06 },
    ],
    [ // broad and low — an old spreading crown
      { x: 10, y: 30, rx: 9.5, ry: 8, bias: -0.13 },
      { x: 38, y: 31, rx: 9, ry: 7.5, bias: -0.16 },
      { x: 24, y: 33, rx: 11, ry: 7.5, bias: -0.10 },
      { x: 13, y: 21, rx: 11, ry: 8.5, bias: 0.02 },
      { x: 36, y: 22, rx: 10.5, ry: 8.5, bias: -0.05 },
      { x: 24, y: 17, rx: 12, ry: 8.5, bias: 0.05 },
    ],
  ];
  const clumps = layouts[variant % layouts.length];
  const canopyBottom = Math.max(...clumps.map((c) => c.y + c.ry));

  // trunk first — the canopy will bury most of it
  const trunkTop = Math.round(canopyBottom) - 6;
  trunk(s, 24, trunkTop, 61, P.WOOD, 7300 + variant * 41, {
    topHalf: 3.0, baseHalf: 5.0, flare: 5.0, lean: variant === 2 ? 1.2 : variant === 1 ? -1.0 : 0,
  });
  // two branches lifting into the canopy
  for (const dir of [-1, 1]) {
    const bx = 24 + dir * 2;
    for (let i = 0; i < 9; i++) {
      const x = bx + dir * Math.round(i * 0.8);
      const y = trunkTop - Math.round(i * 0.9) + 2;
      s.px(x, y, P.WOOD[2]);
      s.px(x, y + 1, P.WOOD[1]);
      s.px(x + dir, y + 1, P.WOOD[0], 0.6);
    }
  }

  // canopy on its own surface so its underside shading ignores the trunk
  const can = canopy(W, H, clumps, ramp, sun, 7500 + variant * 17, r, {
    bumps: 11, bites: 3, dappleT: warm ? 0.70 : 0.60, vgrad: warm ? 0.12 : 0.16,
  });
  canopyUnderside(can, ramp);
  leafFringe(can, ramp, sun, r, 22);
  s.blit(can);

  // the canopy drops a shadow onto the trunk right below it
  for (let x = 0; x < W; x++) {
    let low = -1;
    for (let y = H - 1; y >= 0; y--) if (can.alphaAt(x, y)) { low = y; break; }
    if (low < 0) continue;
    for (let k = 1; k <= 5; k++) s.pxOver(x, low + k, P.OUTLINE, 0.34 - k * 0.05);
  }

  rim(s);
  contact(s, 24, 63, 30, 9, 0.34);
  return s;
}

/** Conical evergreen: layered boughs, drawn top-down so lower boughs overlap. */
function pineTree(variant: number): Surface {
  const W = 40, H = 72;
  const s = new Surface(W, H);
  const r = rng(8100 + variant * 577);
  const cx = 20;
  const ramp = variant === 1 ? P.TREE_WARM : P.TREE_DARK;
  const sun = variant === 1 ? P.LEAF_SUN_WARM : P.LEAF_SUN_COOL;
  const layers = [8, 9, 7][variant % 3];
  const spread = [16.5, 15.0, 17.5][variant % 3];
  const lean = [0, 0.8, -0.6][variant % 3];

  // trunk shows below the lowest bough
  trunk(s, cx, 52, 69, P.WOOD, 8300 + variant, { topHalf: 2.2, baseHalf: 3.0, flare: 2.6 });

  const bottomY = 64;
  const step = (bottomY - 12) / (layers - 1);
  const n = valueNoise(8500 + variant * 13);
  for (let k = layers - 1; k >= 0; k--) {
    const t = k / (layers - 1);          // 0 = bottom, 1 = top
    const yk = Math.round(bottomY - k * step);
    const hw = spread * (1 - t * 0.86) + 1.5;
    const bh = 9 + (1 - t) * 4;          // bough height
    const off = lean * (1 - t) * 3;
    for (let dx = -Math.ceil(hw); dx <= Math.ceil(hw); dx++) {
      const x = Math.round(cx + off + dx);
      const u = Math.abs(dx) / hw;
      if (u > 1) continue;
      const topY = Math.round(yk - bh * (1 - u * 0.88));
      const jag = (Math.abs(dx) % 4 < 2 ? 1 : 0) + (n(x * 3, yk, 2.0) > 0.6 ? 1 : 0);
      const botY = yk + jag;
      // upper boughs catch the sky, lower boughs sit in the tree's own shade
      const shift = t > 0.72 ? 1 : t < 0.34 ? -1 : 0;
      for (let y = topY; y <= botY; y++) {
        const v = (dx + hw) / (2 * hw);
        let idx = Math.max(0, Math.min(4, cylIndex(v) + shift));
        let c = ramp[idx];
        if (y >= botY - 1) c = ramp[0];                                  // hard shadow line under each bough
        else if (y <= topY + 1 && dx < 0) c = n(x, y, 2.4) > 0.55 ? sun : ramp[Math.min(4, idx + 1)];
        else if (n(x, y * 2, 2.2) > 0.74 && dx < hw * 0.15) c = ramp[Math.min(4, idx + 1)];
        else if (n(x, y * 2, 1.8) < 0.26) c = ramp[Math.max(0, idx - 1)];
        s.px(x, y, c);
      }
      // needle tips breaking the skirt line
      if (Math.abs(dx) % 3 === 0 && u > 0.25) s.px(x, botY + 1, ramp[0]);
    }
  }
  // spire
  for (let k = 0; k < 6; k++) {
    const y = 8 + k;
    const hw = Math.max(0, Math.round(k * 0.6));
    for (let dx = -hw; dx <= hw; dx++) s.px(cx + Math.round(lean * 3) + dx, y, dx < 0 ? ramp[3] : dx > 0 ? ramp[1] : ramp[2]);
  }
  rim(s);
  contact(s, cx, 70, 24, 7, 0.32);
  return s;
}

/** Blossom tree: the canopy machinery again, but in pink/cream with petal specks. */
function blossomTree(variant: number): Surface {
  const W = 48, H = 60;
  const s = new Surface(W, H);
  const r = rng(8700 + variant * 331);
  const white = variant === 1;
  const ramp = white ? P.BLOSSOM_WHITE : P.BLOSSOM;
  const sun = white ? P.LINEN[4] : P.FLOWER_ROSE[3];

  const clumps: Clump[] = variant === 0 ? [
    { x: 12, y: 26, rx: 9, ry: 7.5, bias: -0.12 },
    { x: 35, y: 25, rx: 9.5, ry: 7.5, bias: -0.10 },
    { x: 24, y: 28, rx: 10, ry: 7, bias: -0.14 },
    { x: 15, y: 15, rx: 9.5, ry: 8, bias: 0.04 },
    { x: 33, y: 14, rx: 9, ry: 7.5, bias: 0.00 },
    { x: 24, y: 9, rx: 9.5, ry: 7, bias: 0.07 },
  ] : [
    { x: 13, y: 24, rx: 9.5, ry: 8, bias: -0.11 },
    { x: 36, y: 27, rx: 8.5, ry: 7, bias: -0.14 },
    { x: 25, y: 27, rx: 10.5, ry: 7.5, bias: -0.09 },
    { x: 17, y: 13, rx: 10, ry: 7.5, bias: 0.05 },
    { x: 35, y: 16, rx: 8.5, ry: 7, bias: -0.01 },
    { x: 26, y: 8, rx: 9, ry: 6.5, bias: 0.08 },
  ];
  const canopyBottom = Math.max(...clumps.map((c) => c.y + c.ry));
  trunk(s, 24, Math.round(canopyBottom) - 5, 57, P.WOOD, 8800 + variant * 7, {
    topHalf: 2.4, baseHalf: 4.0, flare: 4.0, lean: variant === 1 ? 0.9 : -0.7,
  });
  const can = canopy(W, H, clumps, ramp, sun, 8900 + variant * 21, r, {
    bumps: 12, bites: 4, noise: 0.22, contrast: 0.40, dappleT: 0.66,
  });
  // petals: bright specks on the lit half, dark gaps on the shaded half
  for (let k = 0; k < 90; k++) {
    const x = r.int(2, W - 3), y = r.int(2, Math.round(canopyBottom));
    if (!can.alphaAt(x, y)) continue;
    if (x + y < 44) can.px(x, y, r.chance(0.4) ? sun : ramp[4]);
    else if (r.chance(0.4)) can.px(x, y, ramp[1]);
  }
  // a few green leaves so it is a tree, not candyfloss
  for (let k = 0; k < 26; k++) {
    const x = r.int(2, W - 3), y = r.int(4, Math.round(canopyBottom));
    if (!can.alphaAt(x, y)) continue;
    can.px(x, y, P.TREE_WARM[r.int(1, 3)]);
    if (r.chance(0.5)) can.px(x + 1, y, P.TREE_WARM[1]);
  }
  canopyUnderside(can, ramp);
  leafFringe(can, ramp, sun, r, 20);
  s.blit(can);
  for (let x = 0; x < W; x++) {
    let low = -1;
    for (let y = H - 1; y >= 0; y--) if (can.alphaAt(x, y)) { low = y; break; }
    if (low < 0) continue;
    for (let k = 1; k <= 4; k++) s.pxOver(x, low + k, P.OUTLINE, 0.30 - k * 0.05);
  }
  rim(s);
  contact(s, 24, 59, 28, 8, 0.32);
  // fallen petals on the ground
  for (let k = 0; k < 7; k++) {
    const x = 24 + r.int(-13, 13), y = 55 + r.int(0, 4);
    s.pxBehind(x, y, r.chance(0.5) ? ramp[3] : ramp[4]);
  }
  return s;
}

/** Cut stump with growth rings, an axe notch and moss on its shaded side. */
function stump(): Surface {
  return prop(22, 18, (s, r) => {
    const x = 3, w = 16, topY = 4, topH = 6;
    cylBody(s, x, topY + 3, w, 10, P.WOOD);
    // bark striations
    for (let i = 0; i < w; i++) {
      for (let j = 0; j < 10; j++) {
        if (r.chance(0.16)) s.px(x + i, topY + 3 + j, P.WOOD[cylIndex((i + 0.5) / w)] === P.WOOD[0] ? P.WOOD[1] : P.WOOD[0], 0.5);
      }
    }
    // cut face: bark ring, sapwood, two growth rings, one axe scar
    s.ellipse(x, topY, w, topH, P.WOOD[1]);
    topFace(s, x + 1, topY + 1, w - 2, topH - 2, P.WOOD_LIGHT);
    s.ellipseOutline(x + 4, topY + 2, w - 8, topH - 3, P.WOOD_LIGHT[1], 0.7);
    s.ellipse(x + 7, topY + 2, 3, 2, P.WOOD_LIGHT[4]);
    s.line(x + 5, topY + 2, x + 9, topY + 4, P.WOOD_LIGHT[0], 0.65);
    // moss skirt
    for (let k = 0; k < 14; k++) {
      const mx = x + r.int(0, 5), my = topY + 8 + r.int(0, 4);
      s.pxOver(mx, my, P.MOSS[r.int(2, 4)]);
    }
    // roots
    for (const dir of [-1, 1]) {
      for (let k = 0; k < 2; k++) {
        const sx = dir < 0 ? x : x + w - 1;
        const y0 = 13 + k * 2;
        for (let i = 0; i < 3 + k; i++) {
          s.px(sx + dir * i, y0 + Math.round(i * 0.4), dir < 0 ? P.WOOD[3] : P.WOOD[2]);
          s.px(sx + dir * i, y0 + Math.round(i * 0.4) + 1, P.WOOD[0]);
        }
      }
    }
  }, { seed: 9101, shadow: 20, shadowY: 17 });
}

/** Fallen log: a horizontal cylinder with a ringed end cap. */
function log(variant: number): Surface {
  const W = variant === 0 ? 32 : 26, H = 14;
  return prop(W, H, (s, r) => {
    const y0 = 3, h = 8, x0 = 1, w = W - 4;
    for (let j = 0; j < h; j++) {
      const c = P.WOOD[cylIndex((j + 0.5) / h)];
      for (let i = 0; i < w; i++) s.px(x0 + i, y0 + j, c);
    }
    // bark grain along the length
    const n = valueNoise(9200 + variant * 31);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const v = n(x0 + i, (y0 + j) * 3, 3.2);
        if (v > 0.72) s.px(x0 + i, y0 + j, P.WOOD[0], 0.45);
        else if (v < 0.26) s.px(x0 + i, y0 + j, P.WOOD[4], 0.3);
      }
    }
    // end cap on the right, rings visible
    const capX = x0 + w - 3;
    s.ellipse(capX, y0 - 1, 6, h + 2, P.WOOD_LIGHT[2]);
    s.ellipse(capX + 1, y0, 4, h, P.WOOD_LIGHT[3]);
    s.ellipseOutline(capX + 1, y0, 4, h, P.WOOD_LIGHT[1], 0.9);
    s.ellipse(capX + 2, y0 + Math.round(h / 2) - 1, 2, 3, P.WOOD_LIGHT[1]);
    // a snapped branch stub
    s.rect(x0 + 4, y0 - 2, 3, 3, P.WOOD[1]);
    s.hline(x0 + 4, y0 - 2, 3, P.WOOD[3]);
    if (variant === 1) {
      for (let k = 0; k < 20; k++) {
        const mx = x0 + r.int(0, w - 6), my = y0 + r.int(0, 3);
        s.pxOver(mx, my, P.MOSS[r.int(2, 4)]);
        if (r.chance(0.4)) s.pxOver(mx + 1, my + 1, P.MOSS[1]);
      }
    }
  }, { seed: 9300 + variant, shadow: W - 6, shadowY: H - 1, shadowH: 4 });
}

/** Sapling: a stem, a few leaves, and a lot of hope. */
function sapling(variant: number): Surface {
  return prop(14, 22, (s, r) => {
    const cx = 6, baseY = 20;
    const topY = variant === 0 ? 7 : 5;
    for (let y = baseY; y >= topY; y--) {
      const bend = Math.round(Math.sin((baseY - y) * 0.16) * (variant === 0 ? 1 : 1.6));
      s.px(cx + bend, y, P.WOOD[2]);
      s.px(cx + bend + 1, y, P.WOOD[0]);
      s.px(cx + bend - 1, y, P.WOOD[3], 0.6);
    }
    // leaves: little spade shapes, lit on their upper-left half
    const leaves = variant === 0 ? 5 : 6;
    for (let k = 0; k < leaves; k++) {
      const y = topY + 2 + k * 2;
      const dir = k % 2 ? 1 : -1;
      const bend = Math.round(Math.sin((baseY - y) * 0.16) * (variant === 0 ? 1 : 1.6));
      const lx = cx + bend + dir;
      const len = k < 2 ? 4 : 3;
      for (let i = 1; i <= len; i++) {
        const x = lx + dir * i;
        const yy = y - Math.round(i * 0.5);
        const lit = dir < 0;
        const thick = i === len ? 1 : 2;
        s.px(x, yy, lit ? P.TREE_WARM[4] : P.TREE_WARM[3]);
        for (let t = 1; t < thick; t++) s.px(x, yy + t, lit ? P.TREE_WARM[2] : P.TREE_WARM[1]);
        if (i > 1 && i < len) s.px(x, yy - 1, lit ? P.LEAF_SUN_WARM : P.TREE_WARM[4]);
      }
    }
    // tip bud
    s.px(cx, topY - 1, P.TREE_WARM[4]);
    s.px(cx, topY - 2, P.LEAF_SUN_WARM);
  }, { seed: 9400 + variant, shadow: 9, shadowY: 21, shadowH: 3 });
}

/** Bush: three leaf masses, sometimes berried, sometimes in flower. */
function bush(variant: number): Surface {
  const W = 24, H = 22;
  const s = new Surface(W, H);
  const r = rng(9500 + variant * 271);
  const layouts: Clump[][] = [
    [{ x: 7, y: 13, rx: 6.5, ry: 5.5, bias: -0.06 }, { x: 16, y: 13, rx: 6.5, ry: 5.5, bias: -0.10 }, { x: 12, y: 8, rx: 7, ry: 5, bias: 0.06 }],
    [{ x: 8, y: 14, rx: 7, ry: 5, bias: -0.08 }, { x: 17, y: 12, rx: 5.5, ry: 5.5, bias: -0.04 }, { x: 11, y: 9, rx: 6, ry: 5, bias: 0.05 }],
    [{ x: 6, y: 12, rx: 5.5, ry: 5, bias: -0.04 }, { x: 15, y: 14, rx: 7.5, ry: 5.5, bias: -0.10 }, { x: 13, y: 8, rx: 6.5, ry: 5, bias: 0.07 }],
    [{ x: 9, y: 13, rx: 8, ry: 6, bias: -0.07 }, { x: 17, y: 15, rx: 5.5, ry: 4.5, bias: -0.12 }, { x: 13, y: 7, rx: 6, ry: 4.5, bias: 0.08 }],
  ];
  const can = canopy(W, H, layouts[variant], P.BUSH, P.LEAF_SUN_COOL, 9600 + variant * 17, r, {
    bumps: 9, bites: 2, noise: 0.14, contrast: 0.52, vgrad: 0.30, dappleT: 0.66,
  });
  canopyUnderside(can, P.BUSH);
  leafMarks(can, P.BUSH, P.LEAF_SUN_COOL, r, 40, 0.95, 2);
  leafFringe(can, P.BUSH, P.LEAF_SUN_COOL, r, 14);
  s.blit(can);
  if (variant === 1) { // berries
    for (let k = 0; k < 9; k++) {
      const x = r.int(3, W - 4), y = r.int(4, H - 6);
      if (!s.alphaAt(x, y)) continue;
      s.px(x, y, P.FLOWER_ROSE[1]);
      s.px(x, y - 1, P.FLOWER_ROSE[2]);
    }
  } else if (variant === 3) { // small white flowers
    for (let k = 0; k < 11; k++) {
      const x = r.int(3, W - 4), y = r.int(3, H - 7);
      if (!s.alphaAt(x, y)) continue;
      s.px(x, y, P.FLOWER_WHITE[2]);
      s.px(x - 1, y, P.FLOWER_WHITE[1]);
      s.px(x, y - 1, P.FLOWER_WHITE[1]);
    }
  }
  rim(s);
  contact(s, 12, 21, 18, 5, 0.3);
  return s;
}

/**
 * Clipped hedge pieces. Authors run these end to end, so `mid` must tile with no
 * seam: its left and right columns are full-height and it grows no right-hand rim.
 * The form is a box of foliage — lit crown, mid front face, dark skirt.
 */
function hedge(kind: 'mid' | 'end_l' | 'end_r' | 'corner'): Surface {
  const W = 16, H = 20;
  const s = new Surface(W, H);
  const r = rng(9700 + kind.charCodeAt(4 % kind.length) * 13);
  const n = valueNoise(9750);
  const crownY = 4, botY = 17;
  const left = kind === 'end_l' ? 1 : 0;
  const right = kind === 'end_r' ? W - 2 : W - 1;
  // three shallow lobes across the crown, so a long run reads as clipped foliage
  const lobe = (x: number) => -Math.round(Math.cos(((x + 1) % 6) / 6 * Math.PI * 2) * 1.4 + 1.4);
  for (let x = left; x <= right; x++) {
    // crown wobbles by a pixel; the ends and the corner round off
    let top = crownY + lobe(x) + (n(x * 2, 11, 2.4) > 0.62 ? -1 : 0);
    const fromL = x - left, fromR = right - x;
    if ((kind === 'end_l' || kind === 'corner') && fromL < 2) top += 2 - fromL;
    if (kind === 'end_r' && fromR < 2) top += 2 - fromR;
    for (let y = top; y <= botY; y++) {
      const depth = (y - top) / (botY - top);
      let c: string;
      if (depth < 0.14) c = P.BUSH[4];                                   // top plane, full sun
      else if (depth < 0.30) c = n(x, y, 2.2) > 0.45 ? P.BUSH[4] : P.BUSH[3];
      else if (depth < 0.50) c = P.BUSH[3];
      else if (depth < 0.78) c = n(x, y, 2.6) > 0.6 ? P.BUSH[3] : P.BUSH[2];
      else if (depth < 0.93) c = P.BUSH[1];
      else c = P.BUSH[0];
      s.px(x, y, c);
    }
    // ragged crown so a long run never reads as a wall
    if (n(x * 3, 7, 2.0) > 0.62) s.px(x, top - 1, P.BUSH[3]);
  }
  // the shaded return face on an end piece
  if (kind === 'end_r' || kind === 'corner') {
    for (let y = crownY + 2; y <= botY; y++) { s.pxOver(right, y, P.BUSH[1]); s.pxOver(right - 1, y, P.BUSH[2]); }
  }
  if (kind === 'end_l') for (let y = crownY + 2; y <= botY; y++) s.pxOver(left, y, P.BUSH[3]);
  leafMarks(s, P.BUSH, P.LEAF_SUN_COOL, r, 44, 1.15, 2);
  // a couple of gaps at the base where you can see under the hedge
  for (let k = 0; k < 3; k++) {
    const x = r.int(left + 1, right - 1);
    s.px(x, botY, P.BUSH[0]); s.px(x + 1, botY, P.BUSH[0]);
  }
  rim(s, P.OUTLINE, 1, { right: kind === 'end_r' || kind === 'corner' });
  contact(s, W / 2, 19, 16, 4, 0.26);
  return s;
}

/** Small four-petal bloom. */
function bloom(s: Surface, x: number, y: number, c: readonly string[], r: Rng) {
  s.px(x, y, c[2]);
  s.px(x - 1, y, c[1]);
  s.px(x + 1, y, c[1]);
  s.px(x, y - 1, c[3]);
  if (r.chance(0.5)) s.px(x, y + 1, c[0]);
}

/** Timber-edged flowerbed, 2 tiles wide. */
function flowerbed(variant: number): Surface {
  const palettes = [
    [P.FLOWER_ROSE, P.FLOWER_WHITE],
    [P.FLOWER_GOLD, P.FLOWER_ROSE],
    [P.FLOWER_VIOLET, P.FLOWER_GOLD],
  ][variant];
  return prop(32, 20, (s, r) => {
    // soil, seen from three-quarters: a shallow trapezoid
    for (let y = 6; y <= 16; y++) {
      const inset = Math.max(0, 4 - Math.round((y - 6) * 0.5));
      for (let x = 2 + inset; x < 30 - inset; x++) {
        const v = valueNoise(9800 + variant)(x, y, 3.0);
        s.px(x, y, v > 0.66 ? P.DIRT[3] : v < 0.32 ? P.DIRT[1] : P.DIRT[2]);
      }
    }
    // timber edging: front rail plus two side rails
    for (let x = 1; x < 31; x++) {
      s.px(x, 16, P.WOOD[3]);
      s.px(x, 17, P.WOOD[2]);
      s.px(x, 18, P.WOOD[0]);
    }
    for (let y = 6; y <= 16; y++) {
      const inset = Math.max(0, 4 - Math.round((y - 6) * 0.5));
      s.px(2 + inset - 1, y, P.WOOD[3]);
      s.px(2 + inset, y, P.WOOD[1]);
      s.px(30 - inset, y, P.WOOD[1]);
      s.px(30 - inset + 1, y, P.WOOD[0]);
    }
    for (let x = 4; x < 28; x++) s.px(x, 6, P.WOOD[1]);
    // planting: foliage clumps then blooms on top
    for (let k = 0; k < 30; k++) {
      const x = r.int(4, 27), y = r.int(7, 15);
      s.px(x, y, P.VEG_LEAF[r.int(1, 3)]);
      if (r.chance(0.5)) s.px(x, y - 1, P.VEG_LEAF[3]);
    }
    for (let k = 0; k < 13; k++) {
      const x = r.int(4, 27), y = r.int(8, 15);
      bloom(s, x, y, r.chance(0.65) ? palettes[0] : palettes[1], r);
    }
  }, { seed: 9850 + variant, shadow: 30, shadowY: 19, shadowH: 5 });
}

/** Terracotta pot (0) and a timber trough planter (1). */
function planter(variant: number): Surface {
  if (variant === 0) {
    return prop(18, 22, (s, r) => {
      // pot
      const x = 3, w = 12;
      for (let j = 0; j < 9; j++) {
        const shrink = Math.round(j * 0.35);
        for (let i = shrink; i < w - shrink; i++) {
          s.px(x + i, 12 + j, P.TERRACOTTA[cylIndex((i + 0.5) / w)]);
        }
      }
      // rim lip
      for (let i = -1; i < w + 1; i++) s.px(x + i, 11, P.TERRACOTTA[cylIndex((i + 1) / (w + 2)) === 0 ? 1 : 4]);
      for (let i = -1; i < w + 1; i++) s.px(x + i, 12, P.TERRACOTTA[cylIndex((i + 1) / (w + 2))]);
      s.hline(x, 20, w - 6, P.TERRACOTTA[0], 0.6);
      // plant
      for (let k = 0; k < 24; k++) {
        const px = 9 + r.int(-5, 5), py = 7 + r.int(-3, 4);
        s.px(px, py, P.BUSH[r.int(2, 4)]);
        s.px(px, py + 1, P.BUSH[r.int(0, 2)]);
      }
      for (let k = 0; k < 4; k++) bloom(s, 9 + r.int(-4, 4), 5 + r.int(0, 3), P.FLOWER_GOLD, r);
    }, { seed: 9900, shadow: 16, shadowY: 21, shadowH: 5 });
  }
  return prop(24, 18, (s, r) => {
    planks(s, 2, 9, 20, 7, P.WOOD, true, 5, 9910);
    s.hline(2, 8, 20, P.WOOD[4]);
    s.hline(2, 16, 20, P.WOOD[0]);
    s.vline(2, 8, 8, P.WOOD[3]);
    s.vline(21, 8, 8, P.WOOD[0]);
    // soil + herbs
    for (let x = 3; x < 21; x++) s.px(x, 9, P.DIRT[1]);
    for (let k = 0; k < 30; k++) {
      const px = r.int(3, 20), py = 4 + r.int(0, 5);
      s.px(px, py, P.VEG_LEAF[r.int(2, 4)]);
      s.px(px, py + 1, P.VEG_LEAF[r.int(0, 2)]);
    }
    for (let k = 0; k < 3; k++) bloom(s, r.int(5, 19), r.int(3, 6), P.FLOWER_WHITE, r);
  }, { seed: 9920, shadow: 22, shadowY: 17, shadowH: 5 });
}

/** Window box — hangs on a wall, so it gets no ground shadow. */
function windowBox(): Surface {
  return prop(16, 12, (s, r) => {
    planks(s, 1, 5, 14, 6, P.WOOD, true, 4, 9930);
    s.hline(1, 4, 14, P.WOOD[4]);
    s.hline(1, 10, 14, P.WOOD[0]);
    for (let k = 0; k < 26; k++) {
      const x = r.int(1, 14), y = r.int(1, 4);
      s.px(x, y, P.VEG_LEAF[r.int(2, 4)]);
      s.px(x, y + 1, P.VEG_LEAF[r.int(0, 2)]);
    }
    // trailing growth over the front edge
    for (const x of [3, 7, 11, 13]) {
      s.px(x, 6, P.VEG_LEAF[2]);
      s.px(x, 7, P.VEG_LEAF[1]);
      if (x % 2) s.px(x, 8, P.VEG_LEAF[0]);
    }
    for (let k = 0; k < 5; k++) bloom(s, r.int(2, 13), r.int(1, 4), r.chance(0.5) ? P.FLOWER_ROSE : P.FLOWER_GOLD, r);
  }, { seed: 9940, shadow: false });
}

/** Riverbank reeds, some with cattail heads. */
function reeds(variant: number): Surface {
  return prop(18, 26, (s, r) => {
    const base = 24, cx = 9;
    const blades = [7, 9, 6][variant];
    for (let k = 0; k < blades; k++) {
      const bx = cx + r.int(-6, 6);
      const hgt = r.int(9, 20);
      const lean = r.chance(0.5) ? 1 : -1;
      for (let i = 0; i < hgt; i++) {
        const x = bx + Math.round(Math.pow(i / hgt, 2) * 3) * lean;
        const y = base - i;
        const c = i > hgt - 4 ? P.GRASS_DRY[3] : lean < 0 ? P.GRASS[3] : P.GRASS[2];
        s.px(x, y, c);
        if (i < hgt - 3) s.px(x + 1, y, P.GRASS[0], 0.6);
      }
    }
    if (variant !== 2) { // cattails
      for (let k = 0; k < 2; k++) {
        const bx = cx + (k ? 4 : -3);
        const top = 6 + k * 3;
        for (let y = base; y > top; y--) s.px(bx, y, P.GRASS_DRY[2]);
        for (let y = top; y < top + 6; y++) {
          s.px(bx - 1, y, P.WOOD[3]);
          s.px(bx, y, P.WOOD[2]);
          s.px(bx + 1, y, P.WOOD[0]);
        }
        s.px(bx, top - 1, P.WOOD[1]);
      }
    }
  }, { seed: 9950 + variant, shadow: 12, shadowY: 25, shadowH: 4, alpha: 0.24 });
}

/** Lily pads float, so their "shadow" is a soft dark ring in the water. */
function lilypad(variant: number): Surface {
  const W = variant === 0 ? 14 : 12, H = 9;
  return prop(W, H, (s, r) => {
    const w = W - 2, h = 6;
    s.ellipse(1, 1, w, h, P.TREE_DARK[3]);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        if (!s.alphaAt(1 + i, 1 + j)) continue;
        const u = (i + 0.5) / w - 0.5, v = (j + 0.5) / h - 0.5;
        const d = -(u * 0.6 + v * 0.8);
        s.px(1 + i, 1 + j, d > 0.25 ? P.TREE_WARM[4] : d > 0 ? P.TREE_WARM[3] : d > -0.3 ? P.TREE_DARK[3] : P.TREE_DARK[2]);
      }
    }
    // the wedge notch
    const cxp = 1 + Math.floor(w / 2), cyp = 1 + Math.floor(h / 2);
    for (let i = 0; i < Math.ceil(w / 2); i++) {
      const spread = Math.round(i * 0.4);
      for (let d = -spread; d <= spread; d++) s.data[((cyp + d) * s.w + cxp + i) * 4 + 3] = 0;
    }
    // veins
    for (let k = 0; k < 5; k++) {
      const a = -2.4 + k * 0.9;
      s.line(cxp, cyp, cxp + Math.round(Math.cos(a) * w * 0.42), cyp + Math.round(Math.sin(a) * h * 0.42), P.TREE_DARK[1], 0.6);
    }
    if (variant === 1) { // one pad carries a flower
      s.px(4, 2, P.FLOWER_WHITE[2]); s.px(5, 2, P.FLOWER_WHITE[3]);
      s.px(4, 1, P.FLOWER_WHITE[1]); s.px(5, 3, P.FLOWER_ROSE[2]);
      s.px(6, 2, P.FLOWER_WHITE[1]);
    }
  }, { seed: 9960 + variant, shadow: W - 2, shadowY: H - 1, shadowH: 4, alpha: 0.22 });
}

/** Faceted boulders. Four sizes so authors can build rhythm. */
function rock(variant: number): Surface {
  const dims: Array<[number, number]> = [[16, 13], [20, 16], [24, 18], [28, 21]];
  const [W, H] = dims[variant];
  const ramp = variant % 2 ? P.COBBLE : P.STONE_WALL;
  return prop(W, H, (s, r) => {
    const cx = W / 2 - 0.5, cy = H - 4;
    const rx = W / 2 - 2, ry = H - 7;
    // jittered silhouette
    const pts: Array<[number, number]> = [];
    const steps = 11;
    for (let k = 0; k < steps; k++) {
      const a = Math.PI + (k / (steps - 1)) * Math.PI; // upper half, flat base
      const jr = 0.78 + r.range(0, 0.3);
      pts.push([cx + Math.cos(a) * rx * jr, cy + Math.sin(a) * ry * jr]);
    }
    pts.push([cx + rx * 0.9, cy + 2], [cx - rx * 0.9, cy + 2]);
    s.poly(pts, ramp[2]);
    // shade: lit on the upper-left plane
    const n = valueNoise(9970 + variant * 5);
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        if (!s.alphaAt(i, j)) continue;
        const u = (i - cx) / rx, v = (j - cy) / ry;
        const d = -(u * 0.5 + v * 0.86) + (n(i, j, 3.4) - 0.5) * 0.4;
        s.px(i, j, d > 0.78 ? ramp[4] : d > 0.45 ? ramp[3] : d > 0.12 ? ramp[2] : d > -0.2 ? ramp[1] : ramp[0]);
      }
    }
    // two facet creases
    for (let k = 0; k < 2; k++) {
      const x0 = Math.round(cx - rx * (0.6 - k * 0.7)), y0 = Math.round(cy - ry * (0.9 - k * 0.3));
      const x1 = Math.round(cx + rx * (0.3 + k * 0.5)), y1 = Math.round(cy - ry * (0.1 + k * 0.2));
      s.line(x0, y0, x1, y1, ramp[1], 0.8);
      s.line(x0, y0 - 1, x1, y1 - 1, ramp[4], 0.5);
    }
    // grit + a dark seat line
    speckle(s, r, 1, 1, W - 2, H - 3, ramp[0], Math.round(W / 3), 0.4);
    speckle(s, r, 1, 1, W - 2, Math.round(H / 2), ramp[4], Math.round(W / 5), 0.35);
    for (let i = 0; i < W; i++) s.pxOver(i, H - 3, ramp[0], 0.4);
  }, { seed: 9980 + variant, shadow: W - 3, shadowY: H - 1, shadowH: 5, alpha: 0.32 });
}

/** Mossy boulder — the same stone language with a green cap. */
function mossyRock(variant: number): Surface {
  const base = rock(variant + 1);
  const s = base.clone();
  const r = rng(10100 + variant);
  const n = valueNoise(10120 + variant);
  for (let j = 0; j < s.h; j++) {
    for (let i = 0; i < s.w; i++) {
      if (!s.alphaAt(i, j)) continue;
      const c = s.get(i, j);
      if (c[3] < 255) continue;
      const top = j < s.h * 0.55;
      if (!top) continue;
      const v = n(i, j, 4.0) + (0.5 - j / s.h) * 0.5;
      if (v < 0.62) continue;
      const lum = (c[0] + c[1] + c[2]) / 3;
      s.px(i, j, lum > 130 ? P.MOSS[4] : lum > 100 ? P.MOSS[3] : lum > 70 ? P.MOSS[2] : P.MOSS[1]);
    }
  }
  // a fringe of moss hanging over the lit edge
  for (let k = 0; k < 14; k++) {
    const x = r.int(2, s.w - 3), y = r.int(2, Math.round(s.h * 0.6));
    if (!s.alphaAt(x, y)) continue;
    s.px(x, y, P.MOSS[3]);
    s.px(x, y + 1, P.MOSS[1]);
  }
  return s;
}

/** Kitchen-garden rows: cabbages, carrot tops, herbs. */
function vegetableRow(variant: number): Surface {
  return prop(32, 18, (s, r) => {
    // ridged soil
    for (let y = 8; y <= 15; y++) {
      for (let x = 1; x < 31; x++) {
        const v = valueNoise(10200 + variant)(x, y, 2.6);
        s.px(x, y, v > 0.68 ? P.DIRT[3] : v < 0.3 ? P.DIRT[1] : P.DIRT[2]);
      }
    }
    for (let x = 1; x < 31; x++) { s.px(x, 8, P.DIRT[4], 0.6); s.px(x, 15, P.DIRT[0], 0.8); }
    for (let x = 3; x < 30; x += 6) for (let y = 9; y < 15; y++) s.px(x, y, P.DIRT[0], 0.35);
    if (variant === 0) { // cabbages
      for (const cx of [6, 14, 22, 29]) {
        s.ellipse(cx - 4, 4, 8, 7, P.VEG_LEAF[2]);
        s.ellipse(cx - 3, 4, 6, 5, P.VEG_LEAF[3]);
        s.ellipse(cx - 2, 5, 3, 3, P.VEG_LEAF[4]);
        s.ellipseOutline(cx - 4, 4, 8, 7, P.VEG_LEAF[1], 0.8);
        s.px(cx - 4, 9, P.VEG_LEAF[0]); s.px(cx + 3, 9, P.VEG_LEAF[0]);
        for (let k = 0; k < 4; k++) s.px(cx + r.int(-3, 2), 5 + r.int(0, 3), P.VEG_LEAF[1], 0.7);
      }
    } else if (variant === 1) { // carrot tops
      for (const cx of [5, 12, 19, 26]) {
        for (let k = 0; k < 7; k++) {
          const a = -2.6 + k * 0.4;
          const len = r.int(4, 7);
          for (let i = 0; i < len; i++) {
            const x = cx + Math.round(Math.cos(a) * i * 0.8);
            const y = 10 - Math.round(Math.abs(Math.sin(a)) * i);
            s.px(x, y, i > len - 3 ? P.VEG_LEAF[4] : P.VEG_LEAF[2]);
          }
        }
        s.px(cx, 11, P.FLOWER_GOLD[1]); s.px(cx, 12, P.FLOWER_GOLD[0]);
      }
    } else { // herbs / leafy greens
      for (let k = 0; k < 46; k++) {
        const x = r.int(2, 29), y = 4 + r.int(0, 7);
        s.px(x, y, P.VEG_LEAF[r.int(2, 4)]);
        s.px(x, y + 1, P.VEG_LEAF[r.int(0, 2)]);
        if (r.chance(0.12)) bloom(s, x, y - 1, P.FLOWER_WHITE, r);
      }
    }
  }, { seed: 10250 + variant, shadow: 28, shadowY: 17, shadowH: 5, alpha: 0.26 });
}

// ── town furniture ─────────────────────────────────────────────────────────

/** Carved stone with joint lines and a lit upper-left face. */
function stoneBand(s: Surface, x: number, y: number, w: number, h: number, ramp: Ramp, joints = 6, seed = 1) {
  const n = valueNoise(seed);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const u = (i + 0.5) / w;
      let idx = cylIndex(u);
      const v = n(x + i, y + j, 3.0);
      if (v > 0.72) idx = Math.min(4, idx + 1);
      else if (v < 0.28) idx = Math.max(0, idx - 1);
      s.px(x + i, y + j, ramp[idx]);
    }
  }
  for (let k = 1; k < joints; k++) {
    const jx = x + Math.round((k * w) / joints);
    for (let j = 1; j < h - 1; j++) { s.px(jx, y + j, ramp[0], 0.55); s.px(jx + 1, y + j, ramp[4], 0.25); }
  }
  for (let i = 0; i < w; i++) s.px(x + i, y + h - 1, ramp[0], 0.7);
}

/** The Town Square centrepiece. Four frames of moving water. */
function fountain(frame: number): Surface {
  const W = 48, H = 48;
  const s = new Surface(W, H);
  const r = rng(11000 + frame * 97);
  const st = P.PATH_STONE;

  // plinth the whole thing stands on
  s.ellipse(1, 37, 46, 9, st[1]);
  s.ellipse(1, 36, 46, 9, st[2]);
  for (let i = 2; i < 46; i++) s.pxOver(i, 40, st[0], 0.5);
  // basin rim, then the wall that hangs below its front lip
  topFace(s, 2, 20, 44, 18, st);
  s.ellipseOutline(2, 20, 44, 18, st[4], 0.8);
  s.ellipseOutline(3, 21, 42, 16, st[1], 0.5);
  const rimMask = new Surface(W, H);
  rimMask.ellipse(2, 20, 44, 18, '#ffffff');
  const n = valueNoise(11050);
  for (let x = 2; x < 46; x++) {
    let low = -1;
    for (let y = H - 1; y >= 0; y--) if (rimMask.alphaAt(x, y)) { low = y; break; }
    if (low < 0) continue;
    const u = (x - 2) / 44;
    for (let k = 0; k < 6; k++) {
      const v = n(x, low + k, 3.0);
      let idx = cylIndex(u);
      if (v > 0.74) idx = Math.min(4, idx + 1);
      else if (v < 0.28) idx = Math.max(0, idx - 1);
      if (k === 0) idx = Math.min(4, idx + 1);
      if (k >= 4) idx = Math.max(0, idx - 1);
      s.px(x, low - 1 + k, st[idx]);
    }
    if ((x - 2) % 7 === 0) for (let k = 1; k < 5; k++) s.px(x, low - 1 + k, st[0], 0.55);
  }
  // water pool
  const pool = new Surface(W, H);
  pool.ellipse(7, 24, 34, 11, P.WATER[2]);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      if (!pool.alphaAt(i, j)) continue;
      const v = valueNoise(11100)(i, j + frame * 3, 4.0);
      pool.px(i, j, v > 0.68 ? P.WATER[3] : v < 0.32 ? P.WATER[1] : P.WATER[2]);
    }
  }
  // expanding ripple rings
  for (let k = 0; k < 3; k++) {
    const t = ((frame + k * 1.3) % 4) / 4;
    const rw = Math.round(6 + t * 26), rh = Math.round(2 + t * 9);
    pool.ellipseOutline(24 - rw / 2, 29 - rh / 2, rw, rh, t > 0.7 ? P.WATER[3] : P.WATER[4], 0.55 - t * 0.3);
  }
  s.blitInside(pool);
  for (let i = 0; i < W; i++) s.pxOver(i, 25, P.WATER[0], 0.35);

  // pedestal + upper bowl
  s.rect(21, 12, 6, 16, st[2]);
  s.vline(21, 12, 16, st[3]); s.vline(22, 12, 16, st[4]);
  s.vline(26, 12, 16, st[0]); s.vline(25, 12, 16, st[1]);
  s.rect(19, 26, 10, 3, st[2]); s.hline(19, 26, 10, st[4]); s.hline(19, 28, 10, st[0]);
  topFace(s, 15, 8, 18, 7, st);
  s.ellipseOutline(15, 8, 18, 7, st[4], 0.7);
  s.ellipse(18, 10, 12, 4, P.WATER[2]);
  s.ellipse(19, 10, 10, 3, P.WATER[3]);

  // jet + falling water, all animated
  const jetH = [5, 6, 5, 4][frame];
  for (let k = 0; k < jetH; k++) {
    s.px(24, 8 - k, k > jetH - 3 ? P.WATER[4] : P.WATER_FOAM);
    s.px(23, 8 - k, P.WATER[3], 0.8);
  }
  s.px(22, 4 - (frame % 2), P.WATER_FOAM, 0.7);
  s.px(26, 3 + (frame % 3), P.WATER[4], 0.7);
  for (const [sx, dir] of [[16, -1], [31, 1]] as Array<[number, number]>) {
    for (let k = 0; k < 13; k++) {
      const y = 12 + k;
      const x = sx + dir * Math.round(k * 0.15);
      const on = (k + frame * 2) % 5 !== 4;   // the stream breaks into droplets
      if (!on) continue;
      s.px(x, y, P.WATER_FOAM);
      s.px(x + dir, y, P.WATER[4], 0.85);
      s.px(x - dir, y, P.WATER[3], 0.6);
    }
  }
  // splash where the streams land
  for (const sx of [17, 31]) {
    const j = (frame % 2) ? 0 : 1;
    s.px(sx - 1, 25 + j, P.WATER_FOAM, 0.8);
    s.px(sx + 1, 25 + j, P.WATER[4], 0.7);
  }
  // moss where the stone meets the ground
  for (let k = 0; k < 16; k++) {
    const x = r.int(4, 43), y = r.int(38, 43);
    s.pxOver(x, y, P.MOSS[r.int(1, 3)], 0.8);
  }
  rim(s);
  contact(s, 24, 46, 44, 8, 0.32);
  return s;
}

/** Notice board: pinned paper, a plank face and a little roof to keep the rain off. */
function noticeBoard(): Surface {
  return prop(32, 40, (s, r) => {
    // posts
    for (const x of [4, 25]) {
      s.rect(x, 12, 3, 26, P.WOOD[2]);
      s.vline(x, 12, 26, P.WOOD[3]);
      s.vline(x + 2, 12, 26, P.WOOD[0]);
    }
    // board
    planks(s, 4, 10, 24, 18, P.WOOD_LIGHT, true, 6, 11200);
    s.rectOutline(4, 10, 24, 18, P.WOOD[1]);
    s.hline(4, 10, 24, P.WOOD_LIGHT[4]);
    s.vline(4, 10, 18, P.WOOD_LIGHT[3]);
    s.hline(4, 27, 24, P.WOOD[0]);
    s.vline(27, 10, 18, P.WOOD[0]);
    // pinned papers
    const papers: Array<[number, number, number, number, readonly string[]]> = [
      [7, 13, 8, 9, P.UI_PARCHMENT], [17, 12, 8, 7, P.UI_PARCHMENT], [16, 20, 9, 6, P.LINEN], [7, 23, 7, 4, P.UI_PARCHMENT],
    ];
    for (const [px, py, pw, ph, ramp] of papers) {
      s.rect(px, py, pw, ph, ramp[3]);
      s.hline(px, py, pw, ramp[4]);
      s.vline(px, py, ph, ramp[4]);
      s.hline(px, py + ph - 1, pw, ramp[0], 0.8);
      s.vline(px + pw - 1, py, ph, ramp[1]);
      for (let k = 2; k < ph - 1; k += 2) s.hline(px + 1, py + k, pw - r.int(2, 4), ramp[0], 0.45);
      s.px(px + Math.floor(pw / 2), py, P.IRON[3]); // pin
      // a dog-eared corner
      s.px(px + pw - 1, py + ph - 1, ramp[1]);
    }
    // roof
    for (let k = 0; k < 4; k++) {
      const y = 6 + k;
      const x0 = 1 + k, w = 30 - k * 2;
      s.hline(x0, y, w, k === 0 ? P.ROOF_RED[4] : k < 2 ? P.ROOF_RED[3] : P.ROOF_RED[2]);
    }
    s.hline(1, 9, 30, P.ROOF_RED[0], 0.8);
    s.hline(2, 5, 28, P.ROOF_RED[1]);
  }, { seed: 11250, shadow: 26, shadowY: 39, shadowH: 6 });
}

/** Public bench: 0 has a back, 1 is a plain plank seat. */
function bench(variant: number): Surface {
  return prop(32, 22, (s) => {
    const seatY = variant === 0 ? 12 : 13;
    // legs
    for (const x of [3, 26]) {
      s.rect(x, seatY + 3, 3, 6, P.WOOD[1]);
      s.vline(x, seatY + 3, 6, P.WOOD[3]);
      s.vline(x + 2, seatY + 3, 6, P.WOOD[0]);
    }
    // seat
    planks(s, 1, seatY, 30, 4, P.WOOD_LIGHT, false, 2, 11300);
    s.hline(1, seatY, 30, P.WOOD_LIGHT[4]);
    s.hline(1, seatY + 3, 30, P.WOOD[0]);
    if (variant === 0) {
      // back rest with two rails and uprights
      for (const x of [4, 15, 26]) {
        s.rect(x, 3, 2, 10, P.WOOD[2]);
        s.vline(x, 3, 10, P.WOOD[3]);
        s.vline(x + 1, 3, 10, P.WOOD[0]);
      }
      for (const y of [4, 8]) {
        s.hline(2, y, 28, P.WOOD_LIGHT[3]);
        s.hline(2, y + 1, 28, P.WOOD_LIGHT[2]);
        s.hline(2, y + 2, 28, P.WOOD[0], 0.8);
      }
    } else {
      // a knot and a worn edge instead of a back
      s.px(12, seatY + 1, P.WOOD[0]); s.px(13, seatY + 1, P.WOOD[0]);
      s.px(12, seatY, P.WOOD_LIGHT[4]);
    }
  }, { seed: 11310 + variant, shadow: 28, shadowY: 21, shadowH: 5 });
}

/** Picnic table with attached benches. */
function picnicTable(): Surface {
  return prop(40, 30, (s) => {
    // far bench
    planks(s, 2, 11, 36, 3, P.WOOD, false, 2, 11400);
    s.hline(2, 11, 36, P.WOOD[3]);
    s.hline(2, 13, 36, P.WOOD[0]);
    // table top
    planks(s, 3, 14, 34, 7, P.WOOD_LIGHT, false, 3, 11410);
    s.hline(3, 14, 34, P.WOOD_LIGHT[4]);
    s.hline(3, 20, 34, P.WOOD[0]);
    s.vline(3, 14, 7, P.WOOD_LIGHT[3]);
    s.vline(36, 14, 7, P.WOOD[1]);
    // legs (A-frame)
    for (const x of [7, 30]) {
      for (let k = 0; k < 7; k++) {
        s.px(x - Math.round(k * 0.4), 21 + k, P.WOOD[2]);
        s.px(x - Math.round(k * 0.4) + 1, 21 + k, P.WOOD[0]);
        s.px(x + 2 + Math.round(k * 0.4), 21 + k, P.WOOD[1]);
      }
    }
    // near bench
    planks(s, 2, 22, 36, 3, P.WOOD, false, 2, 11420);
    s.hline(2, 22, 36, P.WOOD[3]);
    s.hline(2, 24, 36, P.WOOD[0]);
    for (const x of [6, 31]) { s.rect(x, 25, 2, 3, P.WOOD[1]); s.vline(x, 25, 3, P.WOOD[2]); }
  }, { seed: 11430, shadow: 36, shadowY: 29, shadowH: 6 });
}

/** Small round café table. */
function tableRound(): Surface {
  return prop(26, 24, (s) => {
    // pedestal + foot
    s.rect(11, 11, 4, 8, P.WOOD[2]);
    s.vline(11, 11, 8, P.WOOD[3]); s.vline(14, 11, 8, P.WOOD[0]);
    s.ellipse(7, 18, 12, 5, P.WOOD[1]);
    s.ellipse(7, 17, 12, 5, P.WOOD[2]);
    s.ellipseOutline(7, 17, 12, 5, P.WOOD[3], 0.6);
    // top: a real slab with visible thickness
    topFace(s, 1, 3, 24, 11, P.WOOD_LIGHT);
    const m = new Surface(s.w, s.h);
    m.ellipse(1, 3, 24, 11, '#ffffff');
    for (let x = 1; x < 25; x++) {
      let low = -1;
      for (let y = s.h - 1; y >= 0; y--) if (m.alphaAt(x, y)) { low = y; break; }
      if (low < 0) continue;
      s.px(x, low, P.WOOD[1]);
      s.px(x, low + 1, P.WOOD[0]);
    }
    // radial boards
    for (let k = 0; k < 3; k++) s.line(4 + k * 7, 5, 6 + k * 6, 12, P.WOOD[1], 0.5);
    s.ellipseOutline(4, 5, 18, 7, P.WOOD_LIGHT[4], 0.3);
  }, { seed: 11440, shadow: 20, shadowY: 23, shadowH: 6 });
}

/** Chairs and a stool. */
function chair(variant: number): Surface {
  return prop(14, 22, (s) => {
    const seatY = 12;
    for (const x of [2, 9]) {
      s.rect(x, seatY + 3, 2, 6, P.WOOD[1]);
      s.vline(x, seatY + 3, 6, P.WOOD[3]);
    }
    planks(s, 1, seatY, 12, 3, P.WOOD_LIGHT, true, 4, 11450 + variant);
    s.hline(1, seatY, 12, P.WOOD_LIGHT[4]);
    s.hline(1, seatY + 2, 12, P.WOOD[0]);
    if (variant === 0) { // slat back
      s.rect(2, 3, 2, 10, P.WOOD[2]); s.vline(2, 3, 10, P.WOOD[3]);
      s.rect(10, 3, 2, 10, P.WOOD[2]); s.vline(10, 3, 10, P.WOOD[0]);
      for (const y of [4, 7]) { s.hline(2, y, 10, P.WOOD_LIGHT[3]); s.hline(2, y + 1, 10, P.WOOD[0], 0.7); }
    } else { // solid back with a cut-out heart-shaped hole (just a hole)
      s.rect(2, 2, 10, 11, P.WOOD_LIGHT[2]);
      s.hline(2, 2, 10, P.WOOD_LIGHT[4]);
      s.vline(2, 2, 11, P.WOOD_LIGHT[3]);
      s.vline(11, 2, 11, P.WOOD[0]);
      s.rect(6, 5, 3, 4, P.OUTLINE, 0);
      for (let j = 5; j < 9; j++) for (let i = 6; i < 9; i++) s.data[(j * s.w + i) * 4 + 3] = 0;
      s.hline(6, 9, 3, P.WOOD[0], 0.6);
    }
  }, { seed: 11460 + variant, shadow: 12, shadowY: 21, shadowH: 4 });
}

function stool(): Surface {
  return prop(14, 16, (s) => {
    for (const [x, y] of [[2, 9], [10, 9], [6, 11]] as Array<[number, number]>) {
      s.rect(x, y, 2, 5, P.WOOD[1]);
      s.vline(x, y, 5, P.WOOD[3]);
    }
    topFace(s, 1, 5, 12, 6, P.WOOD_LIGHT);
    s.ellipseOutline(1, 5, 12, 6, P.WOOD[0], 0.6);
    for (let i = 2; i < 12; i++) s.px(i, 10, P.WOOD[1]);
  }, { seed: 11470, shadow: 12, shadowY: 15, shadowH: 4 });
}

/** Village well: stone drum, timber frame, a bucket on a rope. */
function well(): Surface {
  return prop(32, 42, (s, r) => {
    const st = P.STONE_WALL;
    // drum
    stoneBand(s, 4, 24, 24, 12, st, 5, 11500);
    topFace(s, 3, 18, 26, 11, st);
    s.ellipseOutline(3, 18, 26, 11, st[4], 0.7);
    // dark mouth
    s.ellipse(7, 21, 18, 7, P.OUTLINE);
    s.ellipse(8, 22, 16, 5, P.WATER[0], 0.9);
    s.ellipse(11, 23, 8, 2, P.WATER[1], 0.6);
    // frame posts + roof
    for (const x of [5, 24]) {
      s.rect(x, 6, 3, 16, P.WOOD[2]);
      s.vline(x, 6, 16, P.WOOD[3]);
      s.vline(x + 2, 6, 16, P.WOOD[0]);
    }
    for (let k = 0; k < 5; k++) {
      const y = 1 + k;
      const x0 = 2 + k, w = 28 - k * 2;
      s.hline(x0, y, w, k === 0 ? P.THATCH[4] : k < 2 ? P.THATCH[3] : P.THATCH[2]);
    }
    s.hline(2, 6, 28, P.THATCH[0], 0.85);
    // winch + rope + bucket
    s.rect(7, 8, 18, 2, P.WOOD[1]);
    s.hline(7, 8, 18, P.WOOD[3]);
    s.vline(16, 10, 5, P.ROPE[2]);
    s.rect(13, 15, 7, 6, P.WOOD[2]);
    s.hline(13, 15, 7, P.WOOD_LIGHT[4]);
    s.vline(13, 15, 6, P.WOOD[3]);
    s.vline(19, 15, 6, P.WOOD[0]);
    s.hline(13, 17, 7, P.IRON[3], 0.8);
    s.hline(13, 20, 7, P.WOOD[0]);
    // moss + grit
    for (let k = 0; k < 12; k++) s.pxOver(r.int(5, 26), r.int(31, 36), P.MOSS[r.int(1, 3)], 0.85);
  }, { seed: 11510, shadow: 28, shadowY: 41, shadowH: 7 });
}

/** Water trough — half full, with a highlight where the sky lands on it. */
function waterTrough(): Surface {
  return prop(30, 18, (s) => {
    planks(s, 1, 6, 28, 9, P.WOOD, true, 5, 11520);
    s.hline(1, 6, 28, P.WOOD[4]);
    s.hline(1, 14, 28, P.WOOD[0]);
    s.vline(1, 6, 9, P.WOOD[3]);
    s.vline(28, 6, 9, P.WOOD[0]);
    // iron bands
    for (const x of [5, 23]) { s.vline(x, 6, 9, P.IRON[3]); s.vline(x + 1, 6, 9, P.IRON[1]); }
    // water
    s.ellipse(3, 4, 24, 6, P.WATER[2]);
    s.ellipse(4, 4, 22, 5, P.WATER[3]);
    s.ellipseOutline(3, 4, 24, 6, P.WATER[1], 0.7);
    s.hline(7, 5, 6, P.WATER[4], 0.8);
    s.px(18, 6, P.WATER_FOAM, 0.8);
    // legs
    for (const x of [3, 24]) { s.rect(x, 15, 3, 2, P.WOOD[1]); s.px(x, 15, P.WOOD[3]); }
  }, { seed: 11530, shadow: 26, shadowY: 17, shadowH: 5 });
}

/** Cast-iron hand pump on a stone footing. Painted, so it reads against grass. */
function pump(): Surface {
  return prop(18, 28, (s) => {
    const m = P.STONE_WALL; // painted metal — light enough to read at 1x
    // stone footing
    s.rect(2, 22, 14, 4, P.COBBLE[2]);
    s.hline(2, 22, 14, P.COBBLE[4]);
    s.hline(2, 25, 14, P.COBBLE[0]);
    for (let i = 5; i < 16; i += 5) s.vline(i, 23, 3, P.COBBLE[0], 0.5);
    // column
    cylBody(s, 6, 9, 7, 14, m);
    for (const y of [11, 16, 21]) { s.hline(6, y, 7, m[4], 0.6); s.hline(6, y + 1, 7, m[0], 0.6); }
    // head casting
    s.rect(4, 5, 11, 5, m[2]);
    s.hline(4, 5, 11, m[4]);
    s.vline(4, 5, 5, m[3]);
    s.vline(14, 5, 5, m[0]);
    s.hline(4, 9, 11, m[0], 0.8);
    // spout, curving down to the left
    for (let k = 0; k < 6; k++) {
      const x = 4 - k, y = 10 + Math.round(k * k * 0.18);
      s.px(x, y, m[4]);
      s.px(x, y + 1, m[2]);
      s.px(x, y + 2, m[0]);
    }
    s.px(-1 + 0, 16, m[1]);
    // handle: iron arm, wooden grip
    for (let k = 0; k < 6; k++) { s.px(11 + k, 4 - Math.round(k * 0.6), m[3]); s.px(11 + k, 5 - Math.round(k * 0.6), m[1]); }
    s.rect(15, 0, 3, 3, P.WOOD[2]);
    s.hline(15, 0, 3, P.WOOD[4]);
    s.hline(15, 2, 3, P.WOOD[0]);
    // pivot bolt
    s.px(11, 5, P.IRON[4]);
    // a puddle under the spout
    s.ellipse(0, 24, 7, 3, P.WATER[1], 0.5);
    s.ellipse(1, 24, 5, 2, P.WATER[3], 0.5);
  }, { seed: 11540, shadow: 15, shadowY: 27, shadowH: 4 });
}

/** Wrought-iron lamppost; `lit` frames add the amber flicker. */
function lamppost(lit: number | null): Surface {
  return prop(16, 48, (s) => {
    // base
    s.ellipse(3, 41, 10, 5, P.IRON[1]);
    s.ellipse(3, 40, 10, 5, P.IRON[2]);
    s.rect(6, 34, 4, 8, P.IRON[2]);
    s.vline(6, 34, 8, P.IRON[3]);
    s.vline(9, 34, 8, P.IRON[0]);
    // shaft
    for (let y = 12; y < 36; y++) {
      s.px(6, y, P.IRON[3]);
      s.px(7, y, P.IRON[2]);
      s.px(8, y, P.IRON[0]);
    }
    for (const y of [20, 28]) { s.hline(5, y, 5, P.IRON[4]); s.hline(5, y + 1, 5, P.IRON[0]); }
    // curled bracket
    for (let k = 0; k < 4; k++) s.px(8 + k, 12 - k, P.IRON[2]);
    // lantern housing
    s.rect(3, 4, 9, 9, P.IRON[1]);
    s.rect(4, 5, 7, 7, lit !== null ? P.WINDOW_AMBER[3] : P.GLASS_COLD?.[2] ?? P.IRON[3]);
    s.rectOutline(3, 4, 9, 9, P.IRON[0]);
    s.vline(3, 4, 9, P.IRON[3]);
    s.hline(3, 4, 9, P.IRON[4]);
    s.vline(7, 5, 7, P.IRON[1], 0.7);
    s.hline(4, 8, 7, P.IRON[1], 0.5);
    // cap + finial
    for (let k = 0; k < 3; k++) s.hline(2 + k, 1 + k, 11 - k * 2, k === 0 ? P.IRON[4] : P.IRON[2]);
    s.px(7, 0, P.IRON[3]);
    if (lit !== null) {
      const flick = [0, 1, 0.5][lit];
      // flame
      s.rect(6, 7, 3, 4, P.LANTERN[3]);
      s.rect(6, 6 + Math.round(flick), 3, 2, P.LANTERN[4]);
      s.px(7, 5 + Math.round(flick), P.LANTERN[4]);
      // glass glow + spill onto the ironwork
      for (let j = 5; j < 12; j++) for (let i = 4; i < 11; i++) s.px(i, j, P.LANTERN[2], 0.35 + flick * 0.12);
      for (let k = 0; k < 3; k++) {
        s.pxOver(3, 5 + k * 2, P.LANTERN[3], 0.5);
        s.pxOver(11, 5 + k * 2, P.LANTERN[2], 0.4);
      }
      s.pxOver(7, 14, P.LANTERN[1], 0.35);
    }
  }, { seed: 11550, shadow: 12, shadowY: 47, shadowH: 4 });
}

/** Directional fingerpost. Arrows only — the world has no legible text. */
function signpost(variant: number): Surface {
  const arms = [1, 2, 3][variant];
  return prop(24, 30, (s, r) => {
    // post
    s.rect(10, 6, 4, 22, P.WOOD[2]);
    s.vline(10, 6, 22, P.WOOD[3]);
    s.vline(11, 6, 22, P.WOOD[4]);
    s.vline(13, 6, 22, P.WOOD[0]);
    for (let k = 0; k < 6; k++) s.px(r.int(10, 13), r.int(8, 26), P.WOOD[0], 0.5);
    // cap
    s.hline(9, 5, 6, P.WOOD[3]);
    s.hline(9, 4, 6, P.WOOD[4]);
    for (let a = 0; a < arms; a++) {
      const y = 8 + a * 6;
      const dir = a % 2 === 0 ? 1 : -1;
      const w = 11 - a;
      const x0 = dir > 0 ? 13 : 12 - w;
      s.rect(x0, y, w, 5, P.WOOD_LIGHT[3]);
      s.hline(x0, y, w, P.WOOD_LIGHT[4]);
      s.hline(x0, y + 4, w, P.WOOD[0]);
      // arrow point
      for (let k = 0; k < 3; k++) {
        const tipX = dir > 0 ? x0 + w + k : x0 - 1 - k;
        for (let j = k; j < 5 - k; j++) s.px(tipX, y + j, j < 2 ? P.WOOD_LIGHT[3] : P.WOOD_LIGHT[2]);
      }
      // a routed groove standing in for lettering
      s.hline(x0 + 2, y + 2, w - 4, P.WOOD[1], 0.7);
      s.px(dir > 0 ? x0 + 1 : x0 + w - 2, y + 2, P.WOOD[0]);
    }
  }, { seed: 11560 + variant, shadow: 14, shadowY: 29, shadowH: 5 });
}

/** Two-wheeled hand cart. */
function cart(): Surface {
  return prop(48, 34, (s) => {
    // shafts
    for (let k = 0; k < 10; k++) { s.px(2 + k, 20 + Math.round(k * 0.2), P.WOOD[2]); s.px(2 + k, 21 + Math.round(k * 0.2), P.WOOD[0]); }
    // bed
    planks(s, 8, 10, 34, 12, P.WOOD, true, 5, 11570);
    s.hline(8, 10, 34, P.WOOD[4]);
    s.hline(8, 21, 34, P.WOOD[0]);
    s.vline(8, 10, 12, P.WOOD[3]);
    s.vline(41, 10, 12, P.WOOD[0]);
    // side rails
    for (const y of [8, 12]) { s.hline(7, y, 36, P.WOOD_LIGHT[3]); s.hline(7, y + 1, 36, P.WOOD[1]); }
    for (const x of [10, 24, 38]) { s.vline(x, 6, 6, P.WOOD[2]); s.vline(x + 1, 6, 6, P.WOOD[0]); }
    // wheels
    for (const cx of [15, 35]) {
      s.ellipse(cx - 7, 18, 14, 14, P.WOOD[1]);
      s.ellipse(cx - 6, 19, 12, 12, P.WOOD[2]);
      s.ellipseOutline(cx - 7, 18, 14, 14, P.WOOD[0]);
      s.ellipseOutline(cx - 6, 19, 12, 12, P.WOOD[3], 0.6);
      s.ellipse(cx - 5, 20, 10, 10, P.OUTLINE, 0);
      for (let j = 20; j < 30; j++) for (let i = cx - 5; i < cx + 5; i++) {
        const dx = (i - cx + 0.5) / 5, dy = (j - 25 + 0.5) / 5;
        if (dx * dx + dy * dy <= 1) s.data[(j * s.w + i) * 4 + 3] = 0;
      }
      for (let a = 0; a < 6; a++) {
        const ang = a * (Math.PI / 3) + 0.3;
        s.line(cx, 25, cx + Math.round(Math.cos(ang) * 5), 25 + Math.round(Math.sin(ang) * 5), P.WOOD[2]);
      }
      s.ellipse(cx - 2, 23, 4, 4, P.IRON[2]);
      s.px(cx - 1, 24, P.IRON[4]);
    }
  }, { seed: 11580, shadow: 40, shadowY: 33, shadowH: 6 });
}

function wheelbarrow(): Surface {
  return prop(28, 24, (s) => {
    // tray
    s.poly([[5, 6], [25, 6], [22, 16], [8, 16]], P.IRON[2]);
    s.poly([[6, 7], [24, 7], [21, 12], [9, 12]], P.IRON[3]);
    s.hline(5, 6, 21, P.IRON[4]);
    for (let k = 0; k < 4; k++) s.px(8 + k * 4, 16, P.IRON[0]);
    s.line(8, 16, 22, 16, P.IRON[0]);
    // handles
    for (let k = 0; k < 8; k++) { s.px(24 + k - 8, 17 + Math.round(k * 0.3), P.WOOD[2]); }
    for (let k = 0; k < 6; k++) { s.px(21 + k, 15 + k, P.WOOD[2]); s.px(21 + k, 16 + k, P.WOOD[0]); }
    s.rect(25, 19, 3, 2, P.WOOD[3]);
    // leg + wheel
    s.rect(19, 16, 2, 5, P.WOOD[1]);
    s.ellipse(3, 12, 10, 10, P.WOOD[1]);
    s.ellipse(4, 13, 8, 8, P.WOOD[2]);
    s.ellipseOutline(3, 12, 10, 10, P.WOOD[0]);
    s.ellipse(6, 15, 4, 4, P.IRON[2]);
    s.px(7, 16, P.IRON[4]);
    // a load of soil
    for (let k = 0; k < 26; k++) {
      const x = 7 + (k * 7) % 15, y = 5 + (k * 3) % 3;
      s.px(x, y, k % 3 ? P.DIRT[2] : P.DIRT[3]);
    }
  }, { seed: 11590, shadow: 22, shadowY: 23, shadowH: 5 });
}

/** Crates in three sizes. */
function crate(variant: number): Surface {
  const dims: Array<[number, number]> = [[16, 16], [20, 19], [14, 13]];
  const [W, H] = dims[variant];
  return prop(W, H, (s) => {
    const top = 4;
    // top face: pale boards receding to the back edge
    for (let j = 0; j < top; j++) {
      const inset = top - 1 - j;
      for (let i = inset; i < W - 1 - inset; i++) {
        s.px(i, j + 1, j === 0 ? P.WOOD_LIGHT[3] : j < 3 ? P.WOOD_LIGHT[4] : P.WOOD_LIGHT[3]);
      }
    }
    for (let i = 3; i < W - 3; i += 5) for (let j = 1; j <= top; j++) s.pxOver(i, j, P.WOOD[1], 0.5);
    s.hline(1, top, W - 2, P.WOOD_LIGHT[4]);
    // front face
    planks(s, 1, top + 1, W - 2, H - top - 3, P.WOOD, true, 5, 11600 + variant);
    s.rectOutline(1, top + 1, W - 2, H - top - 3, P.WOOD[1]);
    s.vline(1, top + 1, H - top - 3, P.WOOD[3]);
    s.hline(1, top + 1, W - 2, P.WOOD[4]);
    s.hline(1, H - 3, W - 2, P.WOOD[0]);
    s.vline(W - 2, top + 1, H - top - 3, P.WOOD[0]);
    // diagonal brace
    s.line(2, H - 4, W - 3, top + 2, P.WOOD_LIGHT[3]);
    s.line(2, H - 5, W - 3, top + 1, P.WOOD[0], 0.5);
    if (variant === 1) s.line(2, top + 2, W - 3, H - 4, P.WOOD_LIGHT[2]);
    // nails
    for (const [nx, ny] of [[2, top + 2], [W - 3, top + 2], [2, H - 4], [W - 3, H - 4]] as Array<[number, number]>) s.px(nx, ny, P.IRON[3]);
  }, { seed: 11610 + variant, shadow: W - 2, shadowY: H - 1, shadowH: 4 });
}

/** Barrels: upright and on its side. */
function barrel(variant: number): Surface {
  if (variant === 0) {
    return prop(16, 22, (s) => {
      // staves bulge: widest in the middle
      for (let j = 0; j < 15; j++) {
        const bulge = Math.round(Math.sin((j / 14) * Math.PI) * 1.4);
        const x0 = 2 - bulge, w = 12 + bulge * 2;
        for (let i = 0; i < w; i++) s.px(x0 + i, 5 + j, P.WOOD[cylIndex((i + 0.5) / w)]);
      }
      for (const y of [7, 12, 17]) {
        for (let i = 0; i < 14; i++) {
          const bulge = Math.round(Math.sin(((y - 5) / 14) * Math.PI) * 1.4);
          const x0 = 2 - bulge, w = 12 + bulge * 2;
          if (i >= w) continue;
          s.px(x0 + i, y, P.IRON[cylIndex((i + 0.5) / w) === 4 ? 4 : cylIndex((i + 0.5) / w)]);
        }
      }
      topFace(s, 2, 2, 12, 6, P.WOOD_LIGHT);
      s.ellipseOutline(2, 2, 12, 6, P.WOOD[1], 0.9);
      s.px(7, 4, P.WOOD[0]); s.px(8, 4, P.WOOD[0]);
    }, { seed: 11620, shadow: 15, shadowY: 21, shadowH: 5 });
  }
  return prop(24, 16, (s) => {
    for (let j = 0; j < 11; j++) {
      const c = P.WOOD[cylIndex((j + 0.5) / 11)];
      for (let i = 0; i < 18; i++) {
        const bulge = Math.round(Math.sin((i / 17) * Math.PI) * 1.2);
        if (j < 1 - bulge || j > 10 + bulge) continue;
        s.px(3 + i, 3 + j, c);
      }
    }
    for (const x of [6, 11, 16]) s.vline(x, 3, 11, P.IRON[2]);
    for (const x of [6, 11, 16]) s.px(x, 4, P.IRON[4]);
    s.ellipse(1, 3, 5, 11, P.WOOD_LIGHT[2]);
    s.ellipse(2, 4, 4, 9, P.WOOD_LIGHT[3]);
    s.ellipseOutline(1, 3, 5, 11, P.WOOD[1], 0.9);
    // chocks so it does not roll
    s.rect(8, 13, 3, 2, P.WOOD[1]);
  }, { seed: 11630, shadow: 20, shadowY: 15, shadowH: 5 });
}

/** Grain sacks. */
function sack(variant: number): Surface {
  const W = variant === 0 ? 14 : 16, H = variant === 0 ? 17 : 14;
  return prop(W, H, (s, r) => {
    const ramp = variant === 0 ? P.CLOTH.cream : P.UI_PARCHMENT;
    const bodyTop = variant === 0 ? 5 : 4;
    s.ellipse(1, bodyTop, W - 2, H - bodyTop - 1, ramp[2]);
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        if (!s.alphaAt(i, j)) continue;
        const u = (i - 1) / (W - 2), v = (j - bodyTop) / (H - bodyTop - 1);
        const d = -(u - 0.45) * 0.7 - (v - 0.4) * 0.9;
        s.px(i, j, d > 0.45 ? ramp[4] : d > 0.12 ? ramp[3] : d > -0.25 ? ramp[2] : d > -0.55 ? ramp[1] : ramp[0]);
      }
    }
    // creases
    for (let k = 0; k < 4; k++) {
      const x = 3 + k * 3;
      for (let y = bodyTop + 2; y < H - 2; y += 1) if (r.chance(0.6)) s.pxOver(x, y, ramp[1], 0.6);
    }
    // tied neck
    if (variant === 0) {
      s.rect(5, 1, 4, 4, ramp[2]);
      s.hline(5, 1, 4, ramp[4]);
      s.hline(4, 5, 6, P.ROPE[2]);
      s.hline(4, 6, 6, P.ROPE[0]);
      s.px(4, 4, ramp[3]); s.px(9, 4, ramp[1]);
    } else {
      // folded-over top, spilling a little grain
      s.hline(3, 4, 10, ramp[4]);
      s.hline(3, 5, 10, ramp[1]);
      for (let k = 0; k < 5; k++) s.px(4 + k * 2, 3, P.FLOWER_GOLD[1]);
    }
  }, { seed: 11640 + variant, shadow: W - 2, shadowY: H - 1, shadowH: 4 });
}

/** Woven baskets: empty, apples, cloth. */
function basket(variant: number): Surface {
  const W = 16, H = 14;
  return prop(W, H, (s, r) => {
    // body: tapered weave
    for (let j = 0; j < 8; j++) {
      const inset = Math.round(j * 0.35);
      for (let i = 2 + inset; i < W - 2 - inset; i++) {
        const u = (i - 2) / (W - 4);
        let idx = cylIndex(u);
        if ((i + j) % 3 === 0) idx = Math.max(0, idx - 1);      // weave
        if (j % 2 === 0 && (i + j) % 4 === 1) idx = Math.min(4, idx + 1);
        s.px(i, 5 + j, P.ROPE[idx]);
      }
    }
    // rim
    for (let i = 1; i < W - 1; i++) {
      s.px(i, 4, i % 2 ? P.ROPE[4] : P.ROPE[3]);
      s.px(i, 5, P.ROPE[1]);
    }
    s.hline(4, 12, W - 8, P.ROPE[0], 0.7);
    if (variant === 1) { // apples
      for (const [ax, ay] of [[4, 1], [8, 0], [11, 2], [6, 3]] as Array<[number, number]>) {
        s.ellipse(ax, ay + 1, 4, 4, P.FLOWER_ROSE[1]);
        s.px(ax + 1, ay + 2, P.FLOWER_ROSE[2]);
        s.px(ax + 2, ay + 1, P.FLOWER_ROSE[3]);
        s.px(ax + 1, ay, P.TREE_WARM[2]);
      }
    } else if (variant === 2) { // folded cloth
      s.ellipse(3, 1, 11, 5, P.LINEN[3]);
      s.ellipse(4, 1, 9, 3, P.LINEN[4]);
      s.hline(3, 4, 11, P.LINEN[1]);
      for (let k = 0; k < 4; k++) s.px(5 + k * 2, 2, P.CLOTH.mira[2]);
    } else {
      for (let k = 0; k < 6; k++) s.px(r.int(4, 11), r.int(4, 5), P.ROPE[0], 0.5);
    }
  }, { seed: 11650 + variant, shadow: 13, shadowY: 13, shadowH: 4 });
}

/** Courier parcels in four wrap colours — the delivery quest reads these by colour. */
function parcel(variant: number): Surface {
  const wraps: Ramp[] = [P.UI_PARCHMENT, P.ROOF_BLUE, P.ROOF_PLUM, P.ROOF_TEAL];
  const w = wraps[variant];
  const dims: Array<[number, number]> = [[16, 14], [14, 16], [18, 12], [15, 15]];
  const [W, H] = dims[variant];
  return prop(W, H, (s) => {
    const top = 4;
    for (let j = 0; j < top; j++) {
      const inset = top - 1 - j;
      for (let i = inset + 1; i < W - 1 - inset; i++) s.px(i, j + 1, j < 2 ? w[4] : w[3]);
    }
    s.rect(1, top + 1, W - 2, H - top - 3, w[2]);
    s.hline(1, top + 1, W - 2, w[3]);
    s.vline(1, top + 1, H - top - 3, w[3]);
    s.vline(W - 2, top + 1, H - top - 3, w[0]);
    s.hline(1, H - 3, W - 2, w[0]);
    // paper creases
    for (let j = top + 2; j < H - 3; j += 3) s.hline(2, j, W - 4, w[1], 0.4);
    // string cross + knot
    const cx = Math.floor(W / 2);
    s.vline(cx, 1, H - 3, P.ROPE[3]);
    s.vline(cx + 1, 1, H - 3, P.ROPE[0], 0.6);
    s.hline(1, top + Math.floor((H - top) / 2), W - 2, P.ROPE[3]);
    s.hline(1, top + Math.floor((H - top) / 2) + 1, W - 2, P.ROPE[0], 0.6);
    s.px(cx - 1, 2, P.ROPE[4]); s.px(cx + 2, 2, P.ROPE[2]);
    // wax seal / label
    s.px(cx - 2, top + 3, P.FLOWER_ROSE[0]);
    s.rect(cx - 3, top + 3, 3, 2, P.LANTERN[1]);
    s.px(cx - 3, top + 3, P.LANTERN[3]);
  }, { seed: 11660 + variant, shadow: W - 3, shadowY: H - 1, shadowH: 4 });
}

/** Stacked firewood, seen end-on. */
function woodpile(variant: number): Surface {
  const W = variant === 0 ? 30 : 22, H = variant === 0 ? 22 : 18;
  return prop(W, H, (s, r) => {
    const rows = variant === 0 ? 4 : 3;
    for (let row = rows - 1; row >= 0; row--) {
      const y = H - 4 - row * 4;
      const count = Math.floor((W - 4) / 5) - (row > 1 ? 1 : 0);
      const off = row % 2 ? 2 : 0;
      for (let k = 0; k < count; k++) {
        const x = 2 + off + k * 5;
        s.ellipse(x, y - 4, 5, 5, P.WOOD[1]);
        s.ellipse(x + 1, y - 3, 3, 3, P.WOOD_LIGHT[3]);
        s.px(x + 2, y - 2, P.WOOD_LIGHT[4]);
        s.ellipseOutline(x, y - 4, 5, 5, P.WOOD[0], 0.85);
        // ring
        s.px(x + 2, y - 3, P.WOOD_LIGHT[1]);
        if (r.chance(0.35)) s.px(x + 1, y - 1, P.MOSS[2]);
      }
    }
    // a couple of split logs leaning against the stack
    if (variant === 0) {
      for (let k = 0; k < 5; k++) { s.px(1 + k, H - 4 - k, P.WOOD[3]); s.px(1 + k, H - 3 - k, P.WOOD[1]); }
    }
  }, { seed: 11670 + variant, shadow: W - 4, shadowY: H - 1, shadowH: 5 });
}

function hayBale(): Surface {
  return prop(26, 20, (s, r) => {
    // cylinder lying down
    for (let j = 0; j < 13; j++) {
      const c = P.THATCH[cylIndex((j + 0.5) / 13)];
      for (let i = 0; i < 19; i++) {
        const bulge = Math.round(Math.sin((i / 18) * Math.PI) * 1.3);
        if (j < 1 - bulge || j > 12 + bulge) continue;
        s.px(4 + i, 4 + j, c);
      }
    }
    // straw texture
    for (let k = 0; k < 90; k++) {
      const x = r.int(4, 22), y = r.int(4, 16);
      if (!s.alphaAt(x, y)) continue;
      const dark = (x + y) > 26;
      s.px(x, y, dark ? P.THATCH[1] : P.THATCH[4]);
      if (r.chance(0.5)) s.px(x + 1, y, dark ? P.THATCH[0] : P.THATCH[3]);
    }
    // end face
    s.ellipse(1, 4, 6, 13, P.THATCH[2]);
    s.ellipse(2, 5, 5, 11, P.THATCH[3]);
    for (let k = 0; k < 22; k++) {
      const x = r.int(1, 6), y = r.int(4, 16);
      if (!s.alphaAt(x, y)) continue;
      s.px(x, y, r.chance(0.5) ? P.THATCH[4] : P.THATCH[1]);
    }
    // twine
    for (const x of [9, 18]) { s.vline(x, 3, 14, P.ROPE[1]); s.px(x, 5, P.ROPE[4]); }
    // loose straw at the base
    for (let k = 0; k < 10; k++) { const x = r.int(2, 24); s.px(x, 17 + r.int(0, 1), P.THATCH[3]); }
  }, { seed: 11680, shadow: 22, shadowY: 19, shadowH: 5 });
}

function milkChurn(): Surface {
  return prop(16, 24, (s) => {
    const m = P.STONE_WALL; // tinned steel: bright enough to read on grass
    cylBody(s, 3, 9, 10, 12, m);
    // shoulder taper
    for (let j = 0; j < 5; j++) {
      const w = 6 + j;
      const x0 = 3 + Math.round((10 - w) / 2);
      for (let i = 0; i < w; i++) s.px(x0 + i, 4 + j, m[cylIndex((i + 0.5) / w)]);
    }
    topFace(s, 5, 1, 6, 4, m);
    s.hline(5, 3, 6, m[0], 0.6);
    // bands + side handles
    for (const y of [12, 18]) { s.hline(3, y, 10, m[4], 0.8); s.hline(3, y + 1, 10, P.IRON[1], 0.8); }
    for (const [hx, dir] of [[2, -1], [13, 1]] as Array<[number, number]>) {
      s.px(hx, 10, P.IRON[3]); s.px(hx + dir, 11, P.IRON[2]); s.px(hx, 12, P.IRON[1]);
    }
    s.vline(5, 9, 12, m[4], 0.6);
    s.vline(11, 9, 12, m[0], 0.7);
    s.ellipse(3, 20, 10, 3, m[0], 0.45);
  }, { seed: 11690, shadow: 13, shadowY: 23, shadowH: 4 });
}

/** Washing on a line — drawn as an `over` sprite so the player walks behind it. */
function laundryLine(variant: number): Surface {
  const W = 48, H = 26;
  return prop(W, H, (s, r) => {
    // rope with a sag
    for (let x = 0; x < W; x++) {
      const y = 3 + Math.round(Math.sin((x / (W - 1)) * Math.PI) * 2);
      s.px(x, y, P.ROPE[3]);
      s.px(x, y + 1, P.ROPE[0], 0.7);
    }
    const sets: Array<Array<[number, number, number, Ramp]>> = [
      [[3, 9, 12, P.LINEN], [17, 11, 14, P.CLOTH.mira], [33, 8, 11, P.CLOTH.nia]],
      [[5, 12, 15, P.CLOTH.cream], [22, 9, 12, P.LINEN], [36, 10, 10, P.CLOTH.oren]],
      [[2, 8, 10, P.CLOTH.sera], [14, 13, 13, P.LINEN], [30, 10, 16, P.CLOTH.tavi]],
    ];
    for (const [x0, w, h, ramp] of sets[variant]) {
      const topY = 4 + Math.round(Math.sin((x0 / (W - 1)) * Math.PI) * 2);
      // pegs
      s.px(x0 + 1, topY - 1, P.WOOD[3]);
      s.px(x0 + w - 2, topY - 1, P.WOOD[3]);
      for (let j = 0; j < h; j++) {
        const flare = Math.round((j / h) * 2);
        for (let i = -flare; i < w + flare; i++) {
          const u = (i + flare) / (w + flare * 2);
          let idx = u < 0.15 ? 3 : u < 0.3 ? 4 : u < 0.65 ? 3 : u < 0.85 ? 2 : 1;
          if (j > h - 3) idx = Math.max(0, idx - 1);
          s.px(x0 + i, topY + j, ramp[idx]);
        }
      }
      // folds
      for (let k = 0; k < 3; k++) {
        const fx = x0 + 2 + k * Math.floor(w / 3);
        for (let j = 2; j < h - 1; j++) if (r.chance(0.7)) s.px(fx, topY + j, ramp[1], 0.55);
      }
      // hem
      s.hline(x0 - 2, topY + h - 1, w + 4, ramp[0], 0.7);
    }
  }, { seed: 11700 + variant, shadow: false });
}

function birdbath(): Surface {
  return prop(20, 26, (s, r) => {
    const st = P.COBBLE;
    s.ellipse(3, 20, 14, 5, st[1]);
    s.ellipse(3, 19, 14, 5, st[2]);
    cylBody(s, 8, 10, 4, 10, st);
    s.rect(7, 9, 6, 2, st[3]);
    topFace(s, 2, 4, 16, 7, st);
    s.ellipseOutline(2, 4, 16, 7, st[4], 0.8);
    s.ellipse(4, 5, 12, 5, P.WATER[2]);
    s.ellipse(5, 5, 10, 4, P.WATER[3]);
    s.ellipseOutline(4, 5, 12, 5, P.WATER[1], 0.7);
    s.px(7, 6, P.WATER_FOAM, 0.8); s.px(11, 7, P.WATER[4], 0.7);
    for (let k = 0; k < 8; k++) s.pxOver(r.int(3, 16), r.int(16, 20), P.MOSS[r.int(1, 3)], 0.8);
  }, { seed: 11710, shadow: 16, shadowY: 25, shadowH: 5 });
}

function beehive(): Surface {
  return prop(18, 22, (s, r) => {
    // straw skep: stacked coils
    for (let k = 0; k < 5; k++) {
      const w = 14 - Math.abs(k - 1) * 2 - (k > 2 ? (k - 2) * 2 : 0);
      const x0 = Math.round((18 - w) / 2);
      const y = 17 - k * 3;
      for (let j = 0; j < 3; j++) {
        for (let i = 0; i < w; i++) {
          const u = (i + 0.5) / w;
          let idx = cylIndex(u);
          if (j === 0) idx = Math.min(4, idx + 1);
          if (j === 2) idx = Math.max(0, idx - 1);
          s.px(x0 + i, y + j, P.THATCH[idx]);
        }
      }
      for (let i = 0; i < w; i += 2) s.px(x0 + i, y + 1, P.THATCH[1], 0.5);
    }
    s.px(9, 3, P.THATCH[4]); s.px(8, 3, P.THATCH[3]);
    // entrance
    s.rect(7, 15, 4, 3, P.OUTLINE);
    s.hline(7, 15, 4, P.THATCH[0]);
    s.px(8, 16, P.THATCH[1], 0.5);
    // bees
    for (const [bx, by] of [[3, 8], [14, 11], [12, 5]] as Array<[number, number]>) {
      s.px(bx, by, P.FLOWER_GOLD[2]);
      s.px(bx + 1, by, P.OUTLINE);
      s.px(bx, by - 1, P.LINEN[4], 0.6);
    }
    for (let k = 0; k < 10; k++) s.pxOver(r.int(2, 15), r.int(4, 18), P.THATCH[0], 0.35);
  }, { seed: 11720, shadow: 15, shadowY: 21, shadowH: 4 });
}

function scarecrow(): Surface {
  return prop(24, 38, (s, r) => {
    // post + crossbar
    s.rect(11, 12, 3, 24, P.WOOD[2]);
    s.vline(11, 12, 24, P.WOOD[3]);
    s.vline(13, 12, 24, P.WOOD[0]);
    s.hline(2, 16, 20, P.WOOD[3]);
    s.hline(2, 17, 20, P.WOOD[2]);
    s.hline(2, 18, 20, P.WOOD[0]);
    // straw hands
    for (const x of [1, 21]) for (let k = 0; k < 4; k++) s.px(x + (x < 10 ? -0 : 0) + (x < 10 ? k - 1 : k - 1), 15 + k % 2, P.THATCH[3]);
    // shirt
    for (let j = 0; j < 14; j++) {
      const w = 16 - Math.round(j * 0.3);
      const x0 = Math.round((24 - w) / 2);
      for (let i = 0; i < w; i++) {
        const u = (i + 0.5) / w;
        s.px(x0 + i, 14 + j, P.CLOTH.mira[u < 0.2 ? 3 : u < 0.35 ? 4 : u < 0.7 ? 2 : u < 0.86 ? 1 : 0]);
      }
    }
    // patches + straw poking out
    s.rect(9, 22, 4, 3, P.CLOTH.oren[2]);
    s.rectOutline(9, 22, 4, 3, P.CLOTH.oren[0], 0.7);
    for (let k = 0; k < 10; k++) {
      const x = r.int(5, 19), y = 27 + r.int(0, 2);
      s.px(x, y, P.THATCH[3]); s.px(x, y + 1, P.THATCH[1]);
    }
    // sack head
    s.ellipse(7, 2, 10, 11, P.UI_PARCHMENT[2]);
    for (let j = 2; j < 13; j++) for (let i = 7; i < 17; i++) {
      if (!s.alphaAt(i, j)) continue;
      const u = (i - 7) / 10, v = (j - 2) / 11;
      const d = -(u - 0.42) * 0.7 - (v - 0.42) * 0.9;
      s.px(i, j, d > 0.4 ? P.UI_PARCHMENT[4] : d > 0.1 ? P.UI_PARCHMENT[3] : d > -0.25 ? P.UI_PARCHMENT[2] : P.UI_PARCHMENT[1]);
    }
    // stitched face — two crosses and a seam, no expression subtleties needed
    s.px(9, 6, P.OUTLINE); s.px(10, 7, P.OUTLINE); s.px(10, 5, P.OUTLINE);
    s.px(14, 6, P.OUTLINE); s.px(13, 7, P.OUTLINE); s.px(13, 5, P.OUTLINE);
    for (let i = 9; i < 15; i++) s.px(i, 10, P.OUTLINE, 0.8);
    s.px(11, 11, P.OUTLINE, 0.6); s.px(13, 11, P.OUTLINE, 0.6);
    // hat
    for (let k = 0; k < 3; k++) s.hline(8 + k, 1 + k - 1, 8 - k * 2, P.THATCH[3 - k]);
    s.hline(4, 3, 16, P.THATCH[4]);
    s.hline(4, 4, 16, P.THATCH[2]);
    s.hline(5, 5, 14, P.THATCH[0], 0.8);
  }, { seed: 11730, shadow: 16, shadowY: 37, shadowH: 5 });
}

/** Carved stone lantern — the town's quiet nod to the shrine. */
function stoneLantern(): Surface {
  return prop(16, 26, (s, r) => {
    const st = P.SHRINE_STONE;
    s.ellipse(2, 21, 12, 4, st[1]);
    s.ellipse(2, 20, 12, 4, st[2]);
    cylBody(s, 6, 13, 4, 8, st);
    s.rect(4, 11, 8, 3, st[2]);
    s.hline(4, 11, 8, st[4]);
    s.hline(4, 13, 8, st[0]);
    // light chamber
    s.rect(3, 5, 10, 6, st[2]);
    s.hline(3, 5, 10, st[4]);
    s.vline(3, 5, 6, st[3]);
    s.vline(12, 5, 6, st[0]);
    s.rect(5, 6, 6, 4, P.LANTERN[2]);
    s.rect(6, 7, 4, 2, P.LANTERN[4]);
    s.vline(8, 6, 4, P.SHRINE_STONE[0], 0.6);
    // roof
    for (let k = 0; k < 4; k++) s.hline(1 + k, 1 + k, 14 - k * 2, k === 0 ? st[4] : k < 2 ? st[3] : st[2]);
    s.hline(1, 5, 14, st[0], 0.8);
    s.px(8, 0, st[3]);
    for (let k = 0; k < 8; k++) s.pxOver(r.int(2, 13), r.int(16, 21), P.MOSS[r.int(1, 3)], 0.75);
  }, { seed: 11740, shadow: 13, shadowY: 25, shadowH: 4 });
}

function bridgePost(): Surface {
  return prop(12, 22, (s) => {
    s.rect(3, 4, 6, 16, P.WOOD[2]);
    s.vline(3, 4, 16, P.WOOD[3]);
    s.vline(4, 4, 16, P.WOOD[4]);
    s.vline(8, 4, 16, P.WOOD[0]);
    for (let j = 5; j < 20; j += 3) s.px(6, j, P.WOOD[1], 0.6);
    // chamfered cap
    s.hline(2, 3, 8, P.WOOD[3]);
    s.hline(3, 2, 6, P.WOOD[4]);
    s.hline(2, 4, 8, P.WOOD[0], 0.6);
    // rope loop
    for (let k = 0; k < 4; k++) { s.px(1, 8 + k, P.ROPE[2]); s.px(10, 9 + k, P.ROPE[1]); }
    s.hline(1, 8, 10, P.ROPE[3]);
    s.hline(1, 9, 10, P.ROPE[0], 0.6);
  }, { seed: 11750, shadow: 10, shadowY: 21, shadowH: 4 });
}

/** Wet rocks that sit in the shallows. */
function riverRock(variant: number): Surface {
  const dims: Array<[number, number]> = [[14, 9], [17, 11], [12, 8]];
  const [W, H] = dims[variant];
  return prop(W, H, (s, r) => {
    s.ellipse(1, 1, W - 2, H - 3, P.COBBLE[2]);
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        if (!s.alphaAt(i, j)) continue;
        const u = (i - 1) / (W - 2) - 0.45, v = (j - 1) / (H - 3) - 0.45;
        const d = -(u * 0.6 + v * 0.85);
        s.px(i, j, d > 0.42 ? P.COBBLE[4] : d > 0.12 ? P.COBBLE[3] : d > -0.2 ? P.COBBLE[2] : d > -0.5 ? P.COBBLE[1] : P.COBBLE[0]);
      }
    }
    speckle(s, r, 1, 1, W - 2, H - 3, P.COBBLE[0], 4, 0.4);
    // a wet gleam and a waterline
    s.hline(2, 2, 3, P.COBBLE[4], 0.7);
    for (let i = 1; i < W - 1; i++) s.pxOver(i, H - 4, P.WATER[1], 0.35);
  }, { seed: 11760 + variant, shadow: W - 3, shadowY: H - 1, shadowH: 3, alpha: 0.22 });
}

/** A short jetty for the riverbank. */
function jetty(): Surface {
  return prop(32, 26, (s, r) => {
    // deck
    for (let j = 0; j < 12; j++) {
      for (let i = 2; i < 30; i++) {
        const v = valueNoise(11770)(i, j, 3.0);
        s.px(i, 6 + j, v > 0.66 ? P.WOOD[3] : v < 0.3 ? P.WOOD[1] : P.WOOD[2]);
      }
    }
    for (let j = 0; j < 12; j += 3) {
      s.hline(2, 6 + j, 28, P.WOOD[0], 0.7);
      s.hline(2, 7 + j, 28, P.WOOD[4], 0.3);
    }
    s.hline(2, 6, 28, P.WOOD[4]);
    s.hline(2, 17, 28, P.WOOD[0]);
    s.vline(2, 6, 12, P.WOOD[3]);
    s.vline(29, 6, 12, P.WOOD[0]);
    // posts through the deck
    for (const x of [4, 26]) {
      s.rect(x, 2, 3, 20, P.WOOD[2]);
      s.vline(x, 2, 20, P.WOOD[3]);
      s.vline(x + 2, 2, 20, P.WOOD[0]);
      s.hline(x, 2, 3, P.WOOD[4]);
      for (let k = 0; k < 4; k++) s.px(x + 1, 18 + k, P.MOSS[1]);
    }
    // rope between the posts
    for (let x = 6; x < 26; x++) {
      const y = 5 + Math.round(Math.sin(((x - 6) / 20) * Math.PI) * 2);
      s.px(x, y, P.ROPE[3]);
      s.px(x, y + 1, P.ROPE[0], 0.6);
    }
    // waterline stains
    for (let k = 0; k < 10; k++) s.pxOver(r.int(3, 28), r.int(15, 17), P.WATER[0], 0.3);
  }, { seed: 11780, shadow: 26, shadowY: 25, shadowH: 5, alpha: 0.25 });
}

function gravestone(variant: number): Surface {
  const W = 16, H = 20;
  return prop(W, H, (s, r) => {
    const st = P.STONE_WALL;
    const lean = variant === 1 ? 1 : 0;
    if (variant === 0) {
      s.rect(3, 4, 10, 13, st[2]);
      s.ellipse(3, 1, 10, 8, st[2]);
    } else {
      s.rect(3 + lean, 5, 9, 12, st[2]);
      s.hline(3 + lean, 4, 9, st[2]);
    }
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        if (!s.alphaAt(i, j)) continue;
        const u = (i - 3) / 10;
        let idx = cylIndex(u);
        const v = valueNoise(11790 + variant)(i, j, 3.2);
        if (v > 0.72) idx = Math.min(4, idx + 1);
        else if (v < 0.3) idx = Math.max(0, idx - 1);
        s.px(i, j, st[idx]);
      }
    }
    // carved band
    s.hline(4 + lean, 8, 8, st[0], 0.6);
    s.hline(4 + lean, 9, 8, st[4], 0.35);
    s.hline(5 + lean, 12, 6, st[0], 0.5);
    // moss and chips
    for (let k = 0; k < 10; k++) s.pxOver(r.int(3, 12), r.int(12, 17), P.MOSS[r.int(1, 3)], 0.8);
    s.px(12, 6, P.OUTLINE, 0);
    // grass tufts at the foot
    for (const x of [2, 12]) { s.px(x, 17, P.GRASS[3]); s.px(x, 16, P.GRASS[4]); }
  }, { seed: 11795 + variant, shadow: 12, shadowY: 19, shadowH: 4 });
}

/** A tiny roadside memorial: stone, offering bowl, a lit candle. */
function shrineSmall(): Surface {
  return prop(22, 28, (s, r) => {
    const st = P.SHRINE_STONE;
    // plinth
    s.rect(2, 20, 18, 5, st[2]);
    s.hline(2, 20, 18, st[4]);
    s.hline(2, 24, 18, st[0]);
    s.vline(2, 20, 5, st[3]);
    s.vline(19, 20, 5, st[0]);
    // body
    s.rect(5, 8, 12, 12, st[2]);
    s.vline(5, 8, 12, st[3]);
    s.vline(6, 8, 12, st[4]);
    s.vline(16, 8, 12, st[0]);
    // niche with a carved mark
    s.rect(8, 11, 6, 7, st[0]);
    s.rect(9, 12, 4, 5, P.SHRINE_TRIM[1]);
    s.px(11, 13, P.SHRINE_TRIM[4]); s.px(10, 14, P.SHRINE_TRIM[3]); s.px(12, 14, P.SHRINE_TRIM[3]);
    s.px(11, 15, P.SHRINE_TRIM[3]);
    // roof
    for (let k = 0; k < 4; k++) s.hline(2 + k, 4 + k, 18 - k * 2, k === 0 ? st[4] : k < 2 ? st[3] : st[2]);
    s.hline(2, 8, 18, st[0], 0.8);
    // offerings: a bowl and a candle
    s.ellipse(3, 17, 5, 3, P.TERRACOTTA[2]);
    s.ellipse(3, 16, 5, 3, P.TERRACOTTA[3]);
    s.rect(16, 15, 2, 4, P.LINEN[3]);
    s.px(16, 14, P.LANTERN[3]); s.px(16, 13, P.LANTERN[4]);
    for (let k = 0; k < 8; k++) s.pxOver(r.int(2, 19), r.int(21, 24), P.MOSS[r.int(1, 3)], 0.8);
    // a couple of flowers left at the foot
    bloom(s, 6, 24, P.FLOWER_WHITE, r);
    bloom(s, 14, 25, P.FLOWER_ROSE, r);
  }, { seed: 11800, shadow: 18, shadowY: 27, shadowH: 5 });
}

/** Quest One's hand bell. Frame -1 is the resting sprite; 0..2 shake. */
function bellSmall(frame: number): Surface {
  const W = 14, H = 16;
  const tilt = frame < 0 ? 0 : [0, -1, 1][frame];
  return prop(W, H, (s) => {
    const cx = 6 + tilt;
    // handle
    s.rect(cx, 1, 2, 4, P.WOOD[2]);
    s.px(cx, 1, P.WOOD[4]);
    s.px(cx + 1, 4, P.WOOD[0]);
    s.px(cx - 1, 2, P.WOOD[3]);
    // bell body: a bell-shaped taper
    for (let j = 0; j < 8; j++) {
      const w = 4 + Math.round(Math.pow(j / 7, 1.5) * 6);
      const x0 = cx + 1 - Math.floor(w / 2);
      for (let i = 0; i < w; i++) {
        const u = (i + 0.5) / w;
        s.px(x0 + i, 5 + j, P.BRONZE[cylIndex(u)]);
      }
    }
    // flared lip
    const lipW = 12;
    const lipX = cx + 1 - Math.floor(lipW / 2);
    for (let i = 0; i < lipW; i++) {
      const u = (i + 0.5) / lipW;
      s.px(lipX + i, 13, P.BRONZE[Math.min(4, cylIndex(u) + 1)]);
      s.px(lipX + i, 14, P.BRONZE[0]);
    }
    // specular band + clapper
    s.px(cx - 1, 7, P.BRONZE[4]); s.px(cx - 1, 8, P.BRONZE[4]);
    s.px(cx + 3, 10, P.BRONZE[1]);
    s.px(cx + 1 + (frame > 0 ? tilt * 2 : 0), 14, P.BRONZE[0]);
    if (frame > 0) {
      // motion ticks
      const d = frame === 1 ? -1 : 1;
      s.px(cx + d * 7, 8, P.LINEN[3], 0.6);
      s.px(cx + d * 8, 10, P.LINEN[2], 0.45);
    }
  }, { seed: 11810, shadow: 10, shadowY: 15, shadowH: 3 });
}

// ── registration ───────────────────────────────────────────────────────────

export function registerProps(b: ArtBuild): void {
  // ── vegetation ──
  for (let i = 0; i < 4; i++) b.add(`prop/town/tree_oak_${i}`, oakTree(i));
  for (let i = 0; i < 3; i++) b.add(`prop/town/tree_pine_${i}`, pineTree(i));
  for (let i = 0; i < 2; i++) b.add(`prop/town/tree_blossom_${i}`, blossomTree(i));
  b.add('prop/town/tree_stump', stump());
  for (let i = 0; i < 2; i++) b.add(`prop/town/log_${i}`, log(i));
  for (let i = 0; i < 2; i++) b.add(`prop/town/sapling_${i}`, sapling(i));
  for (let i = 0; i < 4; i++) b.add(`prop/town/bush_${i}`, bush(i));
  b.add('prop/town/hedge_mid', hedge('mid'));
  b.add('prop/town/hedge_end_l', hedge('end_l'));
  b.add('prop/town/hedge_end_r', hedge('end_r'));
  b.add('prop/town/hedge_corner', hedge('corner'));
  for (let i = 0; i < 3; i++) b.add(`prop/town/flowerbed_${i}`, flowerbed(i));
  for (let i = 0; i < 2; i++) b.add(`prop/town/planter_${i}`, planter(i));
  b.add('prop/town/window_box', windowBox());
  for (let i = 0; i < 3; i++) b.add(`prop/town/reeds_${i}`, reeds(i));
  for (let i = 0; i < 2; i++) b.add(`prop/town/lilypad_${i}`, lilypad(i));
  for (let i = 0; i < 4; i++) b.add(`prop/town/rock_${i}`, rock(i));
  for (let i = 0; i < 2; i++) b.add(`prop/town/mossy_rock_${i}`, mossyRock(i));
  for (let i = 0; i < 3; i++) b.add(`prop/town/vegetable_row_${i}`, vegetableRow(i));

  // ── town furniture & structures ──
  b.addStrip('prop/town/fountain', [0, 1, 2, 3].map(fountain), { key: 'fountain_idle', frameRate: 6, repeat: -1 });
  b.add('prop/town/fountain', fountain(0));
  b.add('prop/town/notice_board', noticeBoard());
  for (let i = 0; i < 2; i++) b.add(`prop/town/bench_${i}`, bench(i));
  b.add('prop/town/picnic_table', picnicTable());
  b.add('prop/town/table_round', tableRound());
  for (let i = 0; i < 2; i++) b.add(`prop/town/chair_${i}`, chair(i));
  b.add('prop/town/stool', stool());
  b.add('prop/town/well', well());
  b.add('prop/town/water_trough', waterTrough());
  b.add('prop/town/pump', pump());
  b.add('prop/town/lamppost', lamppost(null));
  b.addStrip('prop/town/lamppost_lit', [0, 1, 2].map(lamppost), { key: 'lamppost_flicker', frameRate: 5, repeat: -1 });
  for (let i = 0; i < 3; i++) b.add(`prop/town/signpost_${i}`, signpost(i));
  b.add('prop/town/cart', cart());
  b.add('prop/town/wheelbarrow', wheelbarrow());
  for (let i = 0; i < 3; i++) b.add(`prop/town/crate_${i}`, crate(i));
  for (let i = 0; i < 2; i++) b.add(`prop/town/barrel_${i}`, barrel(i));
  for (let i = 0; i < 2; i++) b.add(`prop/town/sack_${i}`, sack(i));
  for (let i = 0; i < 3; i++) b.add(`prop/town/basket_${i}`, basket(i));
  for (let i = 0; i < 4; i++) b.add(`prop/town/parcel_${i}`, parcel(i));
  for (let i = 0; i < 2; i++) b.add(`prop/town/woodpile_${i}`, woodpile(i));
  b.add('prop/town/hay_bale', hayBale());
  b.add('prop/town/milk_churn', milkChurn());
  for (let i = 0; i < 3; i++) b.add(`prop/town/laundry_line_${i}`, laundryLine(i));
  b.add('prop/town/birdbath', birdbath());
  b.add('prop/town/beehive', beehive());
  b.add('prop/town/scarecrow', scarecrow());
  b.add('prop/town/stone_lantern', stoneLantern());
  b.add('prop/town/bridge_post', bridgePost());
  for (let i = 0; i < 3; i++) b.add(`prop/town/river_rock_${i}`, riverRock(i));
  b.add('prop/town/jetty', jetty());
  for (let i = 0; i < 2; i++) b.add(`prop/town/gravestone_${i}`, gravestone(i));
  b.add('prop/town/shrine_small', shrineSmall());
  b.add('prop/town/bell_small', bellSmall(-1));
  b.addStrip('prop/town/bell_small_ring', [0, 1, 2].map(bellSmall), { key: 'bell_small_ring', frameRate: 12, repeat: -1 });
}
