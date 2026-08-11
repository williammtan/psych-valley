/**
 * The three psychology concepts, as structured data.
 *
 * This mirrors the plan's content data model (§63) — it is the seed dataset a
 * future generation engine would have to reproduce. Nothing here is shown to
 * the player until they have already lived the phenomenon.
 */

export interface ConceptTerm {
  term: string;
  meaning: string;
  /** How it showed up in the player's actual experience. */
  inGame: string;
}

export interface Concept {
  id: string;
  name: string;
  apUnit: string;
  /** The one sentence shown on the Insight Card. */
  definition: string;
  /** Written in terms of what the player just did, not textbook language. */
  illustration: string[];
  terms: ConceptTerm[];
  misconception: string;
  realWorld: string[];
  /** Where the concept is asked for again, in a new context. */
  transfer: string;
}

export const CONCEPTS: Record<string, Concept> = {
  conditioning: {
    id: 'conditioning',
    name: 'CLASSICAL CONDITIONING',
    apUnit: 'Unit 4 — Learning',
    definition: 'A previously neutral stimulus can acquire the ability to trigger a learned response through association.',
    illustration: [
      'Pip was never afraid of the bell.',
      'During the storm the bell rang, and moments later the inn\'s pipes',
      'crashed. It happened again. And again.',
      'The pipes are fixed now. The bell still means the crash to Pip.',
      'Ringing it safely, over and over, taught him it doesn\'t any more.',
    ],
    terms: [
      { term: 'Unconditioned stimulus (US)', meaning: 'Something that already causes a reaction, with no learning needed.', inGame: 'The pipe crash.' },
      { term: 'Unconditioned response (UR)', meaning: 'The automatic reaction to it.', inGame: 'Pip bolting under the furniture.' },
      { term: 'Conditioned stimulus (CS)', meaning: 'A neutral thing that came to predict the US.', inGame: 'The town bell.' },
      { term: 'Conditioned response (CR)', meaning: 'The learned reaction to the CS alone.', inGame: 'Pip fleeing the bell, long after the pipes were repaired.' },
      { term: 'Extinction', meaning: 'The learned response fades when the CS stops predicting the US.', inGame: 'Ringing the bell with nothing bad following it.' },
    ],
    misconception: 'People often think the bell "became scary". It didn\'t — the bell became information.',
    realWorld: [
      'A dog running to the door at the sound of a leash.',
      'Feeling hungry when you smell a bakery you once ate at.',
      'A phone buzz that makes your chest tighten after bad news.',
    ],
    transfer: 'A shrine creature that learned to follow glowing moths.',
  },

  interference: {
    id: 'interference',
    name: 'MEMORY INTERFERENCE',
    apUnit: 'Unit 5 — Cognition',
    definition: 'Similar memories compete with each other, and the one you want is not always the one that arrives.',
    illustration: [
      'Oren ran two delivery routes on two days.',
      'Same streets. Similar parcels. Nearly the same names.',
      'Knowing both is what made it worse, not better.',
      'What separated them wasn\'t memory — it was context.',
      'The rain. A shop that was shut. A door repainted overnight.',
    ],
    terms: [
      { term: 'Proactive interference', meaning: 'Older learning gets in the way of newer learning.', inGame: 'Yesterday\'s route surfacing when Oren reached for today\'s.' },
      { term: 'Retroactive interference', meaning: 'Newer learning gets in the way of older learning.', inGame: 'Today\'s deliveries overwriting his memory of yesterday\'s.' },
      { term: 'Context-dependent memory', meaning: 'Retrieval improves when cues match the original situation.', inGame: 'The rain, the closed shutters, the wet bootprints.' },
      { term: 'Retrieval cue', meaning: 'A detail that reopens the right memory.', inGame: 'A receipt stamped with a time.' },
    ],
    misconception: 'Forgetting is usually treated as information vanishing. Here nothing vanished — two intact memories got in each other\'s way.',
    realWorld: [
      'Typing an old password after changing it.',
      'Calling a new colleague by the previous one\'s name.',
      'Studying two languages at once and mixing the grammar.',
    ],
    transfer: 'Two rune sequences shown in one shrine chamber, and two doors.',
  },

  conformity: {
    id: 'conformity',
    name: 'CONFORMITY',
    apUnit: 'Unit 9 — Social Psychology',
    definition: 'People adjust their judgement or behaviour to match a group, especially when that group is unanimous.',
    illustration: [
      'You heard the tone. You knew which lantern matched.',
      'Then Tavi answered first, and he was wrong, and he was certain.',
      'One by one, the answers moved.',
      'Then Nia said a different number out loud.',
      'She wasn\'t right either — but after her, the group came apart.',
      'It was never the number. It was the unanimity.',
    ],
    terms: [
      { term: 'Normative social influence', meaning: 'Going along with a group to fit in, while privately disagreeing.', inGame: 'Villagers who told you afterwards they knew the right answer.' },
      { term: 'Informational social influence', meaning: 'Assuming the group knows something you don\'t.', inGame: 'Villagers who genuinely stopped trusting their own ears.' },
      { term: 'Unanimity', meaning: 'A group that agrees completely exerts far more pressure than one that doesn\'t.', inGame: 'Round three, when nobody had broken ranks yet.' },
      { term: 'Dissent', meaning: 'A single visible disagreement dramatically reduces conformity.', inGame: 'Nia.' },
    ],
    misconception: 'It looks like weakness. It is closer to a reasonable bet: usually the group is right.',
    realWorld: [
      'Nobody asking a question in a room where nobody has asked one.',
      'A meeting agreeing to a plan that everyone privately doubts.',
      'Laughing at a joke you didn\'t hear properly.',
    ],
    transfer: 'A ring of shrine statues that all copy whichever one leads.',
  },
};

export const CONCEPT_ORDER = ['conditioning', 'interference', 'conformity'];
