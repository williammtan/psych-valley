/**
 * QUEST TWO — THE MIXED-UP DELIVERY.
 *
 * Oren is not confused because he forgot. He is confused because he knows two
 * days perfectly well and they arrive together. Nobody says so in those words
 * until Q2.naming; the player works it out with a rain shower, a shut shop and
 * a wet green door.
 */
import { FLAGS } from './flags';
import { banner, choose, cue, exchange, insight, nar, namespaced, opt, pause, say, you, type ExchangeMap } from './types';

export const Q2: ExchangeMap = namespaced('q2', {
  panic: exchange('q2.panic', [
    cue('oren_run_in', 'Oren jogs into Town Square, already talking'),
    say('oren', 'Did I give you a parcel? Please say no. Say no first, then say why.'),
    choose([
      opt('No.', [
        say('oren', 'Good. Good. One person in this valley I have not ruined.'),
      ]),
      opt('Should you have?', [
        say('oren', "Don't. I have had a morning and it is not lunchtime."),
      ]),
      opt('Breathe.', [
        say('oren', 'I have breathed. It keeps coming back out as more talking.'),
      ]),
    ]),
    say('oren', 'Nine years. Nine years, not one wrong door, and today I have done six.'),
    choose([
      opt('Six?', [
        say('oren', 'Six that I know of. There is a seventh out there somewhere, living a life.'),
      ]),
      opt('That is not so bad.', [
        say('oren', 'Bram received a salve for sheep. Bram has no sheep. Bram has already used it.'),
      ]),
    ]),
    say('oren', "Wren got somebody's boots. Hesta got two sacks of flour on a day she ordered none."),
    say('oren', 'Come to the office. I will show you. I have string.'),
    cue('quest_start', 'q2_oren'),
  ], `sets ${FLAGS.orenPanic}`),

  officeTalk: exchange('q2.officeTalk', [
    say('oren', 'Yesterday I ran the river route. Today I ran the river route.'),
    say('oren', "Same doors. Same names, near enough. Hesta's flour, then Hesta's flour again."),
    say('oren', 'And I know both days. Perfectly. Ask me anything about either one.'),
    choose([
      opt('Then what is the problem?', [
        say('oren', 'Ask me which day had the blue box.'),
      ]),
      opt('What was in the blue box?', [
        say('oren', 'Buttons. Now ask me which day it went out.'),
      ]),
    ]),
    pause(600),
    say('oren', 'I do not know which day had the blue box.', { emphasis: true }),
    say('oren', 'And I can see it going out on both. Both. Clear as this table.'),
    you('Then we stop asking you. We ask the street.'),
    say('oren', 'The street. Yes. The street does not have my head in it.'),
  ]),

  // ── evidence ──────────────────────────────────────────────────────────────
  clueReceipt: exchange('q2.clueReceipt', [
    nar('A receipt spike by the door. Third one down is stamped for the eleventh.'),
    nar("The ink has run at one corner. That slip spent some of its day in the rain."),
  ], `sets ${FLAGS.clueReceipt}`),

  clueBootprints: exchange('q2.clueBootprints', [
    nar('Dried mud tracks the office floor in one direction only, boot-shaped, heading out.'),
    nar("One set. Today's boots are standing clean in the corner, still done up."),
  ], `sets ${FLAGS.clueBootprints}`),

  clueShutters: exchange('q2.clueShutters', [
    say('villager_e', 'Shut all day yesterday. Stocktake. Second Tuesday of the month, every month.'),
    you('So nothing reached you yesterday.'),
    say('villager_e', 'Nothing in, nothing out. Something arrived today, though. Buttons.'),
    say('villager_e', 'I do not sell buttons. I have never sold a button in my life.'),
  ], `sets ${FLAGS.clueShutters}`),

  cluePaint: exchange('q2.cluePaint', [
    nar('The end door on the row is green, and greener in the hinges. Painted very recently.'),
    say('villager_d', 'Brown until yesterday evening. I held the brush while Dov did the corners.'),
    you('So anything left at a green door happened today.'),
    say('villager_d', 'Anything left at a green door happened today and got paint on its string.'),
  ], `sets ${FLAGS.cluePaint}`),

  clueBlueBox: exchange('q2.clueBlueBox', [
    nar('Two blue boxes on the sorting table. One tied with waxed cord, one with new tape.'),
    nar("The office ran out of waxed cord on Monday. There is a note about it in Oren's hand."),
  ], `sets ${FLAGS.clueBlueBox}`),

  clueRoster: exchange('q2.clueRoster', [
    nar('Two days written out in the same careful hand, one under the other.'),
    nar('You have to read them twice to find the difference. Oren read them once.'),
  ], `sets ${FLAGS.clueRoster}`),

  // ── memory threads ────────────────────────────────────────────────────────
  threadsIntro: exchange('q2.threadsIntro', [
    say('oren', 'String and pins. It is not clever. It is what I have.'),
    say('oren', 'Yesterday on the top row. Today underneath. I will not watch over your shoulder.'),
    pause(500),
    nar('He watches over your shoulder.'),
  ], `sets ${FLAGS.threadsOpen}`),

  threadsWrongMemory: exchange('q2.threadsWrongMemory', [
    say('oren', 'I remember it. I remember it on both days. That is exactly the trouble.'),
  ], 'feedback when the player pins a memory-only clue'),

  threadsWrongOrder: exchange('q2.threadsWrongOrder', [
    say('oren', 'No — that one is the other way round. I think. You see what I am dealing with.'),
  ]),

  threadsRightWeather: exchange('q2.threadsRightWeather', [
    say('oren', 'It rained yesterday. It did not rain today. That is not memory, that is weather.', { emphasis: true }),
  ]),

  threadsRightShop: exchange('q2.threadsRightShop', [
    say('oren', 'Tomas was shut. So that one cannot be yesterday. It simply cannot be yesterday.'),
  ]),

  threadsSolved: exchange('q2.threadsSolved', [
    nar('Two rows of pins, and no card left over.'),
    say('oren', 'That is it. That is both days. That is exactly both days.'),
    say('oren', 'I could have told you all of that. I did tell you all of that. Not in that order.'),
  ], `sets ${FLAGS.threadsSolved}`),

  // ── the reveal ────────────────────────────────────────────────────────────
  reveal: exchange('q2.reveal', [
    say('oren', 'I knew both routes.'),
    pause(600),
    say('oren', 'That is what made it worse.', { emphasis: true }),
    say('oren', 'Every time I reached for today, yesterday was already standing in the doorway.'),
    choose([
      opt('It happens to everyone.', [
        say('oren', 'Not to me. That was the whole of my personality and it went before lunch.'),
      ]),
      opt('You knew too much.', [
        say('oren', 'Nine years of knowing. Turns out that is not the same as remembering.'),
      ], { flag: 'tone_quiet' }),
      opt('The weather sorted it.', [
        say('oren', 'Weather, a shut shop, and a wet green door. None of the three were in my head.'),
      ]),
    ]),
    say('oren', 'Please do not tell Elia.'),
    say('oren', 'She will be kind about it. That is worse. She will put a hand on my arm.'),
    say('oren', 'From now on I write the weather on every ticket. Every ticket. Even in June.'),
  ], `sets ${FLAGS.q2Done}`),

  // ── naming moment two ─────────────────────────────────────────────────────
  naming: exchange('q2.naming', [
    say('sera', 'You pulled two days apart. How?'),
    choose([
      opt('It rained on one of them.', [
        say('sera', 'Weather.'),
      ]),
      opt('A shop was shut.', [
        say('sera', 'A shut shop.'),
      ]),
      opt('Someone painted a door.', [
        say('sera', 'Wet paint.'),
      ]),
    ]),
    say('sera', 'Not one of those lives in his head. They were just out there, being the world.'),
    pause(300),
    say('sera', 'He had both days. Whole. Neither one had gone anywhere.'),
    you("They were getting in each other's way."),
    say('sera', 'Yes. The old day shoving in front of the new one, mostly.'),
    say('sera', 'And a bit the other way about — today rubbing at the edges of yesterday.'),
    pause(400),
    say('sera', 'Two good days, one street, both arriving at once.'),
    say('sera', 'There is a word for that collision. Interference.'),
    insight('interference'),
    say('sera', 'Nine years of the same route is what did that to him. Not nine years of sloppiness.'),
  ], 'NAMING MOMENT 2 — recognition, not instruction'),

  recall: exchange('q2.recall', [
    say('sera', 'Useful part. When two patterns lie on top of each other, do not trust the loud one.'),
    say('sera', 'Find the detail that could only belong to one of them. Rain. Paint. A shut door.'),
    banner('RECALL', 'you can pull two overlapping patterns apart using context'),
    cue('ability_grant', 'recall'),
    say('sera', 'The shrine road has two of everything, by the way. I have been meaning to mention it.'),
  ]),

  hint1: exchange('q2.hint1', [
    nar('Mote hovers over the receipt spike, then over the window, where it is raining in memory only.'),
  ]),

  hint2: exchange('q2.hint2', [
    say('sera', 'Stop asking what he remembers. Ask what the street was doing.'),
  ]),
});
