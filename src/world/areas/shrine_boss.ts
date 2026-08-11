/**
 * THE BOSS CHAMBER — encounter wiring and the end of the prototype.
 *
 * The fight itself lives in `entities/EchoBoss.ts`. This file owns everything
 * around it:
 *
 *   · waking it when the player walks into the basin (plan.md §44)
 *   · restoring the CURRENT PHASE on death, so failure costs you a room and not
 *     a dungeon (§67) — the player never re-walks the shrine to try again
 *   · the hint escalation, which only ever fires for a player who has been
 *     stuck a long time (§66), and which describes what the Echo is doing
 *     rather than what the player should do
 *   · the ending (§48): the Echo goes down rather than dying, Sera arrives, and
 *     the camera leaves the shrine for a valley with far too many lights in it
 *
 * Every player-visible word comes from `src/data/dialogue/shrine.ts`. Nothing in
 * this encounter names a psychological concept — the dungeon only ever asks
 * whether you can use what you already worked out (§37).
 */
import Phaser from 'phaser';
import { COLORS, DEPTH, GAME_H, GAME_W, TILE } from '@/core/config';
import { emit, on } from '@/core/events';
import { State } from '@/core/state';
import { Audio } from '@/audio/Audio';
import { hasFrame } from '@/core/textures';
import { makeText, type TextHandle } from '@/ui/text';
import { TALK, playExchange, type CutsceneLike } from '@/data/dialogue';
import { EchoBoss, type Phase } from '@/entities/EchoBoss';
import { registerArea } from '../registry';
import { CHAMBER, RUNE_TILES } from '../maps/shrine_boss';
import type { WorldScene } from '@/scenes/WorldScene';
import type { CutsceneContext } from '@/systems/Cutscene';

interface Chamber {
  boss: EchoBoss;
  /** The phase to come back to after a death. */
  checkpointPhase: Phase;
  started: boolean;
  ended: boolean;
  /** Hint lines already used, so a struggling player is never nagged twice. */
  hinted: Set<Phase>;
  overlay?: Phaser.GameObjects.Container;
  unsubscribe: Array<() => void>;
}

let room: Chamber | null = null;

// ─────────────────────────────────────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────────────────────────────────────

function onEnter(w: WorldScene): void {
  teardown();

  const boss = new EchoBoss(w, {
    arena: CHAMBER.arena,
    home: CHAMBER.home,
    grate: CHAMBER.grate,
    braziers: CHAMBER.braziers,
    runeTiles: RUNE_TILES,
    onPhase: (p) => { if (room) room.checkpointPhase = p; },
    onDefeated: () => { void ending(w); },
    onStuck: (p) => hint(w, p),
  });

  room = {
    boss,
    checkpointPhase: 1,
    started: false,
    ended: false,
    hinted: new Set(),
    unsubscribe: [],
  };

  // Phase one reads whether the player dashed in before swinging, so the boss
  // has to see the dash itself rather than infer it from velocity.
  room.unsubscribe.push(on('player:dash', (p: { x: number; y: number; dir: 'n' | 's' | 'e' | 'w' }) => {
    room?.boss.noteDash(p.x, p.y, p.dir);
  }));

  // GameFlow (§67) has already put the player back at the door with half
  // health. All we owe it is the fight, restarted at the phase they were in.
  room.unsubscribe.push(on('room:reset', (p: { map: string }) => {
    if (p.map !== 'shrine_boss' || !room || room.ended) return;
    room.boss.restartPhase();
    // Keep the fight paused for a moment so the player is not walking into a
    // slam the instant the screen comes back.
    w.time.delayedCall(200, () => emit('ui:toast', { text: `The Echo is still here.` }));
  }));

  // Tally the events that only happen to one kind of player. This is the
  // evidence the playtest uses to say *why* one bot was faster, rather than
  // just that it was.
  const tally = { blocked: 0, punished: 0, deflected: 0, broken: 0, learned: 0, waves: 0 };
  const count = (event: string, key: keyof typeof tally) =>
    room!.unsubscribe.push(on(event, () => { tally[key]++; }));
  count('boss:blocked', 'blocked');
  count('boss:punished', 'punished');
  count('boss:deflected', 'deflected');
  count('boss:unanimity_broken', 'broken');
  count('boss:learned', 'learned');
  count('boss:wave', 'waves');

  installQaHook(w, tally);

  // Entering the chamber is an autosave point (§68). The flag is picked up by
  // GameFlow's autosave list.
  State.set('shrine_boss_entered');
}

function onExit(): void {
  teardown();
}

function teardown(): void {
  if (!room) return;
  room.unsubscribe.forEach((u) => u());
  room.boss.destroy();
  room.overlay?.destroy();
  room = null;
  delete (window as unknown as { __boss?: unknown }).__boss;
  delete (window as unknown as { __psycheVista?: boolean }).__psycheVista;
}

function onUpdate(w: WorldScene, dt: number): void {
  if (!room) return;
  // The encounter does not run under a cutscene: no telegraph should ever land
  // while the player cannot move.
  if (w.cutscene.active) return;
  room.boss.update(dt, w.player);
}

function onTrigger(w: WorldScene, id: string): boolean {
  if (id !== 'boss_wake' || !room || room.started) return false;
  room.started = true;
  void intro(w);
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Opening
// ─────────────────────────────────────────────────────────────────────────────

/**
 * It is already here. It tries on shapes it has collected — the player's, then
 * Mira's — and repeats sentences it heard other people say, badly, and then
 * less badly. The player is watching something rehearse.
 */
async function intro(w: WorldScene): Promise<void> {
  if (!room) return;
  const boss = room.boss;
  await w.cutscene.run(async (c) => {
    await c.panTo(CHAMBER.grate.x / TILE, (CHAMBER.grate.y - 24) / TILE, 700);
    await playExchange(c, TALK.boss.intro, {
      cue: async (name) => {
        if (name !== 'boss_wake') return;
        boss.wake();
        w.lighting.setDarkness(0.72, 900);
        Audio.duckMusic(0.5, 1200);
        await c.wait(1500);
      },
    });
    c.followPlayer(600);
    await c.wait(600);
  });
  boss.beginPhase(1);
}

/**
 * plan.md §66. Fires at most once per phase and only after a long time with no
 * progress at all. Each line describes what the Echo is doing — it never tells
 * the player what to press, and it never uses a word from a textbook.
 */
function hint(w: WorldScene, phase: Phase): void {
  if (!room || room.hinted.has(phase) || room.ended) return;
  room.hinted.add(phase);
  const ex = phase === 1 ? TALK.boss.phase1 : phase === 2 ? TALK.boss.phase2 : TALK.boss.phase3;
  void w.cutscene.run((c) => playExchange(c, ex));
}

// ─────────────────────────────────────────────────────────────────────────────
// Ending — plan.md §48
// ─────────────────────────────────────────────────────────────────────────────

async function ending(w: WorldScene): Promise<void> {
  if (!room || room.ended) return;
  room.ended = true;
  State.set('boss_beaten');

  await w.cutscene.run(async (c) => {
    await c.wait(600);
    await playExchange(c, TALK.boss.defeat, {
      cue: async (name) => {
        if (name !== 'boss_collapse') return;
        w.lighting.setDarkness(0.8, 1400);
        w.shake(0.004, 900);
        await c.wait(700);
      },
    });
  });

  await w.cutscene.run(async (c) => {
    // The title card is the last frame of the prototype; it deserves better
    // than the transient location banner, so the banner beat is intercepted.
    const shim: CutsceneLike = {
      say: (s, t, o) => c.say(s, t, o),
      choose: (p, ch) => c.choose(p, ch),
      wait: (ms) => c.wait(ms),
      insight: (id) => c.insight(id),
      banner: (title, subtitle) => { void titleCard(w, title, subtitle); },
    };
    await playExchange(shim, TALK.ending.scene, {
      cue: (name) => endingCue(w, c, name),
    });
    // Hold on the card.
    await c.wait(5200);
  });

  emit('game:complete', {});
}

async function endingCue(w: WorldScene, c: CutsceneContext, name: string): Promise<void> {
  switch (name) {
    case 'sera_arrive': return seraArrives(w, c);
    case 'camera_rise': return riseOverValley(w, c);
    case 'fade_out': return fadeVista(w, c);
    default: return;
  }
}

/**
 * Nothing in the ending is allowed to hang.
 *
 * A cutscene await that never resolves — an NPC that cannot reach its tile,
 * a camera pan that gets interrupted — would leave the player staring at the
 * last frame of the prototype with no way out. Every wait in the sequence is
 * raced against a deadline so the scene always finishes.
 */
function noHang<T>(w: WorldScene, p: Promise<T>, ms: number): Promise<T | void> {
  return Promise.race([p, new Promise<void>((r) => w.time.delayedCall(ms, r))]);
}

/** She comes down the last stair at a run, lantern first. */
async function seraArrives(w: WorldScene, c: CutsceneContext): Promise<void> {
  const doorTile = { x: 14, y: 12 };
  w.spawnNpc({ id: 'sera', actor: 'sera', x: doorTile.x, y: doorTile.y, facing: 'n' });
  const sera = w.npc('sera');
  if (sera) {
    // A lantern is the only warm light left in the room.
    w.lighting.addPixel(sera.x, sera.y - 12, 72, COLORS.amber, 0.75, 0.5);
    Audio.sfx('door_stone', { volume: 0.4 });
  }
  await noHang(w, c.panTo(doorTile.x, doorTile.y, 500), 900);

  // Walk her to a clear tile beside the player rather than to an offset that
  // might land in a pillar or outside the floor.
  const px = Phaser.Math.Clamp(Math.round((w.player.x - TILE / 2) / TILE) + 2, 4, 25);
  const py = Phaser.Math.Clamp(Math.round((w.player.y - TILE) / TILE), 4, 12);
  await noHang(w, c.walk('sera', px, py), 3000);

  sera?.faceTowards(w.player.x, w.player.y);
  w.player.faceTowards(sera?.x ?? w.player.x + 16, sera?.y ?? w.player.y);
  c.followPlayer(400);
  await c.wait(400);
}

/**
 * Up, out of the shrine mouth, and over a valley that is much bigger than the
 * map has any business showing. Built as a screen-space overlay rather than a
 * map, because the point of the shot is that this place is not on the map.
 */
async function riseOverValley(w: WorldScene, c: CutsceneContext): Promise<void> {
  const cam = w.cameras.main;
  cam.stopFollow();
  cam.pan(CHAMBER.centre.x, CHAMBER.arena.y0 - 40, 1400, 'Sine.easeInOut');
  w.tweens.add({ targets: cam, zoom: 1.12, duration: 1400, ease: 'Sine.easeInOut' });
  await c.wait(1200);
  await noHang(w, c.fadeOut(900), 1400);

  // Completion is banked here rather than after the title card: `game_complete`
  // is an autosave point (§68) and its "Saved" toast would otherwise sit on top
  // of the last frame of the game. By now the fight is unambiguously over.
  State.set('shrine_done');
  State.set('game_complete');

  buildVista(w);
  cam.setZoom(1);
  await noHang(w, c.fadeIn(1), 600);
  await c.wait(900);
}

/** Three ridges, a sky, and the lights coming on beneath them one at a time. */
function buildVista(w: WorldScene): void {
  if (!room) return;
  emit('ui:setHidden', { hidden: true });
  (window as unknown as { __psycheVista?: boolean }).__psycheVista = true;

  const c = w.add.container(0, 0).setScrollFactor(0).setDepth(DEPTH.HUD - 10);
  room.overlay = c;

  // Child 0 is an opaque backdrop that never fades, so when the vista dissolves
  // the screen goes to black rather than back to the boss chamber.
  c.add(w.add.rectangle(0, 0, GAME_W, GAME_H, 0x05040a, 1).setOrigin(0, 0).setScrollFactor(0));

  const sky = w.add.graphics().setScrollFactor(0);
  // Night, graded from a cold horizon up into near-black.
  for (let i = 0; i < GAME_H; i++) {
    const t = i / GAME_H;
    const col = Phaser.Display.Color.Interpolate.ColorWithColor(
      Phaser.Display.Color.IntegerToColor(0x0a0813),
      Phaser.Display.Color.IntegerToColor(0x241d33),
      100, Math.round(Math.min(1, t * 1.5) * 100),
    );
    sky.fillStyle(Phaser.Display.Color.GetColor(col.r, col.g, col.b), 1);
    sky.fillRect(0, i, GAME_W, 1);
  }
  c.add(sky);

  // Stars, thinning toward the horizon.
  const stars = w.add.graphics().setScrollFactor(0);
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * GAME_W;
    const y = Math.random() * 104;
    stars.fillStyle(0xf6ecd4, 0.15 + Math.random() * 0.5 * (1 - y / 120));
    stars.fillRect(Math.round(x), Math.round(y), 1, 1);
  }
  c.add(stars);

  // Four ridge lines, each darker and lower than the one behind it — the whole
  // trick for reading distance in two colours. The horizon sits high so the
  // valley, and not the sky, is what the last shot of the game is about, and so
  // the figures still read above the dialogue box.
  const ridges: Array<[number, number, number]> = [
    [104, 0x342c52, 16],
    [128, 0x2b2545, 20],
    [156, 0x1d1932, 26],
    [192, 0x100d1c, 14],
  ];
  for (const [baseY, colour, amp] of ridges) {
    const g = w.add.graphics().setScrollFactor(0);
    g.fillStyle(colour, 1);
    g.beginPath();
    g.moveTo(0, GAME_H);
    for (let x = 0; x <= GAME_W; x += 6) {
      const y = baseY
        + Math.sin(x * 0.021 + baseY) * amp * 0.5
        + Math.sin(x * 0.007 + baseY * 0.3) * amp * 0.5;
      g.lineTo(x, y);
    }
    g.lineTo(GAME_W, GAME_H);
    g.closePath();
    g.fillPath();
    c.add(g);
  }

  // The lights. Two ridges over, then another, further out — and then more than
  // the player was expecting.
  const spots: Array<[number, number, number, number]> = [
    [128, 146, 26, 900],
    [322, 160, 22, 2100],
    [64, 172, 20, 3100],
    [408, 138, 18, 3900],
    [232, 126, 14, 4600],
    [360, 118, 12, 5200],
  ];
  for (const [x, y, r, delay] of spots) {
    if (!hasFrame(w, 'fx/light_soft_64')) break;
    const img = w.add.image(x, y, 'atlas', 'fx/light_soft_64')
      .setScrollFactor(0)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setScale((r * 2) / 64)
      .setTint(COLORS.echoGlow)
      .setAlpha(0);
    c.add(img);
    w.tweens.add({ targets: img, alpha: 0.85, duration: 700, delay, ease: 'Sine.easeOut' });
    w.tweens.add({
      targets: img, alpha: 0.45, duration: 900 + Math.random() * 600,
      delay: delay + 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    });
    w.time.delayedCall(delay, () => Audio.sfx('echo_hum', { volume: 0.22, rate: 0.7 + r / 60 }));
  }

  // The two of them, from behind, on the near ridge and small against it. They
  // stand above the dialogue box line (y 204) so the figures are never covered
  // by the words they are saying.
  const silhouettes: Array<[string, number, number]> = [
    ['char/player/idle_n_0', 168, 202],
    ['char/sera/idle_n_0', 190, 203],
  ];
  for (const [frame, x, y] of silhouettes) {
    if (!hasFrame(w, frame)) continue;
    const s = w.add.image(x, y, 'atlas', frame)
      .setScrollFactor(0).setOrigin(0.5, 1).setTint(0x08060f);
    c.add(s);
  }
  if (hasFrame(w, 'fx/echo_wisp_0')) {
    const mote = w.add.sprite(200, 186, 'atlas', 'fx/echo_wisp_0')
      .setScrollFactor(0).setTint(COLORS.echoCyan).setAlpha(0.95);
    if (w.anims.exists('fx_echo_wisp')) mote.play('fx_echo_wisp');
    c.add(mote);
    // Mote drifts out past them both and hangs there, facing the far lights.
    w.tweens.add({ targets: mote, x: 236, y: 158, duration: 2800, ease: 'Sine.easeOut' });
  }
}

async function fadeVista(w: WorldScene, c: CutsceneContext): Promise<void> {
  if (room?.overlay) {
    // Everything except the black backdrop at index 0.
    const fading = room.overlay.list.slice(1);
    if (fading.length) w.tweens.add({ targets: fading, alpha: 0, duration: 1400, ease: 'Sine.easeIn' });
  }
  await c.wait(1500);
}

/** PROJECT PSYCHE. Then, after a beat, what it was. */
async function titleCard(w: WorldScene, title: string, subtitle?: string): Promise<void> {
  const c = w.add.container(0, 0).setScrollFactor(0).setDepth(DEPTH.HUD + 200);
  const black = w.add.rectangle(0, 0, GAME_W, GAME_H, 0x05040a, 1).setOrigin(0, 0).setScrollFactor(0);
  c.add(black);

  const parts: TextHandle[] = [];
  const t = makeText(w, GAME_W / 2, GAME_H / 2 - 6, title, 'display', { tint: COLORS.parchment });
  t.setOrigin(0.5, 0.5);
  t.setAlpha(0);
  c.add(t.obj);
  parts.push(t);

  const rule = w.add.graphics().setScrollFactor(0).setAlpha(0);
  const half = Math.max(70, t.width / 2 + 16);
  rule.lineStyle(1, COLORS.gold, 0.9);
  rule.lineBetween(GAME_W / 2 - half, GAME_H / 2 + 8, GAME_W / 2 + half, GAME_H / 2 + 8);
  c.add(rule);

  w.tweens.add({ targets: t.obj, alpha: 1, duration: 1500, ease: 'Sine.easeOut' });
  w.tweens.add({ targets: rule, alpha: 1, duration: 1200, delay: 700 });
  Audio.sfx('insight', { volume: 0.5 });

  if (subtitle) {
    const s = makeText(w, GAME_W / 2, GAME_H / 2 + 22, subtitle, 'body', { tint: COLORS.parchmentDim });
    s.setOrigin(0.5, 0.5);
    s.setAlpha(0);
    c.add(s.obj);
    parts.push(s);
    w.tweens.add({ targets: s.obj, alpha: 1, duration: 1200, delay: 1900 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// QA surface
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `window.__boss`, used by tools/boss_shots.ts and tools/boss_playtest.ts.
 *
 * The playtest bots need to see what a player sees — which marks are live,
 * which follower is out of step — because the whole measurement is "does
 * knowing that make you faster". A bot that cannot see it cannot be informed.
 */
function installQaHook(w: WorldScene, tally: Record<string, number>): void {
  (window as unknown as { __boss: unknown }).__boss = {
    state: () => room?.boss.snapshot() ?? null,
    /** Counts of blocks, punishes, deflects and unanimity breaks so far. */
    tally: () => ({ ...tally }),
    /** Jump straight into a phase, skipping the wake cutscene. */
    phase: (p: Phase) => {
      if (!room) return;
      room.started = true;
      if (room.boss.stage === 'dormant') {
        room.boss.wake();
        w.lighting.setDarkness(0.72, 200);
      }
      room.boss.beginPhase(p);
    },
    /** Kill the current phase outright, for shot setup. */
    skip: () => {
      const s = room?.boss;
      if (!s) return;
      const next = (s.phase + 1) as Phase;
      if (next <= 3) s.beginPhase(next);
    },
    /** Run the real death + ending sequence now. */
    defeat: () => room?.boss.forceDefeat(),
    arena: CHAMBER,
    ended: () => !!room?.ended,
  };
}

registerArea('shrine_boss', { onEnter, onExit, onUpdate, onTrigger });
