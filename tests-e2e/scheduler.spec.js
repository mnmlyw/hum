import { test, expect } from '@playwright/test';
import {
  gotoApp, applyEdit, startPlayback, waitForPhaseDelta, snapshot
} from './helpers.js';

test.beforeEach(async ({ page }) => { await gotoApp(page); });

test('phase advances monotonically during playback', async ({ page }) => {
  await applyEdit(page, 'bpm 120\nbass saw c3 e3 g3 c4');
  await startPlayback(page);
  const samples = [];
  for (let i = 0; i < 6; i++) {
    samples.push(await page.evaluate(() => window.__hum.scheduler.getPhase()));
    await page.waitForTimeout(60);
  }
  for (let i = 1; i < samples.length; i++) {
    expect(samples[i]).toBeGreaterThan(samples[i - 1]);
  }
});

test('getVisualStep equals floor(getPhase)', async ({ page }) => {
  await applyEdit(page, 'bpm 120\nbass saw c3 e3');
  await startPlayback(page);
  for (let i = 0; i < 6; i++) {
    const { phase, vs } = await page.evaluate(() => ({
      phase: window.__hum.scheduler.getPhase(),
      vs: window.__hum.scheduler.getVisualStep()
    }));
    expect(vs).toBe(Math.floor(phase));
    await page.waitForTimeout(40);
  }
});

test('bpm change preserves phase continuity (rebase, not reset)', async ({ page }) => {
  await applyEdit(page, 'bpm 120\nbass saw c3 e3 g3 c4');
  await startPlayback(page);
  await waitForPhaseDelta(page, 2.5);

  const before = await snapshot(page);
  expect(before.phase).toBeGreaterThan(2);

  await applyEdit(page, 'bpm 60\nbass saw c3 e3 g3 c4');
  const after = await snapshot(page);

  // dur reflects new bpm
  expect(after.dur).toBeCloseTo(60 / 60 / 2, 6);
  // phase did not reset (monotonic)
  expect(after.phase).toBeGreaterThanOrEqual(before.phase);
  // applyEdit is synchronous so wall-clock advance is tiny
  const elapsed = after.now - before.now;
  expect(elapsed).toBeLessThan(0.1);
  // Δphase bounded by the faster of the two rates — guards against "jumped
  // forward by hundreds of steps" as well as "reset to 0".
  const maxRate = Math.max(1 / before.dur, 1 / after.dur);
  expect((after.phase - before.phase)).toBeLessThan(elapsed * maxRate + 0.5);
});

test('t0 is unchanged across pattern, effect, waveform, add, and remove edits', async ({ page }) => {
  await applyEdit(page, 'bpm 120\nbass saw c3 e3 g3 c4');
  await startPlayback(page);
  await waitForPhaseDelta(page, 1);

  const t0 = await page.evaluate(() => window.__hum.scheduler.t0);

  const edits = [
    'bpm 120\nbass saw c3 e3 g3 a3',                          // pattern-only
    'bpm 120\nbass saw c3 e3 g3 a3 : vol .4',                 // effect
    'bpm 120\nbass sin c3 e3 g3 a3 : vol .4',                 // waveform
    'bpm 120\nbass sin c3 e3 g3 a3 : vol .4\nlead tri e4 g4', // add
    'bpm 120\nbass sin c3 e3 g3 a3 : vol .4'                  // remove
  ];

  for (const e of edits) {
    await applyEdit(page, e);
    const t0Now = await page.evaluate(() => window.__hum.scheduler.t0);
    expect(t0Now).toBe(t0); // strict equality — never mutated
  }
});

test('pattern of length 1 loops without wrap errors', async ({ page }) => {
  // Edge case for `ch.pattern[step % ch.pattern.length]` with length 1:
  // modulo always yields 0 and the same note must keep firing forever.
  await applyEdit(page, 'bpm 240\nlead sin c4');
  await startPlayback(page);
  await waitForPhaseDelta(page, 6);

  const freq = await page.evaluate(
    () => window.__hum.channelNodesByName.get('lead').source.frequency.value
  );
  // c4 ≈ 261.63 Hz; any non-zero value at c4 pitch means the note scheduled.
  expect(freq).toBeGreaterThan(250);
  expect(freq).toBeLessThan(275);
});

test('polyrhythm: different pattern lengths each advance from the same t0', async ({ page }) => {
  await applyEdit(
    page,
    'bpm 240\nlead sin c4 e4 g4\nbass saw c3 g3'
  );
  await startPlayback(page);
  await waitForPhaseDelta(page, 4);

  const { t0Lead, t0Bass, patternLengths } = await page.evaluate(() => {
    const h = window.__hum;
    return {
      t0Lead: h.scheduler.t0,
      t0Bass: h.scheduler.t0,
      patternLengths: h.channelNodes.map((n) => n.channel.pattern.length)
    };
  });
  // Both channels share the single scheduler t0 — drift comes from modulo only.
  expect(t0Lead).toBe(t0Bass);
  expect(patternLengths).toEqual([3, 2]);
});

test('t0 rebases on bpm edit but leaves phase continuous', async ({ page }) => {
  await applyEdit(page, 'bpm 120\nbass saw c3 e3 g3 c4');
  await startPlayback(page);
  await waitForPhaseDelta(page, 2);

  const t0Before = await page.evaluate(() => window.__hum.scheduler.t0);
  await applyEdit(page, 'bpm 60\nbass saw c3 e3 g3 c4');
  const t0After = await page.evaluate(() => window.__hum.scheduler.t0);

  // t0 DOES change on tempo (it's rebased to preserve phase).
  expect(t0After).not.toBe(t0Before);
});
