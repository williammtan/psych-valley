/**
 * SERA'S WORKSHOP — area script.
 *
 * Two things here matter more than their size suggests.
 *
 * SERA'S BOOKSHELF (plan.md §49) is the game's only long-form educational
 * surface, and it is entirely optional. The rules it follows:
 *
 *   1. an entry exists only for a concept the player has ALREADY lived through
 *      (§51: terminology after experience, never before)
 *   2. entries are asides, not textbook paragraphs — the interesting extra
 *      thing, the misconception, the place it shows up in your own life
 *   3. the shelf never tells you the answer to anything you are currently
 *      stuck on; the Journal already holds the canonical definitions
 *
 * The prose is drawn from `src/data/concepts.ts` so the shelf and the Insight
 * Cards cannot drift apart — the misconception and real-world lines are lifted
 * directly, and the framing sentences are written to the §53 voice brief.
 *
 * THE MAP TABLE is the hinge of the whole slice (plan.md §31, §36). After the
 * third quest, Sera connects a frightened cat, a confused courier and a town
 * that all agreed on the wrong answer to one thing underneath the valley — and
 * the south gate opens. That scene lives here rather than in a quest module
 * because the table is the thing the player interacts with.
 *
 * TODO(dialogue): placeholder copy to the §53 brief; moves to
 * `src/data/dialogue/` when that folder grows content files.
 */
import { State } from '@/core/state';
import { CONCEPTS } from '@/data/concepts';
import { registerArea } from '../registry';
import type { WorldScene } from '@/scenes/WorldScene';

// ── the shelf ──────────────────────────────────────────────────────────────

interface ShelfEntry {
  /** Concept id in CONCEPTS; also the gate. */
  concept: string;
  /** Spine text shown in the choice list. */
  spine: string;
  /** Two or three short lines. An aside, not a lecture. */
  lines: string[];
}

/**
 * One entry per concept, unlocked by having lived it. The lines deliberately
 * do NOT restate the definition — the player already has that on their Insight
 * Card. These are the things a researcher would say over her shoulder.
 */
const SHELF: ShelfEntry[] = [
  {
    concept: 'conditioning',
    spine: 'ON LEARNED ALARM  (annotated, badly)',
    lines: [
      'A margin note, in Sera\'s hand: "the bell never became frightening."',
      CONCEPTS.conditioning.misconception.replace(/^People often think /, 'Everyone assumes '),
      `Underlined twice: "${CONCEPTS.conditioning.realWorld[0]}"`,
    ],
  },
  {
    concept: 'interference',
    spine: 'FIELD NOTES ON FORGETTING',
    lines: [
      'Sera has crossed out the title and written: NOT forgetting.',
      CONCEPTS.interference.misconception,
      `In the margin: "${CONCEPTS.interference.realWorld[1]}" — with a date, and a name scribbled out.`,
    ],
  },
  {
    concept: 'conformity',
    spine: 'A TREATISE ON PUBLIC AGREEMENT',
    lines: [
      'Thin, and much-handled. Someone has folded down one page.',
      CONCEPTS.conformity.misconception,
      'At the bottom, pressed hard enough to dent the paper: "one voice is enough."',
    ],
  },
];

function unlocked(e: ShelfEntry): boolean {
  return State.insightUnlocked(e.concept) || State.has(`insight_${e.concept}`);
}

// ── copy ───────────────────────────────────────────────────────────────────

const LOOKS: Record<string, string> = {
  chalkboard: 'Three diagrams. Two are crossed out. The third has a question mark and a date.',
  jars: 'Nine jars. Six are labelled. Two of the labels are the same word.',
  desk: 'Paper to the depth of a hand. Somewhere under it, allegedly, a desk.',
  plants: 'Whatever this is, it has outgrown the shelf and started on the wall.',
  orrery: 'Brass rings on a stand. Someone has re-strung the smallest one with wire.',
  crates: 'Crates of things dug out of the valley. Each one tagged, none of them explained.',
  armchair: 'Deeply scratched on one arm. A cat lived here before Pip did, or instead of.',
};

const ARTEFACT = [
  'A shard on a stand, and a violet light with nothing lighting it.',
  'It is the only thing in the room Sera has not written on.',
];

const MAP_TABLE_IDLE = [
  'A map of the valley, pinned flat. String runs between four pins.',
  'Three of the pins have dates. The fourth is under the town, and has none.',
];

function say(w: WorldScene, lines: string[], speaker = 'narrator'): boolean {
  w.cutscene.talk(async (c) => {
    for (const line of lines) await c.say(speaker, line);
  });
  return true;
}

/** Is the third quest behind us? */
function q3Done(): boolean {
  return State.has('q3_complete') || State.has('q3_done') || !!State.quests.q3_lanterns?.complete;
}

// ── area ───────────────────────────────────────────────────────────────────

registerArea('workshop', {
  onEnter(w) {
    // Sera keeps her own hours. She is here unless the story has her elsewhere:
    // during the festival she is at the plaza, and once the gate is open she
    // has gone ahead to the south road.
    const elsewhere = (State.has('festival_started') && !q3Done()) || State.has('entered_woods');
    if (!elsewhere && !w.npc('sera')) {
      w.spawnNpc({
        id: 'sera',
        actor: 'sera',
        x: 18,
        y: 11,
        facing: 's',
        // A short loop between the desk, the map table and the artefact: she is
        // working, not waiting for you.
        path: [[18, 11], [23, 12], [18, 11], [11, 12]],
        dwell: 3.4,
      });
      State.meet('sera');
    }

    // The map table is the room's mechanism, so it gets an Observe mark from
    // the moment it has something to say.
    w.addInteractable({
      id: 'map_table_hint',
      x: 9 * 16 + 8,
      y: 13 * 16,
      radius: 6,
      label: 'Look',
      observable: true,
      enabled: () => q3Done() && !State.has('south_gate_open'),
    });
  },

  onInteract(w, id) {
    if (id === 'sera_bookshelf') return readShelf(w);
    if (id === 'map_table' || id === 'map_table_hint') return mapTable(w);
    if (id === 'echo_artefact') return say(w, ARTEFACT);
    if (LOOKS[id]) return say(w, [LOOKS[id]]);
    return false;
  },
});

// ── the bookshelf ──────────────────────────────────────────────────────────

function readShelf(w: WorldScene): boolean {
  const available = SHELF.filter(unlocked);

  if (!available.length) {
    say(w, [
      'Books, three deep, in no order anyone could defend.',
      'Most of it is about things you have not seen yet.',
    ]);
    return true;
  }

  w.cutscene.talk(async (c) => {
    await c.say('narrator', 'One shelf is at eye height and the spines on it are worn.');
    const options = available.map((e) => ({ text: e.spine }));
    options.push({ text: 'Leave it.' });
    const pick = await c.choose('Read something?', options);
    const entry = available[pick];
    if (!entry) return;
    for (const line of entry.lines) await c.say('narrator', line);
  });
  return true;
}

// ── the map table ──────────────────────────────────────────────────────────

function mapTable(w: WorldScene): boolean {
  if (!q3Done()) return say(w, MAP_TABLE_IDLE);
  if (State.has('south_gate_open')) {
    return say(w, [
      'Three dated pins, and a fourth with no date, under the town.',
      'The string from all three runs to it.',
    ]);
  }

  // The scene. Short, because the player already did the work — Sera's job is
  // to name the pattern they found, not to explain it to them (plan.md §5.3).
  const sera = w.npc('sera');
  w.cutscene.run(async (c) => {
    if (sera) {
      await c.walk('sera', 10, 13);
      c.face('sera', 'n');
    }
    await c.say('narrator', 'Sera moves a lamp over the map and puts her finger on the town.');
    await c.say('sera', 'Pip. Oren. The Trial.');
    await c.say('sera', 'Three different things going wrong with three different mechanisms.');
    await c.say('player', 'And they all got worse at the same time.');
    await c.say('sera', 'They did.', { emote: 'idea' });
    await c.wait(300);
    c.toast('The south gate is open.');
    await c.say('sera', "Whatever is under us has been practising. I'd rather we saw it first.");
    await c.say('sera', 'South road. Through the woods.');

    State.set('south_gate_open');
    State.set('sera_briefed');
    State.startQuest('q4_shrine');
    if (sera) c.face('sera', 's');
  });
  return true;
}
