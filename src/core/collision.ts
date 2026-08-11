/**
 * Grid collision with corner assist.
 *
 * Phaser's arcade physics would work, but the feel we want comes from two
 * details it doesn't give for free:
 *
 *   1. Axis-separated resolution, so sliding along a wall keeps full speed on
 *      the free axis instead of stalling.
 *   2. Corner assist — when the player walks into a wall corner while trying to
 *      pass through a gap, nudge them sideways so they slip through. Without
 *      this, top-down movement feels like it snags on doorways. A Link to the
 *      Past does exactly this and it is most of why its movement feels good.
 */

import { TILE } from './config';

export interface Box {
  /** Centre X of the collision box. */
  x: number;
  /** Bottom Y of the collision box (the entity's feet). */
  y: number;
  w: number;
  h: number;
}

export type SolidGrid = boolean[][];

export function solidAt(grid: SolidGrid, tx: number, ty: number): boolean {
  if (ty < 0 || ty >= grid.length) return true;
  const row = grid[ty];
  if (tx < 0 || tx >= row.length) return true;
  return row[tx];
}

function overlaps(grid: SolidGrid, box: Box, x: number, y: number): boolean {
  const left = x - box.w / 2;
  const right = x + box.w / 2;
  const top = y - box.h;
  const bottom = y;
  const tx0 = Math.floor(left / TILE);
  const tx1 = Math.floor((right - 0.001) / TILE);
  const ty0 = Math.floor(top / TILE);
  const ty1 = Math.floor((bottom - 0.001) / TILE);
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      if (solidAt(grid, tx, ty)) return true;
    }
  }
  return false;
}

export interface MoveResult {
  x: number;
  y: number;
  hitX: boolean;
  hitY: boolean;
}

/** Maximum sideways nudge, in pixels, when slipping past a corner. */
const CORNER_ASSIST = 5;

export function moveBox(
  grid: SolidGrid,
  box: Box,
  dx: number,
  dy: number,
  opts: { cornerAssist?: boolean } = {},
): MoveResult {
  const assist = opts.cornerAssist !== false;
  let x = box.x;
  let y = box.y;
  let hitX = false;
  let hitY = false;

  // Sub-step so fast movers can't tunnel through a 16px wall.
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / (TILE / 2)));
  const sx = dx / steps;
  const sy = dy / steps;

  for (let i = 0; i < steps; i++) {
    if (sx !== 0) {
      if (!overlaps(grid, box, x + sx, y)) {
        x += sx;
      } else {
        let slipped = false;
        if (assist && sy === 0) {
          // Try shifting vertically to clear a corner blocking horizontal travel.
          for (let n = 1; n <= CORNER_ASSIST; n++) {
            if (!overlaps(grid, box, x + sx, y - n)) { y -= n; x += sx; slipped = true; break; }
            if (!overlaps(grid, box, x + sx, y + n)) { y += n; x += sx; slipped = true; break; }
          }
        }
        if (!slipped) hitX = true;
      }
    }
    if (sy !== 0) {
      if (!overlaps(grid, box, x, y + sy)) {
        y += sy;
      } else {
        let slipped = false;
        if (assist && sx === 0) {
          for (let n = 1; n <= CORNER_ASSIST; n++) {
            if (!overlaps(grid, box, x - n, y + sy)) { x -= n; y += sy; slipped = true; break; }
            if (!overlaps(grid, box, x + n, y + sy)) { x += n; y += sy; slipped = true; break; }
          }
        }
        if (!slipped) hitY = true;
      }
    }
  }

  return { x, y, hitX, hitY };
}

/** True if the box would overlap solid geometry at this position. */
export function boxBlocked(grid: SolidGrid, box: Box, x = box.x, y = box.y): boolean {
  return overlaps(grid, box, x, y);
}

/**
 * Push a box out of any solid it is currently inside — used after teleports and
 * after dynamic geometry (a closing gate) traps something.
 */
export function unstick(grid: SolidGrid, box: Box): { x: number; y: number } {
  if (!overlaps(grid, box, box.x, box.y)) return { x: box.x, y: box.y };
  // A full ring rather than eight rays: rays leave blind corridors, so a body
  // wedged in a corner or against the map border can sit two tiles from open
  // ground and never find it. Nearest free spot wins, so the push-out is the
  // smallest one that works.
  for (let r = 1; r <= 48; r++) {
    let best: { x: number; y: number; d: number } | null = null;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        // Only the newly reached ring; the interior was covered by earlier r.
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = box.x + dx;
        const ny = box.y + dy;
        if (overlaps(grid, box, nx, ny)) continue;
        const d = dx * dx + dy * dy;
        if (!best || d < best.d) best = { x: nx, y: ny, d };
      }
    }
    if (best) return { x: best.x, y: best.y };
  }
  return { x: box.x, y: box.y };
}
