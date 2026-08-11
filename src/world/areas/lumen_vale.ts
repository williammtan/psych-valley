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
  store_apples: 'Apples, stacked by size. A hand-lettered price you cannot read from here.',
  scarecrow: 'Someone gave it a hat. The birds are unbothered.',
  beehive: 'A low, warm hum. Best not to lean closer.',
  parcels: 'Four parcels, four different knots. All the same handwriting.',
  courier_cart: "Oren's cart. The route board is chalked over twice.",
  pigeons: 'The roost. They come back here no matter where they are let go.',
  pump: 'The handle is worn smooth on one side.',
  cat: 'Asleep in the only warm strip of the lane. Not Pip.',
  cat_south: 'A ginger cat, flat out on the doorstep. Also not Pip.',
  inn_cat: 'A stranger cat, sunning itself outside the inn. Mira feeds them all.',
  sera_bench: 'A table of jars, a notebook, and a stone that should not be that colour.',
  garden_basket: 'Beans, mostly. One very proud marrow.',
  well: 'Deep, cold, and much older than the houses around it.',
  jetty: 'Two planks are new. The rest are green with river.',
  river_bench: 'A good bench. Someone sits here often enough to wear the paint.',
  overlook: 'From up here you can see the whole valley bend around the town.',
  roadside_shrine: 'A small stone, a bowl, a candle. Nobody remembers who started it.',
  shrine_small: 'Offerings at the tower foot: a coin, a ribbon, a pressed flower.',
  plaza_stall: 'A stall frame with no stall on it yet. Soon.',
  plaza_crates: 'Lanterns, packed in straw. A lot of lanterns.',
  plaza_arch: 'Flowers wired to a frame. Half of them are still in the crate.',
  inn_table: 'Someone left half a drink and all of their cards.',
  ford_sign: 'An arrow across the shallows, and one back to the square.',
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
  signpost_gate: ['South: WHISPER WOODS.', 'Underneath, newer paint: CLOSED.'],
  gate_sign: ['GATE SHUT BY ORDER OF THE COUNCIL.', 'No reason given. That is the part people mind.'],
};

function say(w: WorldScene, lines: string[], speaker = 'narrator'): boolean {
  w.cutscene.talk(async (c) => {
    for (const line of lines) await c.say(speaker, line);
  });
  return true;
}

/** Buildings you can see the door of but not open yet. */
const SHUT: Array<[string, string]> = [
  ['store', 'Shutters down. A chalk note: BACK AFTER THE FESTIVAL.'],
  ['house_a', 'Locked. A boot scraper, and mud on it.'],
  ['house_b', 'Locked. Someone is humming on the other side.'],
  ['house_c', 'Locked. The knocker is shaped like a fish.'],
  ['house_d', 'Locked. A cat flap, and no cat.'],
  ['house_e', 'Locked. Three pairs of boots by the step.'],
  ['belltower', 'The stair door is roped off. The rope is old and the knot is new.'],
];


/**
 * Door/marker zones are declared in the map file; the area script only needs
 * their position. Falls back to off-screen so a missing marker degrades to an
 * unreachable interaction rather than a crash.
 */
function lvDoor(w: WorldScene, id: string): { x: number; y: number } {
  const z = w.zone(id);
  return z ? { x: z.x + z.w / 2, y: z.y + z.h } : { x: -99, y: -99 };
}

registerArea('lumen_vale', {
  onEnter(w) {
    // ── doors without interiors: shut, with a reason ────────────────────────
    for (const [id, line] of SHUT) {
      const d = lvDoor(w, id);
      w.addInteractable({
        id: `shut_${id}`,
        x: d.x * 16 + 8,
        y: d.y * 16 - 4,
        label: 'Open',
        observable: true,
        onInteract: () => { say(w, [line]); },
      });
    }

    // ── the South Gate ──────────────────────────────────────────────────────
    const open = State.has('south_gate_open');
    const gate = w.prop('south_gate');
    if (gate && open) gate.sprite.setTexture('atlas', 'prop/build/south_gate');
    const gd = lvDoor(w, 'south_gate_look');
    w.addInteractable({
      id: 'gate_bar',
      x: gd.x * 16 + 8,
      y: gd.y * 16 - 10,
      label: 'Look',
      observable: true,
      onInteract: () => {
        if (State.has('south_gate_open')) say(w, ['The crossbar is up. The road south is open.']);
        else say(w, ['A crossbar as thick as your arm, and a new iron lock.']);
      },
    });

    // ── the festival transition, before it is a transition ──────────────────
    w.addInteractable({
      id: 'plaza_prep',
      x: 44 * 16,
      y: 10 * 16,
      label: 'Look',
      observable: true,
      forbids: 'festival_started',
      onInteract: () => { say(w, ['They are still hanging the lights. Come back at dusk.']); },
    });

    // ── arrival ─────────────────────────────────────────────────────────────
    if (!State.has('intro_done')) this.runArrival!(w);
  },

  onInteract(w, id) {
    if (LOOKS[id]) return say(w, [LOOKS[id]]);
    if (READS[id]) return say(w, READS[id]);
    return false;
  },

  onTrigger(w, id) {
    if (id === 'gate_shut' && !State.has('south_gate_open')) {
      emitToast(w, 'The south gate is barred.');
      return true;
    }
    if (id === 'plaza_gate' && !State.has('festival_started')) {
      emitToast(w, 'Festival Plaza — preparations underway.');
      return true;
    }
    return false;
  },
} as ReturnType<typeof makeArea>);

// ── helpers ────────────────────────────────────────────────────────────────

function emitToast(w: WorldScene, text: string): void {
  w.cutscene.run(async (c) => { c.toast(text); });
}

function makeArea() {
  return {} as {
    onEnter?(w: WorldScene): void;
    onInteract?(w: WorldScene, id: string): boolean;
    onTrigger?(w: WorldScene, id: string): boolean;
    runArrival?(w: WorldScene): void;
  };
}
