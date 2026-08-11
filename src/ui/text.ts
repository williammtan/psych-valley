/**
 * Text helper.
 *
 * The game uses generated bitmap fonts. Until they exist (or if one fails to
 * load) this falls back to a pixel-ish system font so the UI is never invisible
 * during development. Every UI surface goes through here so swapping the font
 * is a one-line change.
 */
import Phaser from 'phaser';

export type FontName = 'body' | 'display';

const FALLBACK_STYLE: Record<FontName, Phaser.Types.GameObjects.Text.TextStyle> = {
  body: { fontFamily: 'ui-monospace, "Courier New", monospace', fontSize: '8px', color: '#f6ecd4' },
  display: { fontFamily: 'ui-monospace, "Courier New", monospace', fontSize: '12px', color: '#f6ecd4' },
};

export function fontAvailable(scene: Phaser.Scene, font: FontName): boolean {
  return !!scene.cache.bitmapFont.get(font);
}

export interface TextHandle {
  obj: Phaser.GameObjects.BitmapText | Phaser.GameObjects.Text;
  setText(s: string): void;
  setTint(c: number): void;
  setAlpha(a: number): void;
  setOrigin(x: number, y?: number): void;
  setPosition(x: number, y: number): void;
  setDepth(d: number): void;
  destroy(): void;
  readonly width: number;
  readonly height: number;
}

export function makeText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  content: string,
  font: FontName = 'body',
  opts: { tint?: number; align?: number; maxWidth?: number; letterSpacing?: number } = {},
): TextHandle {
  if (fontAvailable(scene, font)) {
    const t = scene.add.bitmapText(x, y, font, content);
    if (opts.tint !== undefined) t.setTint(opts.tint);
    if (opts.maxWidth) t.setMaxWidth(opts.maxWidth);
    if (opts.align !== undefined) t.setCenterAlign?.();
    if (opts.letterSpacing) t.setLetterSpacing(opts.letterSpacing);
    return wrap(t);
  }
  const style = { ...FALLBACK_STYLE[font] };
  if (opts.tint !== undefined) style.color = '#' + opts.tint.toString(16).padStart(6, '0');
  if (opts.maxWidth) {
    style.wordWrap = { width: opts.maxWidth, useAdvancedWrap: true };
  }
  const t = scene.add.text(x, y, content, style);
  t.setResolution(1);
  return wrap(t);
}

function wrap(obj: Phaser.GameObjects.BitmapText | Phaser.GameObjects.Text): TextHandle {
  return {
    obj,
    setText: (s) => { obj.setText(s); },
    setTint: (c) => {
      if (obj instanceof Phaser.GameObjects.BitmapText) obj.setTint(c);
      else obj.setColor('#' + c.toString(16).padStart(6, '0'));
    },
    setAlpha: (a) => { obj.setAlpha(a); },
    setOrigin: (x, y) => { obj.setOrigin(x, y ?? x); },
    setPosition: (x, y) => { obj.setPosition(Math.round(x), Math.round(y)); },
    setDepth: (d) => { obj.setDepth(d); },
    destroy: () => obj.destroy(),
    get width() { return obj.width; },
    get height() { return obj.height; },
  };
}

/** Word-wrap a string to a pixel width using the given font's metrics. */
export function wrapText(scene: Phaser.Scene, content: string, font: FontName, maxWidth: number): string {
  const probe = makeText(scene, -9999, -9999, '', font);
  const words = content.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    probe.setText(test);
    if (probe.width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  probe.destroy();
  return lines.join('\n');
}
