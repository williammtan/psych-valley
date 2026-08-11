/**
 * The page-side driver both boss tools inject.
 *
 * It runs inside the game's window next to `__psyche` and `__boss` rather than
 * as an imported module, so it is exported here as source.
 *
 * TWO INPUT PATHS, and they are not interchangeable:
 *
 *   · GAMEPLAY goes through `scene.keys.scripted`, which InputManager drains at
 *     the top of each frame. `__psyche.press()` writes straight into the
 *     per-frame set, which the very next `keys.update()` clears — from a timer
 *     that is a coin flip, so no bot should use it for attacking.
 *   · DIALOGUE goes through real DOM key events, because DialogueBox listens to
 *     `keydown` directly and InputManager is disabled during a cutscene anyway.
 */
export const DRIVER = `
window.__bossDriver = (() => {
  const P = () => window.__psyche;
  const B = () => window.__boss;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  function keys() {
    const k = P().scene.keys;
    if (!k.scripted) k.scripted = { axis: { x: 0, y: 0 }, actions: new Set() };
    return k.scripted;
  }
  function move(dx, dy) {
    const len = Math.hypot(dx, dy);
    keys().axis = len > 1 ? { x: dx / len, y: dy / len } : { x: dx, y: dy };
  }
  function halt() { keys().axis = { x: 0, y: 0 }; }
  function attack() { keys().actions.add('attack'); }
  function dash() { keys().actions.add('dash'); }

  /** Dialogue only. See the note above. */
  function advance() {
    for (const type of ['keydown', 'keyup']) {
      const ev = new KeyboardEvent(type, { key: ' ', code: 'Space', keyCode: 32, which: 32, bubbles: true });
      window.dispatchEvent(ev);
      document.dispatchEvent(ev);
    }
  }
  async function advanceUntil(pred, timeout) {
    const t0 = performance.now();
    while (performance.now() - t0 < (timeout || 60000)) {
      let done = false;
      try { done = !!pred(); } catch (e) { done = false; }
      if (done) return true;
      advance();
      await wait(240);
    }
    return false;
  }

  async function until(pred, timeout) {
    const t0 = performance.now();
    while (performance.now() - t0 < (timeout || 12000)) {
      let v = false;
      try { v = !!pred(); } catch (e) { v = false; }
      if (v) return true;
      await wait(40);
    }
    return false;
  }

  function player() { return P().state().player; }

  /**
   * Walk somewhere.
   *
   * ALWAYS yields at least once. An early \`break\` with no await would let the
   * caller's loop spin synchronously, which starves the game's requestAnimation
   * Frame entirely — the page stops producing frames and looks like a hang.
   */
  async function goTo(tx, ty, timeout) {
    const t0 = performance.now();
    for (;;) {
      const p = player();
      const dx = tx - p.x, dy = ty - p.y;
      const d = Math.hypot(dx, dy);
      if (d < 8) { halt(); await wait(40); return; }
      move(dx / d, dy / d);
      await wait(30);
      if (performance.now() - t0 >= (timeout || 2500)) break;
    }
    halt();
  }

  /** Stand on one side of a point, turn to face it, and swing. */
  async function strikeSide(cx, cy, side, timeout) {
    const off = { n: [0, -46], s: [0, 40], e: [42, -6], w: [-42, -6] }[side];
    await goTo(cx + off[0], cy + off[1], timeout || 1500);
    const p = player();
    const dx = cx - p.x, dy = (cy - 6) - p.y;
    const d = Math.hypot(dx, dy) || 1;
    move(dx / d, dy / d);
    await wait(150);
    halt();
    attack();
    await wait(300);
  }

  /** Walk into something and hit it. */
  async function strikeAt(cx, cy, timeout) {
    const t0 = performance.now();
    while (performance.now() - t0 < (timeout || 1400)) {
      const p = player();
      const dx = cx - p.x, dy = (cy - 8) - p.y;
      const d = Math.hypot(dx, dy);
      if (d < 26) break;
      move(dx / d, dy / d);
      await wait(30);
    }
    halt();
    attack();
    await wait(290);
  }

  /** The arena point furthest from everything in \`avoid\`. */
  function bestSpot(avoid) {
    const a = B().arena.arena;
    let best = { x: (a.x0 + a.x1) / 2, y: (a.y0 + a.y1) / 2 };
    let bestD = -1;
    for (let x = a.x0 + 14; x <= a.x1 - 14; x += 14) {
      for (let y = a.y0 + 14; y <= a.y1 - 6; y += 14) {
        let d = 1e9;
        for (const o of avoid) d = Math.min(d, Math.hypot(o.x - x, o.y - y));
        if (d > bestD) { bestD = d; best = { x: x, y: y }; }
      }
    }
    return best;
  }

  /**
   * The closest point to \`near\` that is still at least \`clear\` away from
   * everything in \`avoid\`.
   *
   * This is what actually separates the informed bot from a coward: knowing the
   * rule is "outside the burning quadrant" lets you stand safe AND next to the
   * Echo, ready for the stagger. Fleeing to the far corner is safe too, and much
   * slower.
   */
  function safeSpotNear(avoid, clear, near) {
    const a = B().arena.arena;
    let best = null, bestScore = 1e9;
    for (let x = a.x0 + 12; x <= a.x1 - 12; x += 12) {
      for (let y = a.y0 + 12; y <= a.y1 - 6; y += 12) {
        let d = 1e9;
        for (const o of avoid) d = Math.min(d, Math.hypot(o.x - x, o.y - y));
        if (d < clear) continue;
        const score = Math.hypot(near.x - x, near.y - y);
        if (score < bestScore) { bestScore = score; best = { x: x, y: y }; }
      }
    }
    return best || bestSpot(avoid);
  }

  // ── the bots ─────────────────────────────────────────────────────────────
  //
  // NAIVE   never varies and never reads the room. It attacks from the same
  //         side, treats every attack marker on the floor as dangerous, and in
  //         phase three swings at whatever is nearest.
  //
  // INFORMED plays the three lessons: it BAITS the Echo into a read and then
  //         breaks it (plan.md §45 — "deliberately manipulate what the Echo
  //         expects"), it stands clear of the burning quadrant instead of
  //         dodging the stale echoes, and it goes straight for the follower
  //         that is out of step.

  async function runBot(mode, limitMs) {
    const t0 = performance.now();
    const M = {
      mode: mode,
      phaseMs: { 1: 0, 2: 0, 3: 0 },
      combatMs: 0,
      totalMs: 0,
      heartsLost: 0,
      deaths: 0,
      blocked: 0,
      punished: 0,
      deflected: 0,
      unanimityBreaks: 0,
      swings: 0,
      completed: false,
      note: '',
    };

    let lastPhase = null;
    let phaseStart = t0;
    let lastHp = P().state().hp;
    let wasDown = false;
    let baseSide = 's';
    const sides = ['s', 'e', 'w'];
    let sideIdx = 0;

    while (performance.now() - t0 < limitMs) {
      // Belt and braces: no path through this loop may ever run without
      // yielding, or the game never gets a frame.
      await wait(0);
      const st = P().state();
      if (st.hp < lastHp) M.heartsLost += lastHp - st.hp;
      if (st.hp <= 0 && !wasDown) { M.deaths++; wasDown = true; }
      if (st.hp > 0) wasDown = false;
      lastHp = st.hp;

      if (st.cutscene) { advance(); await wait(200); continue; }

      const b = B();
      const s = b && b.state();
      if (!s) { await wait(120); continue; }

      if (s.stage === 'dormant') { await goTo(240, 160, 1200); continue; }
      if (s.stage === 'dying' || s.stage === 'done') break;

      if (s.phase !== lastPhase) {
        const now = performance.now();
        if (lastPhase) M.phaseMs[lastPhase] += now - phaseStart;
        lastPhase = s.phase;
        phaseStart = now;
      }

      if (s.phase === 1) {
        let side;
        if (mode === 'naive') {
          side = 's';
        } else if (s.predicted) {
          // It has committed to a read. Break it: anywhere but there.
          side = sides.filter((x) => x !== s.predicted[0])[0] || 'e';
        } else {
          // No read yet — keep feeding it the same approach so it forms one.
          side = baseSide;
        }
        if (mode === 'informed' && s.predicted) {
          baseSide = sides[(++sideIdx) % sides.length];
        }
        M.swings++;
        await strikeSide(s.x, s.y - 26, side, 1500);
      } else if (s.phase === 2) {
        if (s.staggered) {
          M.swings++;
          await strikeAt(s.x, s.y, 1000);
        } else {
          if (mode === 'informed') {
            // Knows the rule, so stays out of the fire-lit quadrant and no
            // further — waiting next to the Echo for it to over-commit.
            const lit = s.braziers.filter((x) => x.lit);
            if (lit.length) {
              const spot = safeSpotNear(lit, 96, { x: s.x, y: s.y + 20 });
              await goTo(spot.x, spot.y, 420);
            } else {
              await goTo(s.x, s.y + 34, 300);
            }
          } else {
            // Cannot tell a real mark from an echo of one, so treats them all
            // as real and spends the whole wave running from ghosts.
            if (s.indicators.length) {
              const spot = bestSpot(s.indicators);
              await goTo(spot.x, spot.y, 420);
            } else {
              await wait(70);
            }
          }
        }
      } else {
        if (!s.unanimous || s.staggered) {
          M.swings++;
          await strikeAt(s.x, s.y, 900);
        } else {
          const alive = s.followers.filter((f) => !f.dissenting);
          let target = null;
          if (mode === 'informed') {
            target = alive.filter((f) => f.odd)[0] || alive[0];
          } else {
            // Nearest thing in front of it. No idea which one matters.
            const p = player();
            let bd = 1e9;
            for (const f of alive) {
              const d = Math.hypot(f.x - p.x, f.y - p.y);
              if (d < bd) { bd = d; target = f; }
            }
          }
          if (target) { M.swings++; await strikeAt(target.x, target.y, 900); }
          else await wait(80);
        }
      }
    }

    if (lastPhase) M.phaseMs[lastPhase] += performance.now() - phaseStart;
    M.combatMs = performance.now() - t0;
    halt();

    const s = B() && B().state();
    if (!s || (s.stage !== 'dying' && s.stage !== 'done')) {
      M.note = 'ran out of time before the Echo went down';
    }

    // Sit through the ending and confirm the run is actually finished.
    const tally = (B() && B().tally && B().tally()) || {};
    M.blocked = tally.blocked || 0;
    M.punished = tally.punished || 0;
    M.deflected = tally.deflected || 0;
    M.unanimityBreaks = tally.broken || 0;

    await advanceUntil(() => P().flags()['game_complete'], 150000);
    M.completed = !!P().flags()['game_complete'];
    M.totalMs = performance.now() - t0;
    return M;
  }

  return {
    wait, until, player, move, halt, attack, dash, advance, advanceUntil,
    goTo, strikeSide, strikeAt, bestSpot, runBot,
  };
})();
`;
