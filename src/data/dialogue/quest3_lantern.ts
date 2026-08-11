/**
 * QUEST THREE — THE LANTERN TRIAL.
 *
 * The reference tone matches the THIRD lantern in rounds two, three and four.
 * Tavi says second, every time, cheerfully, and is never once a villain. Nia
 * breaks the unanimity in round four by saying FIRST — which is also wrong, and
 * works anyway. That is the whole point, and nobody explains it on stage.
 */
import { FLAGS } from './flags';
import { banner, choose, cue, exchange, group, insight, nar, namespaced, opt, pause, say, variants, you, type ExchangeMap } from './types';

export const Q3: ExchangeMap = namespaced('q3', {
  festivalOpen: exchange('q3.festivalOpen', [
    cue('festival_lights', 'string lights come up across the plaza; music starts'),
    say('elia', 'Lumen Vale! Welcome to the Festival of Lanterns, which is running—'),
    nar('She consults the clipboard.'),
    say('elia', '—forty minutes late. Which, for us, is early.'),
    say('elia', 'The musicians have agreed to play. Not on what. But on playing.'),
    say('elia', 'Food at the north stalls. Do not eat the lanterns. Someone did. We do not discuss it.'),
    say('elia', 'And at eight, the Lantern Trial. Newcomers welcome. Newcomers usually lose.'),
    choose([
      opt('What is the Trial?', [
        say('elia', 'I strike one lantern, then three. You tell me which of the three matched.'),
      ]),
      opt('I will be there.', [
        say('elia', 'Everyone says that. Then they find the pie stall and I never see them again.'),
      ]),
    ]),
    say('elia', 'Tavi has won six years running, which I am assured is not grounds to cancel it.'),
  ], `sets ${FLAGS.festivalOpen}`),

  trialRules: exchange('q3.trialRules', [
    say('elia', 'Three lanterns. I strike the reference. Then all three, in order. Then you answer.'),
    say('elia', 'One strike each. And no humming. No humming. I have had to write that down.'),
    say('tavi', 'Do not overthink it. A tone is a feeling, not a sum.'),
    say('tavi', 'You will be fine. First festival is the fun one. Nothing to defend yet.'),
    say('elia', 'Round one. Everyone on their own slate, no looking. Bram.'),
    say('villager_a', 'I was not looking.'),
  ], `sets ${FLAGS.trialJoined}`),

  // ── round one — private ───────────────────────────────────────────────────
  round1: exchange('q3.round1', [
    cue('tone_reference'),
    nar('The reference lantern rings. Then the three, in order, each one its own animal.'),
    cue('trial_answer', 'ROUND 1 — private slate, no crowd answers shown'),
  ]),

  round1Result: exchange('q3.round1Result', [
    say('elia', 'Slates up. Yes — almost all of you. Well done, almost all of you.'),
    say('villager_c', 'Which did you have? No. Do not tell me. I am confident.'),
    variants(
      group({ forbids: 'trial_r1_wrong' }, [
        say('tavi', 'See? Nothing to it. Everyone hears the easy one.'),
      ]),
      group({ requires: 'trial_r1_wrong' }, [
        say('tavi', 'Ears warm up, that is all. The next one is the real one.'),
      ]),
    ),
  ], `sets ${FLAGS.trialR1}`),

  // ── round two — Tavi first, in public ─────────────────────────────────────
  round2: exchange('q3.round2', [
    say('elia', 'Round two. Out loud, so the judges can hear. Tavi, you are first.'),
    cue('tone_reference'),
    pause(400),
    say('tavi', 'Second one. Easy.'),
    nar('He says it the way other people say their own name.'),
    say('villager_a', 'Second.'),
    say('villager_b', '...Second.'),
    say('villager_c', 'Second, I suppose.'),
    say('villager_d', 'If Tavi has second, second.'),
    say('villager_f', 'Second.'),
    nar('Nia says nothing at all. Nia is looking at the third lantern.'),
    cue('trial_answer', 'ROUND 2 — public, player answers after the crowd'),
    say('elia', 'Noted. Noted. Noted. No reveals until the end, that is the tradition.'),
  ], `sets ${FLAGS.trialR2}`),

  // ── round three — the player, last, in front of everyone ──────────────────
  round3: exchange('q3.round3', [
    say('elia', 'Round three. Same again, except our newcomer answers last. Standard procedure.'),
    say('elia', 'It is not standard procedure. I invented it just now. It is a good bit.'),
    cue('tone_reference'),
    say('tavi', 'Second.'),
    say('villager_a', 'Second.'),
    say('villager_b', 'Second.'),
    say('villager_e', 'Second.'),
    say('villager_d', 'Second.'),
    nar('Six voices, one answer. Every face in the plaza turns the same way, towards you.'),
    pause(500),
    say('elia', 'And our newcomer. No rush. None at all. Everyone is waiting, but no rush.'),
    cue('trial_answer', 'ROUND 3 — the pressure round. Set player_conformed if they match the group'),
  ], `sets ${FLAGS.trialR3}`),

  round3After: exchange('q3.round3After', [
    variants(
      group({ requires: FLAGS.playerConformed }, [
        nar('You say second. The plaza makes the small warm noise a crowd makes when it agrees.'),
        say('tavi', 'There you are. Ear like a bell.'),
        nar('Nia does not look up.'),
        nar('Something under your ribs disagrees, quietly, and keeps it to itself.'),
      ]),
      group({}, [
        nar('You say third. Six people do the same small polite thing with their faces.'),
        say('tavi', 'Bold. I like bold. Wrong, but I like it.'),
        nar('Nobody moves off second. The plaza goes on being certain, without you in it.'),
        nar('Nia looks up for exactly as long as it takes to look at someone.'),
      ]),
    ),
  ], 'both outcomes are fine; the game never punishes conforming'),

  // ── round four — Nia ──────────────────────────────────────────────────────
  round4: exchange('q3.round4', [
    say('elia', 'Round four, and the last. Nia, you have not answered all evening. Nia?'),
    pause(700),
    say('nia', 'First.'),
    nar('The plaza stops.', { emphasis: true }),
    say('elia', 'First? Nia, love. It is not first.'),
    say('nia', 'I know what I heard.'),
    pause(600),
    say('villager_b', 'Actually — I had third. I have had third all evening.'),
    say('villager_f', 'Third. It is third. I have been sitting on third for twenty minutes.'),
    say('villager_c', 'Third! I said third to myself. Out loud. Inside my own head.'),
    say('villager_a', 'Well, now I do not know what I heard.'),
    say('tavi', 'Hold on—'),
    say('elia', 'Strike them again. All three. Everybody quiet.'),
    cue('tone_all'),
    nar('Three tones, in order, in a plaza where for once nobody is talking.'),
    pause(500),
    say('elia', 'It is third.'),
    pause(600),
    say('tavi', 'Huh.'),
  ], `sets ${FLAGS.niaDissented} and ${FLAGS.trialR4}`),

  taviAfter: exchange('q3.taviAfter', [
    say('tavi', 'It was second in my head. It was second the entire time. It was extremely second.'),
    choose([
      opt('You were certain.', [
        say('tavi', 'I am always certain. It has never cost anybody anything before.'),
      ]),
      opt('Everyone agreed with you.', [
        say('tavi', 'Yes. That is the part I will be lying awake about.'),
      ], { flag: 'tone_quiet' }),
      opt('It happens.', [
        say('tavi', 'Six years I have won this. Now I am wondering what people were being polite about.'),
      ]),
    ]),
    say('tavi', 'Right. Next year I answer last. Let us see how much I enjoy that.'),
  ]),

  // ── afterwards: what people actually heard ────────────────────────────────
  afterHesta: exchange('q3.afterHesta', [
    say('villager_b', 'I heard third. I said second.'),
    say('villager_b', 'I would like that one back, please. Only that one.'),
  ]),

  afterBram: exchange('q3.afterBram', [
    say('villager_a', 'Six people cannot all be wrong. That is not stupidity, that is arithmetic.'),
    pause(400),
    say('villager_a', 'Six people were all wrong.'),
  ]),

  afterDov: exchange('q3.afterDov', [
    say('villager_c', 'After the third voice I stopped hearing the lantern altogether.'),
    say('villager_c', 'I was listening to the room by then. The room is louder.'),
  ]),

  afterWren: exchange('q3.afterWren', [
    say('villager_d', 'I thought my ears had finally gone. I am up at four every day with sheep.'),
    say('villager_d', 'Turns out my ears are the last working part of me.'),
  ]),

  afterTomas: exchange('q3.afterTomas', [
    say('villager_e', 'I said what Tavi said. I sell that man rope. Draw your own conclusions.'),
  ]),

  afterIsolde: exchange('q3.afterIsolde', [
    say('villager_f', 'I tune instruments. For money. It is the only thing I do.'),
    say('villager_f', 'And I said second, out loud, in front of the Mayor.'),
  ]),

  afterNia: exchange('q3.afterNia', [
    say('nia', 'I heard first. I still hear first.'),
    you('You were wrong as well.'),
    say('nia', 'Yes.'),
    pause(500),
    say('nia', 'I was not right. I was just not quiet.', { emphasis: true }),
  ]),

  afterElia: exchange('q3.afterElia', [
    say('elia', 'Nobody has ever argued at the Trial. Not once, in ninety years of Trials.'),
    say('elia', 'I have had to invent a procedure. This evening. With a clipboard.'),
  ], `sets ${FLAGS.villagersHonest} once enough villagers are heard`),

  // ── naming moment three ───────────────────────────────────────────────────
  naming: exchange('q3.naming', [
    say('sera', 'Round one. Your own slate, nobody watching. What did you hear?'),
    you('Third.'),
    say('sera', 'And in round three, with the whole plaza looking at you?'),
    variants(
      group({ requires: FLAGS.playerConformed }, [
        you('I said second.'),
        say('sera', 'Mm.'),
        say('sera', 'So did the baker. So did a woman who tunes instruments for a living.'),
      ]),
      group({}, [
        you('Third. It did not help.'),
        say('sera', 'No. One voice against six almost never does.'),
        say('sera', 'You will have noticed how much work it was, though.'),
      ]),
    ),
    pause(300),
    say('sera', 'Nothing about the lanterns changed between round one and round three.'),
    you('Only the number of people.'),
    say('sera', 'Only the number of people, all pointing the same way at once.'),
    pause(500),
    say('sera', 'Then Nia said first — which was also wrong — and the whole thing fell over.'),
    say('sera', 'It was never the answer. It was that nobody had gone first.'),
    pause(400),
    say('sera', 'That has a name. Conformity.'),
    insight('conformity'),
    say('sera', 'Half of them knew. They told you so themselves. They said second anyway.'),
  ], 'NAMING MOMENT 3 — recognition, not instruction'),

  dissent: exchange('q3.dissent', [
    say('sera', 'A group that agrees completely is very strong and very brittle.'),
    say('sera', 'One voice the other way and it comes apart. It does not even have to be right.'),
    banner('DISSENT', 'you can break a group by giving one of them a reason to differ'),
    cue('ability_grant', 'dissent'),
    say('sera', 'Hold on to that. I have a feeling about what is under the south road.'),
  ]),

  hint1: exchange('q3.hint1', [
    nar('Mote drifts from face to face along the row, then stops on Nia and stays there.'),
  ]),
});
