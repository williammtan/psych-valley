/**
 * Grid painting utility for map authors.
 *
 * Maps ultimately become `string[]` character grids, but hand-counting 90
 * columns is where map bugs come from. GridPainter lets an author say what they
 * mean — "a flagstone plaza here, a path from the plaza to the gate, a river
 * down the east side" — and emits the grid.
 *
 * Authors who prefer literal ASCII can still use `GridPainter.fromAscii`.
 */

export class GridPainter {
  readonly w: number;
  readonly h: number;
  private cells: string[][];

  constructor(w: number, h: number, fill = '.') {
    this.w = w;
    this.h = h;
    this.cells = Array.from({ length: h }, () => new Array<string>(w).fill(fill));
  }

  static fromAscii(rows: string[]): GridPainter {
    const g = new GridPainter(rows[0].length, rows.length);
    rows.forEach((row, y) => {
      if (row.length !== rows[0].length) {
        throw new Error(`GridPainter.fromAscii: row ${y} is ${row.length} wide, expected ${rows[0].length}`);
      }
      [...row].forEach((ch, x) => { g.cells[y][x] = ch; });
    });
    return g;
  }

  clone(): GridPainter {
    const g = new GridPainter(this.w, this.h);
    g.cells = this.cells.map((r) => [...r]);
    return g;
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  get(x: number, y: number): string {
    return this.inside(x, y) ? this.cells[y][x] : ' ';
  }

  set(x: number, y: number, ch: string): this {
    if (this.inside(x, y)) this.cells[y][x] = ch;
    return this;
  }

  /** Write only where the current char is one of `over`. */
  setIf(x: number, y: number, ch: string, over: string[]): this {
    if (this.inside(x, y) && over.includes(this.cells[y][x])) this.cells[y][x] = ch;
    return this;
  }

  fill(ch: string): this {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) this.cells[y][x] = ch;
    return this;
  }

  rect(x: number, y: number, w: number, h: number, ch: string): this {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, ch);
    return this;
  }

  outline(x: number, y: number, w: number, h: number, ch: string): this {
    for (let i = x; i < x + w; i++) { this.set(i, y, ch); this.set(i, y + h - 1, ch); }
    for (let j = y; j < y + h; j++) { this.set(x, j, ch); this.set(x + w - 1, j, ch); }
    return this;
  }

  /** Axis-aligned corridor of a given width. */
  hLine(x0: number, x1: number, y: number, ch: string, width = 1): this {
    const [a, b] = x0 <= x1 ? [x0, x1] : [x1, x0];
    const off = Math.floor((width - 1) / 2);
    for (let x = a; x <= b; x++) for (let k = 0; k < width; k++) this.set(x, y - off + k, ch);
    return this;
  }

  vLine(y0: number, y1: number, x: number, ch: string, width = 1): this {
    const [a, b] = y0 <= y1 ? [y0, y1] : [y1, y0];
    const off = Math.floor((width - 1) / 2);
    for (let y = a; y <= b; y++) for (let k = 0; k < width; k++) this.set(x - off + k, y, ch);
    return this;
  }

  /** An L-shaped path between two points; `hFirst` picks which leg comes first. */
  path(x0: number, y0: number, x1: number, y1: number, ch: string, width = 3, hFirst = true): this {
    if (hFirst) {
      this.hLine(x0, x1, y0, ch, width);
      this.vLine(y0, y1, x1, ch, width);
    } else {
      this.vLine(y0, y1, x0, ch, width);
      this.hLine(x0, x1, y1, ch, width);
    }
    return this;
  }

  /** Organic blob, useful for ponds, clearings and worn patches. */
  blob(cx: number, cy: number, rx: number, ry: number, ch: string, seed = 1, wobble = 0.3): this {
    const noise = (a: number) => {
      let n = Math.sin(a * 12.9898 + seed * 78.233) * 43758.5453;
      return n - Math.floor(n);
    };
    for (let y = Math.floor(cy - ry - 2); y <= cy + ry + 2; y++) {
      for (let x = Math.floor(cx - rx - 2); x <= cx + rx + 2; x++) {
        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        const ang = Math.atan2(dy, dx);
        const r = 1 + (noise(ang * 3) - 0.5) * wobble * 2;
        if (dx * dx + dy * dy <= r * r) this.set(x, y, ch);
      }
    }
    return this;
  }

  /** Scatter `ch` into cells currently matching `over`, deterministically. */
  scatter(ch: string, over: string[], density: number, seed = 7, region?: { x: number; y: number; w: number; h: number }): this {
    const r = region ?? { x: 0, y: 0, w: this.w, h: this.h };
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        if (!this.inside(x, y)) continue;
        if (!over.includes(this.cells[y][x])) continue;
        let n = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
        n = (n ^ (n >>> 13)) * 1274126177;
        const v = ((n ^ (n >>> 16)) >>> 0) / 4294967296;
        if (v < density) this.cells[y][x] = ch;
      }
    }
    return this;
  }

  /** Replace every occurrence of one char with another. */
  swap(from: string, to: string): this {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (this.cells[y][x] === from) this.cells[y][x] = to;
    }
    return this;
  }

  /** Stamp a small ASCII sprite at (x,y); spaces are transparent. */
  stamp(x: number, y: number, rows: string[]): this {
    rows.forEach((row, j) => {
      [...row].forEach((ch, i) => {
        if (ch === ' ') return;
        this.set(x + i, y + j, ch);
      });
    });
    return this;
  }

  /** Draw a border of `ch`, `thickness` cells deep. */
  border(ch: string, thickness = 1): this {
    for (let t = 0; t < thickness; t++) this.outline(t, t, this.w - t * 2, this.h - t * 2, ch);
    return this;
  }

  rows(): string[] {
    return this.cells.map((r) => r.join(''));
  }

  /** Count cells matching a predicate — used by density self-checks. */
  count(pred: (ch: string) => boolean): number {
    let n = 0;
    for (const row of this.cells) for (const ch of row) if (pred(ch)) n++;
    return n;
  }

  /** Fraction of the map that is neither empty ground nor a wall. */
  report(emptyChars: string[]): { total: number; empty: number; ratio: number } {
    const total = this.w * this.h;
    const empty = this.count((c) => emptyChars.includes(c));
    return { total, empty, ratio: 1 - empty / total };
  }
}
