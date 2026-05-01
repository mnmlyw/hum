import { test, expect } from '@playwright/test';
import { gotoApp } from './helpers.js';

test.beforeEach(async ({ page }) => { await gotoApp(page); });

const parse = (page, text) =>
  page.evaluate((t) => window.__hum.parse(t), text);

test('bpm below 20 clamps up to 20 and reports an error', async ({ page }) => {
  const r = await parse(page, 'bpm 10\nlead sin c4');
  expect(r.bpm).toBe(20);
  expect(r.errors.some((e) => /bpm/i.test(e.message))).toBe(true);
});

test('bpm above 999 clamps down to 999 and reports an error', async ({ page }) => {
  const r = await parse(page, 'bpm 5000\nlead sin c4');
  expect(r.bpm).toBe(999);
  expect(r.errors.some((e) => /bpm/i.test(e.message))).toBe(true);
});

test('9th channel is dropped with a MAX_CHANNELS error', async ({ page }) => {
  const text = Array.from({ length: 10 }, (_, i) => `c${i} sin c4`).join('\n');
  const r = await parse(page, text);
  expect(r.channels).toHaveLength(8);
  expect(r.errors.some((e) => /8 channels/i.test(e.message))).toBe(true);
});

test('unknown effect name is reported as an error', async ({ page }) => {
  const r = await parse(page, 'lead sin c4 : wobble .5');
  expect(r.errors.some((e) => /unknown effect.*wobble/i.test(e.message))).toBe(true);
});

test('removed effects attack / sustain / release are rejected as unknown', async ({ page }) => {
  const r = await parse(page, 'lead sin c4 : attack .2 sustain .5 release .1');
  const combined = r.errors.map((e) => e.message).join(' ');
  expect(combined).toMatch(/attack/);
  expect(combined).toMatch(/sustain/);
  expect(combined).toMatch(/release/);
});

test('missing effect value reports an "invalid value" error', async ({ page }) => {
  const r = await parse(page, 'lead sin c4 : vol');
  expect(r.errors.some((e) => /invalid value.*vol/i.test(e.message))).toBe(true);
});

test('non-finite effect values are rejected (Infinity, overflow)', async ({ page }) => {
  // parseFloat("Infinity") and parseFloat("1e309") both yield Infinity.
  // Passing Infinity to exponentialRampToValueAtTime or AudioParam.value
  // throws RangeError inside scheduler.tick, leaking a worker listener on
  // the half-started scheduler. Parser must reject before it gets there.
  for (const text of [
    'lead sin c4 : decay Infinity',
    'lead sin c4 : lpf 1e309',
    'lead sin c4 : vol -Infinity'
  ]) {
    const r = await parse(page, text);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.channels[0].effects.decay).not.toBe(Infinity);
    expect(r.channels[0].effects.lpf).not.toBe(Infinity);
  }
});

test('flat and sharp notes map to the same frequency', async ({ page }) => {
  const r = await parse(page, 'lead sin eb3 d#3 bb4 a#4');
  const p = r.channels[0].pattern;
  expect(p[0].freq).toBeCloseTo(p[1].freq, 6);
  expect(p[2].freq).toBeCloseTo(p[3].freq, 6);
});

test('cb wraps to the previous octave (cb4 equals b3)', async ({ page }) => {
  const r = await parse(page, 'lead sin cb4 b3');
  const p = r.channels[0].pattern;
  expect(p[0].freq).toBeCloseTo(p[1].freq, 6);
});

test('underscore is treated as a rest, same as dot', async ({ page }) => {
  const r = await parse(page, 'lead sin c4 _ c4 .');
  expect(r.channels[0].pattern.map((s) => s.type))
    .toEqual(['note', 'rest', 'note', 'rest']);
});

test('comment on a continuation line does not swallow following continuations', async ({ page }) => {
  const r = await parse(
    page,
    ['lead sin', '  c4 e4 -- first bar', '  g4 c5'].join('\n')
  );
  expect(r.channels[0].pattern.map((s) => s.name)).toEqual(['c4', 'e4', 'g4', 'c5']);
});

test('negative decay is clamped to 0 (guards exponentialRampToValueAtTime)', async ({ page }) => {
  // Without the clamp, scheduler.tick would hand a negative endTime to
  // exponentialRampToValueAtTime and throw on every tick, killing the scheduler.
  const r = await parse(page, 'lead sin c4 : decay -.5');
  expect(r.channels[0].effects.decay).toBeGreaterThanOrEqual(0);
});

test('vol is clamped to [0, 1]', async ({ page }) => {
  const high = await parse(page, 'lead sin c4 : vol 2');
  expect(high.channels[0].effects.vol).toBe(1);
  const low = await parse(page, 'lead sin c4 : vol -.5');
  expect(low.channels[0].effects.vol).toBe(0);
});

test('bar line is ignored as a pattern separator', async ({ page }) => {
  const r = await parse(page, 'lead sin c4 | e4 | g4');
  expect(r.channels[0].pattern).toHaveLength(3);
  expect(r.channels[0].pattern.map((s) => s.name)).toEqual(['c4', 'e4', 'g4']);
});
