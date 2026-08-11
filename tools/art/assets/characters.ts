/**
 * CHARACTERS — the whole human cast, plus Pip and Mote.
 */
import { ArtBuild } from '../lib/registry.js';
import {
  drawChar, charStrip, POSE_FRAMES, POSE_FPS, POSE_ONCE,
  type CharSpec, type Dir, type Pose,
} from '../lib/humanoid.js';
import * as P from '../lib/palette.js';

const DIRS: Dir[] = ['s', 'n', 'e'];

function registerHuman(b: ArtBuild, who: string, spec: CharSpec, poses: Pose[]): void {
  for (const pose of poses) {
    for (const dir of DIRS) {
      b.addStrip(`char/${who}/${pose}_${dir}`, charStrip(spec, dir, pose), {
        key: `${who}_${pose}_${dir}`,
        frameRate: POSE_FPS[pose],
        repeat: POSE_ONCE[pose] ? 0 : -1,
      });
    }
  }
  void drawChar;
  void POSE_FRAMES;
}

export function registerCharacters(b: ArtBuild): void {
  registerHuman(b, 'player', {
    skin: 'fair', hair: 'brown', hairStyle: 'short',
    cloth: 'player', cloth2: 'neutral', outfit: 'tunic',
    accessory: 'satchel', build: 'normal', weapon: true,
  }, ['idle', 'walk', 'talk', 'attack', 'surprised', 'happy', 'dash']);
  void P;
}
