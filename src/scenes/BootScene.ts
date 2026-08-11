import Phaser from 'phaser';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload(): void {
    this.load.setBaseURL('');
    this.load.json('art', 'assets/art.json');
  }

  create(): void {
    this.scene.start('Preload');
  }
}
