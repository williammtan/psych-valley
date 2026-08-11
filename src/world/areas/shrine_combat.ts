/**
 * ECHO SHRINE — ROOM TWO. (plan.md §40)
 *
 * The only room in the dungeon with no idea in it. Bars behind, bars ahead,
 * five things to kill, and a wreck in the middle to fight around.
 *
 * The one design rule being enforced here is the seal: `lockUntilCleared` holds
 * both doors until the floor is clear, so the encounter is a room rather than a
 * corridor with monsters in it. Going down re-arms it completely — same enemies,
 * same positions, doors shut again — because a half-cleared arena you respawn
 * into is the exact failure state plan.md §67 exists to prevent.
 *
 * No hints. There is nothing to work out.
 */
import { State } from '@/core/state';
import { Audio } from '@/audio/Audio';
import { registerArea } from '../registry';
import { R2 } from '../maps/shrine_combat';
import { ROOM_FLOOR, northWallY, southWallY } from '../maps/shrine_common';
import { TALK, playExchange } from '@/data/dialogue';
import { BARS_ART, RoomRig, completeRoom, doorGate, readEnv } from './shrine_kit';
import type { Gate } from '@/systems/Puzzle';
import type { WorldScene } from '@/scenes/WorldScene';

interface S {
  rig: RoomRig;
  north: Gate;
  south: Gate;
  fighting: boolean;
}

let s: S | null = null;

function armRoom(w: WorldScene): void {
  if (!s) return;
  w.enemies.clear();
  s.fighting = false;

  if (State.has('shrine_r2_done')) {
    s.north.setOpen(true, true);
    s.south.setOpen(true, true);
    return;
  }

  s.north.setOpen(false, true);
  s.south.setOpen(false, true);

  for (const [x, y] of R2.brambles) w.enemies.spawn('bramble', x, y);
  for (const [x, y] of R2.wisps) w.enemies.spawn('wisp', x, y);
  s.fighting = true;

  // Registered after the spawns, or an empty list would read as "cleared" on
  // the very first frame and hand the room away for free.
  w.enemies.lockUntilCleared(() => {
    if (!s) return;
    s.fighting = false;
    completeRoom(w, 2);
    s.south.setOpen(true);
    s.north.setOpen(true);
    Audio.sfx('gate_open', { volume: 0.6 });
    w.shake(0.004, 260);
  });
}

registerArea('shrine_combat', {
  onEnter(w) {
    s?.rig.destroy();
    w.fx.setAmbient('shrine');

    s = {
      rig: new RoomRig(w),
      north: doorGate(w, R2.doorIn, northWallY(ROOM_FLOOR), { art: BARS_ART }),
      south: doorGate(w, R2.doorOut, southWallY(ROOM_FLOOR), { art: BARS_ART }),
      fighting: false,
    };
    s.rig.onReset(() => armRoom(w));
    armRoom(w);
  },

  onTrigger(w, id) {
    if (id === 'r2_enter') {
      if (State.has('shrine_r2_seen')) return false;
      State.set('shrine_r2_seen');
      void w.cutscene.run((c) => playExchange(c, TALK.shrine.roomCombat));
      return true;
    }
    return false;
  },

  onInteract(w, id) {
    if (id.startsWith('carving.')) return readEnv(w, id);
    return false;
  },

  onExit() {
    s?.north.destroy();
    s?.south.destroy();
    s?.rig.destroy();
    s = null;
  },
});
