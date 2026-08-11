/**
 * QUEST TWO — THE MIXED-UP DELIVERY.  (plan.md §12, §13)
 *
 * Oren ran the river route on the eleventh and again on the twelfth. Same three
 * doors, same order, near enough the same parcels. He remembers both days
 * perfectly and they arrive together, so he cannot say which was which.
 *
 * The quest is a small detective puzzle and nothing else: reconstruct two days
 * from what is lying around a room. Strip every psychological word out of it and
 * it still works, which is the point — the concept is the puzzle's shape, not a
 * label stuck on top of it.
 *
 * ── the evidence, and why the split is load-bearing ────────────────────────
 *
 * Three pairs of deliveries are separated by three physical facts, and by
 * nothing else:
 *
 *   Hesta's two sacks   ← one receipt slip has run in the rain; it rained on
 *                          the eleventh and not since
 *   Dov's two boxes     ← one is tied with waxed cord, and the office ran out
 *                          of waxed cord on Monday; the other is taped
 *   Wren's two salves   ← one string is clean, one is green, and Wren's door
 *                          was brown until yesterday evening
 *
 * Everything else the player can find is somebody's recollection. Four people
 * are certain, two of them about the same parcel and in opposite directions.
 * A recollection can be pinned to the board and will sit there looking exactly
 * as good as the evidence — and will never lock a slot, and will pull visibly
 * against whatever disagrees with it. That refusal is the whole quest.
 */
import { State } from '@/core/state';
import { emit, on } from '@/core/events';
import { registerArea } from '../registry';
import { openMemoryThreads, type ThreadBoard, type ThreadCard } from '@/ui/MemoryThreads';
import { TALK, play, describe, type ResolvedBeat } from '@/data/dialogue';
import type { CutsceneContext } from '@/systems/Cutscene';
import type { WorldScene } from '@/scenes/WorldScene';

// ── the four wraps ──────────────────────────────────────────────────────────
// Index and colour must match `P.PARCEL_WRAP`, which is the contract between
// `prop/town/parcel_<i>` outside and `prop/int/post_parcel_<i>` in here: a
// player who saw a parcel on Courier Row has to recognise it on this board.
const WRAP = {
  cream: { word: 'CREAM', tint: 0xb0977a },
  blue: { word: 'BLUE', tint: 0x3e5279 },
  plum: { word: 'PLUM', tint: 0x66406a },
  teal: { word: 'TEAL', tint: 0x2f6f6f },
} as const;

/** Where each delivery actually happened. The board never shows this. */
const TRUTH: ThreadBoard['truth'] = {
  hesta_11: { day: 'yesterday', slot: 0 },
  dov_11: { day: 'yesterday', slot: 1 },
  wren_11: { day: 'yesterday', slot: 2 },
  hesta_12: { day: 'today', slot: 0 },
  dov_12: { day: 'today', slot: 1 },
  wren_12: { day: 'today', slot: 2 },
};

interface ClueDef extends ThreadCard {
  /** Prop id in the map this clue is read from, or an npc id. */
  at?: string;
  /** Pixel nudge from the prop's anchor. */
  offset?: [number, number];
  /** Exchange played the first time it is read. */
  exchange?: string;
  /** Extra flag set for other people's dialogue conditions. */
  alias?: string;
}

/**
 * Ten cards. Six are things; four are people being certain.
 *
 * The face of a card says what the *evidence* is, never what it proves — the
 * inference from "the ink has run" to "the eleventh" is the player's to make,
 * and it only works if they also found out that it rained.
 */
const CLUES: ClueDef[] = [
  // ── contextual: six things in a room ──────────────────────────────────────
  {
    id: 'c_slip_wet', kind: 'context', delivery: 'hesta_11',
    parcel: WRAP.cream.word, tint: WRAP.cream.tint, address: 'ink has run',
    claim: { day: 'yesterday', slot: 0 },
    note: "Hesta's slip, third down the spike: the ink has run at one corner.",
    at: 'stamp_desk', exchange: 'q2.clueReceipt', alias: 'clue_receipt',
  },
  {
    id: 'c_slip_dry', kind: 'context', delivery: 'hesta_12',
    parcel: WRAP.cream.word, tint: WRAP.cream.tint, address: 'ink still dry',
    claim: { day: 'today', slot: 0 },
    note: 'The other flour slip is crisp, and the pencil has not moved a hair.',
    at: 'lost_shelf',
  },
  {
    id: 'c_cord', kind: 'context', delivery: 'dov_11',
    parcel: WRAP.blue.word, tint: WRAP.blue.tint, address: 'waxed cord tie',
    claim: { day: 'yesterday', slot: 1 },
    note: "Dov's box, tied with waxed cord. The office ran out of waxed cord on Monday.",
    at: 'counter', exchange: 'q2.clueBlueBox', alias: 'clue_blue_box',
  },
  {
    id: 'c_tape', kind: 'context', delivery: 'dov_12',
    parcel: WRAP.blue.word, tint: WRAP.blue.tint, address: 'new tape',
    claim: { day: 'today', slot: 1 },
    note: 'The second blue box is taped. That roll was opened after the cord ran out.',
    at: 'parcel_stack',
  },
  {
    id: 'c_clean', kind: 'context', delivery: 'wren_11',
    parcel: WRAP.teal.word, tint: WRAP.teal.tint, address: 'string clean',
    claim: { day: 'yesterday', slot: 2 },
    note: "One salve parcel's string is clean. Nothing that touched Wren's door today is.",
    at: 'pigeonholes',
  },
  {
    id: 'c_paint', kind: 'context', delivery: 'wren_12',
    parcel: WRAP.teal.word, tint: WRAP.teal.tint, address: 'green on tie',
    claim: { day: 'today', slot: 2 },
    note: "Green paint on the other salve's string, still tacky. That door was brown until yesterday evening.",
    at: 'scales', exchange: 'q2.cluePaint', alias: 'clue_paint',
  },

  // ── memory: four people, entirely sincere ─────────────────────────────────
  {
    id: 'm_oren_dov', kind: 'memory', delivery: 'dov_11',
    parcel: WRAP.blue.word, tint: WRAP.blue.tint, address: 'Oren recalls',
    claim: { day: 'today', slot: 1 },
    note: "OREN: the corded box went out today. I can see myself handing it over.",
    at: 'oren',
  },
  {
    id: 'm_oren_wren', kind: 'memory', delivery: 'wren_12',
    parcel: WRAP.teal.word, tint: WRAP.teal.tint, address: 'Oren recalls',
    claim: { day: 'yesterday', slot: 2 },
    note: "OREN: the painted one was yesterday's last drop. Or this morning's.",
    at: 'oren',
  },
  {
    id: 'm_wren', kind: 'memory', delivery: 'wren_12',
    parcel: WRAP.teal.word, tint: WRAP.teal.tint, address: 'Wren recalls',
    claim: { day: 'today', slot: 2 },
    note: 'WREN: that one came today. I was in. I would know.',
    at: 'villager_d',
  },
  {
    id: 'm_hesta', kind: 'memory', delivery: 'hesta_12',
    parcel: WRAP.cream.word, tint: WRAP.cream.tint, address: 'Hesta recalls',
    claim: { day: 'yesterday', slot: 0 },
    note: 'HESTA: the second lot of flour came yesterday morning. Fairly sure. Fairly.',
    at: 'villager_b',
  },
];

/**
 * Two things the player reads that are not cards: the weather, and the order of
 * the row. Without them the six evidence cards prove nothing, which is what
 * makes them worth finding.
 */
const READS: Array<{ id: string; at: string; exchange?: string; alias?: string; lines?: string[] }> = [
  {
    id: 'r_rain', at: 'handcart', exchange: 'q2.clueBootprints', alias: 'clue_bootprints',
  },
  {
    id: 'r_roster', at: 'roster', exchange: 'courier_roster', alias: 'clue_roster',
  },
];

const CLUE_FLAG = (id: string) => `q2_clue_${id}`;

// ── board assembly ──────────────────────────────────────────────────────────

function board(): ThreadBoard {
  const found = CLUES.filter((c) => State.has(CLUE_FLAG(c.id)));
  return {
    title: 'MEMORY THREADS',
    rule: State.has(CLUE_FLAG('r_roster'))
      ? 'The river route, in order: Hesta, then Dov, then Wren at the end door.'
      : 'The roster on the wall has the order of the row. Read it.',
    columns: ['morning', 'midday', 'afternoon'],
    rows: [
      { day: 'yesterday', label: 'THE ELEVENTH', sub: State.has(CLUE_FLAG('r_rain')) ? 'it rained' : '?' },
      { day: 'today', label: 'THE TWELFTH', sub: State.has(CLUE_FLAG('r_rain')) ? 'dry since dawn' : '?' },
    ],
    cards: found.map((c) => ({
      id: c.id, kind: c.kind, delivery: c.delivery, parcel: c.parcel,
      tint: c.tint, address: c.address, claim: c.claim, note: c.note,
    })),
    truth: TRUTH,
  };
}

// ── dialogue playback ───────────────────────────────────────────────────────

async function playBeats(c: CutsceneContext, beats: ResolvedBeat[]): Promise<void> {
  for (const b of beats) {
    switch (b.kind) {
      case 'line':
        await c.say(b.speaker, b.text, { emote: b.emote, emphasis: b.emphasis, auto: b.auto });
        break;
      case 'choose': {
        const i = await c.choose(b.prompt ?? '', b.options.map((o) => ({ text: o.text, flag: o.flag })));
        const opt = b.options[i];
        if (opt?.flag) State.set(opt.flag);
        if (opt?.reply) await playBeats(c, opt.reply as ResolvedBeat[]);
        break;
      }
      case 'pause': await c.wait(b.ms); break;
      case 'insight': await c.insight(b.concept); break;
      case 'banner': c.banner(b.title, b.subtitle); break;
      case 'cue': handleCue(c, b.name, b.note); break;
      default: break;
    }
  }
}

function handleCue(c: CutsceneContext, name: string, note?: string): void {
  if (name === 'quest_start' && note) State.startQuest(note);
  else if (name === 'ability_grant' && note) State.grant(note as 'recall');
}

async function playId(c: CutsceneContext, id: string): Promise<void> {
  const ex = TALK.q2[id.replace(/^q2\./, '')] ?? undefined;
  const beats = ex ? play(ex) : (describe(id) ?? []);
  await playBeats(c, beats);
}

// ── the quest ───────────────────────────────────────────────────────────────

let unsubscribe: Array<() => void> = [];
/** Clues discovered but not yet announced, so the toast fires once. */
let orenMemoryIndex = 0;

function discover(w: WorldScene, id: string, alias?: string): boolean {
  if (State.has(CLUE_FLAG(id))) return false;
  State.set(CLUE_FLAG(id));
  if (alias) State.set(alias);
  State.bump('q2_evidence');
  const cards = CLUES.filter((c) => State.has(CLUE_FLAG(c.id))).length;
  if (cards >= 4) State.advanceQuest('q2_oren', 'gather');
  emit('ui:toast', { text: 'Evidence noted' });
  return true;
}

/** Read something that is not a card: the weather, the order of the row. */
async function readEnvironment(w: WorldScene, def: { id: string; exchange?: string; alias?: string }): Promise<void> {
  const first = !State.has(CLUE_FLAG(def.id));
  await w.cutscene.talk(async (c) => {
    if (def.exchange) await playId(c, def.exchange);
  });
  if (first) discover(w, def.id, def.alias);
}

async function openBoard(w: WorldScene): Promise<void> {
  const b = board();
  if (!b.cards.length) {
    await w.cutscene.talk(async (c) => {
      await c.say('player', 'String, pins and nothing to pin. Look around first.');
    });
    return;
  }
  if (!State.has('threads_open')) {
    State.set('threads_open');
    await w.cutscene.talk(async (c) => { await playId(c, 'q2.threadsIntro'); });
  }
  const solved = await openMemoryThreads(b);
  if (!solved) return;
  State.set('threads_solved');
  State.advanceQuest('q2_oren', 'sort');
  await reveal(w);
}

async function reveal(w: WorldScene): Promise<void> {
  await w.cutscene.run(async (c) => {
    await playId(c, 'q2.threadsSolved');
    await playId(c, 'q2.reveal');

    // Sera lets herself in, as she does. NPCs walk in straight lines, so the
    // arrival is raced against a timeout: a scene must never wait on pathing.
    w.spawnNpc({ id: 'sera', actor: 'sera', x: 24, y: 6, facing: 'w' });
    await Promise.race([c.walk('sera', 20, 10), c.wait(3500)]);
    c.face('sera', 'w');
    await playId(c, 'q2.naming');
    await playId(c, 'q2.recall');

    State.grant('recall');
    State.setAll(['q2_done', 'q2_complete', 'insight_interference', 'met_sera']);
    State.meet('sera');
    State.addInsightExample(
      'interference',
      'Oren ran the river route on the eleventh and again on the twelfth. Both days were '
      + 'intact and both arrived together. What pulled them apart was rain on one receipt, '
      + 'a roll of cord that ran out on Monday, and green paint that was still tacky.',
    );
    State.addNote('oren', 'Writes the weather on every ticket now. Even in June.');
    State.advanceQuest('q2_oren', 'deliver');
    State.completeQuest('q2_oren');
    State.save();
  });
}

// ── area script ─────────────────────────────────────────────────────────────

registerArea('courier', {
  onEnter(w) {
    State.meet('oren');
    orenMemoryIndex = 0;

    // Contextual clues are Recall's own evidence: they register themselves as
    // examinables, mark themselves found and fire the shimmer.
    for (const clue of CLUES) {
      if (clue.kind !== 'context' || !clue.at) continue;
      const p = w.prop(clue.at);
      if (!p) continue;
      w.recall.add({
        id: clue.id,
        x: p.sprite.x + (clue.offset?.[0] ?? 0),
        y: p.sprite.y - p.sprite.height / 2 + (clue.offset?.[1] ?? 0),
        context: clue.claim.day,
        text: clue.note,
        found: State.has(CLUE_FLAG(clue.id)),
      });
    }

    for (const r of READS) {
      const p = w.prop(r.at);
      if (!p) continue;
      w.addInteractable({
        id: `read:${r.id}`,
        x: p.sprite.x,
        y: p.sprite.y - p.sprite.height / 2,
        label: 'Read',
        observable: true,
        onInteract: () => { void readEnvironment(w, r); },
      });
    }

    // RecallSystem owns the examine prompt; this turns a read into a card.
    unsubscribe.push(on('clue:read', (p: { id: string; first: boolean }) => {
      const clue = CLUES.find((c) => c.id === p.id);
      if (!clue) return;
      const first = !State.has(CLUE_FLAG(clue.id));
      void w.cutscene.talk(async (c) => {
        if (clue.exchange) await playId(c, clue.exchange);
        else await c.say('narrator', clue.note);
      });
      if (first) discover(w, clue.id, clue.alias);
    }));

    if (State.has('q2_complete')) {
      w.npc('villager_b')?.face('s');
      return;
    }
  },

  onExit() {
    unsubscribe.forEach((f) => f());
    unsubscribe = [];
  },

  onTrigger(w, id) {
    if (id !== 'oren_intro' || State.has('q2_started')) return false;
    // Flags go up front: a player who walks out mid-scene is still on the quest.
    const hadPanic = State.has('oren_panic');
    State.setAll(['q2_started', 'met_oren', 'oren_panic']);
    State.startQuest('q2_oren');
    void w.cutscene.run(async (c) => {
      c.face('oren', 's');
      if (!hadPanic) await playId(c, 'q2.panic');
      await playId(c, 'q2.officeTalk');
      State.advanceQuest('q2_oren', 'talk');
      c.toast('Reconstruct the two days');
    });
    return true;
  },

  onInteract(w, id) {
    if (id === 'route_board') {
      if (!State.has('q2_started')) {
        void w.cutscene.talk(async (c) => { await c.say('narrator', 'String, pins, two rows of cards. One row is longer than it has any right to be.'); });
        return true;
      }
      if (State.has('q2_complete')) {
        void w.cutscene.talk(async (c) => { await c.say('narrator', 'Two rows of pins, both the same length, and every card the right way up.'); });
        return true;
      }
      void openBoard(w);
      return true;
    }

    if (id === 'npc:oren') {
      void w.cutscene.talk(async (c) => {
        if (!State.has('q2_started')) { await playId(c, 'q2.officeTalk'); return; }
        if (State.has('q2_complete')) { await c.say('oren', 'Weather on every ticket. Watch me.'); return; }
        const mem = CLUES.filter((k) => k.at === 'oren');
        const next = mem.find((k) => !State.has(CLUE_FLAG(k.id)));
        if (!next) {
          await c.say('oren', "Don't ask me again. I will only give you a third answer.");
          return;
        }
        await c.say('oren', next.note.replace(/^OREN: /, ''));
        if (orenMemoryIndex === 0) await c.say('oren', 'Write it down. Then go and check it, because I would not.');
        orenMemoryIndex++;
        discover(w, next.id, next.alias);
      });
      return true;
    }

    for (const who of ['villager_b', 'villager_d']) {
      if (id !== `npc:${who}`) continue;
      const clue = CLUES.find((k) => k.at === who);
      if (!clue) continue;
      void w.cutscene.talk(async (c) => {
        if (State.has(CLUE_FLAG(clue.id))) {
          await c.say(who, 'That is what I remember. I cannot make it any truer by saying it twice.');
          return;
        }
        await c.say(who, clue.note.replace(/^[A-Z]+: /, ''));
        discover(w, clue.id, clue.alias);
      });
      return true;
    }

    return false;
  },
});
