/**
 * ACTS V–VI — SOUTH GATE, WHISPER WOODS, THE ECHO SHRINE, AND THE ENDING.
 *
 * Almost no dialogue by design (plan §36). The woods are a break from being
 * taught anything. In the shrine nobody names a concept out loud, ever — the
 * rooms ask, and the player answers with their hands. The Echo speaks only in
 * lines it has stolen from people the player already loves.
 */
import { FLAGS } from './flags';
import { banner, choose, cue, exchange, nar, namespaced, opt, pause, say, you, type ExchangeMap } from './types';

export const SOUTH: ExchangeMap = namespaced('south', {
  decision: exchange('south.decision', [
    say('sera', 'A cat. A courier. And forty people at a festival.'),
    say('sera', 'None of those three should have anything whatsoever to do with each other.'),
    choose([
      opt('But they do.', [
        say('sera', 'They all got louder in the same fortnight. Over the same hole in the ground.'),
      ]),
      opt('Coincidence?', [
        say('sera', 'I would love that. I have been trying to make it be that since Tuesday.'),
      ]),
      opt('You have a map, do you.', [
        say('sera', 'I have four maps and one of them is drawn on the back of another one.'),
      ], { flag: 'tone_dry' }),
    ]),
    say('sera', 'The old observatory sits under the south road. I would like to go and look at it.'),
    say('sera', 'Tonight, ideally, while I am still frightened enough to be quick about it.'),
    say('mira', 'Take a lantern.'),
    say('mira', 'And bring my lantern back. I have lost two lanterns and one geologist this year.'),
    cue('quest_start', 'q4_shrine'),
  ], `sets ${FLAGS.southGateOpen}`),

  gate: exchange('south.gate', [
    nar('The south gate has been shut so long the hinges have opinions about it.'),
    say('nia', 'It is quieter down there than people say.'),
    say('nia', 'That is the part I would mind.'),
  ]),
});

export const WOODS: ExchangeMap = namespaced('woods', {
  enter: exchange('woods.enter', [
    nar('The trees close over the road and the festival noise stops as though a door shut.'),
    nar('Sound carries strangely here. Your own footsteps arrive a half-step behind you.'),
  ], `sets ${FLAGS.enteredWoods}`),

  deeper: exchange('woods.deeper', [
    nar('Something with far too many legs for its size leaves the path ahead of you.'),
  ]),

  bridge: exchange('woods.bridge', [
    nar('The second bridge. Past this, the sign said, nothing is maintained.'),
  ]),

  hollow: exchange('woods.hollow', [
    nar('A hollow oak with a floor of feathers. Something roosts here that does not fly.'),
  ]),

  toadstools: exchange('woods.toadstools', [
    nar('A ring of toadstools, too tidy to be an accident. Mote will not go into it.'),
  ]),

  chest: exchange('woods.chest', [
    nar('A chest wedged under the roots. Bone dry inside, after this many winters. Showing off.'),
  ], `sets ${FLAGS.woodsChest}`),

  moteQuiet: exchange('woods.moteQuiet', [
    nar('Mote has gone the colour of the light under the trees and stopped humming.'),
  ]),
});

export const SHRINE: ExchangeMap = namespaced('shrine', {
  arrive: exchange('shrine.arrive', [
    nar('An arch half swallowed by the hill. Somebody cut these steps meaning them to last.'),
    say('sera', 'Observatory. That is what they called it, back when anyone called it anything.'),
    say('sera', 'They came down here to measure the valley.'),
    pause(400),
    say('sera', 'I would very much like to know what measured back.'),
    choose([
      opt('After you.', [
        say('sera', 'Absolutely not. I am the one who writes things down. You are the one with the sword.'),
      ]),
      opt('Together, then.', [
        say('sera', 'Together as far as the first door. Then I hold the lantern and shout usefully.'),
      ]),
    ]),
  ], `sets ${FLAGS.enteredShrine}`),

  entry: exchange('shrine.entry', [
    nar('The air down here is cold and moving, which means it is breathing somewhere else.'),
  ]),

  roomAssociation: exchange('shrine.roomAssociation', [
    nar('Something heavy shifts in the dark ahead, and stops. Then a moth goes past your ear.'),
  ]),

  roomCombat: exchange('shrine.roomCombat', [
    nar('Three of them, and no puzzle. Just the honest sort of problem.'),
  ]),

  roomMemory: exchange('shrine.roomMemory', [
    nar('Runes light along the left wall. A moment later, more on the right. They rhyme.'),
  ]),

  roomConformity: exchange('shrine.roomConformity', [
    nar('A ring of statues, all facing one way. One of them faces very slightly less.'),
  ]),

  roomCombination: exchange('shrine.roomCombination', [
    nar('A leader, a sound, and two doors. You have met all three of these before tonight.'),
  ]),

  moteHintAssociation: exchange('shrine.moteHintAssociation', [
    nar('Mote circles the moth jar, then the pressure plate, then the moth jar again.'),
  ]),

  moteHintMemory: exchange('shrine.moteHintMemory', [
    nar('Mote hovers by the wet patch under the left door and refuses to be interesting elsewhere.'),
  ]),

  moteHintConformity: exchange('shrine.moteHintConformity', [
    nar('Mote settles on the shoulder of the statue at the back, the one nobody is watching.'),
  ]),
});

export const BOSS: ExchangeMap = namespaced('boss', {
  intro: exchange('boss.intro', [
    nar('The chamber is not empty. It has been waiting the way a room waits.'),
    cue('boss_wake'),
    nar('It tries on a shape. Yours. Then Mira. Then something with too many shoulders.'),
    // Every Echo line is stolen verbatim from someone the player has met.
    say('echo', "He's been doing that ever since the storm.", { dup: true }),
    say('echo', 'I knew both routes.', { dup: true }),
    say('echo', 'Second one. Easy.', { dup: true }),
    pause(500),
    nar('It is not talking to you. It is practising.', { emphasis: true }),
  ]),

  phase1: exchange('boss.phase1', [
    nar('It has watched you swing three times. It is already moving to where you were going.'),
    say('echo', 'Tell me what you noticed.', { dup: true }),
  ]),

  phase2: exchange('boss.phase2', [
    nar('Two sets of marks on the floor. One of them is from a minute ago and still glowing.'),
    say('echo', 'Every time I reached for today, yesterday was already standing in the doorway.', { dup: true }),
  ]),

  phase3: exchange('boss.phase3', [
    nar('The small ones copy it exactly, a half-beat late, all of them, every single time.'),
    say('echo', 'Second.', { dup: true }),
    say('echo', 'Second, same as Tavi.', { dup: true }),
  ]),

  taunt: exchange('boss.taunt', [
    say('echo', 'Do not thank me yet. You have not met the stairs.', { dup: true }),
    say('echo', 'Nine years. Not one wrong door.', { dup: true }),
    say('echo', 'It is the size of a plum. So is a wasp.', { dup: true }),
  ], 'optional interstitial barks; it only ever repeats what it has heard'),

  defeat: exchange('boss.defeat', [
    cue('boss_collapse'),
    nar('The shape comes apart and does not fall. It goes down through the floor, unhurried.'),
    pause(700),
    say('echo', 'I know what I heard.', { dup: true }),
    pause(600),
    nar('Then nothing. The chamber is a room again, and cold, and quite ordinary.'),
  ], `sets ${FLAGS.bossBeaten}`),
});

export const ENDING: ExchangeMap = namespaced('ending', {
  scene: exchange('ending.scene', [
    cue('sera_arrive', 'Sera comes down the last stair at a run, lantern first'),
    say('sera', 'It went down. Not out. Down.'),
    choose([
      opt('It copied everyone.', [
        say('sera', 'Badly, at the start. Not badly by the end.'),
      ]),
      opt('It was practising.', [
        say('sera', 'Yes. That is the sentence I was hoping not to hear this evening.'),
      ]),
      opt('It got away.', [
        say('sera', 'It got further in. There is a difference, and I do not care for it.'),
      ]),
    ]),
    pause(400),
    say('sera', 'Whatever is under this valley is not inventing any of it.'),
    say('sera', 'The cat. The two routes. Forty people and a lantern.'),
    say('sera', 'All of that was already ours. It was always going to be ours.'),
    pause(500),
    say('sera', 'It only turns things up until we can finally see them.', { emphasis: true }),
    cue('camera_rise', 'pull up and out of the shrine mouth, over the valley'),
    nar('Outside, the valley keeps going, much further than the map has any business showing.'),
    nar('Two ridges over, a light comes on beneath the ground. Then another, further out.'),
    pause(600),
    say('sera', '...Right.'),
    you('Right.'),
    nar('Mote drifts out past you both and hangs there, facing the far lights, very still.'),
    cue('fade_out'),
    banner('PROJECT PSYCHE', 'End of Prototype'),
  ], 'ENDING — plan §48'),

  /** If the player wanders back into town before the credits. */
  homeward: exchange('ending.homeward', [
    nar('The south road, going up. Behind you, the hill has gone back to being a hill.'),
  ]),
});
