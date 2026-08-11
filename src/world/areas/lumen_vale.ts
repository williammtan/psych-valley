/**
 * LUMEN VALE — area script.
 *
 * Owns everything the map file cannot express as data:
 *   - the arrival sequence (plan.md §32)
 *   - the look-at layer that makes the town readable as a place people live in
 *   - townsfolk conversation, which changes with the story stage
 *   - the doors of buildings with no interior (visibly shut, with a reason)
 *   - the South Gate's open/closed state
 *
 * All player-visible text comes from `@/data/dialogue`. Props in the map file
 * carry the dotted exchange id in their `interact` field (`prop.fountain`,
 * `sign.bridge`), so adding a line to a prop is a dialogue-package edit and
 * never a map edit. The handful of strings still literal here are for props
 * the authored set does not cover; each is marked.
 */
import { State } from '@/core/state';
import {
  ENV, TALK, ambient, anyHint, describe, hint, playExchange, runBeats,
} from '@/data/dialogue';
import { registerArea } from '../registry';
import type { WorldScene } from '@/scenes/WorldScene';

/**
 * TODO(dialogue): props with no authored exchange yet. Everything else routes
 * through `describe()`. Keep this list shrinking, not growing.
 */
const EXTRA: Record<string, string> = {
  cat: 'Asleep in the only warm strip of the lane. Ginger, and emphatically not Pip.',
  laundry: 'Still damp. Someone will be out for it before dusk.',
  woodpile: 'Split, stacked and covered. Whoever did this enjoyed it.',
  store_apples: 'Apples stacked by size, and a price chalked too small to read from here.',
  garden_basket: 'Beans, mostly. One very proud marrow.',
  pigeons: 'The roost. They come back here no matter where they are let go.',
  overlook: 'From the bench the whole valley bends around the town.',
  plaza_arch: 'Flowers wired to a frame. Half of them are still in the crate.',
  sera_bench: 'A table of jars, a notebook, and a stone that should not be that colour.',
};

/**
 * Buildings whose door you can reach but not open. The second field is an
 * authored exchange id where one exists, and otherwise a literal — a locked
 * front door needs one clause, not a scene.
 */
const SHUT: Array<[string, string]> = [
  ['store', 'sign.store'],
  ['belltower', 'prop.towerDoor'],
  ['house_a', 'Locked. A boot scraper, and mud on it.'],
  ['house_b', 'Locked. Someone is humming on the other side.'],
  ['house_c', 'Locked. The knocker is shaped like a fish.'],
  ['house_d', 'Locked. A cat flap, and no cat.'],
  ['house_e', 'Locked. Three pairs of boots by the step.'],
];

function line(w: WorldScene, text: string, speaker = 'narrator'): boolean {
  void w.cutscene.talk(async (c) => { await c.say(speaker, text); });
  return true;
}

function toast(w: WorldScene, text: string): void {
  void w.cutscene.run(async (c) => { c.toast(text); });
}

/**
 * Marker zones declared in the map file give the area script its coordinates,
 * so door positions live in exactly one place. Falls back off-map so a missing
 * marker degrades to an unreachable interaction rather than a crash.
 */
function marker(w: WorldScene, id: string): { x: number; y: number } {
  const z = w.zone(id);
  return z ? { x: z.x + z.w / 2, y: z.y + z.h } : { x: -99, y: -99 };
}

/**
 * ARRIVAL (plan.md §32, TALK.arrival.approach).
 *
 * The player has come up the road through the south gate. The camera leaves
 * them to sweep north over the valley and land on the bell tower — the thing
 * they will navigate by for the next forty minutes — then hands control back.
 * The authored script asks for that pan by name (`cue: camera_pan_town`); this
 * is where the request gets honoured.
 */
function runArrival(w: WorldScene): void {
  void w.cutscene.run(async (c) => {
    await c.fadeIn(700);
    await c.wait(350);
    c.banner('Lumen Vale', 'a valley that remembers');
    await c.movePlayer(41, 66, 42);
    await c.wait(600);

    await playExchange(c, TALK.arrival.approach, {
      cue: async (name) => {
        if (name !== 'camera_pan_town') return;
        await c.panTo(42, 73, 700);          // the gate, shut behind them
        await c.wait(500);
        await c.panTo(43, 58, 850);
        await c.panTo(50, 30, 1500);         // up the valley to the bell tower
        await c.wait(1200);
        await c.panTo(46, 44, 1000);         // the square
        await c.wait(600);
        await c.panTo(70, 44, 900);          // river, bridge, inn
        await c.wait(700);
        c.followPlayer(900);
        await c.wait(900);
      },
    });

    await c.movePlayer(41, 62, 48);
    State.set('intro_done');
  });
}

registerArea('lumen_vale', {
  onEnter(w) {
    // ── doors without interiors: shut, with a reason ────────────────────────
    for (const [id, text] of SHUT) {
      const d = marker(w, id);
      w.addInteractable({
        id: `shut_${id}`,
        x: d.x * 16,
        y: d.y * 16 - 6,
        label: 'Open',
        observable: true,
        onInteract: () => {
          const beats = text in ENV ? describe(text) : null;
          if (beats && beats.length) void w.cutscene.talk((c) => runBeats(c, beats));
          else line(w, text);
        },
      });
    }

    // ── the South Gate ──────────────────────────────────────────────────────
    if (State.has('south_gate_open')) {
      w.prop('south_gate')?.sprite.setTexture('atlas', 'prop/build/south_gate');
    }
    const gd = marker(w, 'to_woods');
    w.addInteractable({
      id: 'gate_bar',
      x: gd.x * 16,
      y: gd.y * 16 - 18,
      radius: 6,
      label: 'Look',
      observable: true,
      onInteract: () => {
        if (State.has('south_gate_open')) { line(w, 'The crossbar is up. The road south is open.'); return; }
        void w.cutscene.talk((c) => playExchange(c, TALK.south.gate));
      },
    });

    // ── the festival transition, before it is a transition ──────────────────
    const fd = marker(w, 'to_festival');
    w.addInteractable({
      id: 'plaza_prep',
      x: fd.x * 16,
      y: fd.y * 16 + 8,
      radius: 8,
      label: 'Look',
      observable: true,
      forbids: 'festival_started',
      onInteract: () => { line(w, 'They are still hanging the lights. Come back at dusk.'); },
    });

    if (!State.has('intro_done')) runArrival(w);
  },

  onInteract(w, id) {
    // ── townsfolk ───────────────────────────────────────────────────────────
    // Ambient sets are indexed by story stage, so the same villager says
    // different things before and after each quest. Every third exchange they
    // offer their "where to go next" line, which is the hint system for a lost
    // player without a separate UI for it.
    if (id.startsWith('npc:')) {
      const who = id.slice(4);
      const idle = ambient(who);
      const nudge = State.bump(`lv_talk_${who}`) % 3 === 0 ? (hint(who) ?? anyHint()) : null;
      if (!idle && !nudge) return false;
      State.meet(who);
      void w.cutscene.talk(async (c) => {
        if (idle) await c.say(idle.speaker, idle.text);
        if (nudge) await c.say(nudge.speaker, nudge.text);
      });
      return true;
    }

    // ── everything you can look at ──────────────────────────────────────────
    if (id in ENV) {
      const beats = describe(id);
      if (beats && beats.length) {
        void w.cutscene.talk((c) => runBeats(c, beats));
        return true;
      }
    }
    if (EXTRA[id]) return line(w, EXTRA[id]);
    return false;
  },

  onTrigger(w, id) {
    if (id === 'gate_shut' && !State.has('south_gate_open')) {
      toast(w, 'The south gate is barred.');
      return true;
    }
    if (id === 'plaza_gate' && !State.has('festival_started')) {
      toast(w, 'Festival Plaza — preparations underway.');
      return true;
    }
    return false;
  },
});
