export const APP_URL = 'index.html?test=1';

export async function gotoApp(page) {
  await page.goto(APP_URL);
  await page.waitForFunction(() => window.__hum && window.__hum.parse);
}

// Synchronously apply an edit — bypasses the 300ms input debounce so tests
// don't need to waitForTimeout. onInput runs parse → updateHighlight →
// liveUpdate inline, so state is fully settled when this resolves.
export async function applyEdit(page, text) {
  await page.evaluate((t) => window.__hum.applyEdit(t), text);
}

export async function startPlayback(page) {
  await page.click('#play-btn');
  await page.waitForFunction(() => {
    const h = window.__hum;
    return h.isPlaying && h.scheduler && h.scheduler.getPhase() > 0.05;
  });
}

// Wait until the scheduler phase has advanced by `delta` from whatever it is now.
export async function waitForPhaseDelta(page, delta) {
  const start = await page.evaluate(() => window.__hum.scheduler.getPhase());
  await page.waitForFunction(
    (target) => window.__hum.scheduler.getPhase() >= target,
    start + delta,
    { timeout: 5000 }
  );
}

// Read a dense state snapshot in one round-trip.
export async function snapshot(page) {
  return page.evaluate(() => {
    const h = window.__hum;
    const s = h.scheduler;
    return {
      now: h.audioCtx.currentTime,
      isPlaying: h.isPlaying,
      phase: s ? s.getPhase() : null,
      step: s ? s.step : null,
      dur: s ? s.dur : null,
      t0: s ? s.t0 : null,
      names: h.channelNodes.map((n) => n.channel.name),
      keys: [...h.channelNodesByName.keys()]
    };
  });
}

// Measure RMS of the analyser's time-domain buffer over `windowMs` wall-clock.
// Returns a positive number; audible playback should be well above 1.
export async function analyserRms(page, windowMs = 200) {
  return page.evaluate(
    (ms) =>
      new Promise((resolve) => {
        const a = window.__hum.analyser;
        const buf = new Uint8Array(a.fftSize);
        let sumSq = 0;
        let count = 0;
        const t0 = performance.now();
        function tick() {
          a.getByteTimeDomainData(buf);
          for (let i = 0; i < buf.length; i++) {
            const v = buf[i] - 128;
            sumSq += v * v;
          }
          count += buf.length;
          if (performance.now() - t0 < ms) requestAnimationFrame(tick);
          else resolve(Math.sqrt(sumSq / count));
        }
        tick();
      }),
    windowMs
  );
}

export async function playingNoteTexts(page) {
  return page.$$eval('.pt.playing', (els) =>
    els.map((e) => e.textContent.trim()).filter(Boolean)
  );
}

// Poll until every expected note text has appeared as .playing at least once.
// Returns the set actually seen (so callers can assert equality).
export async function collectPlayingNotes(page, expected, {
  pollMs = 40, maxPolls = 120
} = {}) {
  const want = new Set(expected);
  const seen = new Set();
  for (let i = 0; i < maxPolls && seen.size < want.size; i++) {
    for (const t of await playingNoteTexts(page)) {
      if (want.has(t)) seen.add(t);
    }
    await page.waitForTimeout(pollMs);
  }
  return seen;
}
