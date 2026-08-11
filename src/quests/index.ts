/**
 * Quest registration.
 *
 * Each quest module registers its journal entry here and installs its own area
 * scripts. Keeping registration separate from the scenes means the debug
 * harness can jump straight to any quest state on a fresh load.
 */
import { State } from '@/core/state';

let registered = false;

export function registerAllQuests(): void {
  if (registered) return;
  registered = true;

  State.registerQuest({
    id: 'q1_pip',
    title: 'The Bell and the Cat',
    giver: 'mira',
    order: 1,
    steps: [
      { id: 'find_pip', text: 'Find out why Pip bolted', done: false },
      { id: 'investigate', text: 'Look around the inn for what set him off', done: false },
      { id: 'experiment', text: 'Try the hand bell with Pip', done: false },
      { id: 'calm', text: 'Get Pip out from under the furniture', done: false },
    ],
  });

  State.registerQuest({
    id: 'q2_oren',
    title: "Oren's Two Days",
    giver: 'oren',
    order: 2,
    steps: [
      { id: 'talk', text: 'Hear Oren out at the courier office', done: false },
      { id: 'gather', text: 'Find evidence of what actually happened', done: false },
      { id: 'sort', text: 'Separate yesterday from today', done: false },
      { id: 'deliver', text: 'Tell Oren what you worked out', done: false },
    ],
  });

  State.registerQuest({
    id: 'q3_lanterns',
    title: 'The Lantern Trial',
    giver: 'elia',
    order: 3,
    steps: [
      { id: 'join', text: 'Take part in the Lantern Trial', done: false },
      { id: 'rounds', text: 'Play through the rounds', done: false },
      { id: 'after', text: 'Ask the villagers what they actually heard', done: false },
    ],
  });

  State.registerQuest({
    id: 'q4_shrine',
    title: 'Beneath Lumen Vale',
    giver: 'sera',
    order: 4,
    steps: [
      { id: 'gate', text: 'Head south through Whisper Woods', done: false },
      { id: 'shrine', text: 'Find the Echo Shrine', done: false },
      { id: 'boss', text: 'Reach whatever is at the bottom', done: false },
    ],
  });
}
