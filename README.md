# Project Psyche

A cozy top-down pixel-art action-adventure in which three AP Psychology concepts are
**gameplay systems**, not quiz questions. Built with Phaser 3, TypeScript and Vite.

The design rule the whole project is measured against:

> If the psychology terminology were removed, the game should still be fun.
> The important psychology mechanics should require understanding the underlying
> pattern, not answering disguised quiz questions.

`plan.md` is the design source of truth. `project_psyche_reference_pack/` holds the
quality bar (Stardew Valley for warmth and density, A Link to the Past for readability
and dungeon composition). No reference asset ships in the game.

---

## Running it

```bash
export PATH=$HOME/.local/opt/node22/bin:$PATH   # Node 20+ required

npm install
npm run art        # generate all art into public/assets
npm run dev        # http://127.0.0.1:5178
```

`npm run build` runs the art pipeline and then bundles for production.

### Controls

| | |
|---|---|
| WASD / arrows | move |
| SPACE / E | interact, advance dialogue |
| J | attack |
| SHIFT | dash (i-frames) |
| Q | Observe |
| TAB | journal |
| ESC | back |

---

## Everything is generated

There are no image files, font files or audio files in this repository. Every pixel and
every sound is produced by code:

- **Art** — `tools/art/` writes `public/assets/{tiles,atlas,art}.{png,json}` plus 4×
  inspection sheets in `art_preview/`. `lib/pixel.ts` is the drawing API,
  `lib/palette.ts` is the single source of colour, `lib/autotile.ts` does blob
  autotiling, and one module per domain lives in `assets/`.
- **Audio** — `src/audio/` synthesises all music and sound effects with the Web Audio
  API at runtime. The hand bell can quote the town bell's motif exactly, because both
  are note data — which is what makes the conditioning quest work.
- **Fonts** — two original bitmap fonts, defined as glyph data and packed at build time.

This keeps every asset original and makes the whole look tunable from one palette.

---

## Layout

```
plan.md                     design source of truth
docs/ART_GUIDE.md           the contract every art module follows
docs/workbench.html         live progress page (npm run workbench)

src/core/       config, grid collision, input, global state/flags/quests, events
src/world/      map format, GridPainter, autotiled world builder, map + area registry
src/world/maps/     one file per map — self-registering, discovered by glob
src/world/areas/    one file per map's logic — cutscenes, quests, interactions
src/entities/   player, NPCs, enemies, Pip, Mote, the Echo
src/systems/    puzzles, abilities, combat, lighting, VFX, cutscenes, game flow
src/ui/         dialogue, journal, HUD, insight cards, quest interfaces
src/data/       the cast, the three concepts as structured data, all dialogue
src/scenes/     Boot, Preload, Title, World, UI

tools/art/      the art pipeline
tools/shot.ts   screenshot harness — boots the real game and drives it
tools/playthrough.ts   whole-game pass over the golden path
tools/mapsmoke.ts      loads every map, reports missing sprites and fps
```

### Adding a map

Create `src/world/maps/<id>.ts` and call `registerMap('<id>', build)`. Add
`src/world/areas/<id>.ts` calling `registerArea('<id>', {...})` for its logic. Both are
discovered automatically — there is no import list to maintain.

Maps are authored as parallel character grids (ground / objects / above) with a legend,
usually painted via `GridPainter`. If the object grid is mostly spaces, the map will
look empty in game.

---

## The three mechanics

| Concept | Quest | Ability | Transfer |
|---|---|---|---|
| Classical conditioning | Pip fears a bell that has never hurt him | **LINK** — bait a creature with a cue it has learned | a shrine creature that follows glowing moths |
| Memory interference | Oren's two delivery routes have merged | **RECALL** — read context to separate what memory can't | two rune sequences, two doors, one damp room |
| Conformity | The Lantern Trial, and a town that agrees | **DISSENT** — break a group's unanimity | statues that copy whichever one leads |

Terminology appears only *after* the player has already solved the thing, on an Insight
Card. The formal AP vocabulary lives in the journal and is never required to progress.

---

## Testing and review

```bash
npm run shot           # the standard review screenshot set → shots/
npm run mapsmoke       # every registered map: missing sprites, NPCs, fps
npm run playthrough    # the whole golden path, with assertions
npm run workbench      # rebuild the live progress page
npm run typecheck
```

Screenshots are compared directly against `project_psyche_reference_pack/`. Nothing is
reviewed from source — if a change is meant to be visible, it gets captured and looked at.

---

## Development notes

- `window.__psyche` is the debug API: `jump(checkpoint)`, `goto(map)`, `teleport(x,y)`,
  `setFlag`, `grant`, `state()`, plus scripted input. Named checkpoints cover the whole
  golden path, so any beat is reachable from a fresh page load.
- URL parameters: `?skiptitle=1`, `?map=<id>`, `?spawn=<id>`, `?mute=1`.
- Every gate in the game is a flag. Nothing is gated on scene-local state, which is what
  makes the checkpoint system and the automated playthrough possible.
