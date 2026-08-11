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
 * TODO(dialogue): the strings in this file are placeholder copy written to the
 * §53 voice brief — one short line, no lectures, and Mote never speaks. When
 * `src/data/dialogue/` grows content files these move there wholesale, which is
 * why they are collected in tables at the top rather than inlined.
 */
import { State } from '@/core/state';
import { emit, on } from '@/core/events';
import { DEPTH, TILE } from '@/core/config';
import { hasFrame } from '@/core/textures';
import { Audio } from '@/audio/Audio';
import { registerArea, hasMap } from '../registry';
import { ENCOUNTERS, WOODS } from '../maps/woods';
import type { WorldScene } from '@/scenes/WorldScene';
import type Phaser from 'phaser';

// ── copy ───────────────────────────────────────────────────────────────────

/** One-line look-at flavour for props carrying an `interact` id. */
const LOOKS: Record<string, string> = {
  woods_campsite: 'A cold campfire, ringed with stones. Someone waited here a long time.',
};

/** Multi-beat reads. Kept to two or three short lines each. */
const READS: Record<string, string[]> = {
  woods_signpost: [
    'SOUTH: THE OLD SHRINE ROAD.',
    'Under it, in a different hand: NOBODY MAINTAINS IT.',
  ],
  woods_first_stone: [
    'A standing stone, older than the road beside it.',
    'The lichen has grown around a mark it did not make.',
  ],
  woods_carving: [
    'Someone cut a spiral into this stone, then cut it again, deeper.',
    'Below it, four notches. Then a fifth, scratched out.',
    'The shrine is meant to be *entered*, the carving says. Not opened.',
  ],
  woods_toadstools: [
    'A perfect ring of toadstools, and nothing inside it but flattened grass.',
    'Something small sleeps here. Not tonight, apparently.',
  ],
  woods_boulder_hint: [
    'The stream runs shallow here — one stride, if there were anything to stride onto.',
    'The boulder on the bank has been rocking in its socket for years.',
  ],
};

const TOASTS = {
  chest: 'Found: a lantern-charm. It catches the light oddly.',
  chestAlready: 'Empty. You took the good bit.',
  ford: 'The boulder settles into the streambed.',
  bushes: 'The bushes were hiding a cut in the rock.',
};

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

    // A hint you find by looking, not by being told.
    w.addInteractable({
      id: 'woods_boulder_hint',
      x: (fx + 0.5) * TILE,
      y: (fy - 1) * TILE,
      label: 'Look',
      observable: true,
      forbids: 'woods_ford_open',
      onInteract: () => { say(w, READS.woods_boulder_hint); },
    });

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
    if (READS[id]) return say(w, READS[id]);
    if (LOOKS[id]) return say(w, [LOOKS[id]]);
    return false;
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
    if (id === 'woods_dell') return dellBeat(w);
    if (id === 'to_shrine') return toShrine(w);
    return false;
  },
});

// ── beats ──────────────────────────────────────────────────────────────────

/**
 * Arrival. Two lines and a gesture: the woods are a break from learning
 * (plan.md §36), so the zone opens by pointing at something and shutting up.
 */
function arrival(w: WorldScene): boolean {
  const [sx, sy] = [26, 10];
  w.cutscene.run(async (c) => {
    c.banner('Whisper Woods', 'the road south');
    await c.wait(500);
    w.mote?.pointAt(sx * TILE + 8, sy * TILE, 2200);
    w.mote?.react('curious', 2200);
    await c.wait(700);
    await c.say('narrator', 'Mote drifts off the path and hangs over the stone.');
    await c.say('narrator', 'Its light has gone the same colour as the mark cut into it.');
  });
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
    await c.say('narrator', 'The trees stop. The ground under your boots is cut stone.');
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
  // You have to be pushing it the way it would actually go.
  if (w.player.dir !== 's') {
    say(w, ['It rocks in its socket. From the other side, it would go over.']);
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
    say(w, [TOASTS.chestAlready]);
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
    c.toast(TOASTS.chest);
    await c.wait(400);
    await c.say('narrator', 'A charm on a cord, cut from something that was never wood.');
  });
  return true;
}
