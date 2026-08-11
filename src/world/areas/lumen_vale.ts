/**
 * LUMEN VALE — area script.
 *
 * Owns everything the map file cannot express as data:
 *   - the arrival sequence (plan.md §32)
 *   - the notice board, the signposts and the look-at layer that makes the
 *     town readable as a place people live in
 *   - the doors of buildings that have no interior yet (visibly shut, with a
 *     one-line reason — never a dead zone)
 *   - the South Gate's open/closed state
 *
 * TODO(dialogue): every line here is placeholder copy written to the voice
 * brief in plan.md §53 (one short line, no lectures). When `src/data/dialogue/`
 * lands, these move there and this file reads from it.
 */
import { State } from '@/core/state';
import { registerArea } from '../registry';
import type { WorldScene } from '@/scenes/WorldScene';

/** Look-at flavour for props that carry an `interact` id in the map file. */
const LOOKS: Record<string, string> = {
  fountain: 'Three spouts, one basin. Somebody keeps the moss off it.',
  market_stall: 'Empty trestles. The awning has been patched twice.',
  square_cart: 'A hand cart, parked and forgotten. The brake is off.',
  store_apples: 'Apples, stacked by size. A price chalked too small to read from here.',
  scarecrow: 'Someone gave it a hat. The birds are unbothered.',
  beehive: 'A low, warm hum. Best not to lean closer.',
  parcels: 'Four parcels, four different knots. All the same handwriting.',
  courier_cart: "Oren's cart. The route board is chalked over twice.",
  pigeons: 'The roost. They come back here no matter where they are let go.',
  pump: 'The handle is worn smooth on one side.',
  cat: 'Asleep in the only warm strip of the lane. Not Pip.',
  cat_south: 'A ginger cat, flat out on a doorstep. Also not Pip.',
  inn_cat: 'A stranger cat, sunning itself outside the inn. Mira feeds them all.',
  sera_bench: 'A table of jars, a notebook, and a stone that should not be that colour.',
  garden_basket: 'Beans, mostly. One very proud marrow.',
  well: 'Deep, cold, and much older than the houses around it.',
  jetty: 'Two planks are new. The rest are green with river.',
  river_bench: 'A good bench. Someone sits here often enough to wear the paint.',
  overlook: 'From up here the valley bends right around the town.',
  roadside_shrine: 'A small stone, a bowl, a candle. Nobody remembers who started it.',
  shrine_small: 'Offerings at the tower foot: a coin, a ribbon, a pressed flower.',
  plaza_stall: 'A stall frame with no stall on it yet. Soon.',
  plaza_crates: 'Lanterns, packed in straw. A lot of lanterns.',
  plaza_arch: 'Flowers wired to a frame. Half of them are still in the crate.',
  inn_table: 'Someone left half a drink and all of their cards.',
  ford_sign: 'An arrow across the shallows, and one back to the square.',
  farm_trough: 'Green water, and a very confident duck.',
  laundry: 'Still damp. Someone will be out for it before dusk.',
  woodpile: 'Split, stacked, and covered. Whoever did this enjoyed it.',
  bridge_rail: 'Initials cut into the rail, worn almost smooth.',
};

/** Signposts and boards get a two-beat read rather than one line. */
const READS: Record<string, [string, string]> = {
  notice_board: [
    'FESTIVAL OF LANTERNS — the plaza, this evening.',
    'Below it: LOST — one cat, ginger, answers to nothing.',
  ],
  courier_board: [
    'Delivery notes, pinned three deep. Half are crossed out.',
    'The top one just says: ASK OREN. TWICE.',
  ],
  plaza_board: [
    'Setup rota. Every name on it is Mayor Elia.',
    'A second sheet: JUDGING AT DUSK. PLEASE DO NOT MOVE THE STAGE.',
  ],
  signpost_square: ['North: the plaza and the bell tower.', 'West: Courier Row. East: the bridge.'],
  signpost_south: ['South: the gate, and the woods beyond it.', 'The lower arm has been snapped off.'],
  signpost_bridge: ['East over the water: the Lantern Inn.', 'Someone has carved a cat into the post.'],
  signpost_gate: ['South: WHISPER WOODS.', 'Underneath, in newer paint: CLOSED.'],
  gate_sign: ['GATE SHUT BY ORDER OF THE COUNCIL.', 'No reason given. That is the part people mind.'],
};

/** Buildings whose door you can reach but not open. */
const SHUT: Array<[string, string]> = [
  ['store', 'Shutters down. A chalk note: BACK AFTER THE FESTIVAL.'],
  ['house_a', 'Locked. A boot scraper, and mud on it.'],
  ['house_b', 'Locked. Someone is humming on the other side.'],
  ['house_c', 'Locked. The knocker is shaped like a fish.'],
  ['house_d', 'Locked. A cat flap, and no cat.'],
  ['house_e', 'Locked. Three pairs of boots by the step.'],
  ['belltower', 'The stair door is roped off. The rope is old and the knot is new.'],
];

function say(w: WorldScene, lines: string[], speaker = 'narrator'): boolean {
  w.cutscene.talk(async (c) => {
    for (const line of lines) await c.say(speaker, line);
  });
  return true;
}

function toast(w: WorldScene, text: string): void {
  w.cutscene.run(async (c) => { c.toast(text); });
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
 * ARRIVAL (plan.md §32).
 *
 * The player has just come up the road through the south gate. The camera
 * leaves them for a moment to sweep north over the valley and land on the bell
 * tower — the thing they will navigate by for the next forty minutes — then
 * comes back and hands over control. One line of narration, no exposition.
 */
function runArrival(w: WorldScene): void {
  w.cutscene.run(async (c) => {
    await c.fadeIn(700);
    await c.wait(350);
    c.banner('Lumen Vale', 'a valley that remembers');
    await c.movePlayer(41, 66, 42);
    await c.wait(700);

    // The gate swinging shut behind them, then the whole valley.
    await c.panTo(42, 73, 750);
    await c.wait(650);
    await c.panTo(43, 58, 900);
    await c.panTo(50, 30, 1500);
    await c.wait(1100);
    await c.say('narrator', 'The bell tower. You can see it from anywhere in the valley.', { auto: 2600 });

    await c.panTo(46, 44, 1100);
    await c.wait(800);
    await c.panTo(70, 44, 1000);
    await c.wait(700);
    await c.say('narrator', 'River, bridge, inn. That will do for a map.', { auto: 2200 });

    c.followPlayer(1000);
    await c.wait(1100);
    await c.movePlayer(41, 62, 48);
    c.toast('Lumen Vale');
    State.set('intro_done');
  });
}

registerArea('lumen_vale', {
  onEnter(w) {
    // ── doors without interiors: shut, with a reason ────────────────────────
    for (const [id, line] of SHUT) {
      const d = marker(w, id);
      w.addInteractable({
        id: `shut_${id}`,
        x: d.x * 16,
        y: d.y * 16 - 6,
        label: 'Open',
        observable: true,
        onInteract: () => { say(w, [line]); },
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
        say(w, State.has('south_gate_open')
          ? ['The crossbar is up. The road south is open.']
          : ['A crossbar as thick as your arm, and a new iron lock.']);
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
      onInteract: () => { say(w, ['They are still hanging the lights. Come back at dusk.']); },
    });

    if (!State.has('intro_done')) runArrival(w);
  },

  onInteract(w, id) {
    if (LOOKS[id]) return say(w, [LOOKS[id]]);
    if (READS[id]) return say(w, READS[id]);
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
