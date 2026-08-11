/**
 * ECHO SHRINE — the entrance hall.
 *
 * No puzzle. Three jobs, in order:
 *
 *   1. ARRIVE.  Sera comes as far as the first door and no further, exactly as
 *      she says she will. The authored exchange does the talking; this file
 *      only decides when.
 *   2. SEE IT ONCE.  Halfway down the hall something crosses the aisle ahead of
 *      you, tries on a shape, and is gone before you can name what it was. It
 *      is never fought here and it is never mentioned again until the boss
 *      chamber. The whole beat is four seconds long and has no dialogue box.
 *   3. LET THEM READ.  Three pillars carry logs one, four and seven — the
 *      observatory's own record, already authored in `data/dialogue/shrine.ts`.
 *      Anyone who reads all twelve across the dungeon gets the entire story of
 *      what happened down here without a single line of exposition.
 */
import { DEPTH } from '@/core/config';
import { emit } from '@/core/events';
import { State } from '@/core/state';
import { Audio } from '@/audio/Audio';
import { registerArea } from '../registry';
import { TALK, ambient, playExchange } from '@/data/dialogue';
import { readEnv, RoomRig } from './shrine_kit';
import type { WorldScene } from '@/scenes/WorldScene';

let rig: RoomRig | null = null;

/** The Echo, seen once, from too far away to be sure. */
function sighting(w: WorldScene): void {
  void w.cutscene.run(async (c) => {
    const cam = w.cameras.main;
    cam.stopFollow();
    await c.panTo(14.5, 21, 700);
    w.mote?.react('alert', 2400);
    Audio.sfx('echo_hum', { volume: 0.5 });
    w.lighting.setDarkness(0.66, 500);

    const shape = w.add.sprite(6 * 16 + 8, 22 * 16 + 16, 'atlas', 'enemy/echo/idle_0')
      .setOrigin(0.5, 1)
      .setDepth(DEPTH.ENTITY_BASE + 22 * 16 + 16)
      .setAlpha(0);
    if (w.anims.exists('echo_idle')) shape.play('echo_idle');
    w.tweens.add({ targets: shape, alpha: 0.75, duration: 320 });
    w.tweens.add({
      targets: shape,
      x: 23 * 16 + 8,
      duration: 1500,
      ease: 'Sine.easeInOut',
      onComplete: () => {
        w.fx.burst(shape.x, shape.y - 14, 'fx/echo_burst');
        w.tweens.add({ targets: shape, alpha: 0, duration: 260, onComplete: () => shape.destroy() });
      },
    });
    await c.wait(1900);
    Audio.sfx('echo_phase', { volume: 0.42 });
    await c.wait(400);
    w.lighting.setDarkness(0.5, 700);
    await playExchange(c, TALK.shrine.entry);
    cam.zoomTo(1, 1, 'Linear', true);
    c.followPlayer(520);
  });
}

registerArea('shrine_entrance', {
  onEnter(w) {
    rig?.destroy();
    rig = new RoomRig(w);
    w.fx.setAmbient('shrine');
    State.setAll(['entered_shrine', 'shrine_entered']);
    State.meet('sera');
    if (State.quests.q4_shrine?.active) State.advanceQuest('q4_shrine', 'shrine');

    // Sera stays here for the rest of the dungeon, so the hall is also the
    // place you can always walk back to and find a person.
    w.npc('sera')?.face('e');

    const chest = w.prop('chest');
    if (chest && !State.has('shrine_chest')) {
      w.addInteractable({
        id: 'shrine_chest',
        x: chest.sprite.x,
        y: chest.sprite.y - 10,
        label: 'Open',
        observable: true,
        forbids: 'shrine_chest',
        onInteract: () => {
          State.set('shrine_chest');
          chest.sprite.setTexture('atlas', 'prop/shrine/chest_open');
          Audio.sfx('chest', { volume: 0.6 });
          w.fx.burst(chest.sprite.x, chest.sprite.y - 14, 'fx/pickup_sparkle');
          State.hp = State.maxHp;
          emit('player:heal', { hp: State.hp });
          Audio.sfx('heart', { volume: 0.6 });
        },
      });
    }

    const pool = w.prop('pool');
    if (pool) {
      w.addInteractable({
        id: 'shrine_pool',
        x: pool.sprite.x,
        y: pool.sprite.y - 6,
        label: 'Look',
        observable: true,
        onInteract: () => {
          Audio.sfx('echo_hum', { volume: 0.35 });
          w.fx.burst(pool.sprite.x, pool.sprite.y - 4, 'fx/recall_shimmer');
          w.mote?.react('curious', 1200);
        },
      });
    }
  },

  onTrigger(w, id) {
    if (id === 'shrine_arrive') {
      if (State.has('shrine_arrival_done')) return false;
      State.set('shrine_arrival_done');
      void w.cutscene.run(async (c) => {
        c.banner('The Echo Shrine');
        await playExchange(c, TALK.shrine.arrive);
      });
      return true;
    }
    if (id === 'echo_sighting') {
      if (State.has('shrine_echo_seen')) return false;
      State.set('shrine_echo_seen');
      sighting(w);
      return true;
    }
    return false;
  },

  onInteract(w, id) {
    if (id.startsWith('carving.')) return readEnv(w, id);
    if (id === 'npc:sera') {
      const line = ambient('sera');
      void w.cutscene.talk(async (c) => {
        if (line) await c.say('sera', line.text);
        else await c.say('sera', 'Go on. I will be right here, being useful at a distance.');
      });
      return true;
    }
    return false;
  },

  onExit() {
    rig?.destroy();
    rig = null;
  },
});
