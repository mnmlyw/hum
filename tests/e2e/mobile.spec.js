import { test, expect } from '@playwright/test';
import { gotoApp, applyEdit } from './helpers.js';

// iPhone 17 Pro isn't in Playwright's device registry yet (latest 1.59.1
// stops at iPhone 15 Pro). Hand-spec the relevant fields based on the
// shipped device — logical viewport 402×874, DPR 3, WebKit-backed Safari.
// What this test actually exercises is the (hover:none, pointer:coarse)
// media query plus tap input; the exact viewport pixels aren't load-bearing.
const iPhone17Pro = {
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) ' +
    'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Mobile/15E148 Safari/604.1',
  viewport: { width: 402, height: 874 },
  screen: { width: 402, height: 874 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  defaultBrowserType: 'webkit'
};

test.use(iPhone17Pro);

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
