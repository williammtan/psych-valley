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
import { Surface, rng, valueNoise, speckle, ditherFill, type Rng } from '../lib/pixel.js';
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
    const x0 = side === 'w' ? 0 : TILE - 3;
    for (let y = from; y <= to; y++) {
      const j = n(11, y * 3, 2.5) > 0.62 ? 1 : 0;
      for (let i = 0; i < 3; i++) s.px(x0 + i - (side === 'w' ? j : -j), y, ramp[1]);
    }
    faceRock(s, Math.max(0, x0 - 1), from, Math.min(TILE - 1, x0 + 2), to, seed + 13);
    for (let y = from; y <= to; y++) {
      const j = n(11, y * 3, 2.5) > 0.62 ? 1 : 0;
      if (side === 'w') {
        s.px(0 - j, y, ramp[3]);
        s.px(2 - j, y, P.OUTLINE, 0.8);
        s.px(3 - j, y, P.OUTLINE, 0.35);
      } else {
        s.px(TILE - 1 + j, y, ramp[2]);
        s.px(TILE - 3 + j, y, ramp[4], 0.8);
        s.px(TILE - 4 + j, y, P.OUTLINE, 0.5);
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
  mottle(s, ramp, seed + variant * 41, { scale: 3.0, lightAmt: 0.7, darkAmt: 0.36 });
  const r = rng(seed + variant * 97);
  // flagstone joints, staggered per variant
  const cuts = [0, 7, 16];
  for (const cy of cuts) {
    for (let x = 0; x < TILE; x++) {
      const j = Math.round(Math.sin((x + seed + variant) * 0.9) * 0.6);
      s.pxOver(x, cy + j, ramp[0], 0.85);
      if (cy + j + 1 < TILE) s.pxOver(x, cy + j + 1, ramp[4], 0.4);
    }
  }
  const stagger = [4, 11];
  for (let band = 0; band < cuts.length - 1; band++) {
    const sx = stagger[(band + variant) % stagger.length];
    for (let y = cuts[band] + 1; y < cuts[band + 1]; y++) s.pxOver(sx, y, ramp[0], 0.8);
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
  const ramp = P.WOODS_CANOPY;
  const sun = P.WOODS_LEAF_SUN;

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
  for (const c of clumps) paintClump(s, c, ramp, sun, 9800 + variant * 13, r, { bumps: 13, bites: 6, flat: 0.3 });
  notchEdge(s, r, 4 + lobes * 2);
  canopyUnderside(s, ramp);
  leafFringe(s, ramp, sun, r, 12 + lobes * 4);
  lightHoles(s, r, 2 + lobes, ramp, sun, 2.8);
  rim(s, P.OUTLINE, 0.7);
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

  // ── props ────────────────────────────────────────────────────────────────
  for (let i = 0; i < 4; i++) b.add(`prop/woods/tree_dark_${i}`, darkTree(i));
  for (let i = 0; i < 4; i++) b.add(`prop/woods/canopy_${i}`, canopyPatch(i));
}
