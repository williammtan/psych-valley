# Project Psyche — Gauntlet Loop

  Build the complete vertical slice described in `plan.md`.

  Project Psyche is a polished top-down pixel-art action-adventure game that teaches AP Psychology through gameplay rather than quizzes. The target feel is the warmth, charm, density, and character life of **Stardew Valley** combined with the exploration, dungeon design, environmental puzzles, progression, and readability of **The Legend of Zelda: A Link to the Past**.

  The finished vertical slice should feel like the opening 30–45 minutes of a real commercial indie game, not an educational demo or AI prototype.

  ## Source of truth

  Read `plan.md` completely before starting. It defines the game, characters, world, quests, psychology mechanics, dungeon, boss, and intended player experience.

  Also inspect everything in `project_psyche_reference_pack/`. These are the concrete visual and design quality references for the project. Use them to judge world density, composition, scale, environment detail, atmosphere, dungeon readability, interiors, festival presentation, and overall polish.

  Do not copy or ship copyrighted assets from the reference games. Create original production assets that reach a comparable level of coherence and quality.

  ## Required stack

  Build the game for desktop web using:

  * **Phaser**
  * **TypeScript**
  * **Vite**

  Use Phaser for the actual game world, rendering, input, animation, camera, audio, tilemaps, collision, and gameplay.

  Do not switch engines or turn this into a React/DOM game.

  Beyond those constraints, choose the architecture and implementation approach yourself.

  ## The bar

  The game should compare favorably with the supplied Stardew Valley and Zelda references in the qualities they are being used to demonstrate.

  Do not accept "good for an AI game," "good for a prototype," or "technically complete."

  For every important visual component, capture and inspect the actual rendered game side-by-side with the relevant references.

  For gameplay, inspect and play the actual running game rather than judging code or descriptions.

  Two rules must remain true:

  1. **If the psychology terminology were removed, the game should still be fun.**
  2. **The important psychology mechanics should require understanding the underlying pattern, not answering disguised quiz ques

  ## Run this as a Gauntlet Loop

  You are the lead agent.

  Break the game into the smallest important pieces that can be built and judged independently. Decide the decomposition yoursel

  Fan out subagents aggressively.

  For every important piece, use a **builder** and a **separate fresh-context critic**.

  The critic must not be the builder and should not receive the builder's rationale or history. Give the critic only the relevanrial, and the real current artifact.

  Critics must inspect the actual output:

  * rendered screenshots
  * running gameplay
  * animations
  * puzzles
  * combat
  * UI
  * audio
  * maps
  * dialogue
  * quest flow
  * code/tests where appropriate

  When possible, have visual critics perform a blind or near-blind A/B comparison between our output and the relevant reference.

  If ours loses, the critic should identify the **largest meaningful remaining gap**.

  Send that finding back to the builder.

  Fix it.

  Then send the real result to a fresh critic again.

  Keep looping.

  Do not use a fixed number of rounds.

  ## Fan out where useful

  Use parallel subagents for independent areas such as:

  * player movement and game feel
  * Town Square / Lumen Vale composition
  * buildings and interiors
  * characters and animation
  * Pip / Link quest
  * Oren / Recall quest
  * Festival / Dissent quest
  * Whisper Woods
  * Echo Shrine
  * individual dungeon puzzles
  * combat
  * Echo boss
  * UI and journal
  * audio
  * visual effects
  * dialogue
  * QA and sequence breaking
  * performance
  * visual comparison against the reference pack

  Multiple critics may independently judge the same important artifact.

  Do not let builders grade their own work.

  For tightly coupled systems, avoid uncontrolled concurrent edits. Fan out criticism freely, then integrate changes coherently.

  ## Full-game passes

  Individual pieces being good is not enough.

  Regularly run the entire vertical slice from a fresh save.

  Check the complete golden path from arrival in Lumen Vale through all three psychology quests, Whisper Woods, Echo Shrine, the boss, and the ending.

  Look for:

  * boring stretches
  * confusing navigation
  * weak pacing
  * soft locks
  * sequence breaks
  * bad collisions
  * unclear puzzle language
  * inconsistent art
  * weak feedback
  * generic UI
  * empty environments
  * dialogue that feels educational instead of natural
  * psychology mechanics that devolve into quizzes
  * areas that feel separately built rather than part of one game

  After major waves of parallel work, spawn a fresh **smoothing agent** to inspect the whole game and resolve inconsistencies without redesigning it.

  ## Visual inspection is mandatory

  Capture screenshots throughout development from important locations and states.

  Compare them directly against the appropriate files in `project_psyche_reference_pack/`.

  If the references clearly win on composition, density, atmosphere, readability, charm, polish, or coherence, keep improving ours.

  Do not let the builder explain away the difference.

  ## Keep a live progress view

  Maintain a simple live progress page or workbench showing how the game evolves over time.

  Include useful artifacts such as:

  * current screenshots
  * before/after comparisons
  * completed areas
  * current critic findings
  * videos/GIFs where useful
  * major remaining gaps

  Keep it updated without requiring me to interrupt the run.

  ## Definition of done

  Do not stop because the game compiles or because every item in `plan.md` technically exists.

  Keep running the gauntlet until:

  * the complete vertical slice is playable end-to-end
  * movement and interaction feel excellent
  * Lumen Vale feels alive and authored
  * the characters are memorable
  * the three psychology concepts work as real gameplay mechanics
  * each concept successfully transfers into Echo Shrine
  * the combination puzzle works
  * the Echo boss feels like a real finale
  * the visuals compare strongly with the supplied references
  * the game feels cohesive rather than assembled from separate agent outputs
  * major critics are finding polish issues rather than fundamental deficiencies

  Use subagents aggressively.

  Use **ultracode**.

  Keep building, comparing, criticizing, fixing, and repeating until our game reaches the bar or I stop the run.
