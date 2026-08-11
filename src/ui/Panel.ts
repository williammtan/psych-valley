/**
 * 9-slice panel builder.
 *
 * Uses generated `ui/panel_*` frames when the UI art module has produced them,
 * and falls back to flat rectangles otherwise so layout work is never blocked
 * on art.
 */
import Phaser from 'phaser';
import { hasFrame } from '@/core/textures';

export type PanelStyle = 'parchment' | 'dark' | 'echo' | 'dialogue' | 'insight' | 'clue' | 'tab';

const PREFIX: Record<PanelStyle, string> = {
  parchment: 'ui/panel',
  dark: 'ui/panelDark',
  echo: 'ui/panelEcho',
  dialogue: 'ui/dialogue',
  insight: 'ui/insight_frame',
  clue: 'ui/clue_card',
  tab: 'ui/tab_active',
};

const FALLBACK_COLORS: Record<PanelStyle, { fill: number; border: number; alpha: number }> = {
  parchment: { fill: 0xeddcb8, border: 0x8a7458, alpha: 1 },
  dark: { fill: 0x241d33, border: 0x5d4e78, alpha: 0.96 },
  echo: { fill: 0x241540, border: 0x7a4fbd, alpha: 0.94 },
  dialogue: { fill: 0xeddcb8, border: 0x8a7458, alpha: 1 },
  insight: { fill: 0xfbf1d8, border: 0xd6a534, alpha: 1 },
  clue: { fill: 0xd8c69c, border: 0x8a7458, alpha: 1 },
  tab: { fill: 0xd8c69c, border: 0x8a7458, alpha: 1 },
};

export const Panel = {
  available(scene: Phaser.Scene, style: PanelStyle): boolean {
    return hasFrame(scene, `${PREFIX[style]}_c`);
  },

  /**
   * Returns a container positioned at (0,0) whose children lay out the panel at
   * the given rect in the container's local space.
   */
  build(scene: Phaser.Scene, x: number, y: number, w: number, h: number, style: PanelStyle = 'parchment'): Phaser.GameObjects.Container {
    const c = scene.add.container(0, 0);
    const p = PREFIX[style];

    if (!this.available(scene, style)) {
      const f = FALLBACK_COLORS[style];
      const border = scene.add.rectangle(x, y, w, h, f.border, f.alpha).setOrigin(0, 0);
      const fill = scene.add.rectangle(x + 1, y + 1, w - 2, h - 2, f.fill, f.alpha).setOrigin(0, 0);
      c.add([border, fill]);
      return c;
    }

    const corner = scene.textures.getFrame('atlas', `${p}_tl`);
    const cw = corner.width;
    const ch = corner.height;
    const midW = Math.max(0, w - cw * 2);
    const midH = Math.max(0, h - ch * 2);

    /**
     * Edges and centre are TILED, not scaled.
     *
     * Scaling an 8px textured slice across a 460px dialogue box stretches its
     * paper grain into visible rectangular blotches — the wider the panel, the
     * worse it looks, and the dialogue box is the widest and most-seen panel in
     * the game. A TileSprite repeats the slice at its native size instead, so
     * the grain stays 8px whatever the panel's dimensions.
     */
    const tile = (frame: string, px: number, py: number, tw: number, th: number) => {
      if (tw <= 0 || th <= 0) return;
      const ts = scene.add.tileSprite(px, py, tw, th, 'atlas', frame).setOrigin(0, 0);
      c.add(ts);
    };
    const corner4 = (frame: string, px: number, py: number) => {
      c.add(scene.add.image(px, py, 'atlas', frame).setOrigin(0, 0));
    };

    tile(`${p}_c`, x + cw, y + ch, midW, midH);
    tile(`${p}_t`, x + cw, y, midW, ch);
    tile(`${p}_b`, x + cw, y + h - ch, midW, ch);
    tile(`${p}_l`, x, y + ch, cw, midH);
    tile(`${p}_r`, x + w - cw, y + ch, cw, midH);
    corner4(`${p}_tl`, x, y);
    corner4(`${p}_tr`, x + w - cw, y);
    corner4(`${p}_bl`, x, y + h - ch);
    corner4(`${p}_br`, x + w - cw, y + h - ch);
    return c;
  },
};
