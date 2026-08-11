/**
 * WHISPER WOODS — the cool, quiet zone between Lumen Vale and the Echo Shrine.
 *
 * The woods are a *pacing* area: three to five minutes of walking, a little
 * combat, a couple of secrets. So the art has one job above all others —
 * the player must always know at a glance where the path is, what blocks it,
 * and what is worth touching.
 *
 * How the woods differ from town (this is the whole brief in four lines):
 *   - hue, not brightness. Greens lose their yellow, bark goes violet-grey,
 *     water goes teal. Nothing is simply "the town, darker".
 *   - contrast goes UP between materials and DOWN inside them. The trail is a
 *     pale ribbon on a dark floor; the floor itself is calmer than town grass.
 *   - the canopy closes overhead: `over`-layer foliage the player walks under.
 *   - light is scarce and therefore compositional — lantern posts and the
 *     holes in the canopy are the only warm/bright things in a frame.
 *
 * Layering contract (shared with terrain.ts):
 *   layer 0 "ground"  — woods grass / soil / leaf litter / shrine flagstone
 *   layer 1 "detail"  — blob overlays: woods_path, woods_moss, woods_water,
 *                       woods_bramble, and the cliff set
 *   layer 2 "scatter" — small non-colliding decoration
 *   layer 3 "over"    — canopy patches, hanging vines, mist
 *
 * House style, unchanged: light from the upper-left, no pure black, scenery
 * rimmed on its lower-right only, every prop on a contact shadow.
 */
import { Surface, rng, valueNoise, speckle, type Rng } from '../lib/pixel.js';
import { ArtBuild, TILE } from '../lib/registry.js';
import { registerBlobSet, edgePixels } from '../lib/autotile.js';
import * as P from '../lib/palette.js';

type Ramp = readonly string[];

// ── shared helpers ─────────────────────────────────────────────────────────

/** Mottled flat fill: base with organic patches of the neighbouring ramp steps. */
function mottle(s: Surface, ramp: Ramp, seed: number, opts: {
  x?: number; y?: number; w?: number; h?: number;
  scale?: number; lightAmt?: number; darkAmt?: number;
} = {}) {
  const { x = 0, y = 0, w = s.w, h = s.h, scale = 3.2, lightAmt = 0.66, darkAmt = 0.32 } = opts;
  const n1 = valueNoise(seed);
  const n2 = valueNoise(seed + 991);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const v = n1(x + i, y + j, scale) * 0.65 + n2(x + i, y + j, scale * 2.6) * 0.35;
      let c = ramp[2];
      if (v > lightAmt + 0.16) c = ramp[4];
      else if (v > lightAmt) c = ramp[3];
      else if (v < darkAmt - 0.14) c = ramp[0];
      else if (v < darkAmt) c = ramp[1];
      s.px(x + i, y + j, c);
    }
  }
}

/** Squashed contact shadow, painted *behind* whatever is already on the surface. */
function contact(
  s: Surface, cx: number, baseY: number, w: number,
  h = Math.max(3, Math.round(w * 0.32)), alpha = 0.32,
) {
  const sh = new Surface(s.w, s.h);
  sh.ellipse(Math.round(cx - w / 2), Math.round(baseY - h + 1), w, h, P.OUTLINE, alpha);
  s.blitBehind(sh);
}

/** Dark rim on the lower and right edges only — never a full outline on scenery. */
function rim(s: Surface, color = P.OUTLINE, alpha = 1): Surface {
  const src = s.clone();
  for (let j = 0; j < s.h; j++) {
    for (let i = 0; i < s.w; i++) {
      if (src.alphaAt(i, j) !== 0) continue;
      if (src.alphaAt(i, j - 1) > 128 || src.alphaAt(i - 1, j) > 128) s.px(i, j, color, alpha);
    }
  }
  return s;
}

/** Erase everything inside an ellipse (masks are built additively, then bitten). */
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

// ── foliage construction ───────────────────────────────────────────────────

interface Clump { x: number; y: number; rx: number; ry: number; bias?: number }

/**
 * WOODS_BARK slid one step darker.
 *
 * The full ramp's light end is a pale violet-grey that belongs on dead,
 * barkless timber. On a living forest trunk it reads as poured concrete and,
 * worse, makes the trunk the brightest object in a dark frame — which is a lie
 * about where the player should be looking. Living trunks get this; the dead
 * trees keep the pale ramp, where it is the whole point.
 */
const LIVE_BARK: Ramp = [
  P.WOODS_BARK[0], P.WOODS_BARK[0], P.WOODS_BARK[1], P.WOODS_BARK[2], P.WOODS_BARK[3],
];

/**
 * One leaf mass: an ellipse whose rim is broken by small blobs and bitten by a
 * few notches. Nothing in a forest is a smooth balloon, and a smooth balloon is
 * exactly what a generated canopy defaults to.
 */
function clumpMask(w: number, h: number, c: Clump, r: Rng, bumps = 11, bites = 4): Surface {
  const m = new Surface(w, h);
  m.ellipse(Math.round(c.x - c.rx), Math.round(c.y - c.ry), Math.round(c.rx * 2), Math.round(c.ry * 2), '#ffffff');
  for (let i = 0; i < bumps; i++) {
    const a = (i / bumps) * Math.PI * 2 + r.range(-0.35, 0.35);
    const br = r.range(1.8, 4.0);
    const px = c.x + Math.cos(a) * (c.rx - br * 0.3);
    const py = c.y + Math.sin(a) * (c.ry - br * 0.3);
    m.ellipse(Math.round(px - br), Math.round(py - br), Math.round(br * 2), Math.round(br * 2), '#ffffff');
  }
  for (let i = 0; i < bites; i++) {
    const a = r.range(0, Math.PI * 2);
    const br = r.range(1.8, 3.4);
    const px = c.x + Math.cos(a) * (c.rx + br * 0.3);
    const py = c.y + Math.sin(a) * (c.ry + br * 0.3);
    eraseEllipse(m, Math.round(px - br), Math.round(py - br), Math.round(br * 2), Math.round(br * 2));
  }
  return m;
}

/** Dome-shade one leaf mass, creasing it against whatever is already behind it. */
function paintClump(
  s: Surface, c: Clump, ramp: Ramp, sun: string, seed: number, r: Rng,
  opts: { bumps?: number; bites?: number; noise?: number; flat?: number } = {},
) {
  const m = clumpMask(s.w, s.h, c, r, opts.bumps ?? 11, opts.bites ?? 4);
  // crease: a dark ring where this mass overlaps one already painted
  const ring = dilate(dilate(m));
  for (let j = 0; j < s.h; j++) {
    for (let i = 0; i < s.w; i++) {
      if (!ring.alphaAt(i, j) || m.alphaAt(i, j)) continue;
      s.pxOver(i, j, ramp[0], 0.8);
    }
  }
  const n = valueNoise(seed);
  const n2 = valueNoise(seed + 77);
  const amp = opts.noise ?? 0.3;
  const dome = opts.flat ?? 0.36;
  for (let j = 0; j < s.h; j++) {
    for (let i = 0; i < s.w; i++) {
      if (!m.alphaAt(i, j)) continue;
      const ox = (i - c.x) / c.rx;
      const oy = (j - c.y) / c.ry;
      const lit = -(ox * 0.56 + oy * 0.83); // upper-left
      const grain = (n(i, j, 2.6) * 0.65 + n2(i, j, 1.3) * 0.35 - 0.5) * amp;
      const v = 0.5 + lit * dome + (c.bias ?? 0) + grain;
      let col: string;
      if (v > 0.95) col = sun;
      else if (v > 0.80) col = ramp[4];
      else if (v > 0.60) col = ramp[3];
      else if (v > 0.40) col = ramp[2];
      else if (v > 0.22) col = ramp[1];
      else col = ramp[0];
      s.px(i, j, col);
    }
  }
}

/** Darken the underside of a leaf mass: the last rows of every column go dark. */
function canopyUnderside(s: Surface, ramp: Ramp) {
  const src = s.clone();
  for (let j = 0; j < s.h; j++) {
    for (let i = 0; i < s.w; i++) {
      if (!src.alphaAt(i, j)) continue;
      if (!src.alphaAt(i, j + 1)) s.px(i, j, ramp[0], 0.9);
      else if (!src.alphaAt(i, j + 2)) s.px(i, j, ramp[0], 0.55);
      else if (!src.alphaAt(i, j + 3)) s.px(i, j, ramp[1], 0.5);
    }
  }
}

/** Individual leaves poking off the silhouette so the outline stays ragged. */
function leafFringe(s: Surface, ramp: Ramp, sun: string, r: Rng, count: number) {
  const src = s.clone();
  const edge: Array<[number, number]> = [];
  for (let j = 1; j < s.h - 1; j++) {
    for (let i = 1; i < s.w - 1; i++) {
      if (!src.alphaAt(i, j)) continue;
      if (!src.alphaAt(i - 1, j) || !src.alphaAt(i + 1, j) || !src.alphaAt(i, j - 1) || !src.alphaAt(i, j + 1)) {
        edge.push([i, j]);
      }
    }
  }
  if (!edge.length) return;
  for (let k = 0; k < count; k++) {
    const [ex, ey] = edge[r.int(0, edge.length - 1)];
    const dx = src.alphaAt(ex - 1, ey) ? 1 : src.alphaAt(ex + 1, ey) ? -1 : 0;
    const dy = src.alphaAt(ex, ey - 1) ? 1 : -1;
    const lit = ey < s.h * 0.45 && dx <= 0;
    const c1 = lit ? ramp[4] : ramp[2];
    const c2 = lit ? sun : ramp[3];
    s.px(ex, ey, c2);
    s.px(ex + dx, ey, c1);
    if (r.chance(0.55)) s.px(ex + dx, ey + dy, c1);
    if (r.chance(0.35)) s.px(ex + dx * 2, ey + dy, ramp[2]);
  }
}

/**
 * Punch dappled light holes through a leaf mass.
 *
 * This is what turns an over-layer canopy from "a green rectangle stuck to the
 * screen" into "foliage you are standing under" — the ground shows through it.
 *
 * The first attempt rimmed every hole all the way round and the canopy came out
 * covered in bright green doughnuts. A hole has to obey the same light as
 * everything else: the leaves on its upper-left lip catch the sun, the ones on
 * the lower-right lip fall into shade. Ringing it evenly is what reads as a
 * decal. Holes are also built from two overlapping bites, never one ellipse,
 * so their edges are as ragged as the silhouette's.
 */
function lightHoles(s: Surface, r: Rng, count: number, ramp: Ramp, sun: string, maxR = 2.6) {
  for (let k = 0; k < count; k++) {
    // find an interior pixel: one with foliage well clear on all four sides
    let hx = -1, hy = -1;
    for (let tries = 0; tries < 40; tries++) {
      const x = r.int(2, s.w - 3), y = r.int(2, s.h - 4);
      if (
        s.alphaAt(x, y) && s.alphaAt(x - 3, y) && s.alphaAt(x + 3, y) &&
        s.alphaAt(x, y - 3) && s.alphaAt(x, y + 3)
      ) { hx = x; hy = y; break; }
    }
    if (hx < 0) continue;
    const rad = r.range(0.9, maxR);
    const w = Math.max(1, Math.round(rad * 2));
    const h = Math.max(1, Math.round(rad * (r.chance(0.5) ? 1.5 : 1.1)));
    eraseEllipse(s, hx - Math.round(w / 2), hy - Math.round(h / 2), w, h);
    if (r.chance(0.7)) {
      const w2 = Math.max(1, w - 1), h2 = Math.max(1, h - 1);
      eraseEllipse(s, hx - Math.round(w2 / 2) + r.int(-2, 2), hy - Math.round(h2 / 2) + r.int(-2, 2), w2, h2);
    }
    // Directional lip: lit on the upper-left of the opening, shaded opposite.
    for (let j = -3; j <= h + 2; j++) {
      for (let i = -3; i <= w + 2; i++) {
        const x = hx - Math.round(w / 2) + i, y = hy - Math.round(h / 2) + j;
        if (!s.alphaAt(x, y)) continue;
        const openR = !s.alphaAt(x + 1, y), openD = !s.alphaAt(x, y + 1);
        const openL = !s.alphaAt(x - 1, y), openU = !s.alphaAt(x, y - 1);
        if (!(openR || openD || openL || openU)) continue;
        if (openR || openD) s.px(x, y, r.chance(0.4) ? sun : ramp[4], 0.85);
        else if (openL || openU) s.px(x, y, ramp[0], 0.7);
      }
    }
  }
}

/**
 * Bite 1–2 px notches out of a silhouette at random.
 *
 * Overlapping ellipses, however many you stack, still resolve into a rounded
 * outline at 1x. This is the pass that makes a forest tree look chewed.
 */
function notchEdge(s: Surface, r: Rng, count: number) {
  for (let k = 0; k < count; k++) {
    const src = s.clone();
    const edge: Array<[number, number]> = [];
    for (let j = 1; j < s.h - 1; j++) {
      for (let i = 1; i < s.w - 1; i++) {
        if (!src.alphaAt(i, j)) continue;
        if (!src.alphaAt(i - 1, j) || !src.alphaAt(i + 1, j) || !src.alphaAt(i, j - 1)) edge.push([i, j]);
      }
    }
    if (!edge.length) return;
    const [ex, ey] = edge[r.int(0, edge.length - 1)];
    const w = r.int(1, 3), h = r.int(1, 3);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const x = ex + i - (w >> 1), y = ey + j - (h >> 1);
        if (s.inside(x, y)) s.data[(y * s.w + x) * 4 + 3] = 0;
      }
    }
  }
}

// ── wood ───────────────────────────────────────────────────────────────────

/**
 * A tapering trunk with bark striations, an optional lean and a root flare.
 * Woods trunks are narrower and cooler than the town oaks, and the roots break
 * the ground line — without them a tall tree reads as a column pasted on grass.
 */
function trunk(
  s: Surface, cx: number, topY: number, baseY: number, ramp: Ramp, seed: number,
  opts: { topHalf?: number; baseHalf?: number; flare?: number; lean?: number; roots?: boolean } = {},
): Array<[number, number, number]> {
  const { topHalf = 2.6, baseHalf = 4.2, flare = 4.6, lean = 0, roots = true } = opts;
  const r = rng(seed);
  const n = valueNoise(seed + 31);
  const h = Math.max(1, baseY - topY);
  const cols: Array<[number, number, number]> = []; // y, x0, x1
  for (let y = topY; y <= baseY; y++) {
    const t = (y - topY) / h;
    let hw = topHalf + (baseHalf - topHalf) * t * t;
    const fromBase = baseY - y;
    if (fromBase < 9) hw += Math.pow((9 - fromBase) / 9, 2.2) * flare;
    const off = lean * Math.sin((1 - t) * 1.5);
    const x0 = Math.round(cx + off - hw);
    const x1 = Math.round(cx + off + hw);
    cols.push([y, x0, x1]);
    for (let x = x0; x <= x1; x++) {
      const u = (x - x0) / Math.max(1, x1 - x0);
      // No wide ramp[4] band: a continuous pale stripe down a trunk is the
      // single fastest way to make wood read as poured concrete. The highlight
      // is added afterwards, one pixel wide and broken up.
      let c: string;
      if (u < 0.10) c = ramp[1];
      else if (u < 0.36) c = ramp[3];
      else if (u < 0.72) c = ramp[2];
      else if (u < 0.89) c = ramp[1];
      else c = ramp[0];
      s.px(x, y, c);
    }
  }
  // bark: broken vertical striations, biased to the shaded side, plus a
  // flickering 1px catch-light on the lit quarter
  for (const [y, x0, x1] of cols) {
    for (let x = x0 + 1; x < x1; x++) {
      const v = n(x * 2, y, 3.2);
      const u = (x - x0) / Math.max(1, x1 - x0);
      if (v > 0.68 && u > 0.34) s.px(x, y, ramp[0], 0.6);
      else if (v < 0.30 && u > 0.2 && u < 0.72) s.px(x, y, ramp[1], 0.55);
    }
    const hx = x0 + Math.max(1, Math.round((x1 - x0) * 0.22));
    if (n(hx, y * 3, 2.4) > 0.52) s.px(hx, y, ramp[4], 0.5);
  }
  // knots
  for (let k = 0; k < 2; k++) {
    const [y, x0, x1] = cols[r.int(Math.round(cols.length * 0.2), Math.round(cols.length * 0.7))];
    if (x1 - x0 < 5) continue;
    const kx = r.int(x0 + 1, x1 - 2);
    s.ellipse(kx, y, 2, 3, ramp[0]);
    s.px(kx, y - 1, ramp[3]);
  }
  if (roots) {
    // Exposed roots. They start above the base line and taper *into* the
    // ground, which is what sells "grown here" instead of "placed here".
    const [, bx0, bx1] = cols[cols.length - 1];
    for (const dir of [-1, 1]) {
      for (let k = 0; k < 2; k++) {
        const len = 5 + r.int(1, 4) + k;
        const sx = dir < 0 ? bx0 + 1 : bx1 - 1;
        const y0 = baseY - 5 - k * 2 + r.int(0, 1);
        for (let i = 0; i < len; i++) {
          const yy = y0 + Math.round(i * i * 0.06 + i * 0.35);
          if (yy > baseY + 1) break;
          const thick = Math.max(1, 3 - Math.floor(i / 2.5));
          for (let t = 0; t < thick; t++) {
            const lit = dir < 0 ? ramp[3] : ramp[2];
            s.px(sx + dir * i, yy + t, t === 0 ? lit : t === thick - 1 ? ramp[0] : ramp[1]);
          }
        }
      }
    }
  }
  return cols;
}

// ── A. GROUND TILES ────────────────────────────────────────────────────────

/**
 * The forest floor. Same discipline as the town grass — ramp[2] dominates,
 * ramp[3] in broad soft patches, the extremes only as deliberate marks.
 *
 * The trap here, learned the hard way over three passes: any *countable* mark —
 * a twig, a bright leaf — repeats every two or three tiles once the runtime is
 * hashing six variants across a field, and the eye instantly reads the grid as
 * brickwork. Two twig experiments both had to be deleted. What is left is the
 * town recipe with the hue moved: broad calm patches, blade tips, and dead
 * leaves so dim they are a hue shift rather than an object. Woodland character
 * comes from the ramp and from the props standing on it, never from the floor
 * texture trying to tell a story by itself.
 */
function woodsGrassTile(seed: number, variant: number): Surface {
  const ramp = P.WOODS_GRASS;
  const s = new Surface(TILE, TILE);
  const n1 = valueNoise(seed);
  const n2 = valueNoise(seed + 4211);
  const ox = variant * 137, oy = variant * 211;
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const v = n1(x + ox, y + oy, 7.5) * 0.75 + n2(x + ox, y + oy, 3.1) * 0.25;
      let c = ramp[2];
      if (v > 0.62) c = ramp[3];
      else if (v < 0.35) c = ramp[1];
      s.px(x, y, c);
    }
  }
  const r = rng(seed + variant * 313);
  // Blade tips. The woods ramp's light end is dull enough that town density is
  // safe here — these never shout the way a bark-coloured mark does.
  const clusters = 2 + r.int(0, 2);
  for (let ci = 0; ci < clusters; ci++) {
    const cx = r.int(1, TILE - 2);
    const cy = r.int(3, TILE - 2);
    const n = r.int(2, 4);
    for (let i = 0; i < n; i++) {
      const bx = cx + r.int(-2, 2);
      const by = cy + r.int(-1, 1);
      s.px(bx, by, ramp[4]);
      s.px(bx, by - 1, ramp[3]);
    }
  }
  // A dead leaf or two: the only warm hue down here, and barely.
  const leaves = r.int(0, 2);
  for (let i = 0; i < leaves; i++) {
    const lx = r.int(1, TILE - 3), ly = r.int(1, TILE - 2);
    s.px(lx, ly, P.TREE_AUTUMN[0], 0.34);
    s.px(lx + 1, ly, P.TREE_AUTUMN[0], 0.3);
    if (r.chance(0.5)) s.px(lx, ly + 1, P.TREE_AUTUMN[0], 0.22);
  }
  speckle(s, rng(seed + variant * 77 + 5), 0, 0, TILE, TILE, ramp[0], 4, 0.45);
  return s;
}

/** Bare damp earth. Darker and cooler than the town's soil, threaded with roots. */
function woodsSoilTile(seed: number, variant: number): Surface {
  const s = new Surface(TILE, TILE);
  mottle(s, P.WOODS_DIRT, seed + variant * 51, { scale: 3.6 });
  const r = rng(seed + variant * 17);
  // a root or two crossing the tile, half-buried
  const runs = r.int(1, 2);
  for (let k = 0; k < runs; k++) {
    let x = r.int(0, TILE - 1);
    let y = r.int(2, TILE - 3);
    const dx = r.chance(0.5) ? 1 : -1;
    for (let i = 0; i < TILE; i++) {
      s.px(x, y, P.WOODS_BARK[1], 0.75);
      s.px(x, y + 1, P.WOODS_BARK[0], 0.5);
      s.px(x, y - 1, P.WOODS_DIRT[4], 0.35);
      x += dx;
      if (r.chance(0.3)) y += r.chance(0.5) ? 1 : -1;
      if (x < 0 || x >= TILE || y < 1 || y >= TILE - 1) break;
    }
  }
  speckle(s, rng(seed + 500 + variant), 0, 0, TILE, TILE, P.WOODS_DIRT[0], 9, 0.5);
  speckle(s, rng(seed + 900 + variant), 0, 0, TILE, TILE, P.WOODS_DIRT[4], 4, 0.4);
  return s;
}

/**
 * Fallen leaves. The one warm-hued ground material in the woods, so it is the
 * easiest thing in the zone to overdo: scattered evenly it turns into an orange
 * noise carpet that fights the trail for attention. Instead the leaves come in
 * two or three drifts with bare earth between them, only the drift centres get
 * the bright autumn steps, and the whole material stays darker than the trail.
 */
function leafLitterTile(seed: number, variant: number): Surface {
  const s = new Surface(TILE, TILE);
  mottle(s, P.WOODS_DIRT, seed + variant * 33, { scale: 4.2, lightAmt: 0.74, darkAmt: 0.42 });
  const r = rng(seed + variant * 131);
  const drifts = 2 + r.int(0, 1);
  for (let d = 0; d < drifts; d++) {
    const dx = r.int(1, TILE - 3), dy = r.int(1, TILE - 3);
    const n = 3 + r.int(0, 2);
    for (let i = 0; i < n; i++) {
      const x = dx + r.int(-3, 3), y = dy + r.int(-2, 2);
      // Warm steps only near a drift centre; the strays are dark and cool.
      const near = Math.abs(x - dx) + Math.abs(y - dy) <= 2;
      const c = near ? (r.chance(0.4) ? P.TREE_AUTUMN[2] : P.TREE_AUTUMN[1]) : P.TREE_AUTUMN[0];
      const a = near ? 0.85 : 0.6;
      s.px(x, y, c, a);
      s.px(x + 1, y, c, a * 0.85);
      if (r.chance(0.5)) s.px(x + 2, y, c, a * 0.6);
      s.px(x, y + 1, P.OUTLINE, 0.2);
    }
  }
  // A few curled, colourless leaves so the material still reads at 1x when the
  // warm drifts happen to fall outside the tile.
  speckle(s, r, 0, 0, TILE, TILE, P.WOODS_DIRT[0], 6, 0.55);
  speckle(s, r, 0, 0, TILE, TILE, P.WOODS_DIRT[4], 3, 0.4);
  return s;
}

// ── A. BLOB MATERIALS ──────────────────────────────────────────────────────

/**
 * The worn trail. This is the single most important tile in the zone: it is how
 * the player knows where to go, so it is deliberately the *lightest* material
 * in the woods — the light end of WOODS_DIRT dominates rather than the middle,
 * which is the opposite of how the grass is built.
 *
 * The other half of the job is making sure it still reads as *ground*. A hard
 * bright line along the top edge and a hard dark line along the bottom turns a
 * trail into a plank lying on the grass, which is exactly what the first pass
 * did. So: the lit lip is noise-broken and half-strength, the shadow lip is
 * softer, and the interior keeps enough mid-tone that the trail has a surface
 * instead of a face.
 */
function woodsPathPainter(seed: number) {
  const ramp = P.WOODS_DIRT;
  return (coverage: Surface, _mask: number, r: Rng): Surface => {
    const s = new Surface(TILE, TILE);
    const n1 = valueNoise(seed);
    const n2 = valueNoise(seed + 313);
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        if (coverage.alphaAt(x, y) === 0) continue;
        const v = n1(x, y, 3.6) * 0.62 + n2(x, y, 1.5) * 0.38;
        let c = ramp[3];
        if (v > 0.80) c = ramp[4];
        else if (v < 0.26) c = ramp[1];
        else if (v < 0.46) c = ramp[2];
        s.px(x, y, c);
      }
    }
    // Trodden grit. One pebble at most, and never bright — a pebble per tile
    // becomes a visible lattice once the trail is twenty tiles long.
    speckle(s, r, 0, 0, TILE, TILE, ramp[1], 7, 0.45);
    speckle(s, r, 0, 0, TILE, TILE, ramp[4], 4, 0.4);
    if (r.chance(0.45)) {
      const px = r.int(1, TILE - 4), py = r.int(1, TILE - 3);
      const w = r.int(2, 3);
      for (let i = 0; i < w; i++) {
        if (coverage.alphaAt(px + i, py)) s.px(px + i, py, P.WOODS_ROCK[2], 0.85);
        if (coverage.alphaAt(px + i, py + 1)) s.px(px + i, py + 1, P.WOODS_ROCK[0], 0.7);
      }
    }
    // Edges: a broken lit lip where the floor steps down onto the trail, a soft
    // dark bite where it falls away below. Both are noise-gated so no run of
    // tiles ever draws a continuous line.
    const { top, bottom, side } = edgePixels(coverage);
    for (const [x, y] of top) {
      if (n2(x * 3, y * 3, 2.2) > 0.34) s.px(x, y, ramp[4], 0.55);
    }
    for (const [x, y] of bottom) s.px(x, y, ramp[0], 0.55);
    for (const [x, y] of side) s.px(x, y, ramp[2], 0.5);
    return s;
  };
}

/** Moss creeping over stone: the damp, soft counterpart to the bramble. */
function mossPainter(seed: number) {
  const ramp = P.MOSS;
  return (coverage: Surface, _mask: number, r: Rng): Surface => {
    const s = new Surface(TILE, TILE);
    const n1 = valueNoise(seed);
    const n2 = valueNoise(seed + 617);
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        if (coverage.alphaAt(x, y) === 0) continue;
        const v = n1(x, y, 3.0) * 0.6 + n2(x, y, 1.3) * 0.4;
        // Damp and dark. Moss that reaches the light end of its ramp reads as
        // lime paint and steals attention from the trail.
        let c = ramp[1];
        if (v > 0.80) c = ramp[3];
        else if (v > 0.68) c = ramp[2];
        else if (v < 0.28) c = ramp[0];
        s.px(x, y, c);
      }
    }
    // Stone showing through the moss — this is what makes it read as moss *on*
    // something rather than as a second, brighter grass.
    for (let k = 0; k < (r.chance(0.6) ? 2 : 1); k++) {
      const px = r.int(1, TILE - 5), py = r.int(1, TILE - 4);
      const w = r.int(3, 5), h = r.int(2, 3);
      for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
          if (coverage.alphaAt(px + i, py + j) === 0) continue;
          s.px(px + i, py + j, j === 0 ? P.WOODS_ROCK[3] : P.WOODS_ROCK[1]);
        }
      }
      for (let i = 0; i < w; i++) s.pxOver(px + i, py + h, P.OUTLINE, 0.45);
    }
    speckle(s, r, 0, 0, TILE, TILE, ramp[4], 6, 0.4);
    // Edges creep: single moss pixels scattered *outside* the coverage rather
    // than a clean boundary. Moss has no edge, it has a frontier.
    const { top, bottom, side } = edgePixels(coverage);
    for (const [x, y] of top) {
      s.px(x, y, ramp[3], 0.8);
      if (n2(x * 5, y * 5, 1.5) > 0.55) s.px(x, y - 1, ramp[2]);
    }
    for (const [x, y] of side) {
      s.px(x, y, ramp[1], 0.6);
      if (n1(x * 5, y * 5, 1.5) > 0.62) s.px(x + (x < TILE / 2 ? -1 : 1), y, ramp[2]);
    }
    for (const [x, y] of bottom) {
      s.px(x, y, ramp[0], 0.85);
      if (n2(x * 7, y * 3, 1.5) > 0.6) s.px(x, y + 1, ramp[1]);
    }
    return s;
  };
}

/**
 * The forest stream. Same construction as the town river, three deliberate
 * changes: WOODS_WATER is far darker and greener, the caustics are dimmer and
 * fewer (little light gets down here to glint off), and the far bank gets a
 * broken MIST-toned ripple instead of white foam — foam is a bright, busy,
 * *loud* material and this water is meant to be quiet.
 */
function streamPainter(seed: number, frame: number) {
  return (coverage: Surface, mask: number): Surface => {
    const s = new Surface(TILE, TILE);
    const n1 = valueNoise(seed);
    const phase = frame * 2.7;
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        if (coverage.alphaAt(x, y) === 0) continue;
        const v = n1(x, y + phase, 5.0);
        // Deliberately flat. A blob run of open water is literally the same
        // tile repeated, so the less internal contrast it carries the less the
        // repetition announces itself.
        let c = P.WOODS_WATER[1];
        if (v > 0.86) c = P.WOODS_WATER[3];
        else if (v > 0.58) c = P.WOODS_WATER[2];
        else if (v < 0.30) c = P.WOODS_WATER[0];
        s.px(x, y, c);
      }
    }
    const r = rng(seed + frame * 733);
    for (let i = 0; i < 2; i++) {
      const gx = (r.int(0, TILE - 1) + frame * 3) % TILE;
      const gy = r.int(0, TILE - 1);
      if (coverage.alphaAt(gx, gy) === 0) continue;
      s.px(gx, gy, P.WOODS_WATER[4], 0.85);
      if (coverage.alphaAt(gx + 1, gy)) s.px(gx + 1, gy, P.WOODS_WATER[3]);
    }
    // A leaf riding the current — the one warm note, and it moves, so the eye
    // reads the stream as flowing rather than as a puddle.
    const lx = (seed + frame * 5) % TILE;
    const ly = (seed * 3 + frame * 2) % TILE;
    if (coverage.alphaAt(lx, ly)) {
      s.px(lx, ly, P.TREE_AUTUMN[1], 0.75);
      if (coverage.alphaAt(lx + 1, ly)) s.px(lx + 1, ly, P.TREE_AUTUMN[0], 0.7);
    }
    const { top, bottom, side } = edgePixels(coverage);
    for (const [x, y] of top) {
      s.px(x, y, P.WOODS_WATER[0]);
      s.px(x, y + 1, P.WOODS_WATER[0], 0.5);
    }
    for (const [x, y] of bottom) {
      const on = (x * 3 + frame * 2 + y) % 7 < 3;
      s.px(x, y, on ? P.MIST_RAMP[1] : P.WOODS_WATER[3], on ? 0.5 : 0.45);
    }
    for (const [x, y] of side) s.px(x, y, P.WOODS_WATER[3], 0.5);
    if (mask === 255) {
      for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) s.px(x, y, P.WOODS_WATER[0], 0.2);
    }
    return s;
  };
}

/**
 * Thorn thicket — the zone's impassable boundary.
 *
 * A collision boundary has to *look* like one before the player walks into it,
 * so this tile is built to be legible as "no" from across the screen, in this
 * order of importance:
 *   1. value. It is the darkest material in the woods by a wide margin, so a
 *      bramble wall reads as a hole in the frame even at 1x.
 *   2. silhouette. Spikes are drawn *outside* the blob coverage, which makes
 *      the edge of a thicket jagged rather than a smooth organic blob — the
 *      one shape language the player never sees on walkable ground.
 *   3. the thorns themselves: pale dry tips, the only light pixels on it, all
 *      pointing outward.
 * The berries are a single saturated note so the thicket still reads as alive.
 */
function bramblePainter(seed: number) {
  const ramp = P.WOODS_BRAMBLE;
  return (coverage: Surface, _mask: number, r: Rng): Surface => {
    const s = new Surface(TILE, TILE);
    const n1 = valueNoise(seed);
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        if (coverage.alphaAt(x, y) === 0) continue;
        const v = n1(x, y, 2.6);
        s.px(x, y, v > 0.68 ? ramp[2] : v > 0.4 ? ramp[1] : ramp[0]);
      }
    }
    // the tangle: stems crossing the tile, each carrying thorns
    for (let k = 0; k < 5; k++) {
      let x = r.int(-2, TILE + 1);
      let y = r.int(-2, TILE + 1);
      const dx = r.chance(0.5) ? 1 : -1;
      const dy = r.chance(0.35) ? (r.chance(0.5) ? 1 : -1) : 1;
      const len = r.int(10, 20);
      for (let i = 0; i < len; i++) {
        if (coverage.alphaAt(x, y)) {
          s.px(x, y, i % 5 === 0 ? ramp[4] : ramp[3]);
          s.px(x, y + 1, ramp[0], 0.7);
          if (i % 4 === 2) {
            // a thorn off the stem
            s.px(x + dx, y - 1, P.BRAMBLE_THORN, 0.75);
            s.px(x + dx, y, ramp[4], 0.8);
          }
        }
        x += dx;
        y += i % 2 === 0 ? dy : 0;
        if (x < -2 || x > TILE + 1 || y < -2 || y > TILE + 1) break;
      }
    }
    // berries
    if (r.chance(0.55)) {
      const bx = r.int(1, TILE - 2), by = r.int(1, TILE - 2);
      if (coverage.alphaAt(bx, by)) {
        s.px(bx, by, P.BRAMBLE_BERRY);
        s.px(bx, by - 1, P.BRAMBLE_BERRY, 0.45);
      }
    }
    // Spikes on the silhouette, drawn beyond the coverage so a thicket's outline
    // is jagged. This is the single most important line in the function.
    const { top, side, bottom } = edgePixels(coverage);
    for (const [x, y] of top) {
      if (n1(x * 9 + 3, y * 9, 1.2) < 0.42) continue;
      s.px(x, y - 1, ramp[3]);
      s.px(x, y - 2, P.BRAMBLE_THORN, 0.85);
    }
    for (const [x, y] of side) {
      if (n1(x * 9, y * 9 + 5, 1.2) < 0.5) continue;
      const d = x < TILE / 2 ? -1 : 1;
      s.px(x + d, y, ramp[3]);
      s.px(x + d * 2, y, P.BRAMBLE_THORN, 0.8);
    }
    // Deep shadow where the thicket meets the ground: mass, and therefore mass
    // the player believes they cannot walk through.
    for (const [x, y] of bottom) {
      s.px(x, y, P.OUTLINE, 0.9);
      s.px(x, y + 1, P.OUTLINE, 0.5);
    }
    return s;
  };
}

// ── A. CLIFFS AND LEDGES ───────────────────────────────────────────────────
//
// Elevation grammar. A wall is authored as three rows on the detail layer:
//
//   row 0   cliff_top_<edge>   the lip of the UPPER ground. Transparent where
//                              the plateau is, so the ground layer's own grass
//                              shows through and there is never a seam; then a
//                              lit rock lip, then the hard shadow line that
//                              starts the drop.
//   row 1   cliff_face_<n>     the rock face proper, fully opaque.
//   row 2   cliff_base_<n>     the foot of the face: rock, rubble, and the cast
//                              shadow it throws onto the lower ground, which
//                              fades out into transparency.
//
// The lit lip + hard shadow pair on every top tile is the whole readability
// argument, borrowed from how Zelda dungeons make a ledge unambiguous: the
// player never has to test whether something is walkable.

/**
 * Mottled rock with horizontal strata; the courses catch light on their tops.
 *
 * `dim` mixes the whole face toward OUTLINE. It exists because the first cliff
 * pass came out as a pale slab that was the brightest thing on screen, which
 * inverts the composition the Stardew mine reference is built on: there, the
 * *tops* of the rock catch the light and the vertical faces fall away into
 * shadow, so the walkable floor stays the bright, readable space. A cliff in
 * these woods is a hole in the frame with one lit line along its lip.
 */
function faceRock(
  s: Surface, x0: number, y0: number, x1: number, y1: number, seed: number, dim = 0.28,
) {
  const n = valueNoise(seed);
  const ramp = P.WOODS_ROCK;
  const d = (c: string, a = dim) => P.mix(c, P.OUTLINE, a);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const v = n(x, y * 1.7, 3.0) * 0.65 + n(x * 2, y, 1.4) * 0.35;
      let c = ramp[1];
      if (v > 0.70) c = ramp[2];
      else if (v < 0.34) c = ramp[0];
      s.px(x, y, d(c));
    }
  }
  // Strata: a dark undercut with the lit top of the next course below it. The
  // course spacing alternates so a two-tile face never reads as brickwork.
  let y = y0 + 3;
  let k = 0;
  while (y <= y1) {
    for (let x = x0; x <= x1; x++) {
      const j = Math.round(Math.sin((x + seed) * 0.8) * 0.9 + Math.sin((x + seed) * 0.31) * 0.7);
      if (y + j < y0 || y + j > y1) continue;
      s.px(x, y + j, d(ramp[0], dim * 0.5), 0.9);
      if (y + j + 1 <= y1) s.px(x, y + j + 1, d(ramp[3]), 0.5);
    }
    y += 3 + ((k++ + seed) % 3);
  }
  // vertical cracks
  const r = rng(seed + 71);
  for (let c = 0; c < 2; c++) {
    let cx = r.int(x0, x1);
    for (let cy = y0 + r.int(0, 3); cy <= y1; cy++) {
      s.px(cx, cy, d(ramp[0], dim * 0.4), 0.7);
      if (r.chance(0.3)) cx += r.chance(0.5) ? 1 : -1;
      if (cx < x0 || cx > x1) break;
    }
  }
}

/** Moss dribbling down from the lip onto the top of a face. */
function faceMoss(s: Surface, seed: number, rows = 6) {
  const r = rng(seed);
  // One or two only. Three per tile, repeated along a wall, reads as a picket
  // fence rather than as damp — the same repetition trap as the grass twigs.
  const n = r.int(0, 2);
  for (let k = 0; k < n; k++) {
    const x = r.int(0, TILE - 1);
    const len = r.int(2, rows);
    for (let i = 0; i < len; i++) {
      s.pxOver(x, i, P.MOSS[i < 2 ? 2 : 1], 0.6 - i * 0.07);
      if (r.chance(0.35)) s.pxOver(x + 1, i, P.MOSS[0], 0.45);
    }
  }
}

/**
 * The lit lip of a ledge plus the dark line under it, along one side of a tile.
 * `from`/`to` let corner tiles draw a partial run.
 */
function ledgeLip(s: Surface, side: 'n' | 's' | 'e' | 'w', from: number, to: number, seed: number) {
  const ramp = P.WOODS_ROCK;
  const n = valueNoise(seed);
  if (side === 's') {
    faceRock(s, from, 10, to, TILE - 1, seed + 5, 0.4);
    for (let x = from; x <= to; x++) {
      const j = n(x * 3, 7, 2.5) > 0.62 ? 1 : 0; // the lip is not a ruler line
      s.px(x, 10 + j, ramp[4]);                  // the lit lip: the brightest
      s.px(x, 11 + j, ramp[3]);                  // line anywhere in the woods
      s.px(x, 12 + j, P.OUTLINE, 0.9);           // and the shadow under it
      s.px(x, 13 + j, P.OUTLINE, 0.45);
    }
  } else if (side === 'n') {
    for (let x = from; x <= to; x++) {
      const j = n(x * 3, 13, 2.5) > 0.62 ? 1 : 0;
      for (let y = 0; y <= 2 + j; y++) s.px(x, y, ramp[1]);
      s.px(x, 0, ramp[3]);
      s.px(x, 3 + j, P.OUTLINE, 0.7); // the verge shades the ground below it
      s.px(x, 4 + j, P.OUTLINE, 0.3);
    }
    faceRock(s, from, 0, to, 2, seed + 9);
    for (let x = from; x <= to; x++) s.px(x, 0, ramp[3], 0.9);
  } else {
    // Side verges. Light from the upper-left: the west verge catches it, the
    // east verge is the one that throws a shadow inward.
    const x0 = side === 'w' ? 0 : TILE - 4;
    faceRock(s, x0, from, x0 + 3, to, seed + 13, 0.4);
    for (let y = from; y <= to; y++) {
      const j = n(11, y * 3, 2.5) > 0.62 ? 1 : 0;
      if (side === 'w') {
        // the west verge turns toward the light, so its outer face is the lit
        // one and the shadow falls inward across the lower ground
        s.px(0, y, ramp[4]);
        s.px(1, y, ramp[3]);
        s.px(2 + j, y, P.OUTLINE, 0.85);
        s.px(3 + j, y, P.OUTLINE, 0.4);
      } else {
        s.px(TILE - 1, y, ramp[2]);
        s.px(TILE - 2, y, ramp[1]);
        s.px(TILE - 3 - j, y, ramp[4], 0.85);
        s.px(TILE - 4 - j, y, P.OUTLINE, 0.6);
      }
    }
  }
}

/** Stairs cut into the rock: two tiles, upper then lower. */
function stairsTile(half: 0 | 1, seed: number): Surface {
  const s = new Surface(TILE, TILE);
  const ramp = P.WOODS_ROCK;
  const top = half === 0 ? 4 : 0;
  // side walls of the cut. The right wall's inner face turns toward the light,
  // so it is the lit one — that asymmetry is what makes the cut read as a
  // recess in the rock rather than a ladder painted on it.
  faceRock(s, 0, top, 2, TILE - 1, seed);
  faceRock(s, TILE - 3, top, TILE - 1, TILE - 1, seed + 3);
  for (let y = top; y < TILE; y++) {
    s.px(2, y, P.OUTLINE, 0.8);
    s.px(3, y, P.OUTLINE, 0.35);
    s.px(TILE - 3, y, ramp[4], 0.7);
    s.px(TILE - 4, y, ramp[3], 0.4);
  }
  if (half === 0) {
    // the opening at plateau level: dark mouth, then the first tread
    for (let x = 3; x < TILE - 3; x++) {
      s.px(x, 0, ramp[4]);
      s.px(x, 1, ramp[3]);
      s.px(x, 2, P.OUTLINE, 0.9);
      s.px(x, 3, P.OUTLINE, 0.55);
    }
  }
  for (let t = 0; t < 3; t++) {
    const y = (half === 0 ? 4 : 0) + t * 4;
    for (let x = 3; x < TILE - 3; x++) {
      s.px(x, y, ramp[4], 0.9);     // lit tread nose
      s.px(x, y + 1, ramp[3], 0.95);
      s.px(x, y + 2, P.mix(ramp[2], P.OUTLINE, 0.2));
      s.px(x, y + 3, P.OUTLINE, 0.75); // riser in shadow
    }
    // the tread's own grit
    speckle(s, rng(seed + t * 31), 4, y, TILE - 8, 2, ramp[1], 3, 0.4);
  }
  if (half === 1) {
    // the bottom step spills onto the lower ground
    for (let x = 2; x < TILE - 2; x++) {
      s.px(x, 12, ramp[3]);
      s.px(x, 13, ramp[1]);
      s.px(x, 14, P.OUTLINE, 0.5);
      s.px(x, 15, P.OUTLINE, 0.22);
    }
  }
  return s;
}

/** Ancient flagstone: where the woods stop and the shrine's architecture starts. */
function shrineStoneTile(seed: number, variant: number): Surface {
  const s = new Surface(TILE, TILE);
  const ramp = P.SHRINE_STONE;
  // Calmer than the woods' natural materials: this is *cut* stone, so the
  // field is quiet and the joints carry the read.
  mottle(s, ramp, seed + variant * 41, { scale: 3.8, lightAmt: 0.78, darkAmt: 0.26 });
  const r = rng(seed + variant * 97);
  // flagstone joints, staggered per variant
  const cuts = [0, 7, 16];
  for (const cy of cuts) {
    for (let x = 0; x < TILE; x++) {
      const j = Math.round(Math.sin((x + seed + variant) * 0.9) * 0.6);
      s.px(x, cy + j, P.OUTLINE, 0.75);                       // the mortar gap
      if (cy + j + 1 < TILE) s.px(x, cy + j + 1, ramp[4], 0.7); // lit top of the
    }                                                          // stone below
  }
  const stagger = [4, 11];
  for (let band = 0; band < cuts.length - 1; band++) {
    const sx = stagger[(band + variant) % stagger.length];
    for (let y = cuts[band] + 1; y < cuts[band + 1]; y++) {
      s.px(sx, y, P.OUTLINE, 0.7);
      s.px(sx + 1, y, ramp[4], 0.45);
    }
  }
  // moss has got into the joints, and one stone has hairline cracks
  for (let k = 0; k < 5; k++) {
    const mx = r.int(0, TILE - 1), my = r.int(0, TILE - 1);
    s.px(mx, my, P.MOSS[1], 0.55);
    if (r.chance(0.5)) s.px(mx + 1, my, P.MOSS[0], 0.45);
  }
  if (variant === 3) {
    // The first hint of what is under the valley: a rune scratch, almost gone.
    const cx = 8, cy = 8;
    for (const [dx, dy] of [[0, -3], [0, 3], [-3, 0], [3, 0]] as const) {
      s.px(cx + dx, cy + dy, P.ECHO_RUNE, 0.3);
    }
    for (let i = -2; i <= 2; i++) s.px(cx + i, cy, P.ECHO_RUNE, 0.16);
    for (let i = -2; i <= 2; i++) s.px(cx, cy + i, P.ECHO_RUNE, 0.16);
  }
  speckle(s, r, 0, 0, TILE, TILE, ramp[0], 5, 0.4);
  return s;
}

// ── B. PROPS ───────────────────────────────────────────────────────────────

/**
 * The tall dark forest tree, 52x72.
 *
 * Denser and darker than a town oak, and built to a different silhouette rule:
 * town oaks are broad and rounded, woods trees are *vertical and chewed*. Three
 * things do that work — clumps stacked more than spread, a notching pass that
 * bites the outline after the clumps have been painted, and enough bare trunk
 * below the canopy that the tree reads as having grown up toward light rather
 * than sat down on the grass.
 */
function darkTree(variant: number): Surface {
  const W = 52, H = 72;
  const s = new Surface(W, H);
  const r = rng(9100 + variant * 911);
  const ramp = P.WOODS_CANOPY;
  const sun = P.WOODS_LEAF_SUN;

  const layouts: Clump[][] = [
    // 0 — upright, weight high, one lobe thrown out to the left
    [
      { x: 16, y: 34, rx: 9, ry: 7, bias: -0.2 },
      { x: 37, y: 33, rx: 8.5, ry: 6.5, bias: -0.22 },
      { x: 26, y: 36, rx: 9.5, ry: 6.5, bias: -0.24 },
      { x: 8, y: 24, rx: 7.5, ry: 6.5, bias: -0.1 },
      { x: 17, y: 21, rx: 10.5, ry: 9, bias: -0.02 },
      { x: 37, y: 20, rx: 10, ry: 8.5, bias: -0.07 },
      { x: 27, y: 23, rx: 10, ry: 8.5, bias: -0.09 },
      { x: 23, y: 10, rx: 10.5, ry: 8, bias: 0.09 },
      { x: 36, y: 8, rx: 7, ry: 5.5, bias: 0.05 },
    ],
    // 1 — leaning right, canopy dragged with it
    [
      { x: 18, y: 35, rx: 8.5, ry: 6.5, bias: -0.22 },
      { x: 36, y: 34, rx: 9, ry: 7, bias: -0.2 },
      { x: 27, y: 37, rx: 9, ry: 6, bias: -0.25 },
      { x: 43, y: 25, rx: 7.5, ry: 6.5, bias: -0.12 },
      { x: 20, y: 22, rx: 10, ry: 8.5, bias: -0.04 },
      { x: 34, y: 19, rx: 11, ry: 9, bias: -0.02 },
      { x: 28, y: 10, rx: 10, ry: 7.5, bias: 0.1 },
      { x: 15, y: 12, rx: 7.5, ry: 6, bias: 0.03 },
    ],
    // 2 — tallest and narrowest; a gap in the middle of the mass
    [
      { x: 19, y: 36, rx: 8, ry: 6, bias: -0.24 },
      { x: 34, y: 35, rx: 8, ry: 6, bias: -0.22 },
      { x: 15, y: 26, rx: 9, ry: 7.5, bias: -0.12 },
      { x: 38, y: 25, rx: 9, ry: 7.5, bias: -0.14 },
      { x: 26, y: 20, rx: 9.5, ry: 8, bias: -0.06 },
      { x: 18, y: 12, rx: 9.5, ry: 8, bias: 0.06 },
      { x: 34, y: 11, rx: 9, ry: 7.5, bias: 0.03 },
      { x: 26, y: 5, rx: 8, ry: 5.5, bias: 0.12 },
    ],
    // 3 — squat and wide-shouldered, the one that fills a gap in a treeline
    [
      { x: 13, y: 33, rx: 10, ry: 7.5, bias: -0.2 },
      { x: 39, y: 34, rx: 10, ry: 7.5, bias: -0.22 },
      { x: 26, y: 35, rx: 10.5, ry: 7, bias: -0.24 },
      { x: 12, y: 21, rx: 10, ry: 8.5, bias: -0.04 },
      { x: 40, y: 21, rx: 9.5, ry: 8, bias: -0.08 },
      { x: 26, y: 22, rx: 11, ry: 9, bias: -0.06 },
      { x: 25, y: 12, rx: 11, ry: 8, bias: 0.08 },
      { x: 12, y: 11, rx: 6.5, ry: 5, bias: 0.02 },
    ],
  ];
  const clumps = layouts[variant % layouts.length];
  const canopyBottom = Math.max(...clumps.map((c) => c.y + c.ry));
  const lean = [0, 1.8, -0.7, 0][variant % 4];

  const trunkTop = Math.round(canopyBottom) - 7;
  trunk(s, 26, trunkTop, 69, LIVE_BARK, 9300 + variant * 41, {
    topHalf: 2.6, baseHalf: 4.2, flare: 5.2, lean,
  });
  // branches lifting into the canopy, so the mass has something holding it up
  for (const dir of [-1, 1]) {
    const bx = 26 + dir * 2;
    for (let i = 0; i < 11; i++) {
      const x = bx + dir * Math.round(i * 0.85);
      const y = trunkTop - Math.round(i * 0.95) + 3;
      s.px(x, y, LIVE_BARK[2]);
      s.px(x, y + 1, LIVE_BARK[1]);
      s.px(x + dir, y + 1, LIVE_BARK[0], 0.6);
    }
  }

  const can = new Surface(W, H);
  for (const c of clumps) paintClump(can, c, ramp, sun, 9500 + variant * 17, r, { bumps: 13, bites: 5 });
  notchEdge(can, r, 9);
  canopyUnderside(can, ramp);
  leafFringe(can, ramp, sun, r, 30);
  lightHoles(can, r, 4, ramp, sun, 1.9);
  s.blit(can);

  // the canopy drops a shadow onto the trunk directly below it
  for (let x = 0; x < W; x++) {
    let low = -1;
    for (let y = H - 1; y >= 0; y--) if (can.alphaAt(x, y)) { low = y; break; }
    if (low < 0) continue;
    for (let k = 1; k <= 5; k++) s.pxOver(x, low + k, P.OUTLINE, 0.36 - k * 0.05);
  }

  rim(s);
  contact(s, 26, 70, 30, 9);
  return s;
}

/**
 * `over`-layer canopy patch: foliage the player physically walks underneath.
 *
 * This is the cheapest depth in the whole zone, and the thing most easily
 * ruined — a rectangular green blob overhead reads as a UI element. So every
 * patch gets an off-centre lobe layout, a notching pass, and real holes punched
 * through it, and the underside carries more shadow than a tree canopy does
 * because the player is looking at the *bottom* of these leaves.
 */
function canopyPatch(variant: number): Surface {
  const sizes: Array<[number, number]> = [[32, 32], [40, 32], [48, 40], [64, 48]];
  const [W, H] = sizes[variant % sizes.length];
  const s = new Surface(W, H);
  const r = rng(9700 + variant * 331);
  // A full step darker than any foliage that stands on the ground. This is the
  // whole reason the trick works: composed into a frame at the same value as a
  // bush, an over-layer patch just reads as a bush the player is clipping
  // through. Underlit and holed, it reads as a ceiling.
  const ramp: Ramp = [
    P.mix(P.WOODS_CANOPY[0], P.OUTLINE, 0.55), P.WOODS_CANOPY[0],
    P.WOODS_CANOPY[1], P.WOODS_CANOPY[2], P.WOODS_CANOPY[3],
  ];
  const sun = P.WOODS_CANOPY[4];

  // Lobes laid out on an irregular scatter across the patch, deliberately not
  // filling the corners — the empty corners are what break the rectangle.
  const lobes = 3 + Math.floor((W * H) / 900);
  const clumps: Clump[] = [];
  for (let i = 0; i < lobes; i++) {
    const t = i / Math.max(1, lobes - 1);
    clumps.push({
      x: W * (0.26 + 0.48 * t) + r.range(-3, 3),
      y: H * (0.38 + (i % 2 ? 0.16 : -0.12)) + r.range(-2, 2),
      rx: r.range(W * 0.22, W * 0.30),
      ry: r.range(H * 0.26, H * 0.34),
      bias: r.range(-0.14, 0.02),
    });
  }
  for (const c of clumps) paintClump(s, c, ramp, sun, 9800 + variant * 13, r, { bumps: 13, bites: 6, flat: 0.26 });
  notchEdge(s, r, 4 + lobes * 2);
  canopyUnderside(s, ramp);
  leafFringe(s, ramp, sun, r, 12 + lobes * 4);
  // Generous holes: the ground showing through is the cue that sells "above".
  lightHoles(s, r, 4 + lobes * 2, ramp, sun, 3.4);
  rim(s, P.OUTLINE, 0.85);
  return s;
}

/**
 * A bare branch, drawn recursively. Dead trees live or die on their branching:
 * two children per fork, both shorter and thinner, both bent away from the
 * parent, and the whole thing biased slightly toward the light so the tree
 * looks like it grew rather than like it was generated.
 */
function branch(
  s: Surface, x: number, y: number, ang: number, len: number, thick: number,
  ramp: Ramp, r: Rng, depth: number,
) {
  let cx = x, cy = y;
  for (let i = 0; i < len; i++) {
    const t = i / len;
    const th = Math.max(1, Math.round(thick * (1 - t * 0.55)));
    for (let k = 0; k < th; k++) {
      // lit on the upper-left of the limb, dark on its lower-right
      const c = k === 0 ? ramp[3] : k === th - 1 ? ramp[0] : ramp[2];
      s.px(Math.round(cx) + k, Math.round(cy), c);
    }
    if (th > 1) s.px(Math.round(cx) - 1, Math.round(cy), ramp[1], 0.7);
    cx += Math.cos(ang);
    cy += Math.sin(ang);
    ang += r.range(-0.1, 0.1);
  }
  if (depth <= 0 || len < 4) {
    // twig tips: two or three pixels fanning out
    for (let k = 0; k < 3; k++) {
      const a = ang + r.range(-0.9, 0.9);
      s.px(Math.round(cx + Math.cos(a) * 2), Math.round(cy + Math.sin(a) * 2), ramp[2]);
      s.px(Math.round(cx + Math.cos(a)), Math.round(cy + Math.sin(a)), ramp[3]);
    }
    return;
  }
  const spread = r.range(0.45, 0.85);
  branch(s, cx, cy, ang - spread, len * r.range(0.55, 0.75), thick * 0.7, ramp, r, depth - 1);
  branch(s, cx, cy, ang + spread * r.range(0.7, 1.2), len * r.range(0.5, 0.7), thick * 0.65, ramp, r, depth - 1);
}

/**
 * Bare, twisted, pale-barked. The dead trees are the zone's punctuation.
 *
 * "Pale" is relative: the first pass used the full WOODS_BONEWOOD ramp and the
 * trunks came out glowing white-lilac, the brightest objects in the woods by a
 * long way, which put the player's eye on scenery instead of on the path. The
 * ramp is slid down a step so the trees stay the palest *wood* without becoming
 * light sources.
 */
const DEAD_BARK: Ramp = [
  P.OUTLINE, P.WOODS_BONEWOOD[0], P.WOODS_BONEWOOD[1], P.WOODS_BONEWOOD[2], P.WOODS_BONEWOOD[3],
];

function deadTree(variant: number): Surface {
  const W = 44, H = 66;
  const s = new Surface(W, H);
  const r = rng(11100 + variant * 733);
  const ramp = DEAD_BARK;
  // 0 — tall and forked; 1 — hard lean, limbs dragged downwind;
  // 2 — snapped off at half height, one surviving limb.
  const lean = [-1.0, 2.2, 0.5][variant % 3];
  const topY = [24, 30, 40][variant % 3];
  const cols = trunk(s, 22, topY, 63, ramp, 11200 + variant * 31, {
    topHalf: variant === 2 ? 3.2 : 2.2, baseHalf: 3.8, flare: 4.2, lean, roots: false,
  });
  const [ty] = cols[0];
  const limbSets: Array<Array<[number, number]>> = [
    [[-0.55, 20], [-1.4, 23], [-2.5, 18]],
    [[-0.35, 24], [-1.1, 17], [-2.1, 12]],
    [[-1.5, 13], [-2.6, 9]],
  ];
  for (const [a, l] of limbSets[variant % 3]) {
    branch(s, 22 + lean, ty + 1, a + r.range(-0.15, 0.15), l, 3, ramp, r, variant === 2 ? 1 : 2);
  }
  if (variant === 2) {
    // the splintered break, drawn as jagged lit teeth over a dark throat
    for (let x = 18; x <= 26; x++) {
      const d = Math.abs(x - 22);
      s.pxOver(x, topY + d - 2, ramp[4]);
      s.pxOver(x, topY + d - 1, ramp[1]);
      s.px(x, topY + d, P.OUTLINE, 0.7);
    }
  }
  // shallow surface roots, dark: dead wood does not catch light at the base
  const [, bx0, bx1] = cols[cols.length - 1];
  for (const dir of [-1, 1]) {
    for (let k = 0; k < 2; k++) {
      const len = 4 + r.int(1, 3);
      const sx = dir < 0 ? bx0 : bx1;
      for (let i = 0; i < len; i++) {
        s.px(sx + dir * i, 61 - k * 2 + Math.round(i * 0.5), ramp[k === 0 ? 2 : 1]);
        s.px(sx + dir * i, 62 - k * 2 + Math.round(i * 0.5), P.OUTLINE, 0.6);
      }
    }
  }
  // an old limb scar
  s.ellipse(19 + variant, 44, 4, 3, ramp[1]);
  s.ellipse(20 + variant, 44, 2, 2, P.OUTLINE, 0.7);
  rim(s);
  contact(s, 22, 64, 22, 7);
  return s;
}

/** A hollow trunk. The cavity is the point: it is a container, so it reads dark. */
function hollowTree(): Surface {
  const W = 40, H = 58;
  const s = new Surface(W, H);
  const r = rng(11500);
  const ramp = P.WOODS_BARK;
  trunk(s, 20, 8, 55, ramp, 11510, { topHalf: 5.2, baseHalf: 7.4, flare: 4.6 });
  // The torn-open top of the broken trunk.
  for (let x = 12; x <= 28; x++) {
    const d = Math.round(Math.sin((x - 12) * 0.7) * 1.6);
    for (let y = 6 + d; y <= 9 + d; y++) s.pxOver(x, y, y <= 7 + d ? ramp[4] : ramp[1]);
    s.pxOver(x, 10 + d, P.OUTLINE, 0.8);
  }
  // The cavity: a dark arch with a lit lip on its upper-left, exactly like a
  // doorway, because that is how the player should read it.
  const cav = new Surface(W, H);
  cav.ellipse(15, 33, 11, 15, '#ffffff');
  cav.rect(15, 40, 11, 12, '#ffffff');
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!cav.alphaAt(x, y) || y > 52) continue;
      const lipUL = !cav.alphaAt(x - 1, y) || !cav.alphaAt(x, y - 1);
      const lipDR = !cav.alphaAt(x + 1, y);
      if (lipUL) s.px(x, y, ramp[4]);            // lit lip, upper-left
      else if (lipDR) s.px(x, y, ramp[1]);       // shaded lip, right
      else s.px(x, y, y > 44 ? P.OUTLINE : P.mix(P.OUTLINE, ramp[0], 0.4));
    }
  }
  // something catching the light deep inside — the reason to walk over
  s.px(19, 45, P.LANTERN[2], 0.4);
  s.px(20, 45, P.LANTERN[1], 0.32);
  s.px(19, 44, P.LANTERN[3], 0.22);
  for (let k = 0; k < 5; k++) {
    const mx = r.int(9, 30), my = r.int(12, 26);
    s.pxOver(mx, my, P.MOSS[1], 0.5);
  }
  rim(s);
  contact(s, 20, 56, 26, 8);
  return s;
}

// ── undergrowth ────────────────────────────────────────────────────────────

/** A low leaf mass with no trunk: bushes, and the base shape for cuttables. */
function leafMound(
  W: number, H: number, ramp: Ramp, sun: string, seed: number,
  opts: { lobes?: number; notches?: number; fringe?: number; base?: number; fat?: number } = {},
): Surface {
  const s = new Surface(W, H);
  const r = rng(seed);
  const lobes = opts.lobes ?? 3;
  const fat = opts.fat ?? 1;
  const baseY = opts.base ?? H - 2;
  for (let i = 0; i < lobes; i++) {
    const t = lobes === 1 ? 0.5 : i / (lobes - 1);
    paintClump(s, {
      x: W * (0.22 + 0.56 * t) + r.range(-1.5, 1.5),
      y: baseY - H * (0.28 + (i % 2 ? 0.16 : 0.04)),
      rx: r.range(W * 0.2, W * 0.3) * fat,
      ry: r.range(H * 0.26, H * 0.36) * fat,
      bias: r.range(-0.08, 0.06),
    }, ramp, sun, seed + i * 17, r, { bumps: 10, bites: 4, flat: 0.4 });
  }
  notchEdge(s, r, opts.notches ?? 5);
  canopyUnderside(s, ramp);
  leafFringe(s, ramp, sun, r, opts.fringe ?? 10);
  return s;
}

function bush(variant: number): Surface {
  const dims: Array<[number, number]> = [[22, 18], [26, 20], [18, 16], [30, 22]];
  const [W, H] = dims[variant % dims.length];
  const s = leafMound(W, H, P.WOODS_UNDER, P.WOODS_LEAF_SUN, 12100 + variant * 191, {
    lobes: variant === 2 ? 2 : 3, notches: 5, fringe: 9 + variant,
  });
  // a few berries on one variant so the set is not four of the same silhouette
  if (variant === 1) {
    const r = rng(12200);
    for (let k = 0; k < 4; k++) {
      const x = r.int(4, W - 5), y = r.int(4, H - 6);
      if (!s.alphaAt(x, y)) continue;
      s.px(x, y, P.FLOWER_ROSE[1]);
      s.px(x, y - 1, P.FLOWER_ROSE[2], 0.7);
    }
  }
  rim(s);
  contact(s, W / 2, H - 1, W - 4, 5);
  return s;
}

/**
 * Cuttable grass, Zelda-style: the ones that hide things.
 *
 * These use the *town* BUSH ramp rather than the woods undergrowth ramp. That
 * is deliberate and it is the most important decision in this function — an
 * interactable has to be more saturated than the scenery it stands in, and a
 * cuttable bush that reads as ordinary undergrowth is a secret nobody finds.
 * The brighter green also quietly says "this is from the world you know".
 */
function cuttableBush(variant: number): Surface {
  const W = 16, H = 16;
  const s = leafMound(W, H, P.BUSH, P.LEAF_SUN_COOL, 12400 + variant * 271, {
    lobes: 2 + (variant % 2), notches: 2, fringe: 8, base: H - 1, fat: 1.35,
  });
  // upright blades breaking the top silhouette — reads as grass, not shrub
  const r = rng(12500 + variant);
  for (let k = 0; k < 4; k++) {
    const x = r.int(3, W - 4);
    let top = H;
    for (let y = 0; y < H; y++) if (s.alphaAt(x, y)) { top = y; break; }
    if (top >= H) continue;
    s.px(x, top - 1, P.BUSH[3]);
    s.px(x, top - 2, P.LEAF_SUN_COOL);
  }
  rim(s);
  contact(s, W / 2, H - 1, W - 4, 4);
  return s;
}

/** The four-frame cut: bush collapses, leaves burst outward, dust settles. */
function bushCutFrames(): Surface[] {
  const W = 24, H = 24;
  const frames: Surface[] = [];
  const src = cuttableBush(0);
  for (let f = 0; f < 4; f++) {
    const s = new Surface(W, H);
    const r = rng(12600 + f * 97);
    if (f === 0) {
      // squashed and shifted: the moment of impact
      const sq = new Surface(16, 16);
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const c = src.get(Math.round(8 + (x - 8) * 0.86), Math.round(y * 1.18 - 2));
          if (c[3]) sq.px(x, y, c);
        }
      }
      s.blit(sq, 4, 7);
    }
    if (f >= 1) {
      // leaves thrown out along an expanding arc, more of them each frame
      // Thrown leaves are 2x2 chunks with a lit top-left pixel. Single pixels
      // read as dust at 1x and the cut loses all its impact.
      // The debris is thrown UP and out, not around a circle. An even ring of
      // leaves reads as a decorative wreath; a fan weighted to the upper half
      // reads as something being hit.
      const n = f === 1 ? 12 : f === 2 ? 10 : 7;
      const spread = 3 + f * 3.2;
      for (let i = 0; i < n; i++) {
        const a = Math.PI + (i / (n - 1)) * Math.PI + r.range(-0.4, 0.4); // upper arc
        const d = spread * r.range(0.55, 1.35);
        const x = Math.round(12 + Math.cos(a) * d);
        const y = Math.round(16 + Math.sin(a) * d * 0.85 - f * 1.2);
        const al = f === 3 ? 0.6 : 1;
        const big = r.chance(0.45);
        s.px(x, y, P.LEAF_SUN_COOL, al);
        s.px(x + 1, y, P.BUSH[3], al);
        s.px(x, y + 1, P.BUSH[2], al);
        s.px(x + 1, y + 1, P.BUSH[1], al * 0.9);
        if (big) {
          s.px(x + 2, y, P.BUSH[2], al * 0.9);
          s.px(x + 2, y + 1, P.BUSH[0], al * 0.8);
          s.px(x, y + 2, P.BUSH[1], al * 0.8);
        }
      }
      // a couple of leaves already falling back down
      for (let i = 0; i < f; i++) {
        const x = 6 + r.int(0, 12), y = 4 + r.int(0, 6);
        s.px(x, y, P.BUSH[3], 0.7);
        s.px(x + 1, y, P.BUSH[1], 0.6);
      }
    }
    if (f === 1) {
      // the stump of the bush still standing for one frame
      for (let x = 7; x < 17; x++) {
        s.px(x, 19, P.BUSH[2]);
        s.px(x, 20, P.BUSH[1]);
      }
    }
    if (f >= 2) {
      // cut stubble left behind
      for (let k = 0; k < 6; k++) {
        const x = 8 + r.int(0, 8);
        s.px(x, 20, P.BUSH[1]);
        s.px(x, 19, P.BUSH[2], 0.8);
      }
    }
    // dust at the base, fading
    if (f >= 1) {
      const a = [0, 0.4, 0.3, 0.16][f];
      s.ellipse(6, 18, 12, 4, P.WOODS_DIRT[3], a);
    }
    contact(s, 12, 22, 14, 4, 0.28);
    frames.push(s);
  }
  return frames;
}

/** Ferns: fronds radiating from one point, the classic undergrowth silhouette. */
function fern(variant: number): Surface {
  const dims: Array<[number, number]> = [[20, 18], [16, 14], [24, 20], [18, 16]];
  const [W, H] = dims[variant % dims.length];
  const s = new Surface(W, H);
  const r = rng(12800 + variant * 131);
  const ramp = P.WOODS_UNDER;
  const cx = W / 2, baseY = H - 2;
  const fronds = 6 + r.int(0, 2);
  for (let i = 0; i < fronds; i++) {
    const t = fronds === 1 ? 0.5 : i / (fronds - 1);
    const ang = -Math.PI / 2 + (t - 0.5) * 2.0;
    const len = H * r.range(0.62, 0.92);
    let x = cx, y = baseY;
    let a = ang;
    for (let k = 0; k < len; k++) {
      // the frond droops as it goes out
      a += (ang > -Math.PI / 2 ? 0.045 : -0.045);
      x += Math.cos(a);
      y += Math.sin(a);
      const lit = ang < -Math.PI / 2; // left-hand fronds face the light
      const xi = Math.round(x), yi = Math.round(y);
      // A 2px spine. One-pixel fronds vanish into the dark floor and what is
      // left reads as scratches rather than as a plant.
      s.px(xi, yi, lit ? ramp[4] : ramp[3]);
      s.px(xi, yi + 1, ramp[1]);
      // leaflets on both sides, longest near the crown
      const l = Math.max(1, Math.round((1 - k / len) * 3.2));
      for (let d = 1; d <= l; d++) {
        s.px(xi - d, yi + 1, lit ? ramp[3] : ramp[2]);
        s.px(xi + d, yi + 1, ramp[2]);
        if (d < l) s.px(xi + d, yi + 2, ramp[0], 0.8);
      }
    }
  }
  // dark core so the fronds read as coming from one crown
  s.ellipse(Math.round(cx) - 2, baseY - 2, 4, 3, ramp[0]);
  rim(s, P.OUTLINE, 0.85);
  contact(s, cx, H - 1, W - 6, 4, 0.28);
  return s;
}

/** Mushrooms. Variant 3 is faintly bioluminescent — the woods' first anomaly. */
function mushroom(variant: number): Surface {
  const W = 16, H = 14;
  const s = new Surface(W, H);
  const r = rng(13100 + variant * 311);
  const glow = variant === 3;
  const cap = glow ? P.ECHO_CYAN : P.FUNGUS_CAP;
  const stem = P.FUNGUS_PALE;
  const caps = variant === 0 ? 3 : variant === 2 ? 2 : 1;
  for (let i = 0; i < caps; i++) {
    const cx = caps === 1 ? 8 : 4 + i * (8 / Math.max(1, caps - 1)) + r.int(0, 3);
    const by = H - 2 - r.int(0, 2);
    const cw = caps === 1 ? (variant === 1 ? 9 : 8) : 5 + r.int(0, 1);
    const chh = Math.max(2, Math.round(cw * 0.55));
    const stemH = variant === 1 ? 6 : 3 + r.int(0, 2);
    // stem
    for (let y = by - stemH; y <= by; y++) {
      s.px(cx, y, stem[3]);
      s.px(cx + 1, y, stem[1]);
      if (variant === 1) s.px(cx - 1, y, stem[2]);
    }
    // cap: a dome with a lit upper-left and a dark gill line under the rim
    const cy = by - stemH - chh + 1;
    for (let j = 0; j < chh; j++) {
      const halfW = Math.round((cw / 2) * Math.sqrt(Math.max(0, 1 - Math.pow((j - chh + 1) / chh, 2))));
      for (let x = -halfW; x <= halfW; x++) {
        const u = (x + halfW) / Math.max(1, halfW * 2);
        const c = u < 0.3 ? cap[3] : u < 0.5 ? cap[4] : u < 0.78 ? cap[2] : cap[1];
        s.px(cx + x, cy + j, j === 0 ? cap[3] : c);
      }
    }
    for (let x = -Math.round(cw / 2); x <= Math.round(cw / 2); x++) {
      s.px(cx + x, cy + chh, cap[0]);
    }
    // white flecks on the brown caps, a faint halo on the glowing one
    if (!glow) {
      for (let k = 0; k < 2; k++) s.px(cx + r.int(-2, 2), cy + r.int(0, chh - 1), stem[4], 0.8);
    } else {
      for (let x = -cw; x <= cw; x++) {
        for (let j = -2; j <= chh + 1; j++) {
          if (s.alphaAt(cx + x, cy + j)) continue;
          const d = Math.hypot(x * 0.7, (j - chh / 2) * 0.9);
          if (d < cw * 0.75) s.px(cx + x, cy + j, P.ECHO_RUNE, 0.13 * (1 - d / (cw * 0.75)));
        }
      }
      s.px(cx, cy + 1, P.ECHO_RUNE, 0.7);
    }
  }
  rim(s, P.OUTLINE, 0.9);
  contact(s, W / 2, H - 1, 10, 4, 0.28);
  return s;
}

/** A fairy ring. Environmental storytelling, and a hint that something is odd. */
function toadstoolRing(): Surface {
  const W = 34, H = 24;
  const s = new Surface(W, H);
  const r = rng(13400);
  const cx = 17, cy = 15, rx = 14, ry = 7;
  // trodden circle inside the ring
  s.ellipse(cx - rx + 2, cy - ry + 1, (rx - 2) * 2, (ry - 1) * 2, P.WOODS_DIRT[1], 0.35);
  const n = 9;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + 0.2;
    const x = Math.round(cx + Math.cos(a) * rx);
    const y = Math.round(cy + Math.sin(a) * ry);
    const h = 2 + r.int(0, 2);
    const w = 3 + r.int(0, 1);
    // back-row toadstools are smaller and dimmer: cheap depth
    const back = Math.sin(a) < -0.2;
    const cap = back ? P.FUNGUS_CAP[1] : P.FUNGUS_CAP[2];
    for (let k = 0; k < h; k++) s.px(x, y - k, P.FUNGUS_PALE[back ? 1 : 3]);
    for (let dx = -Math.floor(w / 2); dx <= Math.floor(w / 2); dx++) {
      s.px(x + dx, y - h, dx < 0 ? P.FUNGUS_CAP[3] : cap);
      s.px(x + dx, y - h + 1, P.FUNGUS_CAP[0]);
    }
    s.px(x, y + 1, P.OUTLINE, 0.35);
  }
  return s;
}

/** Hanging vines for the `over` layer: they cross the player, not the ground. */
function vine(variant: number): Surface {
  const dims: Array<[number, number]> = [[14, 34], [10, 44], [18, 26]];
  const [W, H] = dims[variant % dims.length];
  const s = new Surface(W, H);
  const r = rng(13700 + variant * 211);
  // Vines hang on the `over` layer alongside the canopy patches, so they take
  // the same underlit treatment — anything up there painted at ground-foliage
  // value reads as growing out of the floor instead of hanging above it.
  const ramp: Ramp = [
    P.mix(P.WOODS_UNDER[0], P.OUTLINE, 0.5), P.WOODS_UNDER[0],
    P.WOODS_UNDER[1], P.WOODS_UNDER[2], P.WOODS_UNDER[3],
  ];
  const strands = variant === 2 ? 4 : 2 + variant;
  for (let i = 0; i < strands; i++) {
    let x = 2 + (i * (W - 4)) / Math.max(1, strands - 1) + r.range(-1, 1);
    const len = H * r.range(0.55, 1.0);
    for (let y = 0; y < len; y++) {
      const xi = Math.round(x + Math.sin(y * 0.16 + i) * 1.2);
      s.px(xi, y, ramp[3]);
      s.px(xi + 1, y, ramp[1]);
      s.px(xi + 2, y, ramp[0], 0.6);
      // leaves, alternating sides
      if (y > 2 && y % 3 === (i % 3)) {
        const d = y % 6 < 3 ? -1 : 1;
        s.px(xi + d, y, ramp[3]);
        s.px(xi + d, y + 1, ramp[2]);
        s.px(xi + d * 2, y, d < 0 ? ramp[4] : ramp[2]);
        s.px(xi + d * 2, y + 1, ramp[1]);
        s.px(xi + d * 3, y, ramp[1], 0.8);
      }
    }
    // the tendril tip curls
    const ty = Math.round(len);
    s.px(Math.round(x), ty, ramp[3]);
    s.px(Math.round(x) + 1, ty + 1, ramp[2]);
  }
  // the vine is anchored to something above, so the top edge is dense and dark
  for (let x = 0; x < W; x++) {
    if (s.alphaAt(x, 0)) { s.px(x, 0, ramp[1]); s.px(x, 1, ramp[2]); }
  }
  return s;
}

// ── stone, timber, and the things people left behind ───────────────────────

/**
 * A faceted stone. Built from overlapping ellipses so no two are the same
 * outline, then shaded on a single upper-left axis and cut flat at the base —
 * a rock that is round on the bottom floats, however good its shading is.
 */
function rockBlob(
  w: number, h: number, ramp: Ramp, seed: number,
  opts: { moss?: number; crack?: boolean } = {},
): Surface {
  const s = new Surface(w, h + 3);
  const r = rng(seed);
  const baseY = h;
  const m = new Surface(w, h + 3);
  m.ellipse(0, 2, w, h - 1, '#ffffff');
  for (let i = 0; i < 3; i++) {
    const bw = r.int(Math.max(3, Math.round(w * 0.35)), Math.max(4, Math.round(w * 0.72)));
    const bh = r.int(Math.max(3, Math.round(h * 0.35)), Math.max(4, Math.round(h * 0.7)));
    m.ellipse(r.int(0, Math.max(0, w - bw)), r.int(1, Math.max(1, h - bh)), bw, bh, '#ffffff');
  }
  for (let y = baseY; y < s.h; y++) for (let x = 0; x < w; x++) m.data[(y * w + x) * 4 + 3] = 0;
  const n = valueNoise(seed + 13);
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < w; x++) {
      if (!m.alphaAt(x, y)) continue;
      const lit = 1 - ((x / w) * 0.45 + (y / h) * 0.8);
      const t = lit + (n(x, y, 2.4) - 0.5) * 0.34;
      const c = t > 0.66 ? ramp[4] : t > 0.5 ? ramp[3] : t > 0.32 ? ramp[2] : t > 0.16 ? ramp[1] : ramp[0];
      s.px(x, y, c);
    }
  }
  // one facet crease, so the stone has a plane rather than a gradient
  const fy = Math.round(h * r.range(0.42, 0.6));
  for (let x = 0; x < w; x++) {
    const y = fy + Math.round(Math.sin(x * 0.5 + seed) * 1.2);
    if (!m.alphaAt(x, y)) continue;
    s.px(x, y, ramp[0], 0.55);
    if (m.alphaAt(x, y + 1)) s.px(x, y + 1, ramp[3], 0.5);
  }
  if (opts.crack) {
    let cx = r.int(2, w - 3);
    for (let y = 2; y < baseY; y++) {
      if (m.alphaAt(cx, y)) s.px(cx, y, ramp[0], 0.7);
      if (r.chance(0.35)) cx += r.chance(0.5) ? 1 : -1;
    }
  }
  if (opts.moss) {
    // moss sits on the top and the shaded side — never on the lit crown, which
    // is where water runs off
    for (let k = 0; k < opts.moss; k++) {
      const mx = r.int(0, w - 1), my = r.int(1, Math.max(2, Math.round(h * 0.55)));
      for (let j = 0; j < r.int(1, 3); j++) {
        for (let i = 0; i < r.int(2, 4); i++) {
          if (!m.alphaAt(mx + i, my + j)) continue;
          s.px(mx + i, my + j, j === 0 ? P.MOSS[3] : P.MOSS[1]);
        }
      }
    }
  }
  rim(s);
  contact(s, w / 2, baseY + 1, Math.round(w * 0.9), 4);
  return s;
}

/**
 * Fallen logs. A log is a *cylinder*, and the only thing that says so is a
 * tight highlight band across its upper third with the value falling away hard
 * below it — the first pass spread the ramp evenly down the height and the
 * result was a flat plank. The sawn end sits fully on canvas with concentric
 * rings, because that end is the read: it is what distinguishes a fallen log
 * from a shadow on the ground at 1x.
 */
function fallenLog(variant: number): Surface {
  const dims: Array<[number, number]> = [[44, 18], [34, 15], [52, 21]];
  const [W, H] = dims[variant % dims.length];
  const s = new Surface(W, H + 3);
  const r = rng(14100 + variant * 373);
  const ramp = P.WOODS_BARK;
  const top = 2, bot = H - 1;
  const capW = 9;
  const sag = variant === 2 ? 2 : 0;

  const shade = (u: number): string =>
    u < 0.10 ? ramp[2] : u < 0.30 ? ramp[4] : u < 0.48 ? ramp[3] :
    u < 0.72 ? ramp[2] : u < 0.88 ? ramp[1] : ramp[0];

  for (let x = capW - 2; x < W; x++) {
    const d = Math.round(Math.sin(((x - capW) / W) * Math.PI) * sag);
    for (let y = top + d; y <= bot + d; y++) s.px(x, y, shade((y - top - d) / (bot - top)));
    // lengthwise bark striations, only on the shaded half
    if (r.chance(0.5)) {
      const y = top + d + r.int(Math.round((bot - top) * 0.55), bot - top - 1);
      s.px(x, y, ramp[0], 0.5);
      if (r.chance(0.4)) s.px(x + 1, y, ramp[0], 0.35);
    }
    if (r.chance(0.18)) s.px(x, top + d + r.int(1, 3), ramp[4], 0.5);
  }
  // the sawn end: end grain, rings, and one radial split
  const cy = (top + bot) / 2, ch = bot - top + 1;
  s.ellipse(0, top, capW, ch, P.WOOD_LIGHT[1]);
  s.ellipse(1, top + 1, capW - 2, ch - 2, P.WOOD_LIGHT[3]);
  s.ellipse(2, top + 2, capW - 4, ch - 4, P.WOOD_LIGHT[2]);
  for (let ring = 1; ring <= 3; ring++) {
    s.ellipseOutline(
      ring, top + ring, Math.max(2, capW - ring * 2), Math.max(2, ch - ring * 2),
      ring % 2 ? P.WOOD_LIGHT[0] : P.WOOD_LIGHT[4], 0.7,
    );
  }
  s.line(2, Math.round(cy), capW - 2, Math.round(cy) - 2, P.WOOD_LIGHT[0], 0.8);
  for (let y = top; y <= bot; y++) s.px(capW - 1, y, ramp[0], 0.55);

  // moss in clumps on the upper surface — never in evenly spaced dashes
  for (let k = 0; k < 2 + variant; k++) {
    const mx = capW + r.int(1, Math.max(2, W - capW - 8));
    const w = r.int(4, 8);
    for (let i = 0; i < w; i++) {
      const d = Math.round(Math.sin(((mx + i - capW) / W) * Math.PI) * sag);
      const h = 1 + (i > 0 && i < w - 1 ? 1 : 0);
      for (let j = 0; j < h; j++) s.pxOver(mx + i, top + d + 1 + j, j === 0 ? P.MOSS[3] : P.MOSS[1]);
    }
  }
  if (variant !== 1) {
    // bracket fungus growing out of the flank
    for (let k = 0; k < 2; k++) {
      const mx = capW + 6 + k * 12 + r.int(0, 4);
      const my = top + Math.round(Math.sin(((mx - capW) / W) * Math.PI) * sag) + 1;
      s.px(mx, my, P.FUNGUS_CAP[3]);
      s.px(mx + 1, my, P.FUNGUS_CAP[4]);
      s.px(mx + 2, my, P.FUNGUS_CAP[2]);
      s.px(mx, my + 1, P.FUNGUS_CAP[0]);
      s.px(mx + 1, my + 1, P.FUNGUS_CAP[1]);
    }
  }
  rim(s);
  contact(s, W / 2, H + 1, W - 6, 5);
  return s;
}

/** Stumps: a short drum of trunk with end grain on top and roots at the foot. */
function stump(variant: number): Surface {
  const W = variant === 0 ? 22 : 18;
  const H = variant === 0 ? 20 : 16;
  const s = new Surface(W, H + 2);
  const r = rng(14400 + variant * 211);
  const ramp = P.WOODS_BARK;
  const topH = 5;           // the visible depth of the sawn face
  const bodyTop = 3;
  for (let y = bodyTop; y < H; y++) {
    for (let x = 2; x < W - 2; x++) {
      const u = (x - 2) / (W - 5);
      const c = u < 0.14 ? ramp[1] : u < 0.36 ? ramp[3] : u < 0.72 ? ramp[2] : u < 0.9 ? ramp[1] : ramp[0];
      s.px(x, y, c);
    }
    if (r.chance(0.5)) s.px(r.int(3, W - 4), y, ramp[0], 0.45);
  }
  // sawn top: a shallow ellipse, so the stump keeps its height
  s.ellipse(2, 0, W - 4, topH + 2, P.WOOD_LIGHT[1]);
  s.ellipse(3, 1, W - 6, topH, P.WOOD_LIGHT[3]);
  for (let ring = 1; ring <= 2; ring++) {
    s.ellipseOutline(
      2 + ring * 2, ring, W - 4 - ring * 4, Math.max(2, topH + 2 - ring * 2),
      ring % 2 ? P.WOOD_LIGHT[0] : P.WOOD_LIGHT[4], 0.65,
    );
  }
  s.px(Math.round(W / 2), Math.round(topH / 2), P.WOOD_LIGHT[0]);
  s.line(4, 2, W - 6, topH, P.WOOD_LIGHT[0], 0.55);
  // roots
  for (const dir of [-1, 1]) {
    for (let k = 0; k < 2; k++) {
      const sx = dir < 0 ? 2 : W - 3;
      const len = 3 + r.int(1, 3);
      for (let i = 0; i < len; i++) {
        s.px(sx + dir * i, H - 4 - k * 2 + Math.round(i * 0.6), dir < 0 ? ramp[3] : ramp[1]);
        s.px(sx + dir * i, H - 3 - k * 2 + Math.round(i * 0.6), ramp[0]);
      }
    }
  }
  for (let k = 0; k < 3; k++) s.pxOver(r.int(3, W - 4), topH + 2 + r.int(0, 3), P.MOSS[2], 0.7);
  rim(s);
  contact(s, W / 2, H, W - 4, 5);
  return s;
}

/** A heap of gathered branches — someone was here, and left in a hurry. */
function branchPile(): Surface {
  const W = 28, H = 16;
  const s = new Surface(W, H);
  const r = rng(14700);
  const ramp = P.WOODS_BARK;
  // Branches crowd toward the middle so the heap has a mound silhouette;
  // scattered evenly they read as spilled matchsticks.
  for (let k = 0; k < 14; k++) {
    const t = k / 13;
    const y0 = H - 2 - Math.round(Math.sin(t * Math.PI) * 7) - r.int(0, 2);
    const x0 = r.int(1, W - 12);
    const len = r.int(9, 17);
    const dy = r.range(-0.28, 0.28);
    const thick = r.chance(0.4) ? 2 : 1;
    for (let i = 0; i < len; i++) {
      const x = x0 + i, y = Math.round(y0 + dy * i);
      for (let j = 0; j < thick; j++) {
        s.px(x, y + j, j === 0 ? (k % 3 === 0 ? ramp[4] : ramp[3]) : ramp[1]);
      }
      s.px(x, y + thick, ramp[0], 0.75);
    }
  }
  // a few twig ends poking out of the heap
  for (let k = 0; k < 4; k++) {
    const x = r.int(2, W - 3), y = r.int(2, H - 6);
    for (let i = 0; i < 3; i++) s.px(x + i, y - Math.round(i * 0.6), ramp[2]);
  }
  rim(s);
  contact(s, W / 2, H - 1, W - 6, 5);
  return s;
}

/** A weathered fingerpost. The one piece of writing in the woods. */
function signpost(): Surface {
  const W = 28, H = 38;
  const s = new Surface(W, H);
  const ramp = P.WOOD;
  const px0 = 12;
  // post, with the grain and a weathered split
  for (let y = 6; y < H - 2; y++) {
    s.px(px0, y, ramp[3]);
    s.px(px0 + 1, y, ramp[2]);
    s.px(px0 + 2, y, ramp[1]);
    s.px(px0 + 3, y, ramp[0]);
    if ((y * 7) % 11 < 2) s.px(px0 + 1, y, ramp[0], 0.4);
  }
  for (let x = px0 - 1; x <= px0 + 4; x++) s.px(x, 5, ramp[4]);

  /** One fingerboard: a plank with a pointed end, nailed to the post. */
  const board = (by: number, dir: 1 | -1, len: number, h: number) => {
    const x0 = dir > 0 ? px0 : px0 + 3 - len;
    for (let i = 0; i < len; i++) {
      const x = x0 + i;
      // the last four columns taper to the point
      const fromTip = dir > 0 ? len - 1 - i : i;
      const tip = fromTip < 4 ? 4 - fromTip - 1 : 0;
      for (let y = by + tip; y <= by + h - 1 - tip; y++) {
        const u = (y - by - tip) / Math.max(1, h - 1 - tip * 2);
        s.px(x, y, u < 0.22 ? P.WOOD_LIGHT[4] : u < 0.5 ? P.WOOD_LIGHT[3] : u < 0.8 ? P.WOOD_LIGHT[2] : P.WOOD_LIGHT[0]);
      }
    }
    // carved lettering: two scratched lines, deliberately unreadable
    const tx = dir > 0 ? px0 + 4 : px0 - len + 5;
    for (let i = 0; i < len - 8; i++) {
      if (i % 5 !== 4) s.pxOver(tx + i, by + 2, P.WOOD[0], 0.8);
      if (i % 7 !== 6 && i < len - 10) s.pxOver(tx + i, by + 4, P.WOOD[0], 0.65);
    }
    // nail heads
    s.px(px0 + (dir > 0 ? 1 : 2), by + 1, P.IRON[4]);
    s.px(px0 + (dir > 0 ? 1 : 2), by + h - 2, P.IRON[3]);
  };
  board(8, 1, 16, 8);    // the main arm, pointing on toward the shrine
  board(19, -1, 12, 6);  // a smaller one pointing back toward town
  // moss on the shaded side of the post
  for (let k = 0; k < 4; k++) s.pxOver(px0 + 2, 26 + k * 2, P.MOSS[1], 0.55);
  rim(s);
  contact(s, px0 + 1, H - 1, 12, 5);
  return s;
}

/**
 * The lantern post: an old lit lamp on an iron pole.
 *
 * These do the compositional work the Stardew mine reference is built on. They
 * are not decoration — they are the zone's punctuation for "the path goes this
 * way, and here it is safe", so the lamp head is the most saturated warm thing
 * in the woods and it is the one place in the module where the house rule about
 * light coming from the upper-left is suspended: near a lantern, the lantern is
 * the light, so the post is lit from the head downward.
 */
function lanternPost(frame: number): Surface {
  const W = 20, H = 44;
  const s = new Surface(W, H);
  const cx = 10;
  const headY = 8;
  // glow first, behind everything, breathing across the four frames
  const rad = [9.0, 9.8, 9.3, 10.2][frame];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = Math.hypot(x - cx, (y - (headY + 4)) * 1.05);
      if (d > rad) continue;
      const t = 1 - d / rad;
      s.px(x, y, P.LANTERN[3], t * t * 0.34);
    }
  }
  // pole, lit from the lamp above rather than from the sky
  for (let y = headY + 10; y < H - 3; y++) {
    const t = 1 - (y - headY - 10) / (H - headY - 13);
    s.px(cx - 1, y, P.IRON[2]);
    s.px(cx, y, t > 0.5 ? P.IRON[4] : P.IRON[3]);
    s.px(cx + 1, y, P.IRON[1]);
  }
  // foot
  for (let x = cx - 4; x <= cx + 4; x++) {
    s.px(x, H - 3, P.IRON[3]);
    s.px(x, H - 2, P.IRON[1]);
  }
  s.px(cx - 4, H - 4, P.IRON[2]);
  s.px(cx + 4, H - 4, P.IRON[2]);
  // lamp housing: cap, glass, base
  for (let x = cx - 4; x <= cx + 4; x++) {
    const d = Math.abs(x - cx);
    s.px(x, headY - 3 + (d > 2 ? 1 : 0), P.IRON[4]);
    s.px(x, headY - 2 + (d > 2 ? 1 : 0), P.IRON[2]);
  }
  s.px(cx, headY - 5, P.IRON[3]);
  s.px(cx, headY - 4, P.IRON[4]);
  for (let y = headY; y <= headY + 8; y++) {
    for (let x = cx - 3; x <= cx + 3; x++) {
      const edge = x === cx - 3 || x === cx + 3;
      if (edge) { s.px(x, y, x < cx ? P.IRON[3] : P.IRON[1]); continue; }
      // glass: warm, brightest at the flame, and a highlight on the left pane
      const d = Math.hypot((x - cx) * 1.2, y - (headY + 4));
      const c = d < 1.6 ? P.LANTERN[4] : d < 3 ? P.LANTERN[3] : P.LANTERN[2];
      s.px(x, y, c);
    }
  }
  for (let x = cx - 4; x <= cx + 4; x++) {
    s.px(x, headY + 9, P.IRON[2]);
    s.px(x, headY + 10, P.IRON[0]);
  }
  // the flame, which is what actually animates
  const fx = [0, 0, 1, -1][frame];
  const fh = [3, 4, 3, 4][frame];
  for (let i = 0; i < fh; i++) {
    s.px(cx + fx, headY + 6 - i, i === 0 ? P.FIRE[2] : i < fh - 1 ? P.FIRE[3] : P.FIRE[4]);
  }
  s.px(cx + fx - 1, headY + 5, P.FIRE[2], 0.8);
  s.px(cx + fx + 1, headY + 5, P.FIRE[1], 0.8);
  // vertical glass mullions and a crack in one pane
  s.pxOver(cx - 1, headY + 7, P.IRON[1], 0.5);
  s.pxOver(cx + 2, headY + 2, P.IRON[1], 0.4);
  rim(s, P.OUTLINE, 0.8);
  contact(s, cx, H - 1, 12, 4, 0.3);
  return s;
}

/**
 * Standing stones. The first hint of the shrine: SHRINE_STONE, a shape that is
 * obviously *cut* rather than weathered, and rune traces so faint the player is
 * not sure they saw them. The runes are the only ECHO hue above the ground in
 * this whole zone, which is precisely why they land.
 */
function standingStone(variant: number): Surface {
  const dims: Array<[number, number]> = [[20, 38], [16, 30], [24, 44]];
  const [W, H] = dims[variant % dims.length];
  const s = new Surface(W, H);
  const r = rng(15100 + variant * 419);
  const ramp = P.SHRINE_STONE;
  const tilt = [0, -0.14, 0.1][variant % 3];
  const top = 3;
  // The silhouette is noise-perturbed on both sides and the crown is knocked
  // about. A straight taper reads as a turned column, and the woods already has
  // columns down at the shrine approach — these have to be the *rough* ones.
  const nL = valueNoise(15200 + variant * 31);
  const nR = valueNoise(15300 + variant * 31);
  const crown = 1 + r.int(0, 2);
  for (let y = top + crown; y < H - 2; y++) {
    const t = (y - top) / (H - top);
    const halfW = W * (0.24 + t * 0.13);
    const off = tilt * (1 - t) * 10;
    const jl = Math.round((nL(0, y, 5.5) - 0.5) * 3.2);
    const jr = Math.round((nR(0, y, 5.0) - 0.5) * 3.2);
    const x0 = Math.round(W / 2 + off - halfW) + jl;
    const x1 = Math.round(W / 2 + off + halfW) + jr;
    for (let x = x0; x <= x1; x++) {
      const u = (x - x0) / Math.max(1, x1 - x0);
      const c = u < 0.16 ? ramp[1] : u < 0.42 ? ramp[3] : u < 0.74 ? ramp[2] : u < 0.9 ? ramp[1] : ramp[0];
      s.px(x, y, c);
    }
    // the weathered crown catches what light there is
    if (y < top + crown + 2) for (let x = x0; x <= x1; x++) s.px(x, y, ramp[4]);
  }
  // a chipped shoulder: bite a wedge out of one upper corner
  {
    const side = variant % 2 ? 1 : -1;
    for (let j = 0; j < 4 + variant; j++) {
      for (let i = 0; i < 4 + variant - j; i++) {
        const x = side < 0 ? 1 + i : W - 2 - i;
        const y = top + crown + j;
        if (s.alphaAt(x, y)) s.data[(y * W + x) * 4 + 3] = 0;
      }
    }
    for (let j = 0; j < 5 + variant; j++) {
      const x = side < 0 ? 1 + (4 + variant - j) : W - 2 - (4 + variant - j);
      const y = top + crown + j;
      if (s.alphaAt(x, y)) s.px(x, y, ramp[4], 0.8);
    }
  }
  // chisel facets
  for (let k = 0; k < 3; k++) {
    const fy = top + r.int(4, H - 10);
    for (let x = 0; x < W; x++) {
      if (!s.alphaAt(x, fy)) continue;
      s.px(x, fy, ramp[0], 0.4);
      if (s.alphaAt(x, fy + 1)) s.px(x, fy + 1, ramp[4], 0.35);
    }
  }
  // rune traces: a vertical spine with three cross marks, barely there
  const rx = Math.round(W / 2 + tilt * 4);
  const ry0 = top + 6, ry1 = H - 12;
  for (let y = ry0; y <= ry1; y++) s.px(rx, y, P.ECHO_RUNE, 0.2);
  for (let k = 0; k < 3; k++) {
    const y = ry0 + 3 + k * Math.round((ry1 - ry0 - 4) / 3);
    for (let d = -2; d <= 2; d++) s.px(rx + d, y, P.ECHO_RUNE, 0.26);
    s.px(rx + (k % 2 ? 2 : -2), y - 1, P.ECHO_RUNE, 0.3);
  }
  // Surface grit. Without it the smooth taper plus SHRINE_STONE's cool ramp
  // reads as glazed pottery rather than as a weathered cut stone.
  const grain = valueNoise(15400 + variant * 17);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!s.alphaAt(x, y)) continue;
      const g = grain(x, y, 2.2) * 0.6 + grain(x * 2, y * 2, 1.1) * 0.4;
      if (g > 0.72) s.px(x, y, ramp[4], 0.3);
      else if (g < 0.3) s.px(x, y, ramp[0], 0.34);
    }
  }
  for (let k = 0; k < 7; k++) {
    const px = r.int(2, W - 3), py = r.int(4, H - 4);
    if (s.alphaAt(px, py)) s.px(px, py, ramp[0], 0.5);
  }
  // lichen at the base, and the stone is bedded into the ground
  for (let k = 0; k < 5; k++) s.pxOver(r.int(3, W - 4), H - 7 + r.int(0, 4), P.MOSS[1], 0.55);
  rim(s);
  contact(s, W / 2, H - 1, Math.round(W * 0.8), 5);
  return s;
}

/** The hidden chest. Original design: a stubby banded box with a leaf clasp. */
function chest(open: boolean): Surface {
  const W = 26, H = 24;
  const s = new Surface(W, H);
  const bodyTop = open ? 10 : 9;
  // body
  for (let y = bodyTop; y < H - 2; y++) {
    for (let x = 2; x < W - 2; x++) {
      const u = (x - 2) / (W - 5);
      const v = (y - bodyTop) / (H - 2 - bodyTop);
      const c = v > 0.78 ? P.WOOD[0] : u < 0.12 ? P.WOOD[1] : u < 0.34 ? P.WOOD[3] : u < 0.76 ? P.WOOD[2] : P.WOOD[1];
      s.px(x, y, c);
    }
  }
  // plank seams
  for (let y = bodyTop + 3; y < H - 3; y += 4) {
    for (let x = 2; x < W - 2; x++) s.pxOver(x, y, P.WOOD[0], 0.6);
  }
  // iron bands down the body
  for (const bx of [5, W - 7]) {
    for (let y = bodyTop; y < H - 2; y++) {
      s.px(bx, y, P.IRON[3]);
      s.px(bx + 1, y, P.IRON[1]);
    }
  }
  // lid
  if (!open) {
    for (let y = 4; y < bodyTop; y++) {
      const inset = y < 6 ? 3 : 2;
      for (let x = 2 + inset - 2; x < W - 2 - inset + 2; x++) {
        const u = (x - 2) / (W - 5);
        s.px(x, y, y < 6 ? P.WOOD_LIGHT[4] : u < 0.35 ? P.WOOD_LIGHT[3] : u < 0.75 ? P.WOOD_LIGHT[2] : P.WOOD_LIGHT[1]);
      }
    }
    for (const bx of [5, W - 7]) {
      for (let y = 4; y < bodyTop; y++) { s.px(bx, y, P.IRON[3]); s.px(bx + 1, y, P.IRON[1]); }
    }
    // the clasp: a bronze leaf, which is the chest's whole identity
    const cx = Math.round(W / 2);
    s.px(cx, bodyTop - 3, P.BRONZE[4]);
    s.px(cx - 1, bodyTop - 2, P.BRONZE[3]);
    s.px(cx, bodyTop - 2, P.BRONZE[4]);
    s.px(cx + 1, bodyTop - 2, P.BRONZE[2]);
    s.px(cx - 1, bodyTop - 1, P.BRONZE[2]);
    s.px(cx, bodyTop - 1, P.BRONZE[3]);
    s.px(cx + 1, bodyTop - 1, P.BRONZE[1]);
    s.px(cx, bodyTop, P.BRONZE[1]);
    s.px(cx, bodyTop + 1, P.BRONZE[0]);
  } else {
    // lid thrown back, and warm light spilling out of the box
    for (let y = 1; y < 6; y++) {
      for (let x = 4; x < W - 4; x++) {
        const u = (x - 4) / (W - 9);
        s.px(x, y, y < 3 ? P.WOOD[1] : u < 0.4 ? P.WOOD_LIGHT[1] : P.WOOD_LIGHT[0]);
      }
    }
    for (let x = 4; x < W - 4; x++) s.px(x, 6, P.OUTLINE, 0.8);
    for (let y = 7; y < bodyTop; y++) {
      for (let x = 3; x < W - 3; x++) {
        const d = Math.abs(x - W / 2) / (W / 2);
        s.px(x, y, y === 7 ? P.LANTERN[4] : d < 0.4 ? P.LANTERN[3] : P.LANTERN[2]);
      }
    }
    for (let y = bodyTop; y < bodyTop + 3; y++) {
      for (let x = 4; x < W - 4; x++) s.px(x, y, P.LANTERN[1], 0.6 - (y - bodyTop) * 0.18);
    }
  }
  rim(s);
  contact(s, W / 2, H - 1, W - 6, 5);
  return s;
}

/** Spider webs: strung in a corner, faint, and drawn with real radial threads. */
function spiderWeb(variant: number): Surface {
  const S = variant === 0 ? 24 : 18;
  const s = new Surface(S, S);
  const spokes = variant === 0 ? 7 : 6;
  const ox = 1, oy = 1; // anchored to the upper-left corner
  const c = P.LINEN[3];
  for (let i = 0; i < spokes; i++) {
    const a = (i / (spokes - 1)) * (Math.PI / 2);
    s.line(ox, oy, Math.round(ox + Math.cos(a) * (S - 3)), Math.round(oy + Math.sin(a) * (S - 3)), c, 0.3);
  }
  // the spiral, drawn as arcs between the spokes
  for (let ring = 1; ring <= (variant === 0 ? 4 : 3); ring++) {
    const rr = (ring / 5) * (S - 3);
    for (let i = 0; i < spokes - 1; i++) {
      const a0 = (i / (spokes - 1)) * (Math.PI / 2);
      const a1 = ((i + 1) / (spokes - 1)) * (Math.PI / 2);
      const sag = 1.4;
      const mx = Math.round(ox + Math.cos((a0 + a1) / 2) * (rr - sag));
      const my = Math.round(oy + Math.sin((a0 + a1) / 2) * (rr - sag));
      s.line(Math.round(ox + Math.cos(a0) * rr), Math.round(oy + Math.sin(a0) * rr), mx, my, c, 0.26);
      s.line(mx, my, Math.round(ox + Math.cos(a1) * rr), Math.round(oy + Math.sin(a1) * rr), c, 0.26);
    }
  }
  if (variant === 1) {
    // a torn corner, and something small wrapped up in it
    for (let y = S - 6; y < S; y++) for (let x = S - 6; x < S; x++) s.data[(y * S + x) * 4 + 3] = 0;
    s.ellipse(7, 9, 3, 4, P.LINEN[0], 0.6);
    s.px(8, 10, P.LINEN[2], 0.5);
  }
  return s;
}

/** Bones. Old, half-sunk in the litter, and not gory — this is a pacing zone. */
function bones(variant: number): Surface {
  const W = 20, H = 14;
  const s = new Surface(W, H);
  const r = rng(15600 + variant * 97);
  const ramp = P.BONE;
  if (variant === 0) {
    // a skull, three-quarter, with the jaw missing
    s.ellipse(4, 3, 10, 8, ramp[2]);
    s.ellipse(5, 3, 8, 6, ramp[3]);
    s.ellipse(5, 2, 6, 4, ramp[4]);
    s.ellipse(6, 6, 3, 3, P.OUTLINE, 0.85); // eye socket
    s.ellipse(10, 6, 3, 3, P.OUTLINE, 0.7);
    s.px(8, 9, P.OUTLINE, 0.8);
    s.px(9, 9, P.OUTLINE, 0.8);
    for (let x = 4; x < 13; x++) s.px(x, 11, ramp[1]);
    // a couple of loose ribs beside it
    for (let k = 0; k < 3; k++) {
      const x0 = 14, y0 = 5 + k * 3;
      for (let i = 0; i < 5; i++) s.px(x0 + i, y0 + Math.round(i * 0.35), ramp[k === 0 ? 3 : 2]);
    }
  } else {
    // a scatter: two long bones crossed and some fragments
    for (const [x0, y0, x1, y1] of [[2, 10, 16, 4], [3, 4, 15, 11]] as const) {
      s.line(x0, y0, x1, y1, ramp[3]);
      s.line(x0, y0 + 1, x1, y1 + 1, ramp[1]);
      s.ellipse(x0 - 1, y0 - 1, 3, 3, ramp[4]);
      s.ellipse(x1 - 1, y1 - 1, 3, 3, ramp[2]);
    }
    for (let k = 0; k < 4; k++) s.px(r.int(2, W - 3), r.int(2, H - 2), ramp[2]);
  }
  rim(s, P.OUTLINE, 0.8);
  contact(s, W / 2, H - 1, W - 6, 4, 0.26);
  return s;
}

/** A cold campfire. Someone camped here; they are not here now. */
function campfireOut(): Surface {
  const W = 24, H = 16;
  const s = new Surface(W, H);
  const r = rng(15800);
  // ring of stones
  const n = 8;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = Math.round(12 + Math.cos(a) * 9);
    const y = Math.round(10 + Math.sin(a) * 4.5);
    const back = Math.sin(a) < -0.2;
    const ramp = P.WOODS_ROCK;
    s.ellipse(x - 2, y - 2, 5, 4, back ? ramp[1] : ramp[2]);
    s.ellipse(x - 2, y - 2, 5, 2, back ? ramp[2] : ramp[4]);
    s.px(x, y + 2, P.OUTLINE, 0.5);
  }
  // ash bed
  s.ellipse(6, 7, 13, 7, P.WOODS_ROCK[0]);
  s.ellipse(7, 8, 11, 5, P.mix(P.WOODS_ROCK[1], P.BONE[0], 0.4));
  speckle(s, r, 7, 8, 11, 5, P.BONE[2], 6, 0.5);
  // charred logs, black with a grey ashed end
  for (const [x0, y0, x1, y1] of [[6, 11, 16, 7], [7, 7, 17, 11]] as const) {
    s.line(x0, y0, x1, y1, P.OUTLINE);
    s.line(x0, y0 - 1, x1, y1 - 1, P.mix(P.OUTLINE, P.WOODS_BARK[2], 0.5));
    s.px(x1, y1, P.BONE[1]);
    s.px(x1 - 1, y1, P.BONE[0]);
  }
  contact(s, 12, H - 1, 20, 4, 0.24);
  return s;
}

/** A broken handcart. The strongest "something went wrong here" prop in the set. */
function oldCart(): Surface {
  const W = 46, H = 34;
  const s = new Surface(W, H);
  const ramp = P.WOOD;
  // the bed, tipped: a parallelogram of planks
  for (let i = 0; i < 7; i++) {
    const y0 = 12 + i * 2;
    for (let x = 6; x < 34; x++) {
      const t = (x - 6) / 28;
      const y = Math.round(y0 - t * 5);
      s.px(x, y, i % 2 ? ramp[2] : ramp[3]);
      s.px(x, y + 1, ramp[1]);
    }
  }
  // side rail and a broken upright
  for (let x = 6; x < 32; x++) {
    const y = Math.round(11 - ((x - 6) / 26) * 5);
    s.px(x, y, P.WOOD_LIGHT[4]);
    s.px(x, y - 1, P.WOOD_LIGHT[2]);
  }
  for (let y = 2; y < 10; y++) { s.px(9, y, ramp[3]); s.px(10, y, ramp[1]); }
  for (let i = 0; i < 4; i++) s.px(9 + i, 2 - i, ramp[i % 2 ? 0 : 2]); // splintered top
  // the shafts, pointing at the ground
  for (let i = 0; i < 12; i++) {
    s.px(34 + i, 8 + i, ramp[3]);
    s.px(34 + i, 9 + i, ramp[0]);
  }
  // wheel still on, half sunk
  const wx = 14, wy = 24;
  s.ellipseOutline(wx - 9, wy - 9, 18, 18, P.WOOD[1]);
  s.ellipseOutline(wx - 8, wy - 8, 16, 16, P.WOOD[3]);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    s.line(wx, wy, Math.round(wx + Math.cos(a) * 7), Math.round(wy + Math.sin(a) * 7), P.WOOD[i < 3 ? 3 : 1]);
  }
  s.ellipse(wx - 2, wy - 2, 5, 5, P.IRON[2]);
  s.ellipse(wx - 1, wy - 2, 3, 3, P.IRON[4]);
  // the other wheel, off and lying flat behind the cart
  s.ellipseOutline(30, 24, 14, 7, P.WOOD[1]);
  s.ellipseOutline(31, 25, 12, 5, P.WOOD[2]);
  // grass has grown up through it
  for (let k = 0; k < 7; k++) {
    const x = 8 + k * 5;
    s.px(x, 30, P.WOODS_UNDER[3]);
    s.px(x, 29, P.WOODS_UNDER[4]);
    s.px(x + 1, 30, P.WOODS_UNDER[2]);
  }
  rim(s);
  contact(s, 22, H - 2, 34, 7);
  return s;
}

/**
 * Drifting ground mist, for the `over` layer.
 *
 * Wide, low, and *thin*: the whole effect depends on staying under about 45%
 * alpha, because mist that hides the floor stops being atmosphere and starts
 * being a fog-of-war bug. The edges are Bayer-dithered rather than soft-faded
 * so it still looks like pixel art at 1x rather than a blurred sprite.
 */
function mist(frame: number): Surface {
  const W = 64, H = 24;
  const s = new Surface(W, H);
  const n1 = valueNoise(16100);
  const n2 = valueNoise(16200);
  const drift = frame * 5;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = n1(x + drift, y * 2.2, 13) * 0.62 + n2(x * 1.6 + drift * 1.4, y * 2.4, 6) * 0.38;
      // vertical falloff: densest through the middle band, gone top and bottom
      const fy = 1 - Math.abs((y - H * 0.58) / (H * 0.55));
      const d = (v - 0.42) * 2.4 * Math.max(0, fy);
      if (d <= 0.04) continue;
      const bay = ((x & 3) * 4 + (y & 3)) / 16;
      if (d < 0.34 && bay > d * 2.2) continue; // dithered frontier
      const a = Math.min(0.48, d * 0.58);
      const c = d > 0.6 ? P.MIST_RAMP[4] : d > 0.42 ? P.MIST_RAMP[3] : P.MIST_RAMP[2];
      s.px(x, y, c, a);
    }
  }
  return s;
}

/** Shrine architecture, half-swallowed: broken columns and a standing arch. */
function brokenColumn(variant: number): Surface {
  const dims: Array<[number, number]> = [[20, 40], [18, 26], [30, 16]];
  const [W, H] = dims[variant % dims.length];
  const s = new Surface(W, H + 2);
  const r = rng(16400 + variant * 313);
  const ramp = P.SHRINE_STONE;
  const flute = (x0: number, x1: number, y0: number, y1: number) => {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const u = (x - x0) / Math.max(1, x1 - x0);
        // Cylinder shading first. The fluting is then only a groove line with a
        // catch-light beside it — drawn as full-width alternating bands it
        // turns the column into a barcode and kills the round form.
        let c = u < 0.14 ? ramp[1] : u < 0.4 ? ramp[3] : u < 0.74 ? ramp[2] : u < 0.9 ? ramp[1] : ramp[0];
        const span = Math.max(1, x1 - x0);
        if ((x - x0) % 5 === 3 && u > 0.1 && u < 0.92) c = P.mix(c, ramp[0], 0.55);
        else if ((x - x0) % 5 === 4 && u > 0.1 && u < 0.92) c = P.mix(c, ramp[4], 0.35);
        if (span > 6 && u > 0.24 && u < 0.36) c = ramp[4];
        s.px(x, y, c);
      }
    }
  };
  if (variant === 2) {
    // Toppled, so the shaft is a HORIZONTAL cylinder and its flutes run along
    // its length. Reusing the upright painter here left the flutes running
    // across the fallen column, which read as a cattle grid.
    const y0 = 3, y1 = H - 2;
    for (let x = 3; x < W - 1; x++) {
      for (let y = y0; y <= y1; y++) {
        const u = (y - y0) / (y1 - y0);
        let c = u < 0.10 ? ramp[2] : u < 0.30 ? ramp[4] : u < 0.5 ? ramp[3] :
          u < 0.74 ? ramp[2] : u < 0.9 ? ramp[1] : ramp[0];
        if ((y - y0) % 4 === 3) c = P.mix(c, ramp[0], 0.5);
        s.px(x, y, c);
      }
    }
    // drum joints across the shaft
    for (let x = 3 + 10; x < W - 2; x += 10) {
      for (let y = y0; y <= y1; y++) {
        s.pxOver(x, y, ramp[0], 0.7);
        s.pxOver(x + 1, y, ramp[4], 0.3);
      }
    }
    // the broken end, facing the camera
    s.ellipse(0, y0, 6, y1 - y0 + 1, ramp[1]);
    s.ellipse(1, y0 + 1, 4, y1 - y0 - 1, ramp[3]);
    s.ellipse(2, y0 + 2, 2, y1 - y0 - 3, ramp[2]);
    for (let y = y0; y <= y1; y++) s.px(5, y, ramp[0], 0.5);
  } else {
    const top = variant === 0 ? 6 : 4;
    flute(3, W - 4, top, H - 1);
    // one horizontal drum joint, so the column reads as stacked stone
    const joint = top + Math.round((H - top) * 0.55);
    for (let x = 3; x <= W - 4; x++) {
      s.pxOver(x, joint, ramp[0], 0.7);
      s.pxOver(x, joint + 1, ramp[4], 0.35);
    }
    // the broken top: jagged, lit on its upper faces
    for (let x = 3; x < W - 3; x++) {
      const d = Math.round(Math.abs(Math.sin((x + variant) * 1.3)) * 3);
      for (let y = top - d; y < top; y++) s.px(x, y, y === top - d ? ramp[4] : ramp[2]);
      s.px(x, top - d - 1, P.OUTLINE, 0.5);
    }
    // base plinth
    for (let x = 1; x < W - 1; x++) {
      s.px(x, H - 2, ramp[3]);
      s.px(x, H - 1, ramp[1]);
    }
  }
  for (let k = 0; k < 5; k++) s.pxOver(r.int(2, W - 3), r.int(H - 12, H - 1), P.MOSS[1], 0.5);
  if (variant === 0) {
    for (let k = 0; k < 3; k++) s.px(r.int(5, W - 6), r.int(10, H - 6), P.ECHO_RUNE, 0.22);
  }
  rim(s);
  contact(s, W / 2, H, W - 4, 5);
  return s;
}

/** The carved arch at the shrine approach: a gate the player walks through. */
function carvedArch(): Surface {
  const W = 52, H = 50;
  const s = new Surface(W, H);
  const ramp = P.SHRINE_STONE;
  const legW = 9;
  const paint = (x: number, y: number, u: number, shade = 0) => {
    const c = u < 0.16 ? ramp[1] : u < 0.44 ? ramp[3] : u < 0.78 ? ramp[2] : ramp[1];
    s.px(x, y, shade ? P.mix(c, P.OUTLINE, shade) : c);
  };
  // legs
  for (const lx of [3, W - 3 - legW]) {
    for (let y = 16; y < H - 2; y++) {
      for (let i = 0; i < legW; i++) paint(lx + i, y, i / (legW - 1), lx > W / 2 ? 0.18 : 0);
    }
    for (let i = -1; i <= legW; i++) {
      s.px(lx + i, H - 2, ramp[3]);
      s.px(lx + i, H - 1, ramp[0]);
      s.px(lx + i, 15, ramp[4]);
    }
  }
  // the arch itself: a ring, cut off below the springing line
  const cx = W / 2, cy = 20, rOut = 23, rIn = 14;
  for (let y = 0; y <= cy; y++) {
    for (let x = 0; x < W; x++) {
      const d = Math.hypot((x - cx) * 1.0, (y - cy) * 1.25);
      if (d > rOut || d < rIn) continue;
      const u = (d - rIn) / (rOut - rIn);
      paint(x, y, u, x > cx ? 0.18 : 0);
    }
  }
  // keystone
  for (let y = 0; y < 8; y++) {
    for (let x = Math.round(cx) - 3; x <= Math.round(cx) + 3; x++) {
      const u = (x - cx + 3) / 6;
      s.px(x, y, u < 0.3 ? ramp[4] : u < 0.7 ? ramp[3] : ramp[1]);
    }
  }
  // carved band and rune traces on the keystone
  for (let x = 0; x < W; x++) {
    for (let y = 0; y <= cy; y++) {
      const d = Math.hypot(x - cx, (y - cy) * 1.25);
      if (Math.abs(d - (rIn + 3)) < 0.6) s.pxOver(x, y, ramp[0], 0.6);
      if (Math.abs(d - (rIn + 4.5)) < 0.6) s.pxOver(x, y, ramp[4], 0.4);
    }
  }
  s.px(Math.round(cx), 3, P.ECHO_RUNE, 0.3);
  s.px(Math.round(cx) - 1, 4, P.ECHO_RUNE, 0.22);
  s.px(Math.round(cx) + 1, 4, P.ECHO_RUNE, 0.22);
  s.px(Math.round(cx), 5, P.ECHO_RUNE, 0.26);
  // it has been standing a long time
  for (let k = 0; k < 8; k++) {
    const r2 = rng(16800 + k);
    s.pxOver(r2.int(2, W - 3), r2.int(H - 18, H - 2), P.MOSS[1], 0.5);
  }
  rim(s);
  contact(s, cx, H - 1, W - 10, 6);
  return s;
}

/** The whole cliff set: lips, faces, feet, ends, corners and the cut stair. */
function registerCliffs(b: ArtBuild): void {
  const blank = () => new Surface(TILE, TILE);

  // Lips along a straight run. Transparent above the lip, so the plateau keeps
  // whatever ground material the map author put there.
  for (let i = 0; i < 3; i++) {
    const s = blank(); ledgeLip(s, 's', 0, TILE - 1, 7701 + i * 13);
    b.addTile(`tile/woods/cliff_top_s_${i}`, s);
  }
  for (let i = 0; i < 3; i++) {
    const s = blank(); ledgeLip(s, 'n', 0, TILE - 1, 7731 + i * 13);
    b.addTile(`tile/woods/cliff_top_n_${i}`, s);
  }
  for (let i = 0; i < 2; i++) {
    const s = blank(); ledgeLip(s, 'w', 0, TILE - 1, 7761 + i * 13);
    b.addTile(`tile/woods/cliff_top_w_${i}`, s);
  }
  for (let i = 0; i < 2; i++) {
    const s = blank(); ledgeLip(s, 'e', 0, TILE - 1, 7781 + i * 13);
    b.addTile(`tile/woods/cliff_top_e_${i}`, s);
  }

  // Outer (convex) corners: both sides drop away, so both lips run full length.
  const outer: Array<[string, 'n' | 's', 'e' | 'w']> = [
    ['sw', 's', 'w'], ['se', 's', 'e'], ['nw', 'n', 'w'], ['ne', 'n', 'e'],
  ];
  for (const [name, v, h] of outer) {
    const s = blank();
    ledgeLip(s, h, 0, TILE - 1, 7801);
    ledgeLip(s, v, 0, TILE - 1, 7811);
    b.addTile(`tile/woods/cliff_top_${name}`, s);
  }

  // Inner (concave) corners: the tile is almost all plateau and the drop only
  // nicks one corner, so each lip is a short fragment that turns.
  const inner: Array<[string, 'n' | 's', number, number, 'e' | 'w', number, number]> = [
    ['se', 's', 11, 15, 'e', 11, 15],
    ['sw', 's', 0, 4, 'w', 11, 15],
    ['ne', 'n', 11, 15, 'e', 0, 4],
    ['nw', 'n', 0, 4, 'w', 0, 4],
  ];
  for (const [name, v, vf, vt, h, hf, ht] of inner) {
    const s = blank();
    ledgeLip(s, h, hf, ht, 7821);
    ledgeLip(s, v, vf, vt, 7831);
    b.addTile(`tile/woods/cliff_inner_${name}`, s);
  }

  // The face itself: the upper piece is solid rock, the base piece meets the
  // lower ground and fades its cast shadow out into transparency.
  for (let i = 0; i < 3; i++) {
    const s = blank();
    faceRock(s, 0, 0, TILE - 1, TILE - 1, 7901 + i * 29);
    faceMoss(s, 7951 + i * 7, 4 + i * 2);
    b.addTile(`tile/woods/cliff_face_${i}`, s);
  }
  for (let i = 0; i < 3; i++) {
    const s = blank();
    faceRock(s, 0, 0, TILE - 1, 10, 8001 + i * 29);
    const r = rng(8051 + i);
    // rubble piled where the face meets the ground
    for (let k = 0; k < 4; k++) {
      const rx = r.int(0, TILE - 4), ry = 8 + r.int(0, 3);
      const w = r.int(2, 4), h = r.int(2, 3);
      for (let j = 0; j < h; j++) {
        for (let x = 0; x < w; x++) s.px(rx + x, ry + j, j === 0 ? P.WOODS_ROCK[3] : P.WOODS_ROCK[1]);
      }
      for (let x = 0; x < w; x++) s.px(rx + x, ry + h, P.OUTLINE, 0.6);
    }
    for (let x = 0; x < TILE; x++) {
      s.pxBehind(x, 11, P.WOODS_ROCK[0]);
      s.px(x, 12, P.OUTLINE, 0.5);
      s.px(x, 13, P.OUTLINE, 0.32);
      s.px(x, 14, P.OUTLINE, 0.18);
    }
    b.addTile(`tile/woods/cliff_base_${i}`, s);
  }

  // The ends of a face run, where the rock turns away from the camera.
  for (const side of ['l', 'r'] as const) {
    for (const kind of ['face', 'base'] as const) {
      const s = blank();
      const bottom = kind === 'face' ? TILE - 1 : 10;
      if (side === 'l') {
        faceRock(s, 3, 0, TILE - 1, bottom, 8101);
        faceRock(s, 0, 0, 2, bottom, 8111);
        for (let y = 0; y <= bottom; y++) {
          s.px(3, y, P.WOODS_ROCK[4], 0.85); // the lit corner of the turn
          s.px(2, y, P.WOODS_ROCK[1]);
          s.px(0, y, P.WOODS_ROCK[0], 0.8);
        }
      } else {
        faceRock(s, 0, 0, TILE - 4, bottom, 8121);
        faceRock(s, TILE - 3, 0, TILE - 1, bottom, 8131);
        for (let y = 0; y <= bottom; y++) {
          s.px(TILE - 4, y, P.OUTLINE, 0.75); // the shaded corner of the turn
          s.px(TILE - 3, y, P.WOODS_ROCK[0]);
          s.px(TILE - 1, y, P.WOODS_ROCK[1], 0.8);
        }
      }
      if (kind === 'face') faceMoss(s, 8141 + (side === 'l' ? 0 : 5), 5);
      else {
        for (let x = 0; x < TILE; x++) {
          s.pxBehind(x, 11, P.WOODS_ROCK[0]);
          s.px(x, 12, P.OUTLINE, 0.5);
          s.px(x, 13, P.OUTLINE, 0.3);
        }
      }
      b.addTile(`tile/woods/cliff_${kind}_${side}`, s);
    }
  }

  b.addTile('tile/woods/stairs_up_0', stairsTile(0, 8201));
  b.addTile('tile/woods/stairs_up_1', stairsTile(1, 8211));
}

export function registerWoods(b: ArtBuild): void {
  // ── ground ───────────────────────────────────────────────────────────────
  for (let i = 0; i < 6; i++) b.addTile(`tile/woods/grass_${i}`, woodsGrassTile(6101, i));
  for (let i = 0; i < 4; i++) b.addTile(`tile/woods/soil_${i}`, woodsSoilTile(6201, i));
  for (let i = 0; i < 4; i++) b.addTile(`tile/woods/leaflitter_${i}`, leafLitterTile(6301, i));
  for (let i = 0; i < 4; i++) b.addTile(`tile/woods/shrine_stone_${i}`, shrineStoneTile(6501, i));

  // ── overlay materials ────────────────────────────────────────────────────
  registerBlobSet(b, 'blob/woods_path', 6401, woodsPathPainter(6401), { wobble: 1.35 });
  registerBlobSet(b, 'blob/woods_moss', 6601, mossPainter(6601), { wobble: 1.7, radius: 4.6 });
  registerBlobSet(b, 'blob/woods_bramble', 6701, bramblePainter(6701), { wobble: 1.5 });

  // The stream: four whole blob sets, one per animation frame, swapped on the
  // detail layer by the runtime exactly as the town river is.
  const streamFrames: number[][] = [];
  for (let f = 0; f < 4; f++) {
    streamFrames.push(
      registerBlobSet(b, `blob/woods_water_f${f}`, 6801, streamPainter(6801, f), { wobble: 0.9, radius: 5 }),
    );
  }
  b.blobs['blob/woods_water'] = streamFrames[0];
  b.blobFrames['blob/woods_water'] = { frames: streamFrames, frameRate: 4 };

  registerCliffs(b);

  // ── props: trees and canopy ──────────────────────────────────────────────
  for (let i = 0; i < 4; i++) b.add(`prop/woods/tree_dark_${i}`, darkTree(i));
  for (let i = 0; i < 3; i++) b.add(`prop/woods/tree_dead_${i}`, deadTree(i));
  b.add('prop/woods/tree_hollow', hollowTree());
  for (let i = 0; i < 4; i++) b.add(`prop/woods/canopy_${i}`, canopyPatch(i));

  // ── props: undergrowth ───────────────────────────────────────────────────
  for (let i = 0; i < 4; i++) b.add(`prop/woods/bush_${i}`, bush(i));
  for (let i = 0; i < 3; i++) b.add(`prop/woods/cuttable_bush_${i}`, cuttableBush(i));
  b.addStrip('prop/woods/bush_cut', bushCutFrames(), { key: 'bush_cut', frameRate: 14, repeat: 0 });
  for (let i = 0; i < 4; i++) b.add(`prop/woods/fern_${i}`, fern(i));
  for (let i = 0; i < 4; i++) b.add(`prop/woods/mushroom_${i}`, mushroom(i));
  b.add('prop/woods/toadstool_ring', toadstoolRing());
  for (let i = 0; i < 3; i++) b.add(`prop/woods/vine_${i}`, vine(i));

  // ── props: stone ─────────────────────────────────────────────────────────
  const rockDims: Array<[number, number]> = [[13, 10], [10, 8], [16, 12], [11, 9]];
  rockDims.forEach(([w, h], i) => {
    b.add(`prop/woods/rock_${i}`, rockBlob(w, h, P.WOODS_ROCK, 13900 + i * 151, { crack: i === 2 }));
  });
  b.add('prop/woods/boulder_0', rockBlob(30, 24, P.WOODS_ROCK, 13960, { crack: true, moss: 3 }));
  b.add('prop/woods/boulder_1', rockBlob(26, 21, P.WOODS_ROCK, 13970, { moss: 2 }));
  for (let i = 0; i < 3; i++) {
    b.add(`prop/woods/mossy_stone_${i}`, rockBlob(18 + i * 3, 14 + i * 2, P.WOODS_ROCK, 13980 + i * 61, { moss: 5 + i }));
  }

  // ── props: timber and traces of people ───────────────────────────────────
  for (let i = 0; i < 3; i++) b.add(`prop/woods/log_fallen_${i}`, fallenLog(i));
  for (let i = 0; i < 2; i++) b.add(`prop/woods/stump_${i}`, stump(i));
  b.add('prop/woods/branch_pile', branchPile());
  b.add('prop/woods/signpost_woods', signpost());
  b.addStrip('prop/woods/lantern_post', [0, 1, 2, 3].map(lanternPost), {
    key: 'lantern_post', frameRate: 6, repeat: -1,
  });
  b.add('prop/woods/chest_wood_closed', chest(false));
  b.add('prop/woods/chest_wood_open', chest(true));
  for (let i = 0; i < 2; i++) b.add(`prop/woods/spider_web_${i}`, spiderWeb(i));
  for (let i = 0; i < 2; i++) b.add(`prop/woods/bones_${i}`, bones(i));
  b.add('prop/woods/campfire_out', campfireOut());
  b.add('prop/woods/old_cart_broken', oldCart());

  // ── props: atmosphere and the shrine approach ────────────────────────────
  b.addStrip('prop/woods/mist', [0, 1, 2, 3].map(mist), {
    key: 'woods_mist', frameRate: 2, repeat: -1,
  });
  for (let i = 0; i < 3; i++) b.add(`prop/woods/standing_stone_${i}`, standingStone(i));
  for (let i = 0; i < 3; i++) b.add(`prop/woods/broken_column_${i}`, brokenColumn(i));
  b.add('prop/woods/carved_arch', carvedArch());
}
