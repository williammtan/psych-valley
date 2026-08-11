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
export const GRASS: Ramp = ['#23422e', '#315c3a', '#437a49', '#5c9a57', '#7fbc6a'];
export const GRASS_DRY: Ramp = ['#4a5228', '#6b7038', '#8d9049', '#b0b064', '#d0cd88'];
export const DIRT: Ramp = ['#402c22', '#5b4130', '#785640', '#957054', '#b28d6e'];
export const PATH_STONE: Ramp = ['#4a3a2c', '#6a5541', '#8a7157', '#a68d6f', '#c2ab8b'];
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
  oren: ['#2b331a', '#3e4a24', '#556431', '#6f8043', '#8d9d5c'], // courier olive
  tavi: ['#7a3a12', '#a4551c', '#c8752b', '#e2984a', '#f5bd77'], // showy orange
  nia: ['#2e3a5c', '#41507a', '#586a98', '#7387b3', '#96a7cc'], // quiet blue
  elia: ['#4a2a5c', '#66407a', '#855a98', '#a377b3', '#c09acc'], // mayoral plum
  player: ['#2f5a4a', '#3f7860', '#54987a', '#6fb595', '#95d0b3'], // green traveller
  neutral: ['#3a3648', '#514c62', '#6b6580', '#88819c', '#a69fb8'],
  cream: ['#8a7a62', '#ab9a7d', '#cbba9a', '#e3d5b8', '#f6ecd4'],
  apron: ['#6d6858', '#8b8672', '#a9a48e', '#c5c1ad', '#dedbcb'],
};

// ── Town props: foliage, materials, livestock (appended) ──────────────────
/** Dappled sunlight on a cool-green canopy — one step above TREE_DARK[4]. */
export const LEAF_SUN_COOL = '#74b66d';
/** Dappled sunlight on a warm-green canopy — one step above TREE_WARM[4]. */
export const LEAF_SUN_WARM = '#b3cd6e';
/** Spring blossom canopy (pairs with FLOWER_ROSE / FLOWER_WHITE petals). */
export const BLOSSOM: Ramp = ['#7a3550', '#a84c6c', '#d2748f', '#f0a3b6', '#ffd3dd'];
/** The white-blossom sibling — cream, never pure white. */
export const BLOSSOM_WHITE: Ramp = ['#7d6f7a', '#a2939c', '#c7b8bf', '#e6dbdf', '#fbf4f3'];
/** Wrought iron: lampposts, hinges, hoops, bands. */
export const IRON: Ramp = ['#191722', '#272534', '#3a3848', '#514f60', '#6e6b7e'];
/** Bronze / brass: the hand bell, fittings. */
export const BRONZE: Ramp = ['#4a2f12', '#6f4a1c', '#96692a', '#bd9142', '#e0bd72'];
/** Rope, twine, woven basket cane. */
export const ROPE: Ramp = ['#5b4526', '#7d6236', '#a2864f', '#c0a670', '#dcc79a'];
/** Fired clay: planters, pots, roof-tile shards. */
export const TERRACOTTA: Ramp = ['#5a2a1c', '#7d3f27', '#a05a36', '#c07a4d', '#dda06f'];
/** Moss and lichen on stone. */
export const MOSS: Ramp = ['#1d3320', '#2b4a2a', '#3d6634', '#548544', '#75a75c'];
/** Bleached laundry, bedsheets, aprons on the line. */
export const LINEN: Ramp = ['#8e8ea6', '#adaec4', '#cfd0e0', '#e8e9f2', '#fbfbf6'];
/** Kitchen-garden leaves — brighter and yellower than wild foliage. */
export const VEG_LEAF: Ramp = ['#22401f', '#315a27', '#457a32', '#5e9c43', '#82bd5e'];
/** Feathers: chickens, ducks, doves. */
export const FEATHER: Ramp = ['#8a7f78', '#b0a49a', '#d2c7ba', '#e9e0d2', '#f8f2e4'];
/** The fat ginger cat that is emphatically not Pip. */
export const CAT_GINGER: Ramp = ['#5a2810', '#803c17', '#a85a24', '#c87f3e', '#e5a862'];

// ── Enemies (appended by the enemy art module) ────────────────────────────
// Echo creatures are ordinary valley matter pulled out of shape, so their
// bodies stay natural (bracken, husk-cloth, shadow) and only the *light*
// inside them is Echo violet/cyan.
export const BRACKEN: Ramp = ['#1a2317', '#283420', '#3a4a2b', '#4f6135', '#6a7c44'];
export const THORN: Ramp = ['#3a2413', '#573619', '#7d5122', '#a37231', '#c99a4e'];
export const WISP_HUSK: Ramp = ['#1e2b36', '#2c3f4e', '#3f5a6b', '#567a8b', '#7099ab'];
export const MIMIC_SHADE: Ramp = ['#161327', '#211c39', '#2e2851', '#3f376b', '#544a89'];
export const MIRROR: Ramp = ['#39445a', '#55647e', '#7a8ca4', '#a5b8c9', '#d6e6ef'];
export const ECHO_DEEP: Ramp = ['#0f0a1c', '#180f2b', '#231640', '#312057', '#432d74'];
/** Warm fragments the Echo has stolen from the town — memory-coloured amber. */
export const STOLEN_AMBER: Ramp = ['#5a3a12', '#8a5a1c', '#b8822c', '#dcac52', '#f5d68e'];
/** The colour of a follower that has broken from the group. */
export const DISSENT: Ramp = ['#5e2a14', '#8f4a1c', '#c2762a', '#e8a349', '#ffd489'];
/** Desaturated violet for *stale* information — old attack patterns. */
export const ECHO_PALE: Ramp = ['#2a2438', '#3b3450', '#4e4668', '#665d84', '#8279a3'];
export const ECHO_SPARK = '#eae2ff';
/** The white-hot tint of a damage flash. Warm, so it never reads as Echo light. */
export const HIT_FLASH = '#ffe6dc';

// ── Whisper Woods: the cool, quiet zone between town and shrine (appended) ─
// Related to the town ramps by hue so it reads as the same world — the woods
// differ by *temperature and contrast*, not by being turned down.
/** Forest canopy. Darker and a step cooler than TREE_DARK; the woods' signature. */
export const WOODS_CANOPY: Ramp = ['#0d2320', '#14322b', '#1d4636', '#2a6045', '#3c7f56'];
/** The little daylight that reaches the canopy top. Cool, never the town's warm dapple. */
export const WOODS_LEAF_SUN = '#57a069';
/** Undergrowth: bushes, ferns, low leaves. A step warmer than the canopy above. */
export const WOODS_UNDER: Ramp = ['#12281c', '#1b3a25', '#264e30', '#35673e', '#4a8450'];
/** Damp forest bark — greyer, cooler and more violet than town's WOOD. */
export const WOODS_BARK: Ramp = ['#1e1820', '#2e2530', '#413541', '#584857', '#75636f'];
/** Dead, bleached, barkless timber. Pale enough to read against the dark floor. */
export const WOODS_BONEWOOD: Ramp = ['#33303f', '#474455', '#5f5b6c', '#7d7887', '#9d97a2'];
/** Woods rock: cliff faces, boulders, standing stones. Cooler than STONE_WALL. */
export const WOODS_ROCK: Ramp = ['#24222f', '#343343', '#484758', '#605e70', '#7d7a8b'];
/** The stream. Far darker and greener than the town river. */
export const WOODS_WATER: Ramp = ['#0c1f2a', '#12333f', '#1a4a55', '#276b72', '#438f92'];
/** Thorn thicket — the impassable boundary. Nearly hueless, nearly black. */
export const WOODS_BRAMBLE: Ramp = ['#0f0e15', '#191a1e', '#242a26', '#333d33', '#465243'];
/** Dry thorn tips: the only bright marks on a bramble, and they read as spikes. */
export const BRAMBLE_THORN = '#a89c7e';
/** Bramble berries — one saturated warning note per thicket. */
export const BRAMBLE_BERRY = '#7d2340';
/** Fungus caps. */
export const FUNGUS_CAP: Ramp = ['#4a2016', '#6d3520', '#8f4d2c', '#b06b42', '#cd9163'];
/** Fungus stems and gills — pale, faintly green-grey. */
export const FUNGUS_PALE: Ramp = ['#5b5c50', '#7a7b6c', '#9a9b8a', '#bcbca8', '#dcdcc6'];
/** Old bone: skulls, antlers, ribs half-buried in leaf litter. */
export const BONE: Ramp = ['#5d5a52', '#7c786d', '#9c9789', '#bab5a5', '#d8d2c0'];
/** Drifting ground mist. Step [3] is exactly MIST. */
export const MIST_RAMP: Ramp = ['#3f4c62', '#5d6f8c', '#7690ae', '#8fa8c8', '#b6c8de'];

// ── Architecture (appended — buildings module) ────────────────────────────
/** Weathered copper / verdigris roofing and trim. */
export const COPPER_PATINA: Ramp = ['#173a34', '#245445', '#367159', '#4f8f70', '#72ad8d'];
/** Unlit or cold window glass — shopfronts, skylights, gable lights. */
export const GLASS_COLD: Ramp = ['#28374a', '#3a4d63', '#526981', '#7189a0', '#9cb4c4'];
/** Awning / tent canvas, cream weave. */
export const CANVAS: Ramp = ['#7b6851', '#9c896b', '#bfab8a', '#ddcfad', '#f4e9cc'];
/** Fired brick — chimneys, foundation courses. */
export const BRICK: Ramp = ['#3f231e', '#5c332a', '#7a4738', '#96604a', '#b17f63'];
/** Grey slate roofing for civic buildings and the bell tower spire. */
export const ROOF_SLATE: Ramp = ['#252634', '#343648', '#484b61', '#61647c', '#7f8298'];
/** Ancient shrine granite — colder and greener than SHRINE_STONE's interior. */
export const SHRINE_OUTER: Ramp = ['#20222e', '#2e3242', '#3e4457', '#525a70', '#6d768c'];
/** Chimney smoke: warm-grey drifting to violet, never neutral. */
export const CHIMNEY_SMOKE: Ramp = ['#3c3648', '#544e62', '#6f6980', '#918ba0', '#b4aec2'];
/** Brown paper a courier's parcel is wrapped in, and the string round it. */
export const KRAFT: Ramp = ['#6a5236', '#8b6f4a', '#ab8c60', '#c9aa7c', '#e3c99e'];
export const STRING = '#d0b98c';

// ── Festival of Lanterns (appended) ───────────────────────────────────────
// The three ceremonial trial tones reuse the FX tone ramps so the lantern and
// the tone it emits are literally the same colour: LANTERN (amber) = tone A,
// TONE_ROSE = tone B, TONE_TEAL = tone C.
/** Unlit paper: cold, dusty, obviously "off". */
export const PAPER_DIM: Ramp = ['#3a3242', '#544a58', '#6f6472', '#8e8390', '#aca2ab'];
/** Lit red paper — deep at the hem, hot at the core. Traditional festival red. */
export const PAPER_RED: Ramp = ['#4a1220', '#7d2231', '#b83c40', '#e3745c', '#ffcf9e'];
/** Warm paper stock for hanging lanterns that are lit but not ceremonial. */
export const PAPER_WARM: Ramp = ['#8a5a30', '#b57c42', '#d9a361', '#f0c98c', '#fdefc6'];
/** The ceremonial runner laid down the plaza's centre. */
export const CARPET_RED: Ramp = ['#3e0f1c', '#5e1a2a', '#84293c', '#a63f4f', '#c45f68'];
/** Bunting / banner dye lots that are not roof colours. */
export const DYE_SAFFRON: Ramp = ['#7a4a0e', '#a86a18', '#d59429', '#f0bb54', '#ffe08e'];
export const DYE_PLUM: Ramp = ['#3d1c46', '#572c62', '#763f82', '#96599f', '#b57cba'];
export const DYE_SEA: Ramp = ['#12333f', '#1c4d5c', '#2a6e7c', '#3f939c', '#6dbcbe'];
/** Grilled food, roast skewers, sausage. */
export const FOOD_MEAT: Ramp = ['#40190f', '#5e2916', '#7f4020', '#a35e2d', '#c58449'];
/** Crust and crumb: bread, pastry, pie. */
export const FOOD_BREAD: Ramp = ['#6a3f18', '#8e5a24', '#b47c37', '#d3a25c', '#eecb92'];
/** Charcoal in a brazier: dead ash through hot coal. */
export const COAL: Ramp = ['#191420', '#2c232e', '#463038', '#7a3320', '#b8471f'];

// ── Character kit (humanoid rig, Pip, Mote) ───────────────────────────────
// Appended for the character generator. Boots/straps/bags share one leather
// ramp so the whole cast's gear reads as coming from the same tannery, and the
// six villager cloth ramps are deliberately spread around the hue circle so no
// two townsfolk read as recolours of each other.
/** Tanned leather: boots, straps, satchels, bookbindings, armchairs. */
export const LEATHER: Ramp = ['#361d16', '#523024', '#704634', '#8e6048', '#ab7f63'];
export const METAL: Ramp = ['#2a2a36', '#41414f', '#5c5c6b', '#7e7e8b', '#a4a4ae'];
export const CLOTH_MOSS: Ramp = ['#16210f', '#20301a', '#2d4526', '#3e5f36', '#547d49'];
export const CLOTH_CLAY: Ramp = ['#5b2f22', '#7b4530', '#9c5f40', '#bb7f57', '#d6a377'];
export const CLOTH_SLATE: Ramp = ['#25293a', '#373d54', '#4e5570', '#6a728d', '#8b93aa'];
export const CLOTH_WHEAT: Ramp = ['#6e5722', '#917632', '#b39647', '#d0b569', '#e8d495'];
export const CLOTH_BERRY: Ramp = ['#4a1c36', '#6b2b4c', '#8f4166', '#b06083', '#cb87a3'];
export const CLOTH_SAGE: Ramp = ['#1d3c47', '#2a5563', '#3a7183', '#5194a6', '#7bbccb'];

// Pip the cat: warm tabby over a cream chest.
export const PIP_FUR: Ramp = ['#4a2a14', '#6b3d1c', '#8f5626', '#b1783f', '#cf9d63'];
export const PIP_CREAM: Ramp = ['#7a6144', '#9c8160', '#bda182', '#d8c0a4', '#efdcc4'];
export const PIP_PINK = '#d98a92'; // nose / inner ear

/** Mote's specular centre. Near-white but never #ffffff — it is a light, not paper. */
export const MOTE_CORE = '#eaffff';

// ── UI (appended by the UI/typography pass) ───────────────────────────────
/**
 * Bitmap-font neutrals. Glyphs ship in these so the runtime can multiply-tint
 * them to ink, gold or violet. FONT_LIGHT is the body face's only colour and
 * the display face's 1px inner highlight; FONT_MID is the display face's
 * field. The pair is deliberately a *value* step rather than a hue step, so
 * the bevel survives being multiplied by a saturated tint.
 */
export const FONT_LIGHT = '#f6ecd4';
export const FONT_MID = '#dbcda9';

/** Vellum used inside panels — a touch cooler than PLASTER so ink pops. */
export const UI_VELLUM: Ramp = ['#7c6a4e', '#a08a68', '#c9b48c', '#e6d6ae', '#f7edd0'];
/** Brass hardware: frames, rules, rivets, seals. Warmer than UI_GOLD. */
export const UI_BRASS: Ramp = ['#5c3d12', '#8a5c1a', '#b8842a', '#dcae46', '#f6d982'];
/** Health. Reserved for hearts and damage feedback — never decoration. */
export const UI_HEART: Ramp = ['#5e1730', '#8f2445', '#c23c5e', '#e2708a', '#ffa8b4'];
/** Affirmative UI: completed quests, correct thread nodes, checkboxes. */
export const UI_GOOD: Ramp = ['#1d4429', '#2b6338', '#3d8449', '#5aa763', '#8fca8a'];
/** Keycap plastic — cool grey so prompts read as hardware, not paper. */
export const UI_KEY: Ramp = ['#3a3646', '#565164', '#7a7488', '#a49dae', '#cec7d4'];

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

// ── FX ramps (effects module) ─────────────────────────────────────────────
// Effects read as *light*, so their ramps run further and hotter than surface
// ramps: [0] is the faint outer wisp, [4] is the hot core. Only SPECULAR is
// pure white, and it is only ever allowed as a 1–2 px core.
export const SPECULAR = '#ffffff';

/** Sword arc: rose wisp → orange → gold → cream core. Never neutral white. */
export const SLASH: Ramp = ['#a8455c', '#d9713f', '#f9ad4c', '#ffe291', '#fff8e0'];
/** Hit burst / crit shards — hotter and redder than SLASH so hits read apart. */
export const IMPACT: Ramp = ['#7a2438', '#b8482c', '#ec8a2e', '#ffcb66', '#fff4cc'];
/** Kicked-up earth: footfalls, landings, dash scuffs. */
export const DUST: Ramp = ['#3f342a', '#61513e', '#877257', '#b09b78', '#d8c7a4'];
/** Chimney smoke and dust puffs — warm grey, never neutral, drifting violet. */
export const SMOKE_PUFF: Ramp = ['#2e2838', '#443d54', '#615a72', '#837c92', '#aba4b6'];
/** Cooking steam — cooler and lighter than smoke. */
export const STEAM: Ramp = ['#3f4a5c', '#5d6a80', '#8592a6', '#aebbcc', '#dae5ef'];
/** Damage: red-violet, deliberately off the town's warm/foliage hues. */
export const HURT: Ramp = ['#3d0f2c', '#6d1a44', '#a52a5e', '#d95483', '#f78fae'];
/** Metallic cold spark — blocks, and the pipe-crash's ugly white. */
export const COLD_SPARK: Ramp = ['#2b3346', '#465268', '#6f7f96', '#a4b3c6', '#e4eef9'];

/** The town bell made visible. Warm amber, the game's motif. */
export const BELL_TONE: Ramp = ['#6b3a0e', '#a8641a', '#e09a2c', '#ffc85e', '#ffeeb4'];
/** Festival lantern tone B (rose). Tone A is BELL_TONE, tone C is TONE_TEAL. */
export const TONE_ROSE: Ramp = ['#5c1c38', '#8f2f52', '#c25074', '#e8829e', '#ffc6d6'];
/** Festival lantern tone C (teal) — cool but short of Echo cyan's saturation. */
export const TONE_TEAL: Ramp = ['#14494a', '#1d6f6c', '#2b9a92', '#46c0b0', '#8fe4d2'];

/** Greyscale falloff for light sprites; tinted + additively blended at runtime. */
export const LIGHT_RAMP: Ramp = ['#1e1e1e', '#454545', '#7a7a7a', '#b8b8b8', '#ffffff'];

/** A turned autumn leaf — redder than TREE_AUTUMN, so drifting leaves vary. */
export const LEAF_RED: Ramp = ['#4a1a18', '#6e2a1e', '#95412a', '#b85f38', '#d4854f'];

// ── Interiors: the Lantern Inn, Sera's Workshop, the Courier Office ────────
// Interiors are lit by fire and lanterns, so their surfaces run warmer and a
// touch darker than the outdoor equivalents, and their shadows lean violet.

/** Warm oak plank floor — the Lantern Inn's whole ground plane. */
export const FLOOR_WOOD: Ramp = ['#3d2416', '#5c3a21', '#7e5531', '#a17549', '#c29a6c'];
/** Workshop flagstone — cool grey-violet, deliberately colder than the inn. */
export const FLOOR_STONE: Ramp = ['#2e2c3a', '#43414f', '#5b5967', '#787584', '#98959f'];
/** Kitchen tile, pale square. */
export const FLOOR_TILE: Ramp = ['#6b5c4a', '#8b7b64', '#ab9a80', '#c9b99b', '#e3d5b8'];
/** Kitchen tile, clay square — low contrast against FLOOR_TILE by design. */
export const FLOOR_TILE_CLAY: Ramp = ['#5e4238', '#7b594a', '#96705d', '#b08a73', '#c8a68c'];

/** Interior plaster: PLASTER seen in lamplight rather than daylight. */
export const WALL_PLASTER: Ramp = ['#544438', '#71604f', '#907c66', '#ae9a80', '#cab89b'];
/** Timber wall panelling, red-brown so it separates from the oak floor. */
export const WALL_WOOD: Ramp = ['#2c1c14', '#43291d', '#5c3b28', '#7a5238', '#976d4c'];

/** Woven rugs. Deep, slightly dusty — a rug is never as saturated as a banner. */
export const RUG_RED: Ramp = ['#3f1220', '#5f1e2c', '#82303c', '#a54a52', '#c47276'];
export const RUG_BLUE: Ramp = ['#182742', '#243c5c', '#345479', '#4a7096', '#6b90b4'];

/** Hammered copper: pans, kettles, the inn's hanging pot rack. */
export const COPPER: Ramp = ['#4a2412', '#6d381f', '#93532f', '#ba7748', '#dda06e'];
/** Glazed ceramic: mugs, basins, plates. Cool, so it pops against all the wood. */
export const CERAMIC: Ramp = ['#6a6274', '#8c8492', '#aea6ae', '#cdc6c6', '#eae4dc'];
/** Clear glass: window panes, specimen jars, lantern housings. */
export const GLASS_CLEAR: Ramp = ['#38485a', '#526879', '#728e9c', '#9ab3bd', '#c8dade'];
/** Bottle glass. */
export const GLASS_GREEN: Ramp = ['#17322a', '#204c40', '#2c6b56', '#3f8c6e', '#63b18c'];
/** Slate chalkboard. */
export const CHALKBOARD: Ramp = ['#151d1b', '#202d29', '#2c3e38', '#3b5249', '#4d675c'];
export const CHALK = '#e6e4d4';
/** Soot and firebox interiors — darker than OUTLINE but still violet, not black. */
export const SOOT: Ramp = ['#131120', '#1f1c2c', '#2e2b3c', '#403d4f', '#565266'];
// Tanned leather (armchairs, satchels, bookbindings, boots) already exists as
// LEATHER in the character-generator block above; reuse it rather than
// declaring a second, near-identical ramp.

/**
 * The four parcel wraps, in index order. Quest Two asks the player to recognise
 * a specific package they saw somewhere else, so `prop/town/parcel_<i>` and
 * `prop/int/post_parcel_<i>` MUST be the same colour for the same `i`. This
 * array is the contract; neither module may pick its own wrap colours.
 */
export const PARCEL_WRAP: Ramp[] = [UI_PARCHMENT, ROOF_BLUE, ROOF_PLUM, ROOF_TEAL];
/** String / twine that pins a route map. Parcel ties use ROPE, as in town. */
export const TWINE = '#c9b184';

// ── Echo Shrine (appended — shrine module) ────────────────────────────────
// The shrine's value ladder is the whole readability plan, darkest first:
//   SHRINE_CAP (wall mass / not-room)  <  SHRINE_FLOOR (quiet ground)
//   <  SHRINE_STONE (carved wall face, the only textured architecture)
//   <  glowing puzzle objects (ECHO_RUNE / ECHO_FLAME).
// Nothing in the architecture is allowed above SHRINE_STONE[4]; every bright
// pixel underground belongs to something the player can act on.

/** Top surface of a wall seen from above — the "not-room" mass. Nearly void. */
export const SHRINE_CAP: Ramp = ['#0a0a15', '#0f1020', '#16172e', '#1e2040', '#2a2c56'];
/** Old observatory brass: armatures, bands, brackets, lamp bowls. */
export const SHRINE_BRASS: Ramp = ['#33260f', '#54401a', '#7d6229', '#a68a46', '#d4bd7c'];
/** Echo growth creeping over the floor — moss that is lit from inside. */
export const SHRINE_MOSS: Ramp = ['#1a1630', '#28204a', '#3b2f6c', '#54468f', '#7264b0'];
/** Still shrine water: black-blue, mirror-flat, faintly luminous. */
export const SHRINE_WATER: Ramp = ['#0b1526', '#12233c', '#1b3757', '#2a5b7d', '#4f9aa8'];
/** Violet flame — braziers. Runs hotter than ECHO_VIOLET so fire reads as fire. */
export const ECHO_FLAME: Ramp = ['#2b0f4e', '#4b1d84', '#7a3ec0', '#a778e4', '#e0cbff'];
/** A rune with no power in it: engraved, cold, still legible as the same glyph. */
export const ECHO_RUNE_DIM = '#3d6b80';
/** The 1–2 px core of a *lit* rune. The brightest thing in the shrine. */
export const ECHO_RUNE_CORE = '#e8fdff';
