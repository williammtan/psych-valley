/**
 * Interaction targeting.
 *
 * The rule: the player presses one button and the *obviously intended* thing
 * happens. That means scoring candidates by a cone in front of the player,
 * not just by distance — standing between a sign and an NPC should never make
 * the game guess wrong.
 */
import Phaser from 'phaser';
import { DEPTH, TILE } from '@/core/config';
import { emit } from '@/core/events';
import { State } from '@/core/state';
import { DIR_VEC } from '@/entities/Player';
import type { BuiltWorld } from '@/world/WorldBuilder';
import type { WorldScene } from '@/scenes/WorldScene';
import { hasFrame } from '@/core/textures';

export interface Interactable {
  id: string;
  /** World pixel position of the interaction anchor. */
  x: number;
  y: number;
  /** Extra reach beyond the default. */
  radius?: number;
  /** Short verb shown in the prompt, e.g. 'Talk', 'Read', 'Search'. */
  label?: string;
  /** Highlighted by the Observe ability. */
  observable?: boolean;
  /** Hidden until this flag is set. */
  requires?: string;
  /** Hidden once this flag is set. */
  forbids?: string;
  /** Returns false to decline (e.g. quest not active yet). */
  enabled?: () => boolean;
  onInteract?: (w: WorldScene) => void;
  /** Bound entity, so moving NPCs keep their interaction anchored. */
  follow?: { x: number; y: number };
}

const BASE_REACH = 30;

export class Interactions {
  private items: Interactable[] = [];
  private current: Interactable | null = null;
  private prompt?: Phaser.GameObjects.Container;
  private promptLabel?: Phaser.GameObjects.BitmapText | Phaser.GameObjects.Text;
  private promptKey?: Phaser.GameObjects.Image;
  private bob = 0;

  constructor(private scene: WorldScene) {}

  rebuild(world: BuiltWorld): void {
    this.clear();
    // Props marked with an `interact` id become interactables automatically.
    for (const p of world.props) {
      if (!p.spec.interact) continue;
      this.items.push({
        id: p.spec.interact,
        x: p.sprite.x,
        y: p.sprite.y - p.sprite.height / 2,
        observable: true,
        label: 'Look',
      });
    }
  }

  add(i: Interactable): void {
    this.items.push(i);
  }

  remove(id: string): void {
    this.items = this.items.filter((i) => i.id !== id);
  }

  clear(): void {
    this.items = [];
    this.current = null;
    this.prompt?.destroy();
    this.prompt = undefined;
  }

  private available(i: Interactable): boolean {
    if (i.requires && !State.has(i.requires)) return false;
    if (i.forbids && State.has(i.forbids)) return false;
    return true;
  }

  /** Everything Observe should mark, nearest first. */
  observables(x: number, y: number, radius: number): Array<{ x: number; y: number }> {
    const out: Array<{ x: number; y: number; d: number }> = [];
    for (const i of this.items) {
      if (!i.observable) continue;
      if (i.enabled && !i.enabled()) continue;
      const ax = i.follow?.x ?? i.x;
      const ay = i.follow?.y ?? i.y;
      const d = Math.hypot(ax - x, ay - y);
      if (d <= radius) out.push({ x: ax, y: ay, d });
    }
    for (const n of this.scene.npcs) {
      const d = Math.hypot(n.x - x, n.y - y);
      if (d <= radius) out.push({ x: n.x, y: n.y - 30, d });
    }
    return out.sort((a, b) => a.d - b.d).slice(0, 8);
  }

  update(_dt: number): void {
    const p = this.scene.player;
    const [fx, fy] = DIR_VEC[p.dir];
    const found: { best: Interactable | null; score: number } = { best: null, score: -Infinity };

    const consider = (i: Interactable, ax: number, ay: number) => {
      if (i.enabled && !i.enabled()) return;
      const dx = ax - p.x;
      const dy = ay - (p.y - 8);
      const dist = Math.hypot(dx, dy);
      const reach = BASE_REACH + (i.radius ?? 0);
      if (dist > reach) return;
      // Facing alignment dominates; distance is the tiebreak.
      const dot = dist < 1 ? 1 : (dx * fx + dy * fy) / dist;
      if (dot < -0.2) return;
      const score = dot * 100 - dist;
      if (score > found.score) { found.score = score; found.best = i; }
    };

    for (const i of this.items) {
      if (!this.available(i)) continue;
      consider(i, i.follow?.x ?? i.x, i.follow?.y ?? i.y);
    }
    for (const n of this.scene.npcs) {
      consider(
        { id: `npc:${n.id}`, x: n.x, y: n.y - 12, label: 'Talk', observable: true },
        n.x, n.y - 12,
      );
    }

    if (found.best !== this.current) {
      this.current = found.best;
      this.showPrompt(found.best);
    }
    if (this.current && this.prompt) {
      const c = this.current as Interactable;
      const ax = c.follow?.x ?? c.x;
      const ay = c.follow?.y ?? c.y;
      this.bob += _dt / 1000;
      this.prompt.setPosition(Math.round(ax), Math.round(ay - 16 + Math.sin(this.bob * 5) * 1.5));
      this.prompt.setDepth(DEPTH.ENTITY_BASE + ay + 60);
    }

    if (this.current && this.scene.keys.justPressed('interact')) {
      const target = this.current;
      this.scene.player.faceTowards(target.follow?.x ?? target.x, target.follow?.y ?? target.y);
      if (target.id.startsWith('npc:')) {
        const npcId = target.id.slice(4);
        const npc = this.scene.npc(npcId);
        npc?.faceTowards(this.scene.player.x, this.scene.player.y);
        const handled = this.scene.area?.onInteract?.(this.scene, target.id);
        if (!handled) emit('interact:npc', { id: npcId });
      } else {
        target.onInteract?.(this.scene);
        const handled = this.scene.area?.onInteract?.(this.scene, target.id);
        if (!handled && !target.onInteract) emit('interact:object', { id: target.id });
      }
    }
  }

  private showPrompt(i: Interactable | null): void {
    this.prompt?.destroy();
    this.prompt = undefined;
    if (!i) return;
    const c = this.scene.add.container(0, 0).setDepth(DEPTH.ENTITY_BASE + 9999);
    const hasKeyArt = hasFrame(this.scene, 'ui/key_space');
    if (hasKeyArt) {
      const key = this.scene.add.image(0, 0, 'atlas', 'ui/key_space').setOrigin(0.5, 1);
      c.add(key);
    } else {
      const bg = this.scene.add.rectangle(0, -5, 13, 11, 0x241d33).setOrigin(0.5);
      const fg = this.scene.add.rectangle(0, -5, 11, 9, 0xeddcb8).setOrigin(0.5);
      c.add([bg, fg]);
    }
    this.prompt = c;
    c.setScale(0.6);
    this.scene.tweens.add({ targets: c, scale: 1, duration: 130, ease: 'Back.easeOut' });
  }

  get target(): Interactable | null {
    return this.current;
  }
}
