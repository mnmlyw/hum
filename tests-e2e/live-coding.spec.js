import { test, expect } from '@playwright/test';

const URL = 'index.html?test=1';

async function setEditor(page, text) {
  await page.evaluate((t) => window.__hum.setEditor(t), text);
}

async function startPlayback(page) {
  await page.click('#play-btn');
  // wait for scheduler to exist and phase to advance past 0
  await page.waitForFunction(() => {
    const h = window.__hum;
    return h.isPlaying && h.scheduler && h.scheduler.getPhase() > 0.2;
  });
}

// Wait until the scheduler's phase crosses an integer step at least N times.
async function waitSteps(page, n) {
  const start = await page.evaluate(() => window.__hum.scheduler.getPhase());
  await page.waitForFunction((target) =>
    window.__hum.scheduler.getPhase() >= target,
    start + n
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto(URL);
  // give the default hum time to parse
  await page.waitForFunction(() => window.__hum && window.__hum.parse);
});

test('editor loads with default hum and 6 channels parsed', async ({ page }) => {
  const channels = await page.evaluate(() => {
    const text = document.querySelector('#editor').value;
    return window.__hum.parse(text).channels.map(c => c.name);
  });
  expect(channels).toEqual(['lead', 'arp', 'pad', 'bass', 'kick', 'hat']);
});

test('playhead highlights the current note on each channel', async ({ page }) => {
  await setEditor(page, 'bpm 120\npluck sin c4 e4 g4 c5');
  await startPlayback(page);

  // Every actual note token must appear as .playing at some point during one
  // pattern cycle. Matching by text catches "phantom token consumes a step
  // index" regressions that looking at data-s alone would miss.
  const expected = new Set(['c4', 'e4', 'g4', 'c5']);
  const seen = new Set();
  for (let i = 0; i < 80 && seen.size < expected.size; i++) {
    const texts = await page.$$eval('.pt.playing', els =>
      els.map(e => e.textContent.trim()).filter(Boolean));
    for (const t of texts) if (expected.has(t)) seen.add(t);
    await page.waitForTimeout(40);
  }
  expect([...seen].sort()).toEqual([...expected].sort());
});

test('changing bpm preserves beat phase (no jump)', async ({ page }) => {
  await setEditor(page, 'bpm 120\nbass saw c3 e3 g3 c4');
  await startPlayback(page);
  await waitSteps(page, 2);

  const before = await page.evaluate(() => {
    const s = window.__hum.scheduler;
    return { phase: s.getPhase(), dur: s.dur, t0: s.t0, now: window.__hum.audioCtx.currentTime };
  });

  await setEditor(page, 'bpm 180\nbass saw c3 e3 g3 c4');
  // debounced onInput = 300ms
  await page.waitForTimeout(450);

  const after = await page.evaluate(() => {
    const s = window.__hum.scheduler;
    return { phase: s.getPhase(), dur: s.dur, t0: s.t0, now: window.__hum.audioCtx.currentTime };
  });

  // dur changed
  expect(Math.abs(after.dur - 60 / 180 / 2)).toBeLessThan(1e-6);
  // phase is continuous: rebased phase should be close to what `before` would
  // have become in the new grid, not reset to 0.
  expect(after.phase).toBeGreaterThan(before.phase);
  // and definitely not reset
  expect(after.phase).toBeGreaterThan(1);
});

test('adding a channel does not reset phase and new node appears', async ({ page }) => {
  await setEditor(page, 'bpm 120\nbass saw c3 e3 g3 c4');
  await startPlayback(page);
  await waitSteps(page, 3);

  const phaseBefore = await page.evaluate(() => window.__hum.scheduler.getPhase());
  const countBefore = await page.evaluate(() => window.__hum.channelNodes.length);
  expect(countBefore).toBe(1);

  await setEditor(page, 'bpm 120\nbass saw c3 e3 g3 c4\npluck sin c4 e4 g4 c5');
  await page.waitForTimeout(450);

  const after = await page.evaluate(() => ({
    phase: window.__hum.scheduler.getPhase(),
    count: window.__hum.channelNodes.length,
    names: window.__hum.channelNodes.map(n => n.channel.name)
  }));

  expect(after.count).toBe(2);
  expect(after.names).toEqual(['bass', 'pluck']);
  // phase kept moving forward across the edit
  expect(after.phase).toBeGreaterThan(phaseBefore);
});

test('removing a channel stops scheduling for it without killing others', async ({ page }) => {
  await setEditor(page, 'bpm 120\nbass saw c3 e3 g3 c4\npluck sin c4 e4 g4 c5');
  await startPlayback(page);
  await waitSteps(page, 2);

  await setEditor(page, 'bpm 120\nbass saw c3 e3 g3 c4');
  await page.waitForTimeout(450);

  const after = await page.evaluate(() => ({
    count: window.__hum.channelNodes.length,
    names: window.__hum.channelNodes.map(n => n.channel.name),
    isPlaying: window.__hum.isPlaying
  }));

  expect(after.count).toBe(1);
  expect(after.names).toEqual(['bass']);
  expect(after.isPlaying).toBe(true);
});

test('waveform swap keeps scheduler running, no rebuild silence', async ({ page }) => {
  await setEditor(page, 'bpm 120\nbass saw c3 e3 g3 c4');
  await startPlayback(page);
  await waitSteps(page, 2);

  const beforeT0 = await page.evaluate(() => window.__hum.scheduler.t0);

  await setEditor(page, 'bpm 120\nbass sin c3 e3 g3 c4');
  await page.waitForTimeout(450);

  const afterT0 = await page.evaluate(() => window.__hum.scheduler.t0);
  const waveformNow = await page.evaluate(() =>
    window.__hum.channelNodesByName.get('bass').channel.waveform);

  // t0 must not jump (would indicate a full Scheduler restart)
  expect(Math.abs(afterT0 - beforeT0)).toBeLessThan(0.001);
  expect(waveformNow).toBe('sin');
});

test('reordering channels keeps audio identity (registry tracks by name)', async ({ page }) => {
  await setEditor(page, 'bpm 120\nbass saw c3 e3 g3 c4\npluck sin c4 e4 g4 c5');
  await startPlayback(page);
  await waitSteps(page, 2);

  await page.evaluate(() => {
    window.__hum.__bassRef = window.__hum.channelNodesByName.get('bass');
  });

  await setEditor(page, 'bpm 120\npluck sin c4 e4 g4 c5\nbass saw c3 e3 g3 c4');
  await page.waitForTimeout(450);

  const identical = await page.evaluate(() =>
    window.__hum.__bassRef === window.__hum.channelNodesByName.get('bass'));
  const orderedNames = await page.evaluate(() =>
    window.__hum.channelNodes.map(n => n.channel.name));

  expect(identical).toBe(true);
  expect(orderedNames).toEqual(['pluck', 'bass']);
});

test('c5 on single-line channel def is highlighted (regression)', async ({ page }) => {
  await setEditor(page, 'bpm 120\npluck sin c4 e4 g4 c5');
  await startPlayback(page);

  // Before the fix, an empty phantom token after "pluck sin" consumed step 0,
  // shifting c5 to data-s="4" where it never got highlighted.
  // Check the c5 span itself receives .playing.
  let c5Highlighted = false;
  for (let i = 0; i < 80 && !c5Highlighted; i++) {
    c5Highlighted = await page.evaluate(() => {
      const spans = document.querySelectorAll('.pt.nt');
      for (const s of spans) {
        if (s.textContent.trim() === 'c5' && s.classList.contains('playing')) return true;
      }
      return false;
    });
    await page.waitForTimeout(40);
  }
  expect(c5Highlighted).toBe(true);
});

test('parse errors do not kill playback', async ({ page }) => {
  await setEditor(page, 'bpm 120\nbass saw c3 e3 g3 c4');
  await startPlayback(page);
  await waitSteps(page, 2);

  // Introduce garbage mid-pattern
  await setEditor(page, 'bpm 120\nbass saw c3 e3 xyz c4');
  await page.waitForTimeout(450);

  const stillPlaying = await page.evaluate(() => ({
    isPlaying: window.__hum.isPlaying,
    count: window.__hum.channelNodes.length
  }));
  expect(stillPlaying.isPlaying).toBe(true);
  expect(stillPlaying.count).toBe(1);
});
