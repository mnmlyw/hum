import { test, expect } from '@playwright/test';
import {
  gotoApp, applyEdit, startPlayback, collectPlayingNotes
} from './helpers.js';

test.beforeEach(async ({ page }) => { await gotoApp(page); });

test('parses the shipped default hum into 6 channels in order', async ({ page }) => {
  const names = await page.evaluate(() =>
    window.__hum.parse(document.querySelector('#editor').value).channels.map(c => c.name)
  );
  expect(names).toEqual(['lead', 'arp', 'pad', 'bass', 'kick', 'hat']);
});

test('single-line channel def: every note highlights at its turn (c5 regression)', async ({ page }) => {
  await applyEdit(page, 'bpm 120\npluck sin c4 e4 g4 c5');
  await startPlayback(page);
  const seen = await collectPlayingNotes(page, ['c4', 'e4', 'g4', 'c5']);
  expect([...seen].sort()).toEqual(['c4', 'c5', 'e4', 'g4']);
});

test('continuation-line pattern: notes across indented lines all highlight', async ({ page }) => {
  await applyEdit(page, 'bpm 160\nlead tri\n  c4 d4\n  e4 f4');
  await startPlayback(page);
  const seen = await collectPlayingNotes(page, ['c4', 'd4', 'e4', 'f4']);
  expect([...seen].sort()).toEqual(['c4', 'd4', 'e4', 'f4']);
});

test('unknown note receives .er class and no data-s phantom', async ({ page }) => {
  await applyEdit(page, 'bpm 120\nbass saw c3 xyz g3 c4');
  const errTexts = await page.$$eval('.er', els => els.map(e => e.textContent.trim()));
  expect(errTexts).toContain('xyz');
  // The bug we fixed: no span should exist with empty text yet a data-s attribute.
  const phantom = await page.$$eval('.pt', els =>
    els.filter(e => e.textContent === '').length);
  expect(phantom).toBe(0);
});

test('bpm line highlights keyword and number with distinct classes', async ({ page }) => {
  await applyEdit(page, 'bpm 144\nlead sin c4');
  const kwTexts = await page.$$eval('.kw', (els) => els.map((e) => e.textContent));
  const nuTexts = await page.$$eval('#highlight .nu', (els) => els.map((e) => e.textContent));
  expect(kwTexts).toContain('bpm');
  expect(nuTexts).toContain('144');
});

test('stopping playback clears all .playing classes from pattern spans', async ({ page }) => {
  await applyEdit(page, 'bpm 240\nlead sin c4 e4 g4 c5');
  await startPlayback(page);
  await page.waitForFunction(
    () => document.querySelectorAll('.pt.playing').length > 0
  );
  await page.click('#play-btn');
  await page.waitForFunction(() => !window.__hum.isPlaying);
  // drawViz, on next frame, iterates prevPlaying and removes `.playing`.
  await page.waitForFunction(
    () => document.querySelectorAll('.pt.playing').length === 0
  );
});

test('pattern-token data-s indices are contiguous per channel', async ({ page }) => {
  await applyEdit(page, 'bpm 120\npluck sin c4 e4 g4 c5');
  const indices = await page.$$eval('.pt[data-ch="0"]', els =>
    els.map(e => Number(e.dataset.s)).sort((a, b) => a - b));
  expect(indices).toEqual([0, 1, 2, 3]);
});
