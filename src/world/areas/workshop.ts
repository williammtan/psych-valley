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
import { FLAGS, describe, playById, runBeats } from '@/data/dialogue';
import { registerArea } from '../registry';
import type { WorldScene } from '@/scenes/WorldScene';

// ── the shelf ──────────────────────────────────────────────────────────────

interface ShelfTopic {
  /** Spine text shown in the choice list. */
  spine: string;
  /** Authored exchange ids in `src/data/dialogue/optional.ts`, in order. */
  entries: string[];
  /** Which quest has to be behind the player. */
  gate: () => boolean;
}

/**
 * The shelf is a rotating stack, not a menu of articles: each visit to a topic
 * turns up the *next* note in it, so coming back is worth something and no
 * single read is long. The asides themselves are authored in
 * `src/data/dialogue/optional.ts` under `shelf.*` — their `requires` notes are
 * documentation, so the gate is enforced here.
 */
const SHELF: ShelfTopic[] = [
  {
    spine: 'ON LEARNED ALARM',
    entries: ['shelf.conditioning1', 'shelf.conditioning2', 'shelf.conditioning3'],
    gate: () => done(FLAGS.q1Done, 'q1_pip', 'conditioning'),
  },
  {
    spine: 'FIELD NOTES ON FORGETTING',
    entries: ['shelf.interference1', 'shelf.interference2', 'shelf.interference3'],
    gate: () => done(FLAGS.q2Done, 'q2_oren', 'interference'),
  },
  {
    spine: 'ON PUBLIC AGREEMENT',
    entries: ['shelf.conformity1', 'shelf.conformity2', 'shelf.conformity3'],
    gate: () => done(FLAGS.q3Done, 'q3_lanterns', 'conformity'),
  },
  {
    spine: 'A NEWER PAGE, PINNED CROOKED',
    entries: ['shelf.echo'],
    gate: () => State.has(FLAGS.shrineDone) || State.has(FLAGS.bossBeaten),
  },
];

/** A concept counts as lived if its quest, its flag or its insight says so. */
function done(flag: string, questId: string, concept: string): boolean {
  return State.has(flag)
    || State.has(`${questId.slice(0, 2)}_complete`)
    || !!State.quests[questId]?.complete
    || State.insightUnlocked(concept)
    || State.has(`insight_${concept}`);
}

// ── copy ───────────────────────────────────────────────────────────────────
// TODO(dialogue): workshop props have no authored `prop.*` entries yet. Written
// to the §53 brief and ready to move into `src/data/dialogue/environment.ts`.

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

/** Play an authored exchange by id. Returns false if there is no such id. */
function look(w: WorldScene, id: string): boolean {
  const beats = describe(id);
  if (!beats || !beats.length) return false;
  w.cutscene.talk((c) => runBeats(c, beats));
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
    // at the plaza while the Trial is running, and ahead of you on the south
    // road once you have gone into the woods — but back at her desk afterwards,
    // because a character who disappears permanently stops being a character.
    const onTheRoad = State.has('entered_woods')
      && !(State.has('shrine_done') || State.has('boss_beaten'));
    const elsewhere = (State.has('festival_started') && !q3Done()) || onTheRoad;
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
  const available = SHELF.filter((t) => t.gate());

  // Before the first quest there is nothing on the shelf the player has earned
  // the right to find interesting, so it stays shut rather than lecturing.
  if (!available.length) return look(w, 'shelf.general') || say(w, ['Notes, five hands, no order.']);

  w.cutscene.talk(async (c) => {
    if (!State.has('read_shelf')) {
      State.set('read_shelf');
      await runBeats(c, playById('shelf.intro'));
    }
    const options = available.map((t) => ({ text: t.spine }));
    options.push({ text: 'Leave it.' });
    const pick = await c.choose('Read something?', options);
    const topic = available[pick];
    if (!topic) return;
    // Rotate: each visit to a topic turns up the next note in that stack.
    const key = `shelf_${pick}_${topic.entries.length}`;
    const n = State.count(key);
    State.bump(key);
    await runBeats(c, playById(topic.entries[n % topic.entries.length]));
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
