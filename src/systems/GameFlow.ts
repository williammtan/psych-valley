/**
 * Death, respawn and autosave.
 *
 * The plan's failure rule (§67) is that failure must be lightweight: combat
 * sends you back to the room entrance, puzzles reset immediately, and nothing
 * is ever permanently lost. So "death" here is a short beat, not a screen —
 * fade, restore, back on your feet near where you were, with the room reset.
 *
 * Autosave points come from §68: arrival, each concept quest, entering the
 * dungeon, and the boss.
 */
import { State } from '@/core/state';
import { emit, on } from '@/core/events';
import { PLAYER, TILE } from '@/core/config';
import { Audio } from '@/audio/Audio';
import type { WorldScene } from '@/scenes/WorldScene';

/** Where the player reappears after going down, per map. */
const RESPAWN_SPAWN = 'respawn';

const AUTOSAVE_FLAGS = [
  'intro_done',
  'q1_complete',
  'q2_complete',
  'q3_complete',
  'shrine_entered',
  'shrine_r5_done',
  'game_complete',
];

export class GameFlow {
  private downing = false;
  /** Position to return to if the player goes down — the last safe doorway. */
  private checkpoint: { map: string; x: number; y: number } | null = null;

  constructor(private scene: WorldScene) {
    on('player:down', () => this.handleDown());
    on('flag', (p: { flag: string; value: boolean }) => {
      if (!p.value) return;
      if (AUTOSAVE_FLAGS.includes(p.flag)) this.autosave();
      // Observe is the player's own attentiveness rather than a granted power,
      // so it comes on as soon as the arrival sequence hands over control. Quest
      // scripts may grant it earlier; this is the backstop that guarantees the
      // ability is never orphaned.
      if (p.flag === 'intro_done') State.grant('observe');
    });
    on('map:entered', () => {
      // Entering a map is always a safe point to fall back to.
      this.checkpoint = null;
      this.downing = false;
    });
  }

  /** Area scripts call this when the player crosses into a new safe area. */
  markCheckpoint(tileX: number, tileY: number): void {
    this.checkpoint = { map: this.scene.mapId, x: tileX, y: tileY };
  }

  autosave(): void {
    State.save();
    // Deliberately silent. Autosave fires on story beats, which is exactly when
    // the player is reading something that matters — a toast there competes
    // with the moment it is meant to be preserving.
    emit('saved:quiet', {});
  }

  private handleDown(): void {
    if (this.downing) return;
    this.downing = true;

    const p = this.scene.player;
    p.lock();
    this.scene.keys.enabled = false;
    Audio.sfx('hurt', { volume: 0.7, rate: 0.6 });
    Audio.duckMusic(0.4, 1800);
    this.scene.setTimeScale(0.25, 500);
    this.scene.shake(0.008, 400);

    this.scene.cameras.main.fadeOut(650, 10, 8, 20);
    this.scene.cameras.main.once('camerafadeoutcomplete', () => {
      const target = this.checkpoint && this.checkpoint.map === this.scene.mapId
        ? { x: this.checkpoint.x * TILE + TILE / 2, y: this.checkpoint.y * TILE + TILE }
        : this.spawnPoint();

      State.hp = Math.max(2, Math.floor(State.maxHp / 2));
      emit('player:heal', { hp: State.hp });

      p.setPosition(target.x, target.y);
      p.ensureUnstuck();
      this.scene.cameras.main.centerOn(p.x, p.y);

      // Reset the room rather than the run: enemies clear, puzzles re-arm.
      this.scene.enemies.clear();
      emit('room:reset', { map: this.scene.mapId });

      this.scene.cameras.main.fadeIn(500, 10, 8, 20);
      this.scene.time.delayedCall(520, () => {
        this.scene.keys.enabled = true;
        p.unlock();
        this.downing = false;
      });
    });
  }

  private spawnPoint(): { x: number; y: number } {
    const def = this.scene.world.def;
    const s = def.spawns[RESPAWN_SPAWN] ?? def.spawns[State.currentSpawn] ?? def.spawns.default;
    return { x: s.x * TILE + TILE / 2, y: s.y * TILE + TILE };
  }
}
