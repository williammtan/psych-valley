/**
 * Who currently owns the input.
 *
 * A playtest found that reading any piece of scenery locked the game
 * permanently: one physical SPACE produces a raw `keydown` that the dialogue
 * box consumes to close itself, *and* a `JustDown` that the world's interaction
 * system reads on the following tick — by which time the box is closed, so it
 * re-opens the same dialogue. Press again, same thing, forever, with the player
 * unable to walk away.
 *
 * The underlying mistake was two systems reading the same key from two
 * different places. This module is the single arbiter: while a UI surface is
 * capturing, the world does not read input at all, and for a short grace period
 * after it releases, the world ignores the press that dismissed it.
 */
import { emit } from './events';

let captures = 0;
let releasedAt = -Infinity;

/** How long the world keeps ignoring interact after a UI surface closes. */
const GRACE_MS = 220;

/** Called by any full-screen or modal UI when it takes over input. */
export function captureInput(owner: string): void {
  captures++;
  if (captures === 1) emit('ui:capture', { owner, capturing: true });
}

/** Called by that UI when it hands input back. */
export function releaseInput(owner: string, now: number): void {
  captures = Math.max(0, captures - 1);
  if (captures === 0) {
    releasedAt = now;
    emit('ui:capture', { owner, capturing: false });
  }
}

export function isCapturing(): boolean {
  return captures > 0;
}

/**
 * True while the world should ignore interaction — either a UI surface owns the
 * input, or one just released it and the dismissing keypress is still in flight.
 */
export function worldInputBlocked(now: number): boolean {
  return captures > 0 || now - releasedAt < GRACE_MS;
}

/** Reset on scene teardown so a stuck counter can't wedge the game. */
export function resetInputOwnership(): void {
  captures = 0;
  releasedAt = -Infinity;
}
