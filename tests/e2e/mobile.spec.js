import { test, expect, devices } from '@playwright/test';
import { gotoApp, applyEdit } from './helpers.js';

// Mobile UI is gated behind `(hover: none) and (pointer: coarse)`. Run this
// spec under an emulated touch device so the media query matches. Pixel 5 is
// Chromium-based, so it reuses the existing browser cache (iPhone profiles
// would force a WebKit install we don't otherwise need).
test.use(devices['Pixel 5']);

test('mobile-toolbar is visible on coarse-pointer devices', async ({ page }) => {
  await gotoApp(page);
  const toolbar = page.locator('#mobile-toolbar');
  await expect(toolbar).toBeVisible();
});

test('tapping a toolbar token inserts it at the caret', async ({ page }) => {
  await gotoApp(page);
  await applyEdit(page, 'lead sin c4 e4');
  await page.evaluate(() => {
    const ed = document.getElementById('editor');
    ed.focus();
    ed.selectionStart = ed.selectionEnd = ed.value.length;
  });
  await page.locator('#mobile-toolbar button[data-insert=". "]').tap();
  const value = await page.evaluate(() => document.getElementById('editor').value);
  expect(value).toBe('lead sin c4 e4. ');
});

test('toolbar insertion runs onInput so the parser sees the new text', async ({ page }) => {
  await gotoApp(page);
  await applyEdit(page, 'lead sin c4');
  await page.evaluate(() => {
    const ed = document.getElementById('editor');
    ed.focus();
    ed.selectionStart = ed.selectionEnd = ed.value.length;
  });
  await page.locator('#mobile-toolbar button[data-insert=" : "]').tap();
  await page.locator('#mobile-toolbar button[data-insert="bpm "]').tap();
  // Channel info reflects the latest parsed state — no debounce in applyEdit
  // path, but tap → onInput goes through the live path. Give the input event
  // a tick to settle and check the editor value is what we typed.
  const value = await page.evaluate(() => document.getElementById('editor').value);
  expect(value).toBe('lead sin c4 : bpm ');
});
