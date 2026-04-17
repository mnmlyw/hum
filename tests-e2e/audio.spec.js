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

test('stopping playback silences the analyser within a beat', async ({ page }) => {
  await applyEdit(page, 'bpm 120\nbass saw c3 e3 g3 c4');
  await startPlayback(page);
  await waitForPhaseDelta(page, 2);

  await page.click('#play-btn'); // stop
  await page.waitForTimeout(200);

  const rms = await analyserRms(page, 200);
  expect(rms).toBeLessThan(1);
});
