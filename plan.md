# PROJECT PSYCHE

## Vertical Slice Game Design Document

### Working premise

**Project Psyche** is a cozy action-adventure RPG in which psychological concepts are expressed as mechanics, characters, mysteries, and environmental systems rather than traditional lessons or quizzes.

The aesthetic and emotional target is:

**Stardew Valley × The Legend of Zelda: A Link to the Past**

Stardew contributes:

* a warm town
* recurring characters
* charming routines
* exploration between homes and shops
* secrets
* relationship-driven storytelling
* a world the player wants to spend time in

Zelda contributes:

* responsive movement
* exploration
* dungeons
* environmental puzzles
* enemies
* abilities
* secrets
* boss encounters
* knowledge that becomes usable power

The vertical slice should take approximately **30–45 minutes** for a first-time player.

The slice teaches three AP Psychology ideas:

1. Classical conditioning
2. Memory interference
3. Conformity

The player should encounter each phenomenon first as a **game problem**, understand how it works through interaction, and only afterward receive its formal psychological name.

The slice ends with a Zelda-like dungeon requiring the player to use all three concepts together.

---

# 1. PRODUCT THESIS

The central design rule is:

> Psychology is not content placed on top of gameplay. Psychology is part of the gameplay system itself.

A traditional educational game might do this:

> Kill three monsters → answer a psychology question → unlock door.

Project Psyche instead does this:

> Understand why the monster behaves a certain way → manipulate that behavior → unlock door.

The game therefore has to satisfy two conditions.

### Condition A: It must be fun without the lesson

If all terminology and explanatory text were removed, the player should still enjoy:

* exploring
* solving puzzles
* meeting characters
* discovering secrets
* moving through the world
* reaching the dungeon
* overcoming the boss

### Condition B: Knowledge must matter mechanically

If the player does not understand the psychological phenomenon, some important part of the game should become meaningfully harder.

These two conditions govern all design decisions.

---

# 2. THE PLAYER FANTASY

The player arrives in a quiet valley where strange events have begun occurring.

People:

* remember things that never happened
* react emotionally to harmless objects
* repeat the behavior of groups around them
* develop unusual habits
* misperceive their environment
* become trapped in thought patterns

The valley has recently experienced a phenomenon locals call **The Echo**.

The Echo does not create psychology.

Instead, it appears to make normally invisible psychological processes unusually powerful and visible.

The player gradually develops the ability to recognize these patterns.

The fantasy becomes:

> I understand why this world behaves the way it does.

And eventually:

> Because I understand it, I can manipulate it.

That feeling replaces the traditional fantasy of learning stronger spells.

---

# 3. WORLD

## Lumen Vale

The vertical slice occurs entirely in a small region called **Lumen Vale**.

It is a peaceful agricultural valley built around an old bell tower.

The town sits above the ruins of an abandoned research observatory known as the **Echo Shrine**.

The world should initially feel cozy rather than mysterious.

Flowers move in the breeze.

NPCs walk between buildings.

Birds sit on rooftops.

A river cuts through town.

People prepare for an evening festival.

Only slowly does the player notice that certain behaviors around town are strange.

---

# 4. VERTICAL SLICE WORLD MAP

The playable area should feel larger than it actually is.

The town consists of one central outdoor map with several connected interiors.

## High-level layout

```text
                    NORTH

              [Festival Plaza]
                     |
                     |
      [Courier Row]--+--[Bell Tower]
           |         |
           |      [Town Square]
           |         |
     [Sera's Lab]----+----[The Lantern Inn]
                     |
                     |
                [South Gate]
                     |
               [Whisper Woods]
                     |
                [Echo Shrine]
```

---

# 5. MAJOR LOCATIONS

## 5.1 Town Square

The player's central navigation point.

Contains:

* fountain
* general store façade
* notice board
* benches
* townspeople
* central path toward the bell tower

The player should pass through Town Square repeatedly.

Its purpose is orientation.

The player should be able to understand where they are almost immediately whenever they return here.

---

# 5.2 The Lantern Inn

Owned by **Mira**.

Warm wooden interior.

Fireplace.

Kitchen.

Dining room.

Guest rooms upstairs.

A small cat named **Pip** lives here.

This is the location of the first psychology quest.

### Psychological concept

Classical conditioning.

---

# 5.3 Sera's Workshop

Part laboratory, part library.

Books.

Plants.

Old research equipment.

Maps pinned to walls.

Odd artifacts recovered from the valley.

Sera is the closest thing the game has to a psychological researcher.

Crucially, she should not dump lectures on the player.

Her role is primarily to help the player **name patterns they have already discovered**.

---

# 5.4 Courier Row

A narrow group of homes and shops on the western side of town.

Contains the courier office.

Packages.

Maps.

Delivery notes.

Notice boards.

This is where the second major quest begins.

### Psychological concept

Memory interference.

---

# 5.5 Festival Plaza

A large grassy area north of town.

During the slice, villagers are preparing for the **Festival of Lanterns**.

Contains:

* food stalls
* decorations
* lantern stands
* stage
* judging area
* musicians

The third psychology quest happens here.

### Psychological concept

Conformity.

---

# 5.6 Whisper Woods

Small Zelda-style transitional zone between town and dungeon.

Contains:

* enemies
* bushes
* hidden treasure
* environmental interactions
* one optional puzzle

This area establishes that Project Psyche is also an adventure game.

No new educational concept is introduced here.

The woods primarily exist for pacing and fun.

---

# 5.7 Echo Shrine

The vertical slice dungeon.

Approximately 15–20 minutes.

The shrine combines:

* combat
* exploration
* environmental puzzles
* the three psychology systems introduced previously

The final encounter tests whether the player can transfer those ideas into new contexts.

---

# 6. CORE PLAYER CONTROLS

The control scheme should remain extremely simple.

### Movement

Four-direction or eight-direction movement.

### Action

Interact with:

* NPCs
* objects
* signs
* switches
* clues

### Attack

Basic melee attack.

Sword/staff equivalent.

Three-hit basic combo is unnecessary.

One clean attack animation is enough.

### Dodge

Short dash or roll.

### Observe

A dedicated button activates the player's most important noncombat ability.

Observe briefly highlights:

* unusual environmental objects
* NPC behavior
* clues
* interactable patterns

Observe is not detective vision that gives the answer.

It merely says:

> Something here matters.

---

# 7. BASIC ACTION GAMEPLAY

The POC should contain light combat.

Enemies are simple creatures created or disturbed by the Echo.

Examples:

### Bramble

Small plant creature.

Charges directly toward player.

### Wisp

Floats and fires slow projectiles.

### Mimicling

Copies the player's last directional movement.

Only used later.

Combat should occupy approximately **20% of the playtime**.

The purpose is to give rhythm:

exploration → conversation → puzzle → combat → discovery.

We should not try to make the combat system deep in the vertical slice.

---

# 8. THE THREE CORE PSYCHOLOGY MECHANICS

Each concept follows:

**Experience → Investigate → Understand → Name → Transfer**

---

# 9. MECHANIC ONE: ASSOCIATION

### Psychological foundation

Classical conditioning.

### Game abstraction

The player learns that certain creatures and characters can develop associations between stimuli.

This becomes a reusable environmental mechanic.

---

# 10. QUEST ONE: THE BELL AND THE CAT

## Setup

Soon after arriving at the Lantern Inn, the town bell rings.

Pip the cat immediately panics and hides beneath furniture.

Mira comments:

> He's been doing that ever since the storm.

No explanation is provided.

The player is simply asked to help retrieve Pip because Mira needs him out of a blocked storeroom.

---

## Investigation

The player investigates the inn.

Clues reveal:

During a recent storm:

1. The bell tower rang periodically.
2. Moments after the bell rang, unstable pipes in the inn produced an extremely loud metallic bang.
3. Pip was repeatedly frightened by the noise.
4. The pipes have since been repaired.
5. Pip still reacts to the bell.

The player has now encountered:

Neutral stimulus → pairing → learned response.

But no terminology is used yet.

---

## Gameplay puzzle

The player discovers a small hand bell.

Pip initially flees whenever it rings.

The player must create several safe bell experiences while keeping the environment calm.

Eventually Pip stops fleeing.

The player can then lead him from beneath the furniture and complete the quest.

This subtly introduces extinction as well.

---

## Naming moment

Afterward, Sera explains:

> Pip learned that the bell predicted something frightening. The bell didn't frighten him at first. The association was learned.

The screen briefly displays:

**CLASSICAL CONDITIONING**

Then:

**A previously neutral stimulus can acquire the ability to trigger a learned response through association.**

No multiple-choice question.

No textbook paragraph.

---

## Gameplay ability unlocked

### LINK

The player can now intentionally exploit learned associations in certain creatures.

This isn't a magical spell.

It represents the player's understanding of existing behavior.

Example later:

A dungeon creature has learned to chase glowing moths.

The player can release a moth near a pressure plate.

The creature follows.

Puzzle solved.

---

# 11. MECHANIC TWO: MEMORY THREADS

### Psychological foundation

Proactive and retroactive interference.

### Game abstraction

Memories can overlap.

Similar information can interfere with retrieval.

The player learns to distinguish memories using contextual cues.

---

# 12. QUEST TWO: THE MIXED-UP DELIVERY

## Character

**Oren**, the town courier.

Oren is competent and normally extremely organized.

Today he has a problem.

Two delivery routes have become mixed together in his memory.

Yesterday's deliveries and today's deliveries contained similar:

* addresses
* package colors
* customer names
* routes

He can no longer remember which package went where.

---

## Setup

Several villagers are angry because packages appear to have been delivered incorrectly.

Oren asks the player to help reconstruct what happened.

---

## Investigation

The player explores Courier Row.

Clues include:

* footprints
* receipts
* weather conditions
* conversation memories
* package labels
* shop opening times
* environmental details

The player eventually realizes that Oren is mixing two similar sequences.

---

## Memory Thread interface

The player gains a temporary investigation interface.

Two horizontal timelines appear:

```text
YESTERDAY

[ ? ] → [ ? ] → [ ? ]

TODAY

[ ? ] → [ ? ] → [ ? ]
```

The player drags discovered clues into the correct timeline.

But clues that only depend on memory are unreliable.

Environmental/contextual evidence is stronger.

---

## Reveal

The player successfully reconstructs both days.

Oren says:

> I knew both routes. That's what made it worse. Every time I tried to remember today's route, yesterday kept getting in the way.

Sera later names the phenomenon.

### PROACTIVE INTERFERENCE

Older information interferes with newer information.

### RETROACTIVE INTERFERENCE

Newer information interferes with older information.

---

# 13. GAMEPLAY ABILITY UNLOCKED

### RECALL

Certain environmental puzzles contain overlapping sequences.

The player can inspect contextual cues and separate them.

Example:

A dungeon door requires a four-rune sequence.

Two sequences have been shown recently.

The player cannot simply brute-force the most recent symbols.

They must use context to identify which sequence belongs to the door.

---

# 14. MECHANIC THREE: SOCIAL PRESSURE

### Psychological foundation

Conformity.

### Game abstraction

NPC behavior changes depending on:

* group consensus
* public versus private decisions
* presence of dissent
* perceived expertise

The player learns that group behavior can influence individual judgment.

---

# 15. QUEST THREE: THE LANTERN TRIAL

The Festival of Lanterns begins.

Villagers participate in a traditional game.

Three lanterns produce different tones when struck.

Players must identify which lantern matches a reference tone.

The first comparison is easy.

Then something strange happens.

A confident villager named **Tavi** loudly announces the wrong answer.

Several villagers agree.

Other villagers begin changing their answers.

---

# 16. THE CONFORMITY GAMEPLAY

The player participates in several rounds.

The environment manipulates social conditions.

### Round 1

Player answers privately.

Most people answer correctly.

### Round 2

Tavi answers first.

Everyone answers publicly.

Several NPCs follow Tavi even when he is obviously wrong.

### Round 3

Player is asked publicly after the group responds.

This creates pressure on the player.

The game does not punish the player for conforming.

Instead, it lets them experience the tension.

### Round 4

One NPC, **Nia**, publicly disagrees with Tavi.

Suddenly several others feel comfortable giving different answers.

---

# 17. THE PLAYER'S ROLE

Eventually the player discovers that some participants are not changing their perception.

They simply don't want to stand out.

Others genuinely assume:

> If everyone else thinks I am wrong, maybe they know something I don't.

The game therefore introduces both:

* normative social influence
* informational social influence

without requiring those distinctions to become the central AP vocabulary lesson yet.

---

# 18. NAMING MOMENT

Sera explains:

> People often adjust their judgments or behavior to match a group, especially when the group is unanimous.

The game displays:

**CONFORMITY**

Then:

**The tendency to adjust behavior or judgment to align with a group.**

---

# 19. GAMEPLAY ABILITY UNLOCKED

### DISSENT

The player can disrupt certain group-based behaviors by creating an alternative signal.

For example:

A group of Echo creatures copies whichever creature stands at the front.

The player can manipulate one creature into breaking formation.

The others become less synchronized.

Again, this isn't magic.

The player's ability represents understanding a system.

---

# 20. WHY THESE THREE CONCEPTS WORK TOGETHER

They produce very different kinds of gameplay.

### Conditioning

Cause and association.

### Memory interference

Information and context.

### Conformity

Social systems.

This demonstrates that the platform can translate very different psychological ideas into mechanics.

That is important for the POC.

---

# 21. MAIN CHARACTER CAST

The vertical slice should keep the cast small enough that the player remembers everyone.

---

# 22. THE PLAYER

Customizable:

* name
* skin tone
* hair
* clothing color

No predefined personality.

The player is a newcomer invited to help Sera investigate unusual events around the valley.

The protagonist should mostly speak through brief dialogue choices.

Avoid giant branching dialogue trees.

Choices exist mainly to make conversations feel participatory.

---

# 23. SERA

### Role

Researcher / mentor / mystery anchor.

### Age

Late 20s to early 30s.

### Personality

* curious
* slightly chaotic
* observant
* playful
* never condescending
* genuinely fascinated by human behavior

### Visual identity

Messy hair.

Field notebook.

Oversized coat.

Small satchel filled with strange instruments.

### Function

Sera connects the quests.

She should rarely tell the player what something means before the player has experienced it.

Her narrative pattern is:

> Interesting. What did you notice?

rather than:

> Let me teach you about classical conditioning.

---

# 24. MIRA

### Role

Innkeeper.

### Personality

Warm.

Practical.

Knows everyone in town.

Occasionally sarcastic.

### Narrative function

Introduces town culture.

Owner of Pip.

Gives the first psychology quest.

---

# 25. PIP

Mira's cat.

Should become a small recurring mascot.

Pip can appear around town after Quest One.

The player should occasionally see him respond normally to bells afterward.

That provides environmental reinforcement of the completed story.

---

# 26. OREN

### Role

Courier.

### Personality

Fast-talking.

Organized.

Slight perfectionist.

### Narrative function

Memory quest.

Should feel embarrassed by his confusion, making the quest emotionally grounded instead of purely mechanical.

---

# 27. TAVI

### Role

Popular festival participant.

### Personality

Confident.

Charismatic.

Competitive.

Not evil.

### Narrative function

Creates the group consensus that drives the conformity quest.

Importantly, he should not knowingly manipulate everyone.

He is simply extremely confident.

---

# 28. NIA

### Role

Quiet town resident.

### Personality

Thoughtful.

Observant.

Initially hesitant to speak publicly.

### Narrative function

Becomes the dissenter who breaks unanimity during the conformity sequence.

She can later become an important recurring character in the full game.

---

# 29. MAYOR ELIA

### Role

Festival organizer.

### Personality

Energetic.

Slightly overwhelmed.

### Function

Provides comedy and town flavor.

Moves the festival sequence forward.

Does not carry educational exposition.

---

# 30. COMPANION CHARACTER: MOTE

Shortly after meeting Sera, the player discovers a tiny glowing creature called **Mote**.

Mote appears to be connected to the Echo.

Mote follows the player.

### Purpose

Mote provides:

* reactions
* comedy
* visual guidance
* contextual animation
* occasional hints

Mote should not constantly talk.

Think expressive companion rather than tutorial narrator.

When something psychologically unusual occurs, Mote may:

* tilt its head
* glow
* mimic a behavior
* point toward a clue

This creates guidance without exposition.

---

# 31. OVERARCHING STORY OF THE SLICE

The story begins with three incidents that initially appear unrelated.

A cat fears a harmless bell.

A courier cannot separate two memories.

A group of villagers begins copying one another.

Sera becomes suspicious.

All three incidents intensified after strange lights appeared beneath the valley.

She believes the source is somewhere in the old Echo Shrine.

The three quests therefore serve two functions:

### Educational

Teach the player three systems.

### Narrative

Give the player three tools needed to enter the dungeon.

After completing all three quests, the path to the Echo Shrine opens.

---

# 32. GAME FLOW

## ACT I — ARRIVAL

Target time:

5 minutes.

Player arrives in Lumen Vale.

Short controllable arrival sequence.

Player learns:

* movement
* interaction
* basic town layout

Player meets Mira.

Town bell rings.

Pip panics.

Quest begins immediately.

---

# 33. ACT II — ASSOCIATION

Target time:

7–8 minutes.

The Lantern Inn quest.

Player:

* investigates
* discovers clues
* experiments
* helps Pip
* learns classical conditioning

Sera becomes interested.

---

# 34. ACT III — INTERFERENCE

Target time:

8–10 minutes.

Oren runs into Town Square.

Packages are missing.

Player investigates Courier Row.

Uses Memory Threads.

Reconstructs delivery sequence.

Learns memory interference.

---

# 35. ACT IV — FESTIVAL

Target time:

7–10 minutes.

Festival begins.

Music.

NPCs gather.

Player participates in Lantern Trial.

Experiences conformity.

Nia breaks unanimity.

Player learns Social Pressure/Dissent mechanic.

---

# 36. ACT V — WHISPER WOODS

Target time:

3–5 minutes.

Sera discovers that the three disturbances correspond with activity beneath the valley.

South Gate opens.

Player crosses Whisper Woods.

Combat increases.

There is little dialogue.

This section gives the player a psychological break from learning and lets them simply play.

---

# 37. ACT VI — ECHO SHRINE

Target time:

12–15 minutes.

The player reaches the dungeon.

No new psychology concepts are introduced.

The dungeon only asks:

> Can you use what you already learned?

This is the game's most important design principle.

---

# 38. ECHO SHRINE STRUCTURE

Approximately seven rooms.

```text
Entrance
   |
Association Room
   |
Combat Room
   |
Memory Room
   |
Conformity Room
   |
Combination Room
   |
Boss Chamber
```

---

# 39. ROOM ONE — ASSOCIATION

A creature repeatedly follows glowing moths.

The creature is too heavy for the player to move.

A pressure plate opens the next door.

Player must:

1. observe creature
2. observe moth
3. release moth near plate
4. creature follows
5. plate activates

No mention of classical conditioning.

The player transfers the concept to a completely new context.

---

# 40. ROOM TWO — COMBAT

Simple action encounter.

Purpose:

Pacing.

No educational mechanic.

This is important.

Not every room should be a lesson.

---

# 41. ROOM THREE — MEMORY

A sequence of symbols appears.

Later, another similar sequence appears.

The player reaches two doors.

Each door corresponds to a different environmental context.

Player must use contextual clues to reconstruct which sequence belongs where.

This uses the same principle as Oren's delivery problem but looks nothing like it.

---

# 42. ROOM FOUR — CONFORMITY

Several statues rotate to face whichever statue is designated leader.

The player needs different statues facing different directions.

Attacking or moving the leader changes everyone.

Solution:

Create a dissenter.

One statue can be isolated from the group.

Once it stops copying the leader, others become independently manipulable.

The conformity concept has become a spatial puzzle.

---

# 43. ROOM FIVE — COMBINATION PUZZLE

This room uses all three mechanics.

Example:

A group of creatures follows a leader.

The leader follows a learned sound cue.

Two sound patterns overlap.

Player must:

1. identify the correct sequence using memory/context
2. trigger the correct learned association
3. make the leader move
4. cause a follower to break formation
5. use resulting positions to activate multiple switches

This is the first true demonstration of the platform thesis:

Psychological ideas can combine into gameplay systems.

---

# 44. BOSS: THE ECHO

The Echo should not simply be a monster with lots of health.

It should be a multi-stage systemic encounter.

Visually:

A shifting shadow creature mimicking people and objects encountered during the slice.

---

# 45. BOSS PHASE ONE — CONDITIONING

The Echo learns the player's attack pattern.

Repeatedly using the same approach causes it to anticipate and counter the player.

The player must deliberately manipulate what the Echo expects.

---

# 46. BOSS PHASE TWO — INTERFERENCE

The arena presents multiple overlapping attack indicators.

Some come from previous patterns.

Some represent the current attack.

Environmental context reveals which information is relevant.

---

# 47. BOSS PHASE THREE — CONFORMITY

Several smaller Echoes copy the central Echo.

Trying to fight the group directly is difficult.

The player disrupts one follower.

Once unanimity breaks, the formation collapses.

The boss becomes vulnerable.

---

# 48. ENDING

The Echo retreats deeper underground rather than being destroyed.

Sera arrives.

She realizes:

> Whatever is happening beneath Lumen Vale isn't creating random chaos.

It is amplifying patterns that already exist in minds.

The player looks over a larger valley visible beyond the town.

Distant areas flicker with strange light.

Fade out.

Title:

# PROJECT PSYCHE

Then:

**End of Prototype**

---

# 49. OPTIONAL CONTENT

The critical path should take approximately 35 minutes.

Exploratory players should find another 10–15 minutes of optional material.

Examples:

### Pip sightings

Find Pip hiding around town.

### NPC conversations

Villagers react differently after each quest.

### Hidden chest in Whisper Woods

Basic cosmetic reward.

### Sera's bookshelf

Short optional entries explaining discovered concepts.

### Festival minigames

One extremely simple timing game.

Educational content is not required for these.

The world needs activities that exist simply because they are fun.

---

# 50. PROGRESSION

The vertical slice contains four layers of progression.

## Equipment

Basic weapon.

## Knowledge abilities

* Observe
* Link
* Recall
* Dissent

## Narrative progression

Three town mysteries → Echo Shrine.

## World progression

New routes unlock as quests finish.

This creates a Zelda-like feeling of gaining access to previously inaccessible possibilities.

---

# 51. EDUCATIONAL INFORMATION PRESENTATION

Terminology should appear only after experiential understanding.

Each concept unlock produces a small **Insight Card**.

Example:

### CLASSICAL CONDITIONING

When one stimulus repeatedly predicts another, the first stimulus can begin producing a learned response.

Then four optional terms:

* unconditioned stimulus
* unconditioned response
* conditioned stimulus
* conditioned response

The player can inspect these later from their journal.

They should never be forced to read paragraphs before returning to gameplay.

---

# 52. THE JOURNAL

The pause menu contains:

### Map

### People

### Insights

### Quests

The Insights tab gradually becomes the player's psychology notebook.

Each unlocked concept contains:

1. concept name
2. one-sentence explanation
3. illustration from the player's experience
4. formal AP vocabulary
5. discovered examples

For conditioning:

```text
CLASSICAL CONDITIONING

Pip originally feared the crashing pipes.

Because the town bell repeatedly came before the crash,
Pip eventually began fearing the bell itself.

US: loud crash
UR: fear
CS: bell
CR: fear response to bell
```

This bridges the game's intuitive experience to formal AP knowledge.

---

# 53. DIALOGUE PHILOSOPHY

Dialogue should be short.

Avoid educational monologues.

NPCs should sound like people, not teachers.

Bad:

> Classical conditioning is a type of learning in which organisms associate stimuli.

Good:

> SERA: The bell wasn't frightening him.

> PLAYER: But he was terrified of it.

> SERA: Exactly.

> SERA: So somewhere along the way, he learned what the bell meant.

Then reveal terminology.

---

# 54. VISUAL DIRECTION

## Perspective

Top-down / three-quarter pixel art.

Similar readability to classic Zelda.

## Resolution philosophy

Pixel art should be modern enough to support expressive characters but constrained enough for procedural asset production later.

Suggested character size:

Approximately 32×48 or 32×32 effective sprite footprint.

## Color philosophy

Warm town.

Rich greens.

Amber windows.

Soft sunset oranges.

Dungeon introduces:

* dark blues
* violet light
* strange luminous accents

The transition should make the Echo Shrine feel distinctly alien compared with town.

---

# 55. CHARACTER ART

NPCs must be visually recognizable from silhouette and color.

Each important NPC gets:

* idle
* walk
* talking gesture
* surprised reaction
* happy reaction

Avoid huge animation sets for prototype.

---

# 56. WORLD ART

Required outdoor assets:

* grass
* dirt
* stone paths
* wooden fences
* river
* bridge
* trees
* bushes
* flowers
* houses
* bell tower
* signs
* festival decorations
* lanterns

Required interior assets:

* tables
* beds
* shelves
* fireplace
* books
* packages
* laboratory objects
* kitchen objects

Dungeon:

* stone walls
* glowing runes
* pressure plates
* movable objects
* statues
* gates
* moths
* Echo creatures

---

# 57. MUSIC

The prototype needs approximately five tracks.

### Lumen Vale

Warm acoustic town theme.

### Lantern Inn

Soft indoor variation.

### Festival

Energetic folk arrangement.

### Whisper Woods

Adventure/exploration.

### Echo Shrine

Atmospheric, strange, slightly unsettling.

Boss can intensify the dungeon track instead of requiring a sixth composition.

---

# 58. SOUND DESIGN

Sound is particularly important because conditioning and the Lantern Trial depend on audio cues.

Important sounds:

* town bell
* pipe crash
* small bell
* cat reaction
* footsteps
* lantern tones
* UI insight sound
* Echo hum
* sword
* enemy hit
* pressure plate
* dungeon door

The town bell should become one of the game's recognizable motifs.

---

# 59. THE STARDew INFLUENCE

The prototype should **not implement farming**.

That would waste enormous development effort while proving almost nothing about our core thesis.

Instead, take from Stardew:

* warm atmosphere
* town geography
* charming characters
* routines
* interiors
* festivals
* environmental storytelling
* recurring NPC relationships
* a place players enjoy inhabiting

Farming can become a later system if justified.

---

# 60. THE ZELDA INFLUENCE

From Zelda, prioritize:

* immediate movement
* satisfying interaction
* map readability
* world secrets
* dungeon pacing
* gained abilities
* ability reuse
* escalating puzzles
* a final synthesis encounter

The most important Zelda principle for Project Psyche is:

> Teach the player a mechanic safely, then ask them to apply it in increasingly complex situations.

This aligns almost perfectly with our learning goals.

---

# 61. WHAT IS AUTHORED VS GENERATED

For the POC, the **game structure should be authored**.

We should not attempt to procedurally generate the entire experience yet.

Authored:

* map
* characters
* critical quest structure
* three psychological concepts
* puzzle designs
* dungeon
* final boss
* canonical educational content

Potentially LLM-generated:

* flavor dialogue
* alternate NPC lines
* minor character reactions
* optional journal prose
* incidental environmental text

Why?

Because first we need to prove:

> This style of game works.

Only after the recipe works should we ask a model to reproduce it.

---

# 62. PROCEDURAL-GENERATION HOOKS

Even though this slice is authored, every educational quest should conceptually have the same structure.

```text
CONCEPT
↓
PHENOMENON
↓
REAL-WORLD SCENARIO
↓
PLAYER OBSERVATION
↓
PLAYER PREDICTION
↓
PLAYER ACTION
↓
CONSEQUENCE
↓
CONCEPT REVEAL
↓
TRANSFER PUZZLE
```

For conditioning:

```text
CLASSICAL CONDITIONING
↓
Learned association
↓
Pip fears bell
↓
Player observes pattern
↓
Player experiments
↓
Safe bell exposure
↓
Pip stops fleeing
↓
Concept receives name
↓
Dungeon creature association puzzle
```

This becomes the template the future generation engine will need to reproduce.

---

# 63. CONTENT DATA MODEL

Each psychology concept should eventually exist as a structured game object.

Conceptually:

```text
Concept
    Name
    AP Unit
    Definition
    Prerequisites
    Common misconceptions
    Real-world examples
    Gameplay representations
    Narrative representations
    Transfer scenarios
    Formal vocabulary
```

The vertical slice gives us three populated examples.

That becomes our seed dataset for future procedural generation.

---

# 64. CUTSCENE PHILOSOPHY

Cutscenes should be used sparingly.

Good uses:

* important historical experiments
* major character moments
* chapter transitions
* dramatic psychological phenomena

Bad uses:

* explaining definitions
* replacing gameplay
* showing something the player could experience themselves

The three vertical-slice concepts therefore do not require major cutscenes.

When we eventually build something like the Stanford Prison Experiment, it can receive a dedicated interactive historical sequence.

---

# 65. GAMEPLAY RHYTHM

The prototype should alternate activities frequently.

Target rhythm:

```text
Explore
↓
Talk
↓
Observe
↓
Puzzle
↓
Discover
↓
Move
↓
Combat
↓
Story
↓
Puzzle
```

Never allow:

10 minutes of dialogue.

Never allow:

10 minutes of uninterrupted educational explanation.

Never allow:

20 consecutive identical combat encounters.

---

# 66. HINT SYSTEM

If the player becomes stuck, Mote gradually provides hints.

Example conditioning puzzle:

### Hint 1

Mote looks repeatedly between the creature and moth.

### Hint 2

Mote follows the moth's movement.

### Hint 3

A thought bubble shows the moth near the pressure plate.

The game should prefer visual hints over textual explanations.

---

# 67. FAILURE

Failure should be lightweight.

Combat:

Player respawns near room entrance.

Puzzle:

Immediately reset.

Dialogue:

No permanently incorrect choice.

The game should encourage experimentation.

Especially when teaching psychology, players should feel safe forming hypotheses and being wrong.

---

# 68. SAVE STRUCTURE

For the prototype:

Autosave after:

* arrival
* each concept quest
* entering dungeon
* boss

No complex manual save system required.

---

# 69. VERTICAL SLICE CONTENT BUDGET

We should deliberately constrain the project.

### Outdoor maps

3:

* Lumen Vale
* Whisper Woods
* Echo Shrine exterior

### Major interiors

4:

* Lantern Inn
* Sera's Workshop
* Courier Office
* Echo Shrine

### Named characters

7–8.

### Core psychological concepts

3.

### Regular enemy types

3.

### Boss

1.

### Major quests

3.

### Dungeon

1.

### Total intended runtime

30–45 minutes.

That is enough to demonstrate the vision.

---

# 70. WHAT WE ARE NOT BUILDING YET

For the first POC:

No farming system.

No romance.

No complex relationship meters.

No crafting.

No large inventory.

No skill trees.

No character classes.

No procedural maps.

No full AP Psychology curriculum.

No multiplayer.

No voice acting.

No open-world generation.

No full day/calendar simulation.

No dozens of NPCs.

No dynamically generated major quests.

These are expansion opportunities, not vertical-slice requirements.

---

# 71. WHAT THE POC MUST PROVE

The prototype exists to answer five product questions.

### 1.

Can psychology become an actual gameplay mechanic?

### 2.

Can players learn a concept without the experience feeling like a lesson?

### 3.

Can the same concept appear in both narrative and Zelda-style puzzles?

### 4.

Can several psychology mechanics combine into more complex gameplay?

### 5.

Does this world feel strong enough that players want to continue after the educational content ends?

If those work, scaling to more psychology concepts becomes worthwhile.

---

# 72. BUILD ORDER

The game should be developed in this order.

## Phase 1 — Movement Playground

Build:

* player movement
* collision
* interaction
* camera
* basic combat
* one enemy

No story.

We need the game to feel good to move around.

---

## Phase 2 — Lumen Vale

Build the entire outdoor town.

Add placeholder interiors.

Add NPC walking.

Add music.

The player should be able to walk from the inn to the festival plaza to the woods.

---

## Phase 3 — Quest One

Fully implement the Pip/classical-conditioning quest.

This becomes our first complete test of the product formula.

Do not build all three quests simultaneously.

---

## Phase 4 — Quest Two

Implement memory investigation.

Build Memory Thread interface.

---

## Phase 5 — Quest Three

Implement Festival of Lanterns.

Create public/private answer states.

Implement NPC consensus behavior.

---

## Phase 6 — Dungeon

Build the Echo Shrine using existing mechanics.

No new conceptual systems should be required.

---

## Phase 7 — Boss

Combine all three systems.

---

## Phase 8 — Polish

Only after the critical path works:

* animation
* particles
* lighting
* sound
* dialogue cleanup
* environmental details
* secrets
* transitions
* UI polish

---

# 73. DEVELOPMENT RULE FOR THE GAUNTLET

The coding agents should not be allowed to redesign the game while implementing it.

This document is the design source of truth.

Agents may improve:

* implementation
* animation
* visual polish
* code architecture
* performance
* bug fixes

Agents should not independently change:

* characters
* psychological concepts
* quest order
* core map topology
* dungeon structure
* player abilities
* story premise

Those changes require explicit design revision.

Otherwise the gauntlet will gradually turn one coherent game into several competing designs.

---

# 74. GOLDEN PATH

The full first-play experience should approximately look like:

```text
ARRIVE IN LUMEN VALE
        ↓
MEET MIRA
        ↓
BELL RINGS
        ↓
PIP PANICS
        ↓
INVESTIGATE
        ↓
DISCOVER CONDITIONING
        ↓
UNLOCK LINK
        ↓
OREN'S DELIVERY PROBLEM
        ↓
RECONSTRUCT MEMORIES
        ↓
DISCOVER INTERFERENCE
        ↓
UNLOCK RECALL
        ↓
FESTIVAL BEGINS
        ↓
LANTERN TRIAL
        ↓
EXPERIENCE GROUP PRESSURE
        ↓
DISCOVER CONFORMITY
        ↓
UNLOCK DISSENT
        ↓
SERA LOCATES ECHO SOURCE
        ↓
WHISPER WOODS
        ↓
ECHO SHRINE
        ↓
TRANSFER PUZZLES
        ↓
COMBINATION PUZZLE
        ↓
THE ECHO BOSS
        ↓
LARGER MYSTERY REVEALED
```

That is the complete first vertical slice.

---

# 75. THE FEELING WE WANT AT THE END

The player should not finish thinking:

> I just studied three AP Psychology concepts.

They should finish thinking:

> That was fun.

Then:

> Wait—I actually understand why the cat reacted to the bell.

Then when someone later asks:

> What's classical conditioning?

the player remembers **Pip**.

When asked about interference, they remember **Oren's routes**.

When asked about conformity, they remember standing onstage while the entire town confidently gave the wrong answer.

That is the product.

The game creates memories first.

The terminology attaches to those memories afterward.

And the long-term platform thesis is that we can eventually generate those memorable experiences automatically from structured learning objectives.

