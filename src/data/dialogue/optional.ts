/**
 * OPTIONAL CONTENT (plan §49).
 *
 * Pip sightings, the shelf in Sera's workshop, and the festival barker. None of
 * it is required, none of it teaches anything, and the shelf entries are asides
 * rather than notes — the formal vocabulary lives in the journal and nowhere
 * else in this folder.
 */
import { FLAGS } from './flags';
import { exchange, group, look, nar, namespaced, say, variants, type Exchange, type ExchangeMap } from './types';

// ── Pip, found in eight places ──────────────────────────────────────────────
export const PIP_SIGHTINGS: ExchangeMap = namespaced('pip', {
  noticeBoard: exchange('pip.noticeBoard', [
    nar('Pip has arranged himself across the notice board, covering the word FESTIVAL.'),
  ]),
  storeWindow: exchange('pip.storeWindow', [
    nar("Pip is in Tomas's window between the rope and the lamp oil, like a paid advertisement."),
  ]),
  bakeryStep: exchange('pip.bakeryStep', [
    nar('Pip is on the bakery step with crumbs on his chin and no intention of explaining.'),
  ]),
  wellCap: exchange('pip.wellCap', [
    nar('Pip has found the one patch of sun on the well cap and filled all of it.'),
  ]),
  barrow: exchange('pip.barrow', [
    nar('Pip is asleep in a barrow of festival lanterns. Nobody is going to move that barrow.'),
  ]),
  towerSteps: exchange('pip.towerSteps', [
    nar('Pip is sitting on the bell tower steps, which is new, and is looking up, which is newer.'),
  ]),
  jetty: exchange('pip.jetty', [
    nar('Pip is fishing off the jetty with the concentration of a cat who has never caught a fish.'),
  ]),
  notebook: exchange('pip.notebook', [
    nar("Pip is lying on Sera's open notebook. Sera is waiting him out. Sera is losing."),
  ]),

  /** Play whenever the town bell rings and Pip is on screen. */
  bellReaction: exchange('pip.bellReaction', [
    variants(
      group({ requires: FLAGS.pipCalm }, [
        nar('The bell goes. One ear turns. That is the entire reaction now.'),
      ]),
      group({ requires: FLAGS.bellRang }, [
        nar('The bell goes and he is gone before the second toll.'),
      ]),
    ),
  ]),

  /** Mira, if you tell her where he is. */
  reportToMira: exchange('pip.reportToMira', [
    say('mira', 'On the well cap? In front of everyone? He used to be frightened of the well.'),
    say('mira', 'Do not bring him back. He knows the way. He has always known the way.'),
  ]),
});

// ── Sera's shelf: short asides, unlocked as the player earns them ───────────
export const SHELF: ExchangeMap = namespaced('shelf', {
  intro: look('shelf.intro',
    'A shelf of loose notes in five hands, held down with a rock labelled ROCK.'),

  general: look('shelf.general',
    'A folded sheet: THINGS I HAVE BEEN WRONG ABOUT. Three pages. Still being added to.'),

  conditioning1: exchange('shelf.conditioning1', [
    nar("A margin note, Sera's hand:"),
    nar('Halla left a rat with a lamp and a bell. The lamp was the kindest thing in that room.'),
  ], `requires ${FLAGS.q1Done}`),

  conditioning2: exchange('shelf.conditioning2', [
    nar('You do not scrub it out. You write over it.'),
    nar('Then one wet morning, without asking, the old thing turns up again anyway.'),
  ], `requires ${FLAGS.q1Done}`),

  conditioning3: exchange('shelf.conditioning3', [
    nar('Everyone in this valley stands up when the noon bell rings.'),
    nar('None of them has been hungry at noon for twenty years. They stand up regardless.'),
  ], `requires ${FLAGS.q1Done}`),

  interference1: exchange('shelf.interference1', [
    nar('I know two ways down to the shrine. I stop at the fork every time.'),
    nar('I stopped at that fork for a year before I understood why I was stopping.'),
  ], `requires ${FLAGS.q2Done}`),

  interference2: exchange('shelf.interference2', [
    nar('Nine years of doing a thing correctly is nine years of a thing that can get in the way.'),
  ], `requires ${FLAGS.q2Done}`),

  interference3: exchange('shelf.interference3', [
    nar('The best tool I own for finding an old day is not in my head at all.'),
    nar('It is what the weather was doing, and whether the shutters were up.'),
  ], `requires ${FLAGS.q2Done}`),

  conformity1: exchange('shelf.conformity1', [
    nar('In a room of nine, one other voice is enough. Not a friend. Not an expert.'),
    nar('Just one, out loud, first.'),
  ], `requires ${FLAGS.q3Done}`),

  conformity2: exchange('shelf.conformity2', [
    nar('The question is not why six of them said second.'),
    nar('It is what it costs the one who does not, and who is willing to pay it.'),
  ], `requires ${FLAGS.q3Done}`),

  conformity3: exchange('shelf.conformity3', [
    nar('Nia was wrong and it worked anyway.'),
    nar('I have written that sentence out four times this evening and I still like it.'),
  ], `requires ${FLAGS.q3Done}`),

  echo: exchange('shelf.echo', [
    nar('A newer page, pinned crooked: it does not invent. Halla wrote that. Halla was right.'),
    nar('Underlined twice: WE ARE THE MATERIAL.'),
  ], `requires ${FLAGS.shrineDone}`),
});

// ── the striking game on the plaza ──────────────────────────────────────────
export const BARKER: ExchangeMap = namespaced('barker', {
  open: exchange('barker.open', [
    say('elia', 'Strike the lantern on the beat! Three strikes a copper! Two if you smile at me!'),
    say('elia', 'I assigned myself this stall. It seemed fairer. I regret it enormously.'),
  ]),
  again: exchange('barker.again', [
    say('elia', 'Ring it true and win a ribbon. Ring it flat and win my sincere sympathy.'),
  ]),
  crowdPull: exchange('barker.crowdPull', [
    say('elia', 'Roll up, three strikes a copper — Bram, you have had eleven, go and eat something.'),
  ]),
  taviBrag: exchange('barker.taviBrag', [
    say('tavi', 'I hold the record here. Nine in a row. Nobody has ever asked to see proof.'),
  ]),
  perfect: exchange('barker.perfect', [
    say('elia', 'On every beat! Ribbon. Take a ribbon. Take two, nobody else is winning tonight.'),
  ]),
  good: exchange('barker.good', [
    say('elia', 'Very respectable. Isolde would have notes, but Isolde has notes about everything.'),
  ]),
  miss: exchange('barker.miss', [
    say('elia', 'Ah. Well. The lantern is fine, which is the main thing legally.'),
  ]),
  soldOut: exchange('barker.soldOut', [
    say('elia', 'Out of ribbons. Out of coppers. I am going to go and stand somewhere quiet.'),
  ]),
  tomas: exchange('barker.tomas', [
    say('villager_e', 'Lamp oil. Wicks. String. I am not going to shout about it, but there it is.'),
  ]),
  isolde: exchange('barker.isolde', [
    say('villager_f', 'That stall is a semitone flat. I have mentioned it. I shall mention it again.'),
  ]),
});
