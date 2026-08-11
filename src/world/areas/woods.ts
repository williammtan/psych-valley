/**
 * WHISPER WOODS — area script.
 *
 * The map file owns everything that is a shape. This owns everything that is a
 * moment:
 *
 *   - the arrival beat, where Mote notices the first Echo-touched thing
 *   - trigger-driven encounters, so enemies materialise when the player walks
 *     into a room rather than all standing about at map load
 *   - the three secrets (chest, toadstool ring, carved stone) and the campsite
 *   - the two things the player can physically change: the cuttable bushes
 *     screening the gully, and the boulder that fords the stream
 *   - the handover to the Echo Shrine
 *
 * FAILURE IS CHEAP (plan.md §67). Every encounter marks a checkpoint at its own
 * entrance and re-arms itself on `room:reset`, so going down costs you one
 * fight, never the walk back through the woods.
 *
 * DIALOGUE. Every word the woods says is authored data in `src/data/dialogue`
 * (`TALK.woods`, the `carving.*` observatory logs, `sign.woods`). Props declare
 * an exchange id as their `interact` value and this file only decides *when*.
 * The two exceptions are the boulder and the chest, whose lines are reactions
 * to a physical change the player just made rather than descriptions of a
 * thing — those are marked TODO(dialogue) for the writer to absorb.
 */
import { State } from '@/core/state';
import { emit, on } from '@/core/events';
import { DEPTH, TILE } from '@/core/config';
import { hasFrame } from '@/core/textures';
import { Audio } from '@/audio/Audio';
import { TALK, describe, playExchange, runBeats } from '@/data/dialogue';
import { registerArea, hasMap } from '../registry';
import { ENCOUNTERS, WOODS } from '../maps/woods';
import type { WorldScene } from '@/scenes/WorldScene';
import type Phaser from 'phaser';

// TODO(dialogue): reactions to player-caused change; no authored home yet.
const TOASTS = {
  ford: 'The boulder settles into the streambed.',
  bushes: 'The bushes were hiding a cut in the rock.',
};

const BOULDER_HINT = [
  'The stream runs shallow here — one stride, if there were anything to stride onto.',
  'The boulder on the bank has been rocking in its socket for years.',
];

// ── encounter bookkeeping ──────────────────────────────────────────────────

interface Cuttable {
  sprite: Phaser.GameObjects.Sprite;
  tx: number;
  ty: number;
  cut: boolean;
}

/**
 * Per-visit state. Rebuilt in `onEnter`, because a map can be entered several
 * times in a run and none of this should survive a reload.
 */
interface WoodsState {
  cuttables: Cuttable[];
  fired: Set<string>;
  boulderSprite?: Phaser.GameObjects.Sprite;
  offReset?: () => void;
}

let s: WoodsState = { cuttables: [], fired: new Set() };

function say(w: WorldScene, lines: string[], speaker = 'narrator'): boolean {
  w.cutscene.talk(async (c) => {
    for (const line of lines) await c.say(speaker, line);
  });
  return true;
}

/** Play an authored exchange by id. Returns false if there is no such id. */
function look(w: WorldScene, id: string): boolean {
  const beats = describe(id);
  if (!beats || !beats.length) return false;
  w.cutscene.talk((c) => runBeats(c, beats));
  return true;
}

function toast(w: WorldScene, text: string): void {
  w.cutscene.run(async (c) => { c.toast(text); });
}

/** The tiles the gully bushes stand on, and the ford tile they are cousins to. */
const BUSH_TILES: Array<[number, number]> = [[3, 61], [4, 61], [5, 61]];

// ── area ───────────────────────────────────────────────────────────────────

registerArea('woods', {
  onEnter(w) {
    s = { cuttables: [], fired: new Set() };

    State.set('entered_woods');
    if (State.quests.q4_shrine?.active) State.advanceQuest('q4_shrine', 'gate');

    // ── the gully bushes ────────────────────────────────────────────────────
    // Authored as map props so a still screenshot reads correctly; given
    // collision here so that cutting them is a real change to the world.
    if (!State.has('woods_gully_open')) {
      for (const [tx, ty] of BUSH_TILES) {
        const p = w.prop(`gully_bush_${tx}`);
        if (!p) continue;
        w.setDynamicSolid(tx, ty, true);
        s.cuttables.push({ sprite: p.sprite, tx, ty, cut: false });
      }
    } else {
      for (const [tx] of BUSH_TILES) w.prop(`gully_bush_${tx}`)?.sprite.destroy();
    }

    // ── the ford ────────────────────────────────────────────────────────────
    // The shallow tile is walkable in the map data and made solid here, so that
    // clearing it later is a single call rather than a rebuild.
    const [fx, fy] = WOODS.ford;
    const boulder = w.prop('ford_boulder');
    s.boulderSprite = boulder?.sprite;
    if (State.has('woods_ford_open')) {
      placeFordBoulder(w, s.boulderSprite);
    } else {
      w.setDynamicSolid(fx, fy, true);
    }

    // NOTE: the hint about the shallows deliberately does NOT get its own
    // interactable. A second target one tile from the boulder wins the
    // interaction cone as often as the boulder does, and the player ends up
    // reading a description of the puzzle instead of solving it. It is folded
    // into the boulder itself: approach it from the wrong side and it tells you
    // which side is the right one.

    // ── the chest ───────────────────────────────────────────────────────────
    if (State.has('woods_chest')) {
      const chest = w.prop('woods_chest');
      if (chest && hasFrame(w, 'prop/woods/chest_wood_open')) {
        chest.sprite.setFrame('prop/woods/chest_wood_open');
      }
    }

    // ── enemies already dealt with stay dealt with, within one visit ────────
    s.offReset = on('room:reset', (p: { map: string }) => {
      if (p.map !== 'woods') return;
      // Re-arm whichever encounters the player had already walked into: dying
      // costs the fight, not the journey.
      for (const e of ENCOUNTERS) {
        if (!s.fired.has(e.id)) continue;
        s.fired.delete(e.id);
        w.resetTrigger(e.id);
      }
    });
  },

  onExit() {
    s.offReset?.();
    s = { cuttables: [], fired: new Set() };
  },

  onUpdate(w) {
    // Cutting is done with the sword, not with a prompt: the bushes are the one
    // barrier in the zone that looks like it might give way.
    if (!s.cuttables.length) return;
    const hb = w.player.hitbox;
    if (!hb.active) return;
    for (const c of s.cuttables) {
      if (c.cut) continue;
      const cx = c.tx * TILE + TILE / 2;
      const cy = c.ty * TILE + TILE / 2;
      if (cx + 10 < hb.x || cx - 10 > hb.x + hb.w) continue;
      if (cy + 10 < hb.y || cy - 10 > hb.y + hb.h) continue;
      cutBush(w, c);
    }
  },

  onInteract(w, id) {
    if (id === 'woods_chest') return openChest(w);
    if (id === 'woods_boulder') return shoveBoulder(w);
    // Everything else is an authored exchange id declared on the prop itself.
    return look(w, id);
  },

  onTrigger(w, id) {
    const enc = ENCOUNTERS.find((e) => e.id === id);
    if (enc) {
      s.fired.add(enc.id);
      // The entrance of the room you are about to fight in is the safe point.
      w.flow.markCheckpoint(w.player.tileX, w.player.tileY);
      for (const [kind, tx, ty] of enc.spawns) w.enemies.spawn(kind, tx, ty);
      return true;
    }

    if (id === 'woods_arrive') return arrival(w);
    if (id === 'woods_narrows') return narrowsBeat(w);
    if (id === 'woods_dell') return dellBeat(w);
    if (id === 'to_shrine') return toShrine(w);
    return false;
  },
});

// ── beats ──────────────────────────────────────────────────────────────────

/**
 * Arrival. The authored `woods.enter` lines, then a gesture: the woods are a
 * break from learning (plan.md §36), so the zone opens by pointing at the first
 * Echo-touched thing and then shutting up.
 */
function arrival(w: WorldScene): boolean {
  const [sx, sy] = [26, 10];
  w.cutscene.run(async (c) => {
    c.banner('Whisper Woods', 'the road south');
    await c.wait(400);
    await playExchange(c, TALK.woods.enter);
    // Mote never speaks. It goes the colour of the thing it does not like.
    w.mote?.pointAt(sx * TILE + 8, sy * TILE, 2400);
    w.mote?.react('curious', 2400);
    await c.wait(500);
    await playExchange(c, TALK.woods.moteQuiet);
  });
  return true;
}

/** Under the heaviest canopy, where the zone stops feeling like a road. */
function narrowsBeat(w: WorldScene): boolean {
  w.cutscene.talk((c) => playExchange(c, TALK.woods.deeper));
  return true;
}

/** The dell: the player looks up, sees the chest, and cannot get to it yet. */
function dellBeat(w: WorldScene): boolean {
  if (State.has('woods_chest')) return false;
  const [cx, cy] = WOODS.chest;
  w.mote?.pointAt(cx * TILE + 8, (cy - 2) * TILE, 1600);
  return false; // not handled: let anything else on this zone still run
}

function toShrine(w: WorldScene): boolean {
  State.set('woods_cleared');
  w.cutscene.run(async (c) => {
    w.lighting.setDarkness(0.52, 900);
    w.mote?.react('alert', 2000);
    await c.wait(400);
    await playExchange(c, TALK.woods.bridge);
    if (State.quests.q4_shrine?.active) State.advanceQuest('q4_shrine', 'shrine');
    await c.wait(200);
    if (hasMap('shrine_entrance')) {
      emit('request:changeMap', { to: 'shrine_entrance', spawn: 'north', facing: 's' });
    } else {
      // The shrine is another author's map. Never hard-fail on their absence.
      c.toast('The way down is open.');
      w.lighting.setDarkness(0.3, 600);
    }
  });
  return true;
}

// ── the things the player can change ───────────────────────────────────────

function cutBush(w: WorldScene, c: Cuttable): void {
  c.cut = true;
  w.setDynamicSolid(c.tx, c.ty, false);
  Audio.sfx('bush_cut', { volume: 0.55 });
  w.fx.burst(c.sprite.x, c.sprite.y - 8, 'fx/grass_rustle');
  if (w.anims.exists('bush_cut')) {
    c.sprite.play('bush_cut');
    c.sprite.once('animationcomplete', () => c.sprite.destroy());
  } else {
    w.tweens.add({
      targets: c.sprite, alpha: 0, scaleY: 0.6, duration: 180,
      onComplete: () => c.sprite.destroy(),
    });
  }
  if (s.cuttables.every((b) => b.cut)) {
    State.set('woods_gully_open');
    toast(w, TOASTS.bushes);
    w.mote?.pointAt(WOODS.gully[0] * TILE + 8, WOODS.gully[1] * TILE, 1600);
  }
}

/** Drop the boulder into the shallows, making one tile of stream walkable. */
function shoveBoulder(w: WorldScene): boolean {
  if (State.has('woods_ford_open')) {
    say(w, ['It is not going anywhere now.']);
    return true;
  }
  // You have to be on the upstream side to put your weight behind it.
  //
  // This tests POSITION, not facing. `Interactions` turns the player to face
  // whatever they interacted with before dispatching, and it aims at the
  // sprite's mid-height — so by the time this runs the player's `dir` says
  // where the boulder is, not which way they were pushing. Standing north of it
  // is the thing the player actually did, so that is the thing to check.
  if (w.player.tileY > WOODS.boulder[1]) {
    say(w, BOULDER_HINT);
    return true;
  }
  const [fx, fy] = WOODS.ford;
  const sprite = s.boulderSprite;
  State.set('woods_ford_open');
  w.cutscene.run(async (c) => {
    if (sprite) {
      w.tweens.add({
        targets: sprite,
        y: (fy + 1) * TILE,
        duration: 420,
        ease: 'Quad.easeIn',
        onComplete: () => {
          w.fx.burst(sprite.x, sprite.y, 'fx/splash');
          Audio.sfx('splash', { volume: 0.6 });
          w.shake(0.005, 200);
          placeFordBoulder(w, sprite);
        },
      });
    }
    Audio.sfx('push_block', { volume: 0.6 });
    await c.wait(560);
    w.setDynamicSolid(fx, fy, false);
    c.toast(TOASTS.ford);
  });
  return true;
}

/** Park the boulder in the stream, under the player, as a stepping stone. */
function placeFordBoulder(w: WorldScene, sprite?: Phaser.GameObjects.Sprite): void {
  const [fx, fy] = WOODS.ford;
  w.setDynamicSolid(fx, fy, false);
  if (!sprite) return;
  sprite.setPosition(fx * TILE + TILE / 2, (fy + 1) * TILE);
  // Below the player, so standing on it reads as standing ON it.
  sprite.setDepth(DEPTH.ENTITY_BASE + (fy + 1) * TILE - 14);
}

function openChest(w: WorldScene): boolean {
  if (State.has('woods_chest')) {
    // TODO(dialogue): no authored line for a chest you already emptied.
    say(w, ['Empty. You took the good bit.']);
    return true;
  }
  State.set('woods_chest');
  const chest = w.prop('woods_chest');
  if (chest && hasFrame(w, 'prop/woods/chest_wood_open')) {
    chest.sprite.setFrame('prop/woods/chest_wood_open');
  }
  w.cutscene.run(async (c) => {
    if (chest) {
      w.fx.burst(chest.sprite.x, chest.sprite.y - 12, 'fx/pickup_sparkle');
      w.lighting.addPixel(chest.sprite.x, chest.sprite.y - 10, 40, 0xf2ca5e, 0.5);
    }
    Audio.sfx('chest', { volume: 0.6 });
    await c.wait(200);
    await playExchange(c, TALK.woods.chest);
  });
  return true;
}
