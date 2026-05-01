import { test, expect } from '@playwright/test';
import { gotoApp, applyEdit } from './helpers.js';

test.beforeEach(async ({ page }) => { await gotoApp(page); });

test('Control+Enter starts playback when stopped', async ({ page }) => {
  await applyEdit(page, 'bpm 120\nlead sin c4 e4');

  await page.keyboard.press('Control+Enter');
  await page.waitForFunction(() => window.__hum.isPlaying);
  expect(await page.locator('#play-btn').textContent()).toBe('stop');
});

test('Escape stops playback (no-op when already stopped)', async ({ page }) => {
  await applyEdit(page, 'bpm 120\nlead sin c4 e4');
  // Esc while stopped: nothing happens.
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.__hum.isPlaying)).toBe(false);

  await page.click('#play-btn');
  await page.waitForFunction(() => window.__hum.isPlaying);

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.__hum.isPlaying);
  expect(await page.locator('#play-btn').textContent()).toBe('play');
});

test('Control+Enter while playing force-applies pending edits without stopping', async ({ page }) => {
  // Live edits land via a 300ms debounce. Power users who want changes to
  // take effect immediately can press Cmd+Enter while playing — it cancels
  // the debounce, runs onInput, and leaves playback alive.
  await applyEdit(page, 'bpm 120\nlead sin c4 e4');
  await page.keyboard.press('Control+Enter');
  await page.waitForFunction(() => window.__hum.isPlaying);

  // Type into the editor in a way that schedules the debounce (this path
  // mirrors normal user input — applyEdit bypasses debounce, so we drive
  // the editor directly instead).
  await page.evaluate(() => {
    const ed = document.getElementById('editor');
    ed.focus();
    ed.value = 'bpm 120\nlead sin c4 e4\nbass saw c2';
    ed.dispatchEvent(new Event('input', { bubbles: true }));
  });
  // Before the flush, liveUpdate hasn't seen the new channel yet (debounce
  // is still pending — channelNodes still has 1 entry).
  expect(
    await page.evaluate(() => window.__hum.channelNodes.length)
  ).toBe(1);

  // Cmd+Enter while playing flushes the debounce and applies the edit.
  await page.keyboard.press('Control+Enter');
  await page.waitForFunction(() => window.__hum.channelNodes.length === 2);
  expect(await page.evaluate(() => window.__hum.isPlaying)).toBe(true);
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

test('rapid clicks during startup create exactly one scheduler (re-entrancy guard)', async ({ page }) => {
  // Before the guard, the `await audioCtx.resume()` inside startPlayback opened
  // a window where a second click would build a second Scheduler, overwrite the
  // global reference, and leave the first scheduler's worker listener orphaned.
  await applyEdit(page, 'bpm 120\nlead sin c4 e4');
  await page.evaluate(() => {
    const btn = document.getElementById('play-btn');
    btn.click();
    btn.click();
    btn.click();
  });
  await page.waitForFunction(() => window.__hum.isPlaying);
  expect(await page.evaluate(() => window.__hum.schedulerCreations)).toBe(1);
});

test('preset picker loads the selected demo into the editor', async ({ page }) => {
  await page.locator('#preset-picker').selectOption('glass');
  // The glass demo always parses to 6 channels with bpm 96.
  const { bpm, count } = await page.evaluate(() => {
    const h = window.__hum.parse(document.getElementById('editor').value);
    return { bpm: h.bpm, count: h.channels.length };
  });
  expect(bpm).toBe(96);
  expect(count).toBe(6);
  // Picker resets to the placeholder option after selection.
  expect(await page.locator('#preset-picker').inputValue()).toBe('');
});

test('autosave: edits persist across reload', async ({ page }) => {
  const sentinel = 'lead sin c4 e4 g4 c5 -- autosave probe';
  await applyEdit(page, sentinel);
  // Wait past the 500ms autosave debounce.
  await page.waitForTimeout(700);
  await page.reload();
  await page.waitForFunction(() => window.__hum && window.__hum.parse);
  const value = await page.evaluate(() => document.getElementById('editor').value);
  expect(value).toBe(sentinel);
});

test('autosave: ?reset=1 ignores stored buffer and reseeds default', async ({ page }) => {
  await applyEdit(page, 'lead sin c4');
  await page.waitForTimeout(700);
  await page.goto('index.html?test=1&reset=1');
  await page.waitForFunction(() => window.__hum && window.__hum.parse);
  const value = await page.evaluate(() => document.getElementById('editor').value);
  expect(value.startsWith('bpm 96')).toBe(true); // DEFAULT_HUM begins with bpm 96
});

test('per-channel meters appear during playback and clear on stop', async ({ page }) => {
  await applyEdit(page, 'bpm 120\nlead saw c3 e3 g3 c4\nbass saw c2 g2');
  await page.click('#play-btn');
  await page.waitForFunction(() => window.__hum.isPlaying);

  // Meter elements track live channelNodes; one bar per playing channel.
  await page.waitForFunction(
    () => document.querySelectorAll('#meters .meter').length === 2
  );

  // At least one bar lights up within a few frames of audio.
  await page.waitForFunction(() => {
    const m = document.querySelectorAll('#meters .meter');
    return [...m].some((el) => parseFloat(el.style.getPropertyValue('--lvl')) > 0);
  }, null, { timeout: 3000 });

  await page.click('#play-btn');
  await page.waitForFunction(() => !window.__hum.isPlaying);
  await page.waitForFunction(() => {
    const m = document.querySelectorAll('#meters .meter');
    return [...m].every((el) => el.style.getPropertyValue('--lvl') === '0%');
  });
});

test('play button is a no-op when there are no parseable channels', async ({ page }) => {
  await applyEdit(page, '-- only a comment');
  await page.click('#play-btn');
  // startPlayback returns early before scheduler/isPlaying get set.
  expect(await page.evaluate(() => window.__hum.isPlaying)).toBe(false);
  expect(await page.evaluate(() => window.__hum.scheduler)).toBe(null);
});
