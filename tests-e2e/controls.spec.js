import { test, expect } from '@playwright/test';
import { gotoApp, applyEdit } from './helpers.js';

test.beforeEach(async ({ page }) => { await gotoApp(page); });

test('Control+Enter toggles playback', async ({ page }) => {
  await applyEdit(page, 'bpm 120\nlead sin c4 e4');

  await page.keyboard.press('Control+Enter');
  await page.waitForFunction(() => window.__hum.isPlaying);
  expect(await page.locator('#play-btn').textContent()).toBe('stop');

  await page.keyboard.press('Control+Enter');
  await page.waitForFunction(() => !window.__hum.isPlaying);
  expect(await page.locator('#play-btn').textContent()).toBe('play');
});

test('Tab in the editor inserts 2 spaces at the caret', async ({ page }) => {
  await page.evaluate(() => {
    const ed = document.getElementById('editor');
    ed.value = 'lead sin\n';
    ed.focus();
    ed.selectionStart = ed.selectionEnd = ed.value.length;
  });
  await page.keyboard.press('Tab');
  const { value, caret } = await page.evaluate(() => {
    const ed = document.getElementById('editor');
    return { value: ed.value, caret: ed.selectionStart };
  });
  expect(value).toBe('lead sin\n  ');
  expect(caret).toBe(value.length);
});

test('play button is a no-op when there are no parseable channels', async ({ page }) => {
  await applyEdit(page, '-- only a comment');
  await page.click('#play-btn');
  // startPlayback returns early before scheduler/isPlaying get set.
  expect(await page.evaluate(() => window.__hum.isPlaying)).toBe(false);
  expect(await page.evaluate(() => window.__hum.scheduler)).toBe(null);
});
