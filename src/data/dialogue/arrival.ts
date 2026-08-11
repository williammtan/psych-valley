/**
 * ACT I — ARRIVAL.
 *
 * Play order:
 *   ARRIVAL.approach  → walk down into the valley
 *   ARRIVAL.firstSteps → optional, if the player dawdles on the road
 *   TALK.mira.firstMeeting (see ambient.ts) → the inn
 *   ARRIVAL.bell      → the bell rings, Pip bolts, quest one begins
 */
import { FLAGS } from './flags';
import { choose, cue, exchange, nar, namespaced, opt, say, you, type ExchangeMap } from './types';

export const ARRIVAL: ExchangeMap = namespaced('arrival', {
  approach: exchange('arrival.approach', [
    nar('Lumen Vale, then. A bell tower, a river, and more chimney smoke than the map promised.'),
    nar('The road stops climbing and the valley just opens, the way a held breath goes out.'),
    cue('camera_pan_town', 'slow pan across the valley, then back to the player'),
    choose([
      opt("Read Sera's letter again.", [
        nar('"Come south. Bring nothing heavy. Something here is behaving oddly and I need a stranger."'),
        you('She could have opened with hello.'),
      ], { flag: 'tone_dry' }),
      opt('Get moving.', [
        nar('Smoke off the inn chimney, down the hill and east. That will do for a plan.'),
      ]),
      opt('Stand here a moment.', [
        nar('Rooks lift off the bell tower, circle once, and settle back exactly where they were.'),
      ], { flag: 'tone_quiet' }),
    ]),
    nar('Someone has strung lanterns along every fence in sight. There is a festival coming.'),
  ]),

  firstSteps: exchange('arrival.firstSteps', [
    nar('The valley is small enough to cross in a few minutes and old enough to take longer.'),
    nar('Bell tower in the middle. Inn to the east, with the light in the window.'),
  ]),

  // Mira's welcome lives in ambient.ts as TALK.mira.firstMeeting, then this.
  bell: exchange('arrival.bell', [
    cue('bell_toll', 'town bell, five slow tolls; duck the music under it'),
    nar('The bell goes. Five tolls, unhurried, the way it has every evening for a century.'),
    cue('pip_bolt', 'Pip streaks from the hearth to under the settle by the storeroom door'),
    nar('Something orange leaves the hearth rug so fast it takes the rug with it.', { emphasis: true }),
    say('mira', 'Pip—'),
    nar('He is under the settle by the storeroom door. Only the tail is still showing.'),
    say('mira', "He's been doing that ever since the storm."),
    choose([
      opt('Is he hurt?', [
        say('mira', "Not a scratch on him. That's the part I don't care for."),
      ]),
      opt("It's only a bell.", [
        say('mira', 'Tell him that. Speak slowly. He has opinions.'),
      ], { flag: 'tone_dry' }),
      opt('...', [
        say('mira', 'Yes. That was roughly my face too, the first week.'),
      ], { flag: 'tone_quiet' }),
    ]),
    say('mira', 'Nine days now. Bell goes, cat goes.'),
    say('mira', 'And he picks the settle every time. That settle is holding my storeroom shut.'),
    say('mira', "I can't shift it with him under there, and I'm out of flour by Thursday."),
    choose([
      opt("I'll get him out.", [
        say('mira', 'Good. He likes new people. He has no history with you.'),
      ]),
      opt('Have you tried food?', [
        say('mira', 'Food, warmth, a lullaby, and once — I am not proud — outright begging.'),
      ]),
    ]),
    say('mira', "Look round the place if you like. It's been a strange few weeks in here."),
    cue('quest_start', 'q1_pip'),
  ]),

  /** If the player leaves the inn without starting the investigation. */
  nudge: exchange('arrival.nudge', [
    say('mira', "He's not going anywhere. He's made that very clear."),
    say('mira', 'Whatever set him off, it started in this building. Start in this building.'),
  ], 'plays when the player re-enters the inn with q1 active and no clues found'),

  /** Bell tower, on the way through town, before quest one is finished. */
  bellTower: exchange('arrival.bellTower', [
    nar('The tower door is bolted from the inside. Rope marks on the sill, worn to a shine.'),
    nar('A slate by the door, chalked over so many times the numbers have gone grey.'),
  ], `set ${FLAGS.clueBellLog} when read`),
});
