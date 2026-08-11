/**
 * Input abstraction. Every system reads intent from here rather than polling
 * keys, so rebinding, gamepad support and scripted playback (used by the
 * automated QA harness) all work without touching gameplay code.
 */
import Phaser from 'phaser';

export type Action = 'interact' | 'attack' | 'dash' | 'observe' | 'journal' | 'pause' | 'cancel' | 'map';

const BINDINGS: Record<Action, string[]> = {
  interact: ['SPACE', 'E', 'ENTER'],
  attack: ['J', 'X', 'Z'],
  dash: ['SHIFT', 'K'],
  observe: ['Q', 'F'],
  journal: ['TAB', 'I'],
  pause: ['ESC'],
  cancel: ['ESC', 'BACKSPACE'],
  map: ['M'],
};

export class InputManager {
  private keys = new Map<string, Phaser.Input.Keyboard.Key>();
  private pressedThisFrame = new Set<Action>();
  private pad?: Phaser.Input.Gamepad.Gamepad;
  /** Scripted input, used by the automated play harness. */
  scripted: { axis: { x: number; y: number }; actions: Set<Action> } | null = null;
  enabled = true;

  constructor(private scene: Phaser.Scene) {
    const kb = scene.input.keyboard!;
    const all = new Set<string>();
    for (const list of Object.values(BINDINGS)) list.forEach((k) => all.add(k));
    ['W', 'A', 'S', 'D', 'UP', 'DOWN', 'LEFT', 'RIGHT', 'ONE', 'TWO', 'THREE', 'FOUR'].forEach((k) => all.add(k));
    for (const k of all) this.keys.set(k, kb.addKey(k, true, false));
    kb.on('keydown', () => { /* keeps focus semantics simple */ });
    scene.input.gamepad?.on('connected', (p: Phaser.Input.Gamepad.Gamepad) => { this.pad = p; });
  }

  private key(name: string): Phaser.Input.Keyboard.Key | undefined {
    return this.keys.get(name);
  }

  /** Called once per frame by the owning scene, before any system reads input. */
  update(): void {
    this.pressedThisFrame.clear();
    if (!this.enabled) return;
    for (const [action, names] of Object.entries(BINDINGS) as Array<[Action, string[]]>) {
      for (const n of names) {
        const k = this.key(n);
        if (k && Phaser.Input.Keyboard.JustDown(k)) { this.pressedThisFrame.add(action); break; }
      }
    }
    if (this.scripted) {
      for (const a of this.scripted.actions) this.pressedThisFrame.add(a);
      this.scripted.actions.clear();
    }
  }

  /** Normalised movement intent, -1..1 on each axis. */
  axis(): { x: number; y: number } {
    if (this.scripted) return this.scripted.axis;
    if (!this.enabled) return { x: 0, y: 0 };
    let x = 0, y = 0;
    if (this.key('A')?.isDown || this.key('LEFT')?.isDown) x -= 1;
    if (this.key('D')?.isDown || this.key('RIGHT')?.isDown) x += 1;
    if (this.key('W')?.isDown || this.key('UP')?.isDown) y -= 1;
    if (this.key('S')?.isDown || this.key('DOWN')?.isDown) y += 1;
    if (this.pad) {
      const ax = this.pad.axes[0]?.getValue() ?? 0;
      const ay = this.pad.axes[1]?.getValue() ?? 0;
      if (Math.abs(ax) > 0.28) x = ax;
      if (Math.abs(ay) > 0.28) y = ay;
      if (this.pad.left) x = -1;
      if (this.pad.right) x = 1;
      if (this.pad.up) y = -1;
      if (this.pad.down) y = 1;
    }
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    return { x, y };
  }

  justPressed(a: Action): boolean {
    return this.pressedThisFrame.has(a);
  }

  isDown(a: Action): boolean {
    if (this.scripted) return false;
    if (!this.enabled) return false;
    return BINDINGS[a].some((n) => this.key(n)?.isDown);
  }

  /** Digit keys 1-4 select journal tabs / debug jumps. */
  digit(n: 1 | 2 | 3 | 4): boolean {
    const names = ['ONE', 'TWO', 'THREE', 'FOUR'];
    const k = this.key(names[n - 1]);
    return !!k && Phaser.Input.Keyboard.JustDown(k);
  }

  /** Inject an action for one frame (automated QA + on-screen buttons). */
  inject(a: Action): void {
    this.pressedThisFrame.add(a);
  }
}
