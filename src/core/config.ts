/** Global constants. Changing these changes the feel of the whole game. */

export const TILE = 16;

/**
 * Internal render resolution. 480x270 at 16px tiles shows 30x17 tiles, which
 * sits between A Link to the Past (16x14, very tight) and Stardew Valley
 * (~30x17 at its default 1080p zoom). Wide enough to reason about a dungeon
 * room in one screen, tight enough that characters keep their personality.
 * At 1920x1080 this is an exact 4x integer scale.
 */
export const GAME_W = 480;
export const GAME_H = 270;

export const DEPTH = {
  GROUND: 0,
  DETAIL: 10,
  SCATTER: 20,
  SHADOW: 90,
  /** Y-sorted entities live between 100 and 100_000 (depth = 100 + y). */
  ENTITY_BASE: 100,
  OVER: 200_000,
  WEATHER: 300_000,
  LIGHT: 400_000,
  VIGNETTE: 450_000,
  HUD: 500_000,
};

/**
 * Player movement — tuned for immediate, snappy Zelda-style response.
 *
 * Every number here was measured with `tools/feel_probe.ts` rather than guessed
 * at; the comments record what the measurement has to come out as, so a future
 * change that breaks the feel shows up as a failed target instead of a vibe.
 */
export const PLAYER = {
  SPEED: 82,
  /**
   * Fraction of the gap to the target velocity closed per 60Hz step. 0.5 puts
   * the character at 95% of top speed in ~70ms — enough ramp to have weight,
   * short enough that the first frame already moves a whole pixel, so the
   * sprite visibly responds on the frame the key goes down.
   */
  ACCEL: 0.5,
  /** Stopping is quicker than starting: ~70ms, so there is no ice-skating. */
  DECEL: 0.62,
  /**
   * The swing: 4 art frames at 12fps = 333ms, so the state has to be long
   * enough that the follow-through frame is actually seen. Anticipation
   * 0–83ms, strike 83–190ms (the hitbox window), recovery after that.
   */
  ATTACK_MS: 300,
  ATTACK_LUNGE: 46,
  /**
   * Once the strike is spent, pushing a direction ends the attack early. This
   * is what makes the sword usable rhythmically instead of committing you to
   * the full animation every time.
   */
  ATTACK_CANCEL_MS: 200,
  /** Movement authority kept during the swing — a lunge, never a dead stop. */
  ATTACK_MOVE: 0.3,
  /** Input buffered this long before the attack is allowed still fires. */
  ATTACK_BUFFER_MS: 140,
  DASH_MS: 190,
  DASH_SPEED: 205,
  DASH_COOLDOWN_MS: 420,
  /**
   * Must outlast DASH_MS or the tail of the dash is a trap: the player commits
   * to a dodge, the animation says invulnerable, and the last 40ms hurts.
   */
  DASH_IFRAMES_MS: 225,
  /** One trail ghost every N frames of a dash — every frame is soup. */
  DASH_TRAIL_EVERY: 2,
  HURT_IFRAMES_MS: 700,
  KNOCKBACK: 130,
  MAX_HP: 6,
  /** Collision box, in pixels, anchored at the sprite's feet. */
  BODY_W: 10,
  BODY_H: 8,
};

/** Impact feedback, shared by everything that can be hit. */
export const FEEL = {
  /** Hitstop: the world stops dead for this long when a blow connects. */
  HITSTOP_MS: 48,
  /** Time scale during hitstop. Not zero, so tweens and timers keep breathing. */
  HITSTOP_SCALE: 0.04,
  SHAKE_HIT: 0.005,
  SHAKE_HIT_MS: 110,
  /** White flash on a struck enemy — the cheapest, clearest "that landed". */
  HIT_FLASH_MS: 70,
};

/** Enemy timing. Telegraphs are a fairness contract, so they live out here. */
export const ENEMY = {
  /**
   * Wind-up before a Bramble commits to its charge. The art is 3 frames at
   * 6fps = 500ms; matching the state to the animation means the last, loudest
   * telegraph frame is on screen when the charge fires, not cut off before it.
   */
  BRAMBLE_TELL_MS: 500,
  /** Aim time before a Wisp releases a shot. */
  WISP_TELL_MS: 440,
  /**
   * Knockback applied to an enemy that takes a hit. Decays 14% a frame over
   * the 240ms recoil, which lands the body about 15px back — enough to read as
   * a real blow, short of shoving it out of reach.
   */
  KNOCKBACK: 190,
};

export const CAMERA = {
  LERP: 0.14,
  /** Player can drift this far from centre before the camera reacts. */
  DEADZONE_W: 24,
  DEADZONE_H: 18,
};

export const COLORS = {
  ink: 0x241d33,
  inkSoft: 0x3a3050,
  parchment: 0xeddcb8,
  parchmentDim: 0xd8c69c,
  gold: 0xd6a534,
  goldLight: 0xf2ca5e,
  echo: 0xa681e6,
  echoGlow: 0xc8a6ff,
  echoCyan: 0x8ce6e6,
  amber: 0xffb937,
  danger: 0xc2456a,
  good: 0x6cb069,
};

export const SAVE_KEY = 'project-psyche-save-v1';
