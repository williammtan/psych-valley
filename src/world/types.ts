/**
 * MAP AUTHORING FORMAT
 * ────────────────────
 * Maps are authored as character grids. This is deliberate: a grid is readable
 * in a diff, easy to hand-edit, and makes density obvious at a glance — if the
 * object grid is mostly spaces, the map is going to look empty in game.
 *
 * A map has up to three parallel grids of identical dimensions:
 *
 *   ground   required. One char per tile → Material (terrain + collision).
 *   objects  optional. One char per tile → ObjectSpec (props, decoration).
 *   above    optional. One char per tile → ObjectSpec drawn over the player.
 *
 * Precise, non-grid placement (a fountain at a half-tile offset, an NPC's
 * patrol path) uses the explicit `props` / `npcs` arrays instead.
 */

export interface Material {
  /** Ground-layer tile family, e.g. 'grass', 'soil', 'shrine_floor'. */
  base: string;
  /** Detail-layer blob autotile set, e.g. 'path', 'dirt', 'water'. */
  blob?: string;
  /** Blocks movement. */
  solid?: boolean;
  /** Scatter rule key applied to this cell (grass tufts, pebbles...). */
  scatter?: string;
  /** Deep water / pit — blocks movement and is lethal-ish (respawn nudge). */
  pit?: boolean;
  /** Overrides depth-sorted rendering for the ground layer (bridges). */
  bridge?: boolean;
}

export interface ObjectSpec {
  /** Atlas frame name, or a list to pick from deterministically per-cell. */
  key: string | string[];
  /**
   * Collision. `true` uses a box the width of the sprite and 8px tall at its
   * base; a tuple gives an explicit [w, h] in pixels, also base-anchored.
   */
  solid?: boolean | [number, number];
  /** Pixels to shift the sprite's anchor from the tile's bottom-centre. */
  offset?: [number, number];
  /** Added to the Y used for depth sorting; negative draws earlier. */
  depthBias?: number;
  /** Play this animation key on spawn. */
  anim?: string;
  /** Gentle wind sway (foliage, banners, hanging signs). */
  sway?: number;
  /** Emit a light of this radius/colour (see LightDef). */
  light?: { radius: number; color?: number; intensity?: number; flicker?: number };
  /** Always draw above the player regardless of Y. */
  over?: boolean;
  /** Interaction id resolved by the scene's interaction table. */
  interact?: string;
}

export interface ScatterRule {
  /** Tiles chosen from, with weights; '' means "leave empty". */
  tiles: Array<[string, number]>;
  /** 0..1 chance a cell gets anything at all. */
  density: number;
}

export interface PropPlacement {
  key: string;
  /** Tile coordinates; fractional values are allowed. */
  x: number;
  y: number;
  spec?: Omit<ObjectSpec, 'key'>;
  id?: string;
}

export interface NpcPlacement {
  id: string;
  x: number;
  y: number;
  facing?: 'n' | 's' | 'e' | 'w';
  /** Waypoints in tile coordinates; the NPC loops them when idle. */
  path?: Array<[number, number]>;
  /** Seconds to wait at each waypoint. */
  dwell?: number;
}

export type ZoneKind = 'door' | 'trigger' | 'block' | 'camera' | 'spawn' | 'region';

export interface Zone {
  kind: ZoneKind;
  id: string;
  /** Tile-space rect. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** For doors: target map id and spawn point id. */
  to?: string;
  spawn?: string;
  /** Facing after a door transition. */
  facing?: 'n' | 's' | 'e' | 'w';
  /** For triggers: fires once unless `repeat`. */
  repeat?: boolean;
  /** Gate the zone on a flag being set / unset. */
  requires?: string;
  forbids?: string;
  data?: Record<string, unknown>;
}

export interface LightDef {
  x: number;
  y: number;
  radius: number;
  color?: number;
  intensity?: number;
  flicker?: number;
}

export interface MapDef {
  id: string;
  /** Shown on the location banner when the player arrives. */
  name: string;
  /** Sub-label, e.g. "The Lantern Inn". */
  subtitle?: string;
  music?: string;
  ambience?: string;
  /** Indoor maps skip weather and use their own ambient light. */
  indoor?: boolean;
  /** Multiply-tint applied to the whole map (day/night, dungeon mood). */
  tint?: number;
  /** Darkness level 0..1 for the lighting layer. */
  darkness?: number;

  ground: string[];
  legend: Record<string, Material>;

  objects?: string[];
  above?: string[];
  objectLegend?: Record<string, ObjectSpec>;

  scatterRules?: Record<string, ScatterRule>;

  props?: PropPlacement[];
  npcs?: NpcPlacement[];
  zones?: Zone[];
  lights?: LightDef[];

  /** Named spawn points in tile coords. 'default' is required. */
  spawns: Record<string, { x: number; y: number; facing?: 'n' | 's' | 'e' | 'w' }>;
}

/** Validate a map's grids line up; throws with a precise message if not. */
export function validateMap(m: MapDef): void {
  const h = m.ground.length;
  if (!h) throw new Error(`map ${m.id}: empty ground grid`);
  const w = m.ground[0].length;
  const checkGrid = (name: string, grid?: string[]) => {
    if (!grid) return;
    if (grid.length !== h) {
      throw new Error(`map ${m.id}: ${name} has ${grid.length} rows, ground has ${h}`);
    }
    grid.forEach((row, y) => {
      if (row.length !== w) {
        throw new Error(`map ${m.id}: ${name} row ${y} is ${row.length} wide, ground is ${w}`);
      }
    });
  };
  m.ground.forEach((row, y) => {
    if (row.length !== w) throw new Error(`map ${m.id}: ground row ${y} is ${row.length} wide, expected ${w}`);
    for (const ch of row) {
      if (!m.legend[ch]) throw new Error(`map ${m.id}: ground row ${y} uses '${ch}' with no legend entry`);
    }
  });
  checkGrid('objects', m.objects);
  checkGrid('above', m.above);
  for (const [name, grid] of [['objects', m.objects], ['above', m.above]] as const) {
    grid?.forEach((row, y) => {
      for (const ch of row) {
        if (ch === ' ') continue;
        if (!m.objectLegend?.[ch]) {
          throw new Error(`map ${m.id}: ${name} row ${y} uses '${ch}' with no objectLegend entry`);
        }
      }
    });
  }
  if (!m.spawns.default) throw new Error(`map ${m.id}: missing 'default' spawn`);
}
