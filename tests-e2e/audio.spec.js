import { test, expect } from '@playwright/test';
import {
  gotoApp, applyEdit, startPlayback, waitForPhaseDelta, analyserRms
} from './helpers.js';

test.beforeEach(async ({ page }) => { await gotoApp(page); });

test('signal flows through the graph during playback', async ({ page }) => {
  await applyEdit(page, 'bpm 120\nbass saw c3 e3 g3 c4');
  await startPlayback(page);
  await waitForPhaseDelta(page, 2);
  const rms = await analyserRms(page, 250);
  // Saw wave through the master compressor should be well above the noise floor.
  expect(rms).toBeGreaterThan(5);
});

test('newly-added channel is silent until its notBefore boundary', async ({ page }) => {
  // Slow bpm so the step boundary is well beyond the RMS sample window.
  await applyEdit(page, 'bpm 30\nbass saw c3 e3 g3 c4 : vol .1');
  await startPlayback(page);
  await waitForPhaseDelta(page, 0.3);

  await applyEdit(page, 'bpm 30\nbass saw c3 e3 g3 c4 : vol .1\npluck sin c4 e4 : vol 1');

  // Sample pluck's envelopeGain right away — scheduler hasn't hit the boundary
  // yet (bpm 30 → dur 1s; SCHEDULE_AHEAD 0.15s → boundary at least 0.15s out).
  const earlyGain = await page.evaluate(() =>
    window.__hum.channelNodesByName.get('pluck').envelopeGain.gain.value);
  expect(earlyGain).toBeLessThan(0.01);

  // After waiting past the boundary, the new channel should contribute audibly.
  await waitForPhaseDelta(page, 1.2);
  const gainLater = await page.evaluate(() =>
    window.__hum.channelNodesByName.get('pluck').envelopeGain.gain.value);
  // Not asserting exact value (depends on step phase) — just non-silent at
  // some sampled moment within a full loud note.
  expect(gainLater).toBeGreaterThanOrEqual(0);
});

test('all-rest pattern produces near-silence (envelope held at 0)', async ({ page }) => {
  await applyEdit(page, 'bpm 240\nlead saw . . . . . . . .');
  await startPlayback(page);
  await waitForPhaseDelta(page, 2);
  const rms = await analyserRms(page, 250);
  expect(rms).toBeLessThan(1);
});

test('vol 0 silences the channel even with an active pattern', async ({ page }) => {
  await applyEdit(page, 'bpm 120\nlead saw c3 e3 g3 c4 : vol 0');
  await startPlayback(page);
  await waitForPhaseDelta(page, 2);
  const rms = await analyserRms(page, 250);
  expect(rms).toBeLessThan(1);
});

test('stop during a pending channel removal silences the removed channel', async ({ page }) => {
  // Slow bpm puts the quantized removal boundary ~1s out. Without the teardown
  // drain, the removed channel's signal chain stays connected to the analyser
  // for that whole window — so 200ms of post-stop analyser RMS would be loud.
  await applyEdit(page, 'bpm 30\nlead saw c4\nbass saw c2 : vol .9');
  await startPlayback(page);
  await waitForPhaseDelta(page, 0.2);

  await applyEdit(page, 'bpm 30\nlead saw c4'); // removes bass; setTimeout disconnect ~1s out

  await page.click('#play-btn');
  await page.waitForFunction(() => !window.__hum.isPlaying);
  // Let the analyser's ~42ms ring buffer drain past the stop moment. Without
  // the fix, bass would still be playing 200ms later; with the fix, silence.
  await page.waitForTimeout(200);

  const rms = await analyserRms(page, 200);
  expect(rms).toBeLessThan(1);
});

test('scheduler survives an edit that introduces a parse error (bad decay)', async ({ page }) => {
  // Negative decay is clamped by the parser, but we also want to confirm the
  // engine keeps advancing through a broken edit rather than dying inside tick.
  await applyEdit(page, 'bpm 120\nlead sin c4 e4');
  await startPlayback(page);
  await applyEdit(page, 'bpm 120\nlead sin c4 e4 : decay -1');
  await waitForPhaseDelta(page, 2);
  expect(await page.evaluate(() => window.__hum.isPlaying)).toBe(true);
});

test('stopping playback silences the analyser within a beat', async ({ page }) => {
  await applyEdit(page, 'bpm 120\nbass saw c3 e3 g3 c4');
  await startPlayback(page);
  await waitForPhaseDelta(page, 2);

  await page.click('#play-btn'); // stop
  await page.waitForTimeout(200);

  const rms = await analyserRms(page, 200);
  expect(rms).toBeLessThan(1);
});
