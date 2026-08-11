/**
 * QUEST ONE — THE BELL AND THE CAT.
 *
 * The player never hears the words "classical conditioning" until Q1.naming,
 * and Sera never says a sentence there that the player has not already lived.
 * Everything before it is a storm, some pipes, and a cat with a memory.
 */
import { FLAGS } from './flags';
import { choose, cue, exchange, insight, banner, nar, namespaced, opt, pause, say, you, type ExchangeMap } from './types';

export const Q1: ExchangeMap = namespaced('q1', {
  // ── investigation ─────────────────────────────────────────────────────────
  cluePipes: exchange('q1.cluePipes', [
    nar('The kitchen pipes are new. Bright solder, fresh brackets, not a speck of dust.'),
    nar('Everything else in this kitchen is fifty years old and proud of it.'),
  ], `sets ${FLAGS.cluePipes}`),

  cluePipesAsk: exchange('q1.cluePipesAsk', [
    say('mira', 'Burst on the first night of the storm. Right over the cellar stair.'),
    say('mira', 'Made a bang like a dropped anvil. Four nights of it before Bram’s lad soldered it.'),
    choose([
      opt('Four nights?', [
        say('mira', 'Four. I counted, because I was awake for all of them.'),
      ]),
      opt('Where was Pip?', [
        say('mira', 'In here. Where he always is. Right under that pipe, as it turns out.'),
      ]),
    ]),
    you('And the bell? During the storm?'),
    say('mira', 'Rang all night, every night. They do that so the road crews can find the town.'),
    say('mira', 'Bell, then the pipe. Bell, then the pipe. You could set a clock by the pair of them.', { emphasis: true }),
  ]),

  clueBellLog: exchange('q1.clueBellLog', [
    nar('A slate hangs by the tower door, chalked over so often the numbers have gone grey.'),
    nar('STORM WATCH — bell rung on the hour, all night, until the pass was clear. Four nights.'),
  ], `sets ${FLAGS.clueBellLog}`),

  clueScratches: exchange('q1.clueScratches', [
    nar('Four sets of claw marks in the boards. All four point at the same dark gap.'),
  ], `sets ${FLAGS.clueScratches}`),

  clueCatBed: exchange('q1.clueCatBed', [
    nar('A basket under the window with a dent in the cushion exactly the shape of a cat.'),
    nar('The dent is old. Nothing has slept in it for over a week.'),
  ], `sets ${FLAGS.clueCatBed}`),

  clueHandBell: exchange('q1.clueHandBell', [
    nar('A small brass hand bell on the shelf behind the bar, green at the seams.'),
    say('mira', "Supper bell. Hasn't called anyone to a table since my mother. Take it."),
    choose([
      opt('Will this help?', [
        say('mira', 'No idea. You are the one he has no opinions about. Use that.'),
      ]),
      opt('This seems cruel.', [
        say('mira', "It's a bell. Nobody has ever been hurt by a bell, which is rather my point."),
      ]),
    ]),
  ], `sets ${FLAGS.haveHandBell}`),

  seraArrives: exchange('q1.seraArrives', [
    cue('sera_enter', 'Sera comes in the inn door mid-sentence, notebook already open'),
    say('sera', 'Mira, your cat is under a bench and I want to know everything about it.'),
    say('mira', 'You have been in the valley eleven minutes.'),
    say('sera', 'Twelve. There was a queue.'),
  ], 'plays once two clues are found; hand off to TALK.sera.firstMeeting'),

  // ── the experiments ───────────────────────────────────────────────────────
  bellFirst: exchange('q1.bellFirst', [
    nar('You ring it. One clear note, about the size of the room.'),
    cue('pip_flee_deeper'),
    nar('Pip goes from still to gone. The dark under the settle takes him whole.'),
    say('sera', 'Right. So that is a no.'),
    choose([
      opt('That went badly.', [
        say('sera', 'It went honestly. Do it again, but make the room boring first.'),
      ]),
      opt('What do I do?', [
        say('sera', 'Ring it. Then let nothing happen. Nothing is the hard part.'),
      ]),
      opt('Poor thing.', [
        say('sera', 'He is not being silly. He is being extremely reasonable about last week.'),
      ]),
    ]),
  ], `sets ${FLAGS.bellStartled}`),

  bellSpoiledKettle: exchange('q1.bellSpoiledKettle', [
    nar('You ring the bell. The kettle chooses that exact moment to go off like a struck anvil.'),
    cue('crash'),
    say('mira', 'That was me. That was entirely me.'),
    nar('Pip is further back under the settle than when you started.'),
    say('sera', "Don't apologise. Just be dull. Dull is the whole treatment."),
  ], `fail case — sets ${FLAGS.bellSpoiled}, resets the calm counter`),

  bellSpoiledDoor: exchange('q1.bellSpoiledDoor', [
    nar('You ring. Behind you the door bangs wide and a barrel comes down the step on its rim.'),
    say('villager_e', 'Delivery! Sorry. Barrels.'),
    nar("Two coins of light at the back of the dark. They don't blink."),
    say('sera', 'Again. And this time bolt the door, for all our sakes.'),
  ], `second fail variant — sets ${FLAGS.bellSpoiled}`),

  bellCalm2: exchange('q1.bellCalm2', [
    nar('You ring the bell. Then nothing happens, deliberately, for a long while.'),
    nar('Two ears come up out of the dark and stay up.'),
  ]),

  bellCalm3: exchange('q1.bellCalm3', [
    nar('Ring. Wait. The fire ticks. Upstairs a shutter taps and nobody in the room minds.'),
    nar('His tail has stopped moving. He is watching the bell now, not the doorway.'),
    say('sera', 'There. That is the bit worth writing down.'),
  ]),

  bellCalm4: exchange('q1.bellCalm4', [
    nar('You ring it once more. He does not flinch. He blinks slowly, which in a cat is nearly rude.'),
  ]),

  pipOut: exchange('q1.pipOut', [
    cue('pip_emerge'),
    nar('Pip walks out, crosses the floor, and headbutts the bell in your hand.'),
    cue('pip_purr'),
    say('mira', 'Oh, now you are friendly.'),
    say('mira', 'Nine days I have been apologising to that animal on behalf of a bell.'),
    choose([
      opt('He worked it out.', [
        say('mira', 'He worked something out. I would not push him on which.'),
      ]),
      opt('Your storeroom, madam.', [
        say('mira', 'Flour, jam, and my mother’s good preserves. You are having supper here tonight.'),
      ]),
    ]),
    cue('settle_moved', 'Mira shifts the settle; the storeroom door swings open'),
  ], `sets ${FLAGS.pipCalm}`),

  // ── naming moment one ─────────────────────────────────────────────────────
  naming: exchange('q1.naming', [
    say('sera', 'He is out. Sitting on the bar like he owns the deeds.'),
    choose([
      opt('He came out on his own.', [
        say('sera', 'That is the part I like.'),
      ], { flag: 'tone_quiet' }),
      opt('It took four tries.', [
        say('sera', 'Four. I wrote all four down.'),
      ]),
      opt('I did nothing, really.', [
        say('sera', 'You did nothing four times, carefully. That is not the same as nothing.'),
      ], { flag: 'tone_dry' }),
    ]),
    say('sera', 'Tell me what you noticed.'),
    you('The pipes burst on the same nights the bell was ringing.'),
    say('sera', 'Every night. Bell first. Crash after. Four nights of it.'),
    pause(300),
    say('sera', 'The bell never touched him.'),
    you('He was terrified of it.'),
    say('sera', 'Exactly.', { emphasis: true }),
    say('sera', 'So somewhere in those four nights, he learned what the bell meant.'),
    pause(500),
    say('sera', 'And tonight you spent an hour teaching him it does not mean it any more.'),
    say('sera', 'There is a name for the first half of that.'),
    insight('conditioning'),
    say('sera', 'Pip. Bell. Crash. That is the whole of it, and you will not forget it now.'),
  ], 'NAMING MOMENT 1 — recognition, not instruction'),

  // ── ability ───────────────────────────────────────────────────────────────
  link: exchange('q1.link', [
    say('sera', 'Here is the useful part. Anything that can learn a signal can be led by one.'),
    say('sera', 'Cats. Sheep. Whatever it is that has been moving about under the south road.'),
    banner('LINK', 'you can see what a creature has learned to expect'),
    cue('ability_grant', 'link'),
    say('mira', 'If that works on sheep, go and see Wren before she walks in circles herself.'),
  ]),

  moteFound: exchange('q1.moteFound', [
    nar('On the step outside, a fleck of light the size of a moth turns slowly in the air.'),
    nar('It drifts closer and considers you the way a cat considers a chair.'),
    say('sera', 'Oh. Hello.'),
    say('sera', 'I have been looking for one of those for two years and you found one by leaving a room.'),
    choose([
      opt('Is it dangerous?', [
        say('sera', 'It is the size of a plum. So is a wasp.'),
      ]),
      opt('Can I keep it?', [
        say('sera', 'I do not think it is asking.'),
      ]),
      opt('What is it?', [
        say('sera', 'Ask me in a week. Write down what it does until then.'),
      ]),
    ]),
    nar('It settles behind your shoulder, at about the height of a thought you nearly had.'),
    cue('mote_join'),
  ], `sets ${FLAGS.metMote}`),

  // ── hints (visual first, per plan §66) ────────────────────────────────────
  hint1: exchange('q1.hint1', [
    nar('Mote drifts to the bell in your hand, then to the gap under the settle, then back.'),
  ]),

  hint2: exchange('q1.hint2', [
    nar('Mote flattens itself against the kettle and dims until the room has gone quiet.'),
  ]),

  hint3: exchange('q1.hint3', [
    say('sera', 'Ring it. Then be the most boring person in this valley for a full minute.'),
  ]),
});
