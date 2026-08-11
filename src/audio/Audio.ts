/**
 * Audio front-end.
 *
 * All sound in Project Psyche is synthesised at runtime from Web Audio — no
 * sample files ship with the game. That keeps every asset original and lets the
 * conditioning quest treat sound as data (the town bell's motif is a note list,
 * so the hand bell can quote it exactly).
 *
 * This module is the stable API; `synth.ts` and `music.ts` hold the actual
 * sound design.
 */
import type Phaser from 'phaser';

export interface AudioApi {
  init(scene: Phaser.Scene): void;
  playMusic(track?: string, fadeMs?: number): void;
  stopMusic(fadeMs?: number): void;
  duckMusic(amount: number, ms: number): void;
  sfx(name: string, opts?: { volume?: number; rate?: number; pan?: number }): void;
  setMasterVolume(v: number): void;
  setMuted(m: boolean): void;
  readonly ready: boolean;
}

class NullAudio implements AudioApi {
  ready = false;
  init(): void {}
  playMusic(): void {}
  stopMusic(): void {}
  duckMusic(): void {}
  sfx(): void {}
  setMasterVolume(): void {}
  setMuted(): void {}
}

/** Replaced by the real implementation in audio/synth.ts when it registers. */
let impl: AudioApi = new NullAudio();

export function installAudio(a: AudioApi): void {
  impl = a;
}

export const Audio: AudioApi = {
  init: (s) => impl.init(s),
  playMusic: (t, f) => impl.playMusic(t, f),
  stopMusic: (f) => impl.stopMusic(f),
  duckMusic: (a, m) => impl.duckMusic(a, m),
  sfx: (n, o) => impl.sfx(n, o),
  setMasterVolume: (v) => impl.setMasterVolume(v),
  setMuted: (m) => impl.setMuted(m),
  get ready() { return impl.ready; },
};
