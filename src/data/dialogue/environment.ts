/**
 * ENVIRONMENTAL TEXT — signs, boards, labels, spines, stones, and the ~45 props
 * worth looking at twice.
 *
 * This is where the valley does its own talking. Two rules:
 *   - a prop description is one or two lines, and it is about THIS object in
 *     THIS town, never about objects in general
 *   - anything that changes between acts should say so, so the world keeps up
 *     with the player
 */
import { FLAGS } from './flags';
import { exchange, group, look, nar, namespaced, variants, type Exchange, type ExchangeMap } from './types';

// ── signs ───────────────────────────────────────────────────────────────────
export const SIGNS: ExchangeMap = namespaced('sign', {
  southGate: look('sign.southGate',
    'SOUTH GATE — WHISPER WOODS. Path maintained as far as the second bridge.',
    'Underneath, in a different hand: it is not maintained.',
  ),
  townEdge: look('sign.townEdge',
    'LUMEN VALE. Bell on the hour. Mind the bridge boards. Welcome, mostly.',
  ),
  inn: look('sign.inn',
    'THE LANTERN INN — beds, stew, and quiet if you are lucky.',
  ),
  workshop: look('sign.workshop',
    'S. VANNE — RESEARCH. Knock. Then wait. Then knock again.',
  ),
  courier: look('sign.courier',
    'LUMEN VALE COURIER. Parcels sworn by. Rates on the board. Complaints to Oren.',
  ),
  store: look('sign.store',
    'TOMAS — GENERAL GOODS. If you can see it, we have it.',
    'Closed every second Tuesday for stocktake. This has been on the door for years.',
  ),
  bellTower: look('sign.bellTower',
    'BELL TOWER. Rung on the hour. Rung continuously in storms.',
    'Do not climb during either. Signed, the last person who did.',
  ),
  plaza: look('sign.plaza',
    'FESTIVAL OF LANTERNS — this evening. Volunteers wanted.',
    'Below that: volunteers required. Below that, simply: volunteers.',
  ),
  bridge: look('sign.bridge',
    'Bridge rebuilt after the spring flood. Second rebuild. Please do not test it.',
  ),
  woods: look('sign.woods',
    'WHISPER WOODS. Sound carries oddly here. It is the shape of the valley, not a ghost.',
  ),
  shrineRoad: look('sign.shrineRoad',
    'OBSERVATORY ROAD — CLOSED. Authority: the valley. Signed: nobody at all.',
  ),
  bakery: look('sign.bakery',
    'HESTA — BREAD. Open at five. Do not knock before five. She is awake. Do not knock.',
  ),
});

// ── the notice board, which changes with the acts ───────────────────────────
export const NOTICE_BOARD: Exchange = exchange('notice_board', [
  variants(
    group({ stage: 'arrival' }, [
      nar('STORM DAMAGE: shutters, two roofs, one pipe run. All repaired. Stop asking. — M'),
      nar('LOST: one brass hand bell. Sentimental value only. Probably in the inn. — M'),
      nar('FESTIVAL OF LANTERNS: volunteers wanted. Speak to the Mayor. She will find you first.'),
    ]),
    group({ stage: 'afterQ1' }, [
      nar('FOUND: cat. Not lost. Never was lost. Please stop bringing him to me. — M'),
      nar('FESTIVAL OF LANTERNS: volunteers are now assigned. The list is the same list.'),
      nar('WANTED: anyone who kept a record of the bell during the storm. Any record. — S. Vanne'),
    ]),
    group({ stage: 'afterQ2' }, [
      nar('COURIER NOTICE: if you received a parcel that is not yours, it is not a gift.'),
      nar('Below it, in a fast hand: it is not a gift. Please. I have a list. — O'),
      nar('FESTIVAL TONIGHT. Stalls at seven. Trial at eight. Mayor at some point.'),
    ]),
    group({ stage: 'festival' }, [
      nar('TRIAL RULES: one strike per lantern. Answer when asked. No humming.'),
      nar('Someone has added: NO HUMMING. Someone else has added a small drawing of a hum.'),
      nar('PIE JUDGING has been moved to nine, then eight, then back to nine.'),
    ]),
    group({ stage: 'afterQ3' }, [
      nar('LOST PROPERTY from the Trial: one clipboard, one marble, considerable dignity.'),
      nar('NEW TRIAL PROCEDURE, four lines, two of them about humming. Effective next year.'),
      nar('The vegetable results have been pinned up. Somebody has crossed out the marrow.'),
    ]),
    group({ stage: 'afterShrine' }, [
      nar('THE SOUTH ROAD is open. The Mayor formally requests that nobody use it.'),
      nar("Under that, in Sera's hand: I am using it. Come and find me. Bring a lamp."),
      nar("Under THAT, in Mira's hand: bring my lantern back."),
    ]),
  ),
]);

// ── book spines in Sera's workshop ──────────────────────────────────────────
export const BOOK_SPINES: ExchangeMap = namespaced('spine', {
  a: look('spine.a', 'OBSERVATIONS ON DOGS, DINNERS AND BELLS. Volume two. Volume one is missing.'),
  b: look('spine.b', "A SHEPHERD'S COMPLETE FIELD RECORD, 1102 to 1119. Every day. Every single day."),
  c: look('spine.c', 'WHY CROWDS TURN. Thin. Read to pieces. The spine has been repaired twice.'),
  d: look('spine.d', 'THE VALLEY BENEATH THE VALLEY. Mostly maps. Mostly wrong, in interesting ways.'),
  e: look('spine.e', 'NINETEEN WAYS TO BE CERTAIN — and, in smaller letters, to be wrong.'),
  f: look('spine.f', 'PIPES, PUMPS AND DRAINAGE OF THE LOWER VALE. Currently propping open a window.'),
  g: look('spine.g', 'SIX LECTURES ON ATTENTION. Four of the lectures are missing.'),
  h: look('spine.h', 'AN INDEX OF LUMEN VALE SURNAMES. A pencil note inside: far too many Torvals.'),
  i: look('spine.i', 'THE OBSERVATORY PAPERS, VOL. III. The other volumes have never been found.'),
  j: look('spine.j', 'Untitled, handwritten, strapped shut. The first page reads: DO NOT LEND TO SERA.'),
  k: look('spine.k', 'ON TIDE MARKS AND RIVERS THAT MOVE. Borrowed from Dov. Repeatedly.'),
  l: look('spine.l', 'A SHORT HISTORY OF THE FESTIVAL OF LANTERNS. Six recent pages are about Tavi.'),
  m: look('spine.m', 'The shelf label reads: SORTED BY. The rest of the label was never written.'),
  n: look('spine.n', 'CATTLE AILMENTS OF THE NORTHERN VALLEYS. Somebody has drawn a cat on the cover.'),
  o: look('spine.o', 'A book with no title, swollen with pressed flowers, none of them labelled.'),
});

// ── courier office: the duty roster and the labels ──────────────────────────
export const ROSTER: Exchange = exchange('courier_roster', [
  nar('THE ELEVENTH — river route. Hesta, flour, two sacks. Dov, line and hooks. Wren, salve.'),
  nar('THE TWELFTH — river route. Hesta, flour, two sacks. Dov, hooks. Wren, salve and boots.'),
  nar('Two days in the same careful hand. You have to read twice to find the difference.'),
]);

export const LABELS: ExchangeMap = namespaced('label', {
  flour: look('label.flour', 'HESTA — FLOUR, TWO SACKS. Blue tape. Handle like it matters. It does not.'),
  salve: look('label.salve', 'W. OF THE HILL — SALVE. Do not shake. Do not open. Do not smell. In that order.'),
  hooks: look('label.hooks', 'DOV, JETTY — HOOKS. Heavier than it looks and sharper than it sounds.'),
  buttons: look('label.buttons', 'BUTTONS. No name. No street. Somebody has written a question mark and given up.'),
  boots: look('label.boots', 'BOOTS, SIZE NINE. The tag has been crossed out and rewritten twice.'),
  polish: look('label.polish', 'T. — LANTERN POLISH. Six identical tins ordered six years running.'),
  nails: look('label.nails', 'NAILS, ASSORTED. Delivered to a fiddle player. Kept by the fiddle player.'),
  storm: look('label.storm', 'A parcel from storm week, undelivered, addressed to a house that is not there.'),
});

// ── the graveyard on the shrine road ────────────────────────────────────────
export const GRAVES: ExchangeMap = namespaced('grave', {
  torval: look('grave.torval', 'TORVAL VANNE — kept the bell. Forty-one years. Never once late.'),
  halla: look('grave.halla', 'HALLA — said the observatory would end badly. It did. She was insufferable about it.'),
  watchman: look('grave.watchman', 'A WATCHMAN OF THE OBSERVATORY. The name has worn away. The dates are three years apart.'),
  six: look('grave.six', 'SIX NAMES ON ONE STONE. The storm of 1094. The bell rang for all of them.'),
  nameless: look('grave.nameless', 'No name. No dates. Only: WENT DOWN, DID NOT COME UP.'),
});

// ── shrine inscriptions: the observatory's log, carved by whoever was left ──
export const INSCRIPTIONS: ExchangeMap = namespaced('carving', {
  one: look('carving.one', 'LOG 1 — Nothing under here but water and old air. Halla says otherwise. Halla always does.'),
  four: look('carving.four', 'LOG 4 — The hum is steady. The instruments read nothing. Six of us hear it. One does not.'),
  seven: look('carving.seven', 'LOG 7 — Torval rang the bell above and we felt it down here, a full breath before the sound.'),
  twelve: look('carving.twelve', 'LOG 12 — We are not making anything happen. We are making things happen more.'),
  fifteen: look('carving.fifteen', 'LOG 15 — Ask this room a question and it answers in your own voice, very slightly late.'),
  nineteen: look('carving.nineteen',
    'LOG 19 — Halla left a rat in the east chamber with a lamp and a bell.',
    'Two days. It is frightened of the lamp now. The lamp never did anything to it.',
  ),
  twentythree: look('carving.twentythree',
    'LOG 23 — Two teams learned two ways down. Now neither team can walk either without stopping.',
  ),
  twentysix: look('carving.twentysix',
    'LOG 26 — We voted on what we could hear. Eight for, none against.',
    'Then the ninth man came back up from the stair, and it was eight against one, and then it was not.',
  ),
  thirty: look('carving.thirty', 'LOG 30 — We have stopped writing down what we hear. We write down who agrees.'),
  thirtythree: look('carving.thirtythree', 'LOG 33 — It does not invent. It repeats. Repeating a thing is how a thing becomes true.'),
  thirtysix: look('carving.thirtysix',
    'LOG 36 — Sealing the lower stair. Not for what is down there.',
    'For what we agreed about it, all nine of us, in one afternoon, without argument.',
  ),
  last: look('carving.last',
    'The last carving is in a worse hand, and lower, as though written sitting down.',
    'we came to study a hum. it studied the nine of us. it got better at it than we did.',
  ),
});

// ── props: "look at this" ───────────────────────────────────────────────────
export const PROPS: ExchangeMap = namespaced('prop', {
  // town
  fountain: exchange('prop.fountain', [
    nar('The fountain runs all year. In hard frosts they light a brazier beside it.'),
    nar('Three coins in the bottom, and one button.'),
  ]),
  well: look('prop.well', 'The well is capped and padlocked. The padlock is much newer than the cap.'),
  bench: look('prop.bench', 'A name is carved into the arm of this bench. Elbows have polished it away.'),
  cart: look('prop.cart', 'A handcart with one good wheel, parked hopefully.'),
  scarecrow: look('prop.scarecrow', 'The scarecrow is wearing a better coat than the one you arrived in.'),
  beehive: look('prop.beehive', 'The bees are working the festival flowers. Nobody has told them it is a festival.'),
  birdbath: look('prop.birdbath', 'Two sparrows, one bath, and an ongoing dispute about it.'),
  trough: look('prop.trough', 'Somebody has left a mug on the edge of the horse trough. It is a good mug.'),
  wheelbarrow: look('prop.wheelbarrow', 'A barrow of lanterns, pointed firmly in the wrong direction.'),
  churn: look('prop.churn', 'Full, cold, and labelled in three different hands, all of them saying BRAM.'),
  jetty: exchange('prop.jetty', [
    nar('Tide marks cut into the jetty post. Thirty years of them, one a season.'),
    variants(
      group({ stage: 'afterShrine' }, [
        nar('The top mark lines up with the rest again. There is a fresh cut beside it, made today.'),
      ]),
      group({}, [
        nar('The top three do not line up with the rest. Dov has been right for a year.'),
      ]),
    ),
  ]),
  stoneLantern: look('prop.stoneLantern', 'An old stone lantern. Whoever lights it has been lighting it a very long time.'),
  roadShrine: look('prop.roadShrine', 'A roadside shrine the size of a breadbox. Offerings: two coins, a plum, one fishhook.'),
  hayBale: look('prop.hayBale', 'Hay, stacked with considerably more care than the building beside it.'),
  lamppost: look('prop.lamppost', 'The lamplighter starts at this end, so this one is lit first and goes out last.'),
  pump: look('prop.pump', 'The pump handle is worn on one side only. The valley is right-handed, apparently.'),
  stump: look('prop.stump', 'A stump wide enough to sit on, with a ring count nobody has ever finished.'),
  picnicTable: look('prop.picnicTable', 'A Trial scoreboard is scratched into this table. Six years of it. Mostly Tavi.'),
  chicken: look('prop.chicken', 'It has selected you. There is no known appeal process.'),
  duck: look('prop.duck', 'The duck is on the path again. The path is not for ducks. The duck disagrees.'),
  windowBox: look('prop.windowBox', 'Marigolds, and a card: DO NOT PICK. Underneath: you know who you are.'),
  towerDoor: look('prop.towerDoor', 'The tower door is bolted from inside. The rope hole is polished bright.'),
  bridgeBoards: look('prop.bridgeBoards', 'New boards in the middle, old boards at both ends. Everyone crosses the middle.'),

  // the inn
  innFireplace: look('prop.innFireplace', 'The fire is banked low. There is a cat-sized clean patch on the hearthstone.'),
  innCatBowl: look('prop.innCatBowl', 'Full. Untouched since this morning. Somebody keeps topping it up regardless.'),
  innClock: look('prop.innClock', 'The inn clock runs a minute behind the bell. Mira maintains the bell is wrong.'),
  innBar: look('prop.innBar', 'Ring marks layered into the bar like a stump. The flood of 1102 is in there somewhere.'),
  innSoup: look('prop.innSoup', 'Stew. It has been stew for some time and intends to go on being stew.'),
  innPicture: look('prop.innPicture', 'The valley painted from the south road, before the bell tower had its roof.'),
  innCrates: look('prop.innCrates', 'Crates against the storeroom door, and a settle wedged in front of the crates.'),
  innPipes: look('prop.innPipes', 'The new pipe run, bright as a coin. Somebody has chalked FIXED on the bracket.'),
  innKeg: look('prop.innKeg', 'One keg says DO NOT TAP. Below, in another hand: WHY. Below that: BECAUSE.'),
  innHerbs: look('prop.innHerbs', "Bundles drying overhead. One is plain nettles, labelled: for guests I dislike."),
  innGuestBook: look('prop.innGuestBook', 'The guest book. Eleven names this year. Yours would make twelve.'),
  innStairs: look('prop.innStairs', 'Second on the left, she said. The window in it sticks, she said.'),
  innBroom: look('prop.innBroom', 'Leaning exactly where Mira can reach it without having to look.'),

  // Sera's workshop
  workshopInstruments: look('prop.workshopInstruments',
    'Instruments for measuring things that have not yet agreed to be measurable.'),
  workshopMaps: look('prop.workshopMaps', 'Four maps of one valley. Two of them disagree about the south road.'),
  workshopArtifacts: look('prop.workshopArtifacts', 'A tray of things dug out of the valley. Every label ends in a question mark.'),
  workshopPlant: look('prop.workshopPlant', 'A plant that has grown entirely sideways, towards a window it cannot possibly see.'),
  workshopNotebook: look('prop.workshopNotebook', 'The field notebook. Shut, strapped, and none of your business, obviously.'),
  workshopTea: look('prop.workshopTea', 'Three mugs of tea at three separate stages of having been forgotten.'),
  workshopBellSheet: look('prop.workshopBellSheet',
    'A pinned sheet: BELL TIMES, this month. Four nights are circled, every hour of them.'),

  // courier office
  courierParcels: look('prop.courierParcels', 'Parcels sorted by street, then weight, then something only Oren can see.'),
  courierLedger: look('prop.courierLedger', 'Nine years of ledgers. The handwriting is identical until the last two pages.'),
  courierBoots: look('prop.courierBoots', "Today's boots, clean, standing to attention. Yesterday's are still caked."),
  courierPinboard: look('prop.courierPinboard', 'String, pins, two rows of cards. One row is longer than it has any right to be.'),
  courierScales: look('prop.courierScales', 'Brass scales, balanced, with a thumbprint worn into one pan.'),
  courierBell: look('prop.courierBell', 'A caller bell by the door, never used. Oren hears the gate from three streets away.'),

  // festival plaza
  festStall: look('prop.festStall', 'Four hundred honey cakes, arranged in a formation that means business.'),
  festBrazier: look('prop.festBrazier', 'Throwing more sparks than heat, which is precisely what it is there for.'),
  festJudging: look('prop.festJudging', 'The judging table. A marrow with a face drawn on it is already sitting there.'),
  festReferenceLantern: look('prop.festReferenceLantern', 'The reference lantern on its own stand, roped off as though it might bolt.'),
  festLights: look('prop.festLights', 'Lights strung tower to stalls. Somebody has counted them. Somebody always does.'),
  festStage: look('prop.festStage', 'Six planks and a very great deal of ceremony.'),
  festSlate: look('prop.festSlate', "The competitors' slate. Tavi's name is first, and larger than the others."),

  // woods and shrine road
  woodsMilestone: look('prop.woodsMilestone', 'A milestone: LUMEN VALE, one mile. Below, nearly worn out: OBSERVATORY, two.'),
  woodsGate: look('prop.woodsGate', 'An iron gate lying flat in the leaves. It has been lying there a long while.'),
  shrineCrystal: look('prop.shrineCrystal', 'A crystal the size of a fist, warm to hold, humming just underneath hearing.'),
  shrinePool: look('prop.shrinePool', 'A pool with no inlet. The surface copies you back, half a second late.'),
  shrineStatue: look('prop.shrineStatue', 'A carved figure with its head turned to watch the figure standing beside it.'),
  shrineBrazier: look('prop.shrineBrazier', 'Still alight. Nobody has been down here in thirty years.'),
  shrineMothJar: look('prop.shrineMothJar', 'A jar of moths, alive, which is not possible, and is nevertheless the case.'),
  shrineBarredDoor: look('prop.shrineBarredDoor', 'Barred from this side. Whoever barred it was going the other way.'),
  shrineChest: look('prop.shrineChest', 'A chest, and the very old habit of hoping there is something in it.'),
});

/** The blocked storeroom, which reads differently once Pip stops hiding. */
export const STOREROOM: Exchange = exchange('prop.storeroom', [
  variants(
    group({ requires: FLAGS.pipCalm }, [
      nar('The settle is back against the wall and the storeroom door stands open.'),
      nar('Flour, jam, and one small orange cat sitting on the flour.'),
    ]),
    group({}, [
      nar('The storeroom door will not shift. There is a settle in front of it.'),
      nar('There is a cat under the settle. There is no arguing with either of them.'),
    ]),
  ),
]);
