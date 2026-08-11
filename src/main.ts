import Phaser from 'phaser';
import { GAME_W, GAME_H } from './core/config';
import { BootScene } from './scenes/BootScene';
import { PreloadScene } from './scenes/PreloadScene';
import { TitleScene } from './scenes/TitleScene';
import { WorldScene } from './scenes/WorldScene';
import { UIScene } from './scenes/UIScene';
import './world/maps';

const game = new Phaser.Game({
  type: Phaser.WEBGL,
  parent: 'game',
  width: GAME_W,
  height: GAME_H,
  backgroundColor: '#0d0b14',
  pixelArt: true,
  roundPixels: true,
  antialias: false,
  disableContextMenu: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  render: {
    powerPreference: 'high-performance',
  },
  input: { gamepad: true },
  fps: { target: 60, min: 30 },
  scene: [BootScene, PreloadScene, TitleScene, WorldScene, UIScene],
});

// Exposed for the automated QA + screenshot harness.
(window as unknown as { __game: Phaser.Game }).__game = game;
