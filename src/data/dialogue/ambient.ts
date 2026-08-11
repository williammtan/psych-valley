/**
 * AMBIENT DIALOGUE — what the town says when nothing is happening.
 *
 * Every character carries a different set of idle lines for each of the six
 * story stages. A villager remarking on the business with the cat, or being
 * quietly embarrassed about the Trial, is the cheapest and strongest tool we
 * have for making the valley feel like it was paying attention.
 *
 * Rules for anything added here:
 *   - one sentence, two at the outside
 *   - specific. "Nice weather" is dead. A thorn tree that has been moved and
 *     is still being walked around is alive.
 *   - nobody explains anything. They gossip, complain, and get on with it.
 */
import type { Stage } from './flags';
import { choose, exchange, opt, say, type Exchange } from './types';

export interface AmbientProfile {
  person: string;
  /** Played once, the first time the player talks to them. */
  firstMeeting: Exchange;
  /** Cycled on repeat conversations, per stage. */
  idle: Partial<Record<Stage, string[]>>;
  /** One line per stage for a player who has lost the thread. */
  hint: Partial<Record<Stage, string>>;
}

export const AMBIENT: Record<string, AmbientProfile> = {
  // ── MIRA — warm, dry, has run out of patience with her own plumbing ───────
  mira: {
    person: 'mira',
    firstMeeting: exchange('mira.firstMeeting', [
      say('mira', 'You will be the one Sera wrote about.'),
      say('mira', 'Her words were: a newcomer, on foot, probably lost.'),
      choose([
        opt('Thank you.', [
          say('mira', 'Do not thank me yet. You have not met the stairs.'),
        ]),
        opt('She wrote about me?', [
          say('mira', 'She writes to everyone. It is how we learn what she is not telling us.'),
        ]),
        opt('I am not lost.', [
          say('mira', 'You came up the south road holding a map. But do go on.'),
        ], { flag: 'tone_dry' }),
      ]),
      say('mira', 'Room is second on the left. The window sticks. Hit it once, near the latch.'),
      say('mira', 'Kitchen through there. If an orange thing ignores you, that is Pip. He is mine.'),
    ]),
    idle: {
      arrival: [
        'Bell goes on the hour. You will stop hearing it inside a day. He has not.',
        'Half this valley will tell you it is fine. The other half says it twice.',
        'That storm took four nights, two shutters and, apparently, one cat.',
        'There is stew. There is always stew. That is not a boast, it is a warning.',
      ],
      afterQ1: [
        'He slept on the bar all afternoon. Bell went at four. He did not open an eye.',
        'Nine days I apologised to that animal, and it was my own pipes the whole time.',
        'Sera has been in twice to look at the cat and once to look at her notes about the cat.',
        'Storeroom is open. I have flour until spring and you may have jam whenever you like.',
      ],
      afterQ2: [
        'Oren has been here since four, reorganising a shelf I had already organised.',
        'He brought the right flour, said so twice, and looked at me until I agreed.',
        "Bram's boots turned up. Bram had been wearing them, so nobody wanted them back.",
      ],
      festival: [
        'One night a year I shut this place, and I still cannot stop wiping things.',
        'Elia asked me to judge the pies. I said no four times. I am judging the pies.',
        'Everyone is up at the plaza. The inn has never been quieter. I hate it.',
      ],
      afterQ3: [
        'I heard the whole square go quiet, then go wrong, from my own doorstep.',
        'Tavi came in for a drink and did not tell anybody about it. That is new.',
        'Hesta is still upset. I have given her the good chair and a very large slice.',
      ],
      afterShrine: [
        'Kettle is on. You have the look of somebody who has recently been underground.',
        'You brought my lantern back. Nobody brings my lantern back.',
        'Pip sat by the door all evening watching the south road. So did I, a little.',
      ],
    },
    hint: {
      arrival: 'He is under the settle by the storeroom, being dramatic. Start where he started.',
      afterQ1: 'Oren went past that window at a run. That has never once meant good news.',
      afterQ2: 'They will be lighting the plaza soon. North, and take an appetite.',
      festival: 'The Trial is on the stage at eight. Elia will find you if you are late.',
      afterQ3: 'Sera is down at the south gate with four maps and no coat.',
      afterShrine: 'Sit down. That is not a hint, that is an instruction.',
    },
  },

  // ── SERA — quick, curious, chaotic, never talks down to anyone ────────────
  sera: {
    person: 'sera',
    firstMeeting: exchange('sera.firstMeeting', [
      say('sera', 'You came. Good. I was only seventy per cent sure that letter could be answered.'),
      choose([
        opt('It was a strange letter.', [
          say('sera', 'It was efficient. Those are different things.'),
        ]),
        opt('You wanted a stranger.', [
          say('sera', 'I did. Everyone here already knows what everything means. It is useless.'),
        ]),
        opt('Who are you, exactly?', [
          say('sera', 'Sera Vanne. My family kept that bell for three generations, which is funny now.'),
        ]),
      ]),
      say('sera', 'Do not let me hold you up. You have a cat under a bench.'),
      say('sera', 'Tell me what you find. Not what you think it means. What you find.'),
    ]),
    idle: {
      arrival: [
        'Do not rush him. Frightened creatures need extremely boring evenings.',
        'I have written down every time that bell rang this month. It is a problem I have.',
        'Ask Mira about the pipes. Do not say why. You will get the better version.',
        'There is a cat-shaped dent in that basket and nothing has been in it for a week.',
      ],
      afterQ1: [
        'I keep coming back to the fourth ring. That is where his tail stopped.',
        "Wren's sheep are walking a circle. I would like to know what they think is at the end of it.",
        'I have a page of notes about a cat and a page about lights under a road. Same page now.',
      ],
      afterQ2: [
        'Two whole days, both intact, arriving together. That is not forgetting. That is traffic.',
        'Oren writes the weather on his tickets now. He has invented something and has no idea.',
        'The shrine road forks twice and both forks look identical. I have opinions about that.',
      ],
      festival: [
        'Forty people, one right answer, and one very confident man. I am taking notes.',
        'Elia asked me to judge and I have now said no in six separate ways.',
        'Watch the quiet one at the end of the row. She has been right for ten minutes.',
      ],
      afterQ3: [
        'Nia is the interesting one. She was wrong out loud and it fixed the whole plaza.',
        'Tavi asked me a question this evening. Tavi has never asked me a question.',
        'Three of these now, in one fortnight, in one valley. I have stopped calling it luck.',
      ],
      afterShrine: [
        'It went down, not away. I would like to know what down means here, precisely.',
        'Eleven pages of notes and not one of them is the page I actually need.',
        'Come and see me tomorrow. Bring the small light. It has been reading my notebook.',
      ],
    },
    hint: {
      arrival: 'The kitchen. Whatever happened to that cat, it happened inside this building.',
      afterQ1: 'Somebody is shouting in the square. It sounds like a professional crisis.',
      afterQ2: 'Plaza. North. They are lighting it now and Elia is already behind.',
      festival: 'Stay by the stage. This next round is the one worth standing through.',
      afterQ3: 'South gate. Bring the sword, something warm, and low expectations.',
      afterShrine: 'The workshop, when you are ready. I will make the bad tea.',
    },
  },

  // ── OREN — fast, precise, mortified ──────────────────────────────────────
  oren: {
    person: 'oren',
    firstMeeting: exchange('oren.firstMeeting', [
      say('oren', 'Morning! Cannot stop. Four parcels, one hill, and the hill is winning.'),
      choose([
        opt('You are the courier?', [
          say('oren', 'Nine years. Not one wrong door. I would like that on a small plaque.'),
        ]),
        opt('Need a hand?', [
          say('oren', 'No. Thank you. It is a system. A hand would be inside the system.'),
        ]),
      ]),
      say('oren', 'Anything comes for you, it goes to the inn. Everything goes to the inn.'),
    ]),
    idle: {
      arrival: [
        'Two doors, six streets, three of them named after the same dead man.',
        'Nine years, not one wrong door. I am aware that I say that a great deal.',
        'The bell is how I keep pace. Four doors between tolls. Five if it is downhill.',
      ],
      afterQ1: [
        'I heard about the cat. Does he hide from you too? He hides from me professionally.',
        'There is a parcel from storm week that never got delivered. I keep meaning to ask whose.',
        'If you ever need anything carried, do not. But if you did, I would.',
      ],
      afterQ2: [
        'I write the weather on every ticket now. Elia thinks I have lost my mind.',
        'Rain. Dry. Shut. Painted. Four words, and I never do that to myself again.',
        'I owe you one free delivery, anywhere in the valley, including up that hill.',
      ],
      festival: [
        'I am not competing. I am holding coats. It is a role and I am good at it.',
        'Tavi handed me his jacket as though it were a favour to me. It was, slightly.',
        'Elia has me on lantern duty at nine. I have written the weather on the schedule.',
      ],
      afterQ3: [
        'Everyone said second and I said second and I was not even listening. Again!',
        'I have decided that being certain is a thing that happens to other people.',
        'Nia said one word and eleven people found their spines. One word.',
      ],
      afterShrine: [
        'Deliveries went perfectly today. I am choosing to take full credit for that.',
        'You went down there on purpose. I get nervous past the second bridge.',
        'There is a parcel for you at the office. No idea who from. That is not like me.',
      ],
    },
    hint: {
      arrival: 'The inn, if you are lost. Mira knows everything, including what she should not.',
      afterQ1: 'Courier office, west side. Come now. Come quite fast, actually.',
      afterQ2: 'Plaza, north of the tower. You will not miss it, it is the loud part.',
      festival: 'Stage is that way. Do not let Elia catch you idle, she carries a clipboard.',
      afterQ3: 'Sera went south with a lantern and no coat. Somebody ought to follow that.',
      afterShrine: 'Inn. Mira has kept food for you, which she will deny to your face.',
    },
  },

  // ── TAVI — confident, generous, never doubts himself, never a villain ────
  tavi: {
    person: 'tavi',
    firstMeeting: exchange('tavi.firstMeeting', [
      say('tavi', 'A new face. Excellent. New faces are lucky at the Trial.'),
      choose([
        opt('The Trial?', [
          say('tavi', 'Lanterns, tones, and a great deal of pointing. I have won it six years.'),
        ]),
        opt('You seem confident.', [
          say('tavi', 'I am. It is considerably cheaper than practice.'),
        ]),
      ]),
      say('tavi', 'Tavi. If anyone tells you I am insufferable, they are quoting my mother.'),
    ]),
    idle: {
      arrival: [
        'Six years running. I would love to tell you I am nervous. I would be lying.',
        "North stalls, when they open. Hesta's honey cakes. Get there before Bram.",
        'Everyone here is friendly and about half of them mean it. Good odds, that.',
      ],
      afterQ1: [
        "Heard about Mira's cat. That is exactly the sort of thing I like about this place.",
        'I would have shouted at it. That is why nobody sends me on the cat jobs.',
        'You sat in a room doing nothing for an hour. I could not do that for money.',
      ],
      afterQ2: [
        'Oren delivered my lantern polish to Bram. Bram polished a turnip with it.',
        'The turnip looks tremendous. He has entered it in two separate categories.',
        'Poor man has been apologising in the street. I told him to stop. He apologised.',
      ],
      festival: [
        'Come and watch. Stand at the front. You will hear better and I like an audience.',
        'The trick is answering fast. A slow answer is just doubt with extra steps.',
        'Six lanterns, six years, one Tavi. Somebody should write it down properly.',
      ],
      afterQ3: [
        'I have been thinking. What if I have been wrong before and everyone was polite?',
        'Do not answer that. Actually, do. Later. When I have had a drink in my hand.',
        'Nia has said four words to me in eleven years and one of them was first.',
      ],
      afterShrine: [
        'You went into those woods for fun. I go in for firewood and complain the whole way.',
        'Next year I answer last. I have told everyone, so now I have to actually do it.',
        'Drinks are on me. Do not read anything into it. Read a little into it.',
      ],
    },
    hint: {
      arrival: 'Inn is east, past the fountain. Mira will feed you and interrogate you.',
      afterQ1: 'Somebody is having a crisis outside the courier office. It is Oren.',
      afterQ2: 'Plaza, tonight. You will hear it well before you see it.',
      festival: 'Stage. Front row. Come on.',
      afterQ3: "Sera has gone south with Mira's lantern. She should not be down there alone.",
      afterShrine: 'Go and eat something. You have gone the colour of that shrine.',
    },
  },

  // ── NIA — says little, means all of it ───────────────────────────────────
  nia: {
    person: 'nia',
    firstMeeting: exchange('nia.firstMeeting', [
      say('nia', 'You came in by the south road.'),
      choose([
        opt('Is that unusual?', [
          say('nia', 'Most take the ferry. The south road is longer and nobody minds it.'),
        ]),
        opt('You were watching?', [
          say('nia', 'I was here. Watching is what here is for.'),
        ]),
      ]),
      say('nia', 'Nia.'),
      say('nia', 'If you want the inn, it is the building with the light on.'),
    ]),
    idle: {
      arrival: [
        'The bell is a minute fast. It has been all year. Nobody has mentioned it.',
        'That cat used to sleep on this wall every afternoon. Not since the storm.',
        'I like the valley at this hour. Everyone is indoors being loud somewhere else.',
      ],
      afterQ1: [
        'The cat is on the bar. Eyes open. Good.',
        'You were in there a long while doing nothing at all. That was the clever part.',
        'Mira has started leaving the door open again.',
      ],
      afterQ2: [
        'Oren counts out loud when he is frightened. He counted all morning.',
        'He is back to counting under his breath. That is his ordinary amount.',
        'The green door was brown on Monday. People walk past it and do not see.',
      ],
      festival: [
        'I am not going up on that stage. I will be here.',
        'I can hear it perfectly well from here.',
        'Third one. But nobody has asked me.',
      ],
      afterQ3: [
        'Being wrong out loud cost me nothing. I had expected it to cost something.',
        'Hesta has apologised to me four times. I was not the one she got wrong.',
        'Tavi said hello. Properly, with my name in it.',
      ],
      afterShrine: [
        'You came back up the south road. That is twice now.',
        'It is quieter down there. I still would not like it.',
        'The light behind your shoulder is watching me. I do not mind.',
      ],
    },
    hint: {
      arrival: 'The cat went under the settle. The settle is by the storeroom.',
      afterQ1: 'Courier office. He has been walking in circles outside it.',
      afterQ2: 'North. They have lit the plaza.',
      festival: 'The stage. Elia has been saying your name.',
      afterQ3: 'South gate. She has been standing there twenty minutes.',
      afterShrine: 'Inn. There is a fire.',
    },
  },

  // ── ELIA — overwhelmed, funny about it, carries eleven things ────────────
  elia: {
    person: 'elia',
    firstMeeting: exchange('elia.firstMeeting', [
      say('elia', 'Mayor Elia. Welcome to Lumen Vale. Please do not need anything until Thursday.'),
      choose([
        opt('I need nothing.', [
          say('elia', 'Oh, I like you enormously.'),
        ]),
        opt('What happens Thursday?', [
          say('elia', 'Nothing. Thursday is aspirational.'),
        ]),
      ]),
      say('elia', 'There is a festival tonight, which is why I am holding eleven things and no drink.'),
    ]),
    idle: {
      arrival: [
        'Volunteers were asked for. Volunteers were then assigned. It is the same list.',
        'Somebody has to bless the lanterns. Traditionally me. Traditionally I hate it.',
        'If you see a boy pushing a barrow of lanterns the wrong way, that is my nephew.',
      ],
      afterQ1: [
        'I am told there was an incident involving a cat. I have chosen not to investigate.',
        'Mira has stopped writing to me about her pipes. Small mercies, and I will take them.',
        'Sera has requested access to the south road. In triplicate. She does love a form.',
      ],
      afterQ2: [
        'Six wrong deliveries. Eleven complaints. Somebody complained twice, and I know who.',
        'Oren offered to resign. In writing. On the back of a delivery ticket.',
        'I have not accepted it. I have put it in a drawer where resignations go to think.',
      ],
      festival: [
        'The stage is level. I checked with a marble. The marble is now missing.',
        'Isolde has tuned for three days and will play four songs. Four.',
        'If you are competing, sign the slate. If you are eating, do not sign the slate.',
      ],
      afterQ3: [
        'Ninety years of Trials and nobody has ever disagreed. I had no procedure!',
        'I have written a procedure. It is four lines and two of them are about humming.',
        'Tavi has asked to answer last next year. I wrote it down in case he forgets.',
      ],
      afterShrine: [
        'Do you know what I have now? A shrine. In my jurisdiction. With a hole in it.',
        'I shall need a sign. Two signs. One of them is going to say DO NOT.',
        'The valley council meets Thursday. I have moved it to never.',
      ],
    },
    hint: {
      arrival: 'Inn is east. Mira will have you fed and questioned, in that order.',
      afterQ1: 'Would you speak to Oren? He has gone the colour of his own paperwork.',
      afterQ2: 'Plaza! North! Tonight! I have now said all three of those to everyone.',
      festival: 'Stage, please. We are running late and I am the reason.',
      afterQ3: 'Sera has gone south. She asked permission. I said no. She went.',
      afterShrine: 'Go and sit somewhere warm. Not in my office. Anywhere else warm.',
    },
  },

  // ── BRAM — farmer, turnips, absolute confidence in arithmetic ────────────
  villager_a: {
    person: 'villager_a',
    firstMeeting: exchange('villager_a.firstMeeting', [
      say('villager_a', 'Bram. Turnips.'),
      say('villager_a', 'If you want to know anything else about me, that is the wrong order.'),
    ]),
    idle: {
      arrival: [
        'Turnips do not care about storms, festivals, or the price of turnips.',
        "Lost a shed roof in that storm. Found it in Dov's field. He is keeping it.",
        'You will hear the bell all night in a storm. Never used to bother anybody.',
      ],
      afterQ1: [
        "Heard you fixed Mira's cat. Can you do sheep? Do not answer. Ask Wren.",
        'That cat has been in my barn twice today. Bold, for a coward.',
        'Sat in a room ringing a bell at nothing. And it worked. Valley is full of surprises.',
      ],
      afterQ2: [
        'Oren brought me a salve for sheep. I have no sheep. I used it anyway.',
        'Best my knees have been in years, mind.',
        'He came back for it. I told him it was gone. It is gone into my knees.',
      ],
      festival: [
        'Eleven years I have entered a turnip in the judging. This is the year.',
        'It is a large turnip. I am not going to pretend to be modest about it.',
        'Do not stand near the marrow table. There is history at the marrow table.',
      ],
      afterQ3: [
        'I have said six people cannot be wrong my whole life. Tonight I watched it happen.',
        'The turnip took second. Second! Behind a marrow with a face drawn on it.',
        'I keep going over it. I did hear third. I did. And then I said second.',
      ],
      afterShrine: [
        'Turnips unchanged. Whatever you did down there, the turnips are unchanged.',
        'That is not nothing. Reassuring, that.',
        'Wren says her sheep have stopped circling. I have said nothing to Wren.',
      ],
    },
    hint: {
      arrival: 'Inn is east. Look for the lantern that is actually lit.',
      afterQ1: 'Courier office. Oren has been out front doing a lot of walking.',
      afterQ2: "Plaza is north. Follow the smell off Hesta's stall.",
      festival: 'Judging is by the stage. So is everything else.',
      afterQ3: 'South gate. Sera went through it like she was late for it.',
      afterShrine: 'Go home. Or to the inn. Same thing round here.',
    },
  },

  // ── HESTA — baker, up before the bell, kind and not over it ──────────────
  villager_b: {
    person: 'villager_b',
    firstMeeting: exchange('villager_b.firstMeeting', [
      say('villager_b', 'Hesta. Bakery, on the row.'),
      say('villager_b', 'I am up two hours before that bell, so forgive the face.'),
    ]),
    idle: {
      arrival: [
        'That bell is not a wake-up call for me. It is a taunt. I have been up since four.',
        "Storm week you could hear Mira's pipes go off from my ovens. Like a door falling over.",
        'Four nights of that. I burnt two trays and blamed the weather, which was fair.',
      ],
      afterQ1: [
        'Pip came into the bakery today and did not hide once. He stole a bun, mind.',
        'First time in a fortnight he has come in the front way. He used to live on my step.',
        'Mira looks ten years younger. It was never about the cat, that.',
      ],
      afterQ2: [
        'Two sacks of flour on Tuesday and none on Wednesday. I said nothing. I am nice.',
        'I have said something since. Gently. He apologised for eleven minutes.',
        'He asked me what the weather was doing on Tuesday. I have never been asked that.',
      ],
      festival: [
        'Four hundred honey cakes. If you take one before the Mayor does, I saw nothing.',
        'Do not tell Bram the cakes are out. Bram has a system for cakes.',
        'I bake for this every year and I have never once watched the Trial. Not once.',
      ],
      afterQ3: [
        'I heard third. I said second. I have been chewing on it all evening.',
        'I am not upset with Tavi. I am upset with the version of me that said second.',
        'Nia buys one loaf a week and says four words. She spent them well tonight.',
      ],
      afterShrine: [
        'There is bread for you. Do not argue, it is already wrapped.',
        'The ovens have drawn properly since this morning. First time in a fortnight.',
        'You look like you have not eaten since the woods. That is not a guess.',
      ],
    },
    hint: {
      arrival: 'The inn is the long building east of the fountain. Mind the step.',
      afterQ1: 'Oren went by so fast he did not take his bread. Something is wrong with him.',
      afterQ2: 'North for the plaza. I am up there in an hour with four hundred cakes.',
      festival: 'Stage is past the food. Everyone gets stuck at the food.',
      afterQ3: 'The south gate. She had a lantern and that look she gets.',
      afterShrine: 'Sit at my stall. I will bring you something and you will eat it.',
    },
  },

  // ── DOV — fisher, the river has moved, nobody believes him ───────────────
  villager_c: {
    person: 'villager_c',
    firstMeeting: exchange('villager_c.firstMeeting', [
      say('villager_c', 'Dov. River.'),
      say('villager_c', 'It has moved a foot off my jetty since spring and nobody believes me.'),
    ]),
    idle: {
      arrival: [
        'A foot. Measure it yourself, the marks are still on the post. Nobody ever does.',
        'Fish are fine. Fish are always fine. It is the water that has gone odd.',
        'I have kept a tide mark on that jetty for thirty years. It is not a hobby, it is a habit.',
      ],
      afterQ1: [
        'The cat used to fish off my jetty. He was back today. Caught nothing, as ever.',
        'You are the one who did the business with the bell. Could you do a river?',
        'Mira sent down soup. Mira never sends down soup. Something has gone right.',
      ],
      afterQ2: [
        'Oren gave me a parcel of buttons. I do not have buttons. I have hooks.',
        'I kept them. You never know when a valley is going to need buttons.',
        'He asked me if it rained Tuesday. I said it rained on me, personally, all day.',
      ],
      festival: [
        'I row the reference lantern out to the stage every year. It is my one job.',
        'Do not ask me to judge. I called a marrow a pumpkin once, in front of everyone.',
        'Best sound in the valley, that reference lantern. Carries right across the water.',
      ],
      afterQ3: [
        'I stopped hearing the lantern and started hearing the row. Still annoyed about it.',
        'Nia was wrong, and I have never been so grateful to anybody in my life.',
        'Thirty years of listening to water and I could not hold on to one note.',
      ],
      afterShrine: [
        'River settled overnight. Back where it sat in spring. Do not tell me that is nothing.',
        'You went under the valley. I am not asking. I am simply noting that I noticed.',
        'Marks on the post line up again. Thirty years and they line up again.',
      ],
    },
    hint: {
      arrival: 'Inn is up the bank and east. Follow the smoke, not the path.',
      afterQ1: 'There is shouting up by the courier office. Sounds like the fast lad.',
      afterQ2: 'Plaza is north. I am rowing the lantern up at seven.',
      festival: 'Stage is on the water side. I put it there. It floats better.',
      afterQ3: "South gate, and quickly. She has that lantern of Mira's.",
      afterShrine: "Go up to the inn. You have earned somebody else's cooking.",
    },
  },

  // ── WREN-OF-THE-HILL — shepherd, circling sheep, dry as a bone ───────────
  villager_d: {
    person: 'villager_d',
    firstMeeting: exchange('villager_d.firstMeeting', [
      say('villager_d', 'Wren. Of the hill, they say, as though there were another Wren.'),
      say('villager_d', 'Two of my sheep have started walking in circles and I would rather not think about it.'),
    ]),
    idle: {
      arrival: [
        'Two of them go round the same thorn tree. Same direction. All morning.',
        'I moved the thorn tree. They go round where it was.',
        'They are not distressed. They are extremely calm. That is the unsettling part.',
      ],
      afterQ1: [
        'A third has joined the circle. It is a very tidy circle now.',
        'You did something with a bell and a cat. Would that work on a sheep, do you think?',
        'I have started ringing a pan at feeding time to see what happens. Nothing yet.',
      ],
      afterQ2: [
        "Got somebody's boots on Tuesday. They fit. I have said nothing to anyone.",
        'Do not tell Bram. He has been describing his boots to people all week.',
        'Oren came to ask about the paint on the door. He wrote down the answer twice.',
      ],
      festival: [
        'I brought the circling ones down for the festival. They are circling near the pies.',
        'Everybody thinks it is charming. I have to catch them at midnight.',
        'One evening a year I am not on that hill and I still smell of that hill.',
      ],
      afterQ3: [
        'Nine hours a day alone with sheep and I still could not say a number on my own.',
        'I said what Tavi said and I have never had a conversation with Tavi.',
        'The sheep, at least, are honest about who they are following.',
      ],
      afterShrine: [
        'They stopped. All three, this evening, at once. Just stood there.',
        'Like they had forgotten why they started. I would like to know what forgot for them.',
        'First quiet night on that hill since the storm. I did not sleep. Habit.',
      ],
    },
    hint: {
      arrival: 'The inn is east, and the cat you are after is under the furniture in it.',
      afterQ1: 'The courier lad is in a state outside his office. Go and be calm at him.',
      afterQ2: 'Plaza. North. Everyone is going, including three sheep.',
      festival: 'Stage. Past the pies, where the noise is.',
      afterQ3: 'She went south. Nobody goes south.',
      afterShrine: 'Up to the inn with you. There is a chair by that fire with your name on.',
    },
  },

  // ── TOMAS — sells everything, recommends nothing ─────────────────────────
  villager_e: {
    person: 'villager_e',
    firstMeeting: exchange('villager_e.firstMeeting', [
      say('villager_e', 'Tomas. General goods.'),
      say('villager_e', 'I have rope, oil, nails, and no opinion whatsoever about any of them.'),
    ]),
    idle: {
      arrival: [
        'If you can see it, we have it. If you cannot see it, we had it.',
        'People ask me what is good. I sell everything. Everything cannot be good.',
        'Shut every second Tuesday for stocktake. It is on the door. It has always been on the door.',
      ],
      afterQ1: [
        'Somebody bought a small brass bell off me last spring. Never asked what for.',
        'That cat sat in my window two years like a paid advertisement. He is back in it.',
        'Sold Sera four notebooks this month. Four. She writes faster than I stock.',
      ],
      afterQ2: [
        'Shut Tuesday for stocktake. Told Oren. Told him twice. It was on the door.',
        'Buttons arrived. I do not sell buttons. I now sell buttons.',
        'Made a profit on the buttons, as it happens. Do not tell Dov.',
      ],
      festival: [
        'Lamp oil, string, spare wicks. Festival night is my Tuesday.',
        'Everyone buys a lantern they already own. I am not going to stop them.',
        'Six years I have sold Tavi the same polish. He thinks it is a different polish.',
      ],
      afterQ3: [
        'The lanterns were not the point. Business is business, and rope is rope.',
        'Do not look at me like that. I sold Nia a lamp this morning at cost.',
        'I will say this once: I knew. I have known since round two. There.',
      ],
      afterShrine: [
        'You will want oil. Whatever you have been doing, you will want oil.',
        'I am not asking. I have priced it as though I did not ask.',
        'Half the valley came in today wanting to talk. Nobody bought anything. Terrible day.',
      ],
    },
    hint: {
      arrival: 'Inn, east side. They have beds and I do not, so it is not a hard sell.',
      afterQ1: 'The courier is outside doing laps of his own office. Go on.',
      afterQ2: 'Plaza, north. I shall be there selling you a lantern you own already.',
      festival: 'Stage is past my stall. Everything is past my stall. That is the plan.',
      afterQ3: 'She went out the south gate with a lantern and bought nothing on the way.',
      afterShrine: 'Inn. Warm. Free. Three things I cannot sell you.',
    },
  },

  // ── ISOLDE — musician, three days of tuning, the only one who can hear it ─
  villager_f: {
    person: 'villager_f',
    firstMeeting: exchange('villager_f.firstMeeting', [
      say('villager_f', 'Isolde. Third day of tuning.'),
      say('villager_f', 'The strings are fine. It is the valley that is off.'),
    ]),
    idle: {
      arrival: [
        'The A goes flat by evening and I cannot find a single reason for it.',
        'I have four songs ready. One is cheerful. Elia has asked for four cheerful.',
        'You can hear the bell in the strings if you stand still. Try it. Nobody ever tries it.',
      ],
      afterQ1: [
        'That cat used to sit under my window while I practised. He was there today.',
        'He only likes the slow one. Everybody only likes the slow one.',
        'I played through the whole storm week. Somebody had to make a nicer noise.',
      ],
      afterQ2: [
        'Oren brought me a parcel of nails. I play the fiddle. What am I to do with nails.',
        'I have kept them. Everybody in this valley is keeping the wrong thing now.',
        'He has apologised so thoroughly that I have started apologising back.',
      ],
      festival: [
        'Four songs, then I sit down and someone else can be looked at for a while.',
        'If those tone lanterns are flat tonight I am going home and nobody may stop me.',
        'They are not flat. I checked. I checked eleven times. They are perfect.',
      ],
      afterQ3: [
        'I have tuned instruments since I was nine years old. And I said second.',
        'I had been humming the third one under my breath the entire evening.',
        'Elia has banned humming. I would like the record to show why.',
      ],
      afterShrine: [
        'The A held all morning. First time this month. Something has stopped pulling at it.',
        'Whatever you did, the valley is in tune. Nobody will notice but me.',
        'I have written something new. It is not cheerful. Elia will have to cope.',
      ],
    },
    hint: {
      arrival: 'Inn is east. Mira keeps the best chair by the fire for people who arrive late.',
      afterQ1: 'That is Oren shouting. He never shouts. Go and see.',
      afterQ2: 'Plaza, north, and I shall be the one tuning in the corner.',
      festival: 'Stage. I am on it in ten minutes, so hurry, or do not, honestly.',
      afterQ3: 'South gate. She asked me what a tone sounds like underground. I had no answer.',
      afterShrine: 'Go to the inn and let somebody make a fuss of you.',
    },
  },
};
