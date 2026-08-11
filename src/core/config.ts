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
} as const;

/** Player movement — tuned for immediate, snappy Zelda-style response. */
export const PLAYER = {
  SPEED: 82,
  /** Fraction of the gap to the target velocity closed per 60Hz step. */
  ACCEL: 0.42,
  DECEL: 0.55,
  ATTACK_MS: 260,
  ATTACK_LUNGE: 46,
  /** Input buffered this long before the attack is allowed still fires. */
  ATTACK_BUFFER_MS: 140,
  DASH_MS: 190,
  DASH_SPEED: 205,
  DASH_COOLDOWN_MS: 420,
  DASH_IFRAMES_MS: 150,
  HURT_IFRAMES_MS: 700,
  KNOCKBACK: 130,
  MAX_HP: 6,
  /** Collision box, in pixels, anchored at the sprite's feet. */
  BODY_W: 10,
  BODY_H: 8,
} as const;

export const CAMERA = {
  LERP: 0.14,
  /** Player can drift this far from centre before the camera reacts. */
  DEADZONE_W: 24,
  DEADZONE_H: 18,
} as const;

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
} as const;

export const SAVE_KEY = 'project-psyche-save-v1';
