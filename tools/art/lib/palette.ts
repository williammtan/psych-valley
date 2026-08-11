/**
 * PROJECT PSYCHE — MASTER PALETTE
 *
 * One palette governs every pixel in the game. Ramps are 5 steps unless noted:
 *   [0] deep shadow  [1] shadow  [2] base  [3] light  [4] highlight
 *
 * Rules that keep the game looking like one artist made it:
 *  - Shadows drift toward violet-blue (#2a2440 family), never toward pure black.
 *  - Highlights drift toward warm cream (#ffe9c2 family) in town, toward cyan
 *    (#a8f0ff family) underground.
 *  - Outlines are never pure black; use OUTLINE / OUTLINE_SOFT.
 *  - The Echo owns violet + cyan. Nothing in town uses those hues at full
 *    saturation, so Echo-touched things read instantly as wrong.
 */

export type Ramp = readonly string[];

export const hex = (h: string): [number, number, number, number] => {
  const s = h.replace('#', '');
  if (s.length === 8) {
    return [
      parseInt(s.slice(0, 2), 16),
      parseInt(s.slice(2, 4), 16),
      parseInt(s.slice(4, 6), 16),
      parseInt(s.slice(6, 8), 16),
    ];
  }
  return [
    parseInt(s.slice(0, 2), 16),
    parseInt(s.slice(2, 4), 16),
    parseInt(s.slice(4, 6), 16),
    255,
  ];
};

// ── Neutrals ──────────────────────────────────────────────────────────────
export const OUTLINE = '#241d33';
export const OUTLINE_SOFT = '#3a3050';
export const OUTLINE_WARM = '#3d2a2a';
export const SHADOW_CAST = '#241d3355'; // drop shadow under entities

// ── Terrain: town ─────────────────────────────────────────────────────────
export const GRASS: Ramp = ['#1c3a2c', '#27543a', '#357049', '#4b8f56', '#6cb069'];
export const GRASS_DRY: Ramp = ['#33452a', '#4a5f31', '#66793b', '#87964c', '#a8b062'];
export const DIRT: Ramp = ['#402c22', '#5b4130', '#785640', '#957054', '#b28d6e'];
export const PATH_STONE: Ramp = ['#4a4038', '#6b5c4e', '#8b7a68', '#a99783', '#c6b6a1'];
export const COBBLE: Ramp = ['#3f3a3c', '#5c5457', '#7a7071', '#98908c', '#b8b1a8'];
export const SAND: Ramp = ['#7a6142', '#9c7d55', '#bc9c70', '#d6bb90', '#eddab4'];

// ── Water ─────────────────────────────────────────────────────────────────
export const WATER: Ramp = ['#153048', '#1d4a66', '#2a6a8c', '#3d8fac', '#6fbcc9'];
export const WATER_FOAM = '#d9f4f7';

// ── Wood / architecture ───────────────────────────────────────────────────
export const WOOD: Ramp = ['#332015', '#4d3220', '#6b4830', '#8a6242', '#a87e58'];
export const WOOD_LIGHT: Ramp = ['#4a3020', '#6d492e', '#8e6642', '#ae8760', '#cba885'];
export const PLASTER: Ramp = ['#7a6553', '#9e8770', '#c0a98d', '#dcc9a9', '#f2e5c8'];
export const ROOF_RED: Ramp = ['#4a1f22', '#6e2f2c', '#93453a', '#b45f47', '#d0805c'];
export const ROOF_TEAL: Ramp = ['#173c3f', '#215357', '#2f6f6f', '#42908a', '#63b0a4'];
export const ROOF_BLUE: Ramp = ['#20293f', '#2d3b5b', '#3e5279', '#546c96', '#7189b3'];
export const ROOF_PLUM: Ramp = ['#38203c', '#4d2d52', '#66406a', '#815785', '#a074a0'];
export const STONE_WALL: Ramp = ['#3a3846', '#525062', '#6d6b7d', '#8b8898', '#aaa7b3'];
export const THATCH: Ramp = ['#5a4520', '#7c612c', '#9e803c', '#bfa055', '#dcc078'];

// ── Light & warmth ────────────────────────────────────────────────────────
export const WINDOW_AMBER: Ramp = ['#8a5418', '#c07d1e', '#eaa62c', '#f9c95c', '#fff0a8'];
export const LANTERN: Ramp = ['#a05a12', '#e08a1c', '#ffb937', '#ffdb7a', '#fff6d0'];
export const FIRE: Ramp = ['#8c2a10', '#c9541a', '#f08a26', '#ffbe4e', '#fff2b0'];
export const SUNSET_TINT = '#ff9d5c';
export const NIGHT_TINT = '#3a4a86';

// ── Foliage ───────────────────────────────────────────────────────────────
export const TREE_DARK: Ramp = ['#12281f', '#1b3a2a', '#265234', '#357045', '#4a8f56'];
export const TREE_WARM: Ramp = ['#243a1c', '#365227', '#4c6f31', '#6a9040', '#8fb257'];
export const TREE_AUTUMN: Ramp = ['#5c2a12', '#82461a', '#a86a22', '#c9922f', '#e5bb52'];
export const BUSH: Ramp = ['#1a3a26', '#265034', '#356b40', '#4a8b4f', '#68ab63'];

// ── Flowers / accents ─────────────────────────────────────────────────────
export const FLOWER_ROSE = ['#8c2b47', '#c2456a', '#e87b96', '#ffb3c4'];
export const FLOWER_GOLD = ['#9a6410', '#d4941c', '#f5bf3a', '#ffe486'];
export const FLOWER_VIOLET = ['#452a70', '#65409c', '#8f66c8', '#bda1e8'];
export const FLOWER_WHITE = ['#8f8a9c', '#bdb8c6', '#e2dfe8', '#ffffff'];

// ── The Echo (dungeon + anomalies) ────────────────────────────────────────
export const ECHO_VIOLET: Ramp = ['#241540', '#3a2166', '#57318f', '#7a4fbd', '#a681e6'];
export const ECHO_CYAN: Ramp = ['#0f3a48', '#155a6e', '#1c8296', '#3fb3c0', '#8ce6e6'];
export const ECHO_GLOW = '#c8a6ff';
export const ECHO_RUNE = '#9de8ff';
export const SHRINE_STONE: Ramp = ['#1b1b2c', '#282a42', '#383b5a', '#4c5075', '#666a93'];
export const SHRINE_FLOOR: Ramp = ['#17182a', '#22243a', '#2e3150', '#3d4166', '#51557f'];
export const SHRINE_TRIM: Ramp = ['#2a2140', '#40305f', '#5a4482', '#7a60a6', '#9d85c6'];

// ── Woods (Whisper Woods) ─────────────────────────────────────────────────
export const WOODS_GRASS: Ramp = ['#12291f', '#1b3a29', '#254e33', '#336744', '#478457'];
export const WOODS_DIRT: Ramp = ['#2b1e18', '#3f2d22', '#54402f', '#6b563f', '#847053'];
export const MIST = '#8fa8c8';

// ── UI ────────────────────────────────────────────────────────────────────
export const UI_PANEL: Ramp = ['#1a1526', '#241d33', '#332a46', '#463a5c', '#5d4e78'];
export const UI_PARCHMENT: Ramp = ['#8a7458', '#b0977a', '#d8c69c', '#eddcb8', '#fbf1d8'];
export const UI_GOLD: Ramp = ['#7a561a', '#a87a22', '#d6a534', '#f2ca5e', '#ffeaa0'];
export const UI_INK = '#2b2338';
export const UI_INK_SOFT = '#5a4d6b';

// ── Skin / hair for characters ────────────────────────────────────────────
export const SKIN: Record<string, Ramp> = {
  fair: ['#8a5540', '#b57a5c', '#dba07c', '#f0c19c', '#ffe0c0'],
  warm: ['#7a442e', '#9e6142', '#c48158', '#e0a377', '#f5c79c'],
  olive: ['#5f3d28', '#7d5637', '#a0734b', '#c09468', '#dcb78d'],
  brown: ['#3e2418', '#5a3823', '#7a5033', '#9a6c48', '#b98b63'],
  deep: ['#2a160f', '#3f2418', '#573524', '#714a33', '#8d6547'],
};

export const HAIR: Record<string, Ramp> = {
  black: ['#12101c', '#1d1a2c', '#2c2740', '#3f3858', '#584f74'],
  brown: ['#2a1a12', '#3f2a1b', '#573a26', '#725034', '#8f6a48'],
  auburn: ['#3a1710', '#5c2618', '#7f3c22', '#a35a30', '#c47c45'],
  blonde: ['#6b4a16', '#95691f', '#c08f2e', '#dfb551', '#f5d987'],
  ash: ['#2c2c38', '#43434f', '#5e5e6c', '#7d7d8a', '#a0a0aa'],
  teal: ['#12333a', '#1b4a52', '#276870', '#3a8b8f', '#5cb0ad'],
  plum: ['#2f1832', '#472549', '#623664', '#814d80', '#a26ea0'],
  rust: ['#4a2110', '#6c3418', '#8f4c22', '#b06c33', '#cd8d4e'],
};

export const CLOTH: Record<string, Ramp> = {
  sera: ['#2a3b4a', '#3c5566', '#527389', '#6d94a8', '#92b6c6'], // teal-grey coat
  mira: ['#6b2434', '#8f3548', '#b04d5e', '#c86c78', '#e0949a'], // warm red
  oren: ['#3f4a20', '#586630', '#748443', '#93a25c', '#b3be7e'], // courier olive
  tavi: ['#7a3a12', '#a4551c', '#c8752b', '#e2984a', '#f5bd77'], // showy orange
  nia: ['#2e3a5c', '#41507a', '#586a98', '#7387b3', '#96a7cc'], // quiet blue
  elia: ['#4a2a5c', '#66407a', '#855a98', '#a377b3', '#c09acc'], // mayoral plum
  player: ['#2f5a4a', '#3f7860', '#54987a', '#6fb595', '#95d0b3'], // green traveller
  neutral: ['#3a3648', '#514c62', '#6b6580', '#88819c', '#a69fb8'],
  cream: ['#8a7a62', '#ab9a7d', '#cbba9a', '#e3d5b8', '#f6ecd4'],
  apron: ['#6d6858', '#8b8672', '#a9a48e', '#c5c1ad', '#dedbcb'],
};

/** Multiply-tint helper shared with the runtime for lighting maths. */
export function shade(color: string, amount: number): string {
  const [r, g, b, a] = hex(color);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * amount)));
  return (
    '#' +
    [f(r), f(g), f(b)].map((v) => v.toString(16).padStart(2, '0')).join('') +
    (a === 255 ? '' : a.toString(16).padStart(2, '0'))
  );
}

/** Blend two hex colours; t=0 → a, t=1 → b. */
export function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1, a1] = hex(a);
  const [r2, g2, b2, a2] = hex(b);
  const l = (x: number, y: number) => Math.round(x + (y - x) * t);
  const out = [l(r1, r2), l(g1, g2), l(b1, b2)];
  const alpha = l(a1, a2);
  return (
    '#' +
    out.map((v) => v.toString(16).padStart(2, '0')).join('') +
    (alpha === 255 ? '' : alpha.toString(16).padStart(2, '0'))
  );
}
