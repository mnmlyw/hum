import { test, expect } from '@playwright/test';
import {
  gotoApp, applyEdit, startPlayback, waitForPhaseDelta, snapshot
} from './helpers.js';

test.beforeEach(async ({ page }) => { await gotoApp(page); });

test('pattern-only edit is zero-latency (no scheduler rewind)', async ({ page }) => {
  await applyEdit(page, 'bpm 120\nbass saw c3 e3 g3 c4');
  await startPlayback(page);
  await waitForPhaseDelta(page, 2);

  const stepBefore = await page.evaluate(() => window.__hum.scheduler.step);
  await applyEdit(page, 'bpm 120\nbass saw c3 e3 g3 a3');

  const { step, patternName } = await page.evaluate(() => ({
    step: window.__hum.scheduler.step,
    patternName: window.__hum.channelNodesByName.get('bass').channel.pattern[3].name
  }));
  // scheduler.step never rewinds for pattern-only edits
  expect(step).toBeGreaterThanOrEqual(stepBefore);
  // new pattern is visible to the next tick via shared reference
  expect(patternName).toBe('a3');
});

test('effect-only edit ramps volume to target without rebuild', async ({ page }) => {
  await applyEdit(page, 'bpm 120\nbass saw c3 e3 g3 c4 : vol .5');
  await startPlayback(page);

  const { node: bass, initialVol } = await page.evaluate(() => {
    const n = window.__hum.channelNodesByName.get('bass');
    window.__bassRef = n; // pin identity for later comparison
    return { node: true, initialVol: n.volumeGain.gain.value };
  });
  expect(bass).toBe(true);
  expect(initialVol).toBeCloseTo(0.5, 2);

  await applyEdit(page, 'bpm 120\nbass saw c3 e3 g3 c4 : vol .2 lpf 800');

  // setTargetAtTime ramps exponentially (tc = 10ms). LPF has a much bigger
  // delta (20k → 800) than volume (0.5 → 0.2), so it needs more settle time.
  await page.waitForFunction(() => {
    const n = window.__hum.channelNodesByName.get('bass');
    return Math.abs(n.volumeGain.gain.value - 0.2) < 0.02
      && n.filterLPF.frequency.value < 1000;
  }, null, { timeout: 2000 });

  const { lpfFreq, sameNode } = await page.evaluate(() => ({
    lpfFreq: window.__hum.channelNodesByName.get('bass').filterLPF.frequency.value,
    sameNode: window.__bassRef === window.__hum.channelNodesByName.get('bass')
  }));
  expect(lpfFreq).toBeLessThan(1000); // converging toward 800
  expect(sameNode).toBe(true); // identity preserved = no rebuild
});

test('absent lpf/hpf land on OPEN constants (always-present filter chain)', async ({ page }) => {
  await applyEdit(page, 'bpm 120\nbass saw c3 e3');
  await startPlayback(page);

  const values = await page.evaluate(() => ({
    lpf: window.__hum.channelNodesByName.get('bass').filterLPF.frequency.value,
    hpf: window.__hum.channelNodesByName.get('bass').filterHPF.frequency.value,
    LPF_OPEN: window.__hum.LPF_OPEN,
    HPF_OPEN: window.__hum.HPF_OPEN
  }));
  expect(values.lpf).toBeCloseTo(values.LPF_OPEN);
  expect(values.hpf).toBeCloseTo(values.HPF_OPEN);
});

test('add channel: node created with notBefore at the next step boundary', async ({ page }) => {
  await applyEdit(page, 'bpm 120\nbass saw c3 e3 g3 c4');
  await startPlayback(page);
  await waitForPhaseDelta(page, 2);

  await applyEdit(page, 'bpm 120\nbass saw c3 e3 g3 c4\npluck sin c4 e4');
  const r = await page.evaluate(() => {
    const pluck = window.__hum.channelNodesByName.get('pluck');
    const s = window.__hum.scheduler;
    return {
      notBefore: pluck.notBefore,
      now: window.__hum.audioCtx.currentTime,
      dur: s.dur,
      ahead: window.__hum.SCHEDULE_AHEAD,
      // envelope should still be at 0 before the boundary
      gainNow: pluck.envelopeGain.gain.value
    };
  });
  // notBefore beyond the lookahead but within one step past it
  expect(r.notBefore - r.now).toBeGreaterThan(r.ahead);
  expect(r.notBefore - r.now).toBeLessThan(r.ahead + r.dur + 0.05);
  // silent until the boundary hits
  expect(r.gainNow).toBeLessThan(0.01);
});

test('add channel: parse order reflected in channelNodes array', async ({ page }) => {
  await applyEdit(page, 'bpm 120\nbass saw c3 e3\npluck sin c4 e4');
  await startPlayback(page);
  await applyEdit(page, 'bpm 120\npad tri a3 b3\nbass saw c3 e3\npluck sin c4 e4');

  const names = await page.evaluate(() =>
    window.__hum.channelNodes.map(n => n.channel.name));
  expect(names).toEqual(['pad', 'bass', 'pluck']);
});

test('remove channel: registry and array drop it; existing nodes keep their identity', async ({ page }) => {
  await applyEdit(page, 'bpm 120\nbass saw c3 e3 g3 c4\nhat noise x x x x');
  await startPlayback(page);
  await waitForPhaseDelta(page, 1);

  await page.evaluate(() => {
    window.__bassRef = window.__hum.channelNodesByName.get('bass');
  });

  await applyEdit(page, 'bpm 120\nbass saw c3 e3 g3 c4');
  const r = await page.evaluate(() => ({
    keys: [...window.__hum.channelNodesByName.keys()],
    names: window.__hum.channelNodes.map(n => n.channel.name),
    bassIdentity: window.__bassRef === window.__hum.channelNodesByName.get('bass')
  }));
  expect(r.keys).toEqual(['bass']);
  expect(r.names).toEqual(['bass']);
  expect(r.bassIdentity).toBe(true);
});

test('remove channel: removed node eventually disconnected from the graph', async ({ page }) => {
  await applyEdit(page, 'bpm 120\nbass saw c3 e3\nhat noise x x x x');
  await startPlayback(page);
  await waitForPhaseDelta(page, 1);

  // Pin a reference to the hat node before it's removed.
  await page.evaluate(() => {
    window.__hatRef = window.__hum.channelNodesByName.get('hat');
  });

  await applyEdit(page, 'bpm 120\nbass saw c3 e3');
  // Disconnect happens after applyAt + ~80ms. Wait generously.
  await page.waitForTimeout(600);

  // The pinned node's envelopeGain should be ramping to (or at) 0 — audible
  // proof that the remove path faded rather than hard-cut.
  const gain = await page.evaluate(() => window.__hatRef.envelopeGain.gain.value);
  expect(gain).toBeLessThan(0.05);
});

test('waveform swap: node.source.type reflects new waveform, identity preserved', async ({ page }) => {
  await applyEdit(page, 'bpm 120\nbass saw c3 e3 g3 c4');
  await startPlayback(page);
  await waitForPhaseDelta(page, 2);

  await page.evaluate(() => {
    window.__bassRef = window.__hum.channelNodesByName.get('bass');
  });

  await applyEdit(page, 'bpm 120\nbass sin c3 e3 g3 c4');
  await page.waitForFunction(() =>
    window.__hum.channelNodesByName.get('bass').source.type === 'sine'
  , null, { timeout: 2000 });

  const identity = await page.evaluate(() =>
    window.__bassRef === window.__hum.channelNodesByName.get('bass'));
  expect(identity).toBe(true); // swap mutated in place, not a rebuild
});

test('waveform swap: envelope is not reset (sourceGain crossfade preserves it)', async ({ page }) => {
  await applyEdit(page, 'bpm 60\nlead tri c4 e4 g4 c5 : vol .5');
  await startPlayback(page);
  await waitForPhaseDelta(page, 1);

  // The pre-existing envelopeGain AudioParam should survive the swap —
  // node.envelopeGain reference stays the same object.
  const beforeRef = await page.evaluate(() => {
    window.__envRef = window.__hum.channelNodesByName.get('lead').envelopeGain;
    return true;
  });
  expect(beforeRef).toBe(true);

  await applyEdit(page, 'bpm 60\nlead saw c4 e4 g4 c5 : vol .5');
  const sameEnv = await page.evaluate(() =>
    window.__envRef === window.__hum.channelNodesByName.get('lead').envelopeGain);
  expect(sameEnv).toBe(true);
});

test('rename: old fades, new arrives with fresh identity', async ({ page }) => {
  await applyEdit(page, 'bpm 120\nbass saw c3 e3 g3 c4');
  await startPlayback(page);
  await waitForPhaseDelta(page, 1);

  await page.evaluate(() => {
    window.__oldBass = window.__hum.channelNodesByName.get('bass');
  });

  await applyEdit(page, 'bpm 120\nbassy saw c3 e3 g3 c4');
  const r = await page.evaluate(() => ({
    hasOld: window.__hum.channelNodesByName.has('bass'),
    hasNew: window.__hum.channelNodesByName.has('bassy'),
    fresh: window.__oldBass !== window.__hum.channelNodesByName.get('bassy')
  }));
  expect(r.hasOld).toBe(false);
  expect(r.hasNew).toBe(true);
  expect(r.fresh).toBe(true);
});

test('reorder: name-keyed registry preserves node identity on both channels', async ({ page }) => {
  await applyEdit(page, 'bpm 120\nbass saw c3 e3\npluck sin c4 e4');
  await startPlayback(page);
  await waitForPhaseDelta(page, 1);

  await page.evaluate(() => {
    window.__refs = {
      bass: window.__hum.channelNodesByName.get('bass'),
      pluck: window.__hum.channelNodesByName.get('pluck')
    };
  });

  await applyEdit(page, 'bpm 120\npluck sin c4 e4\nbass saw c3 e3');
  const r = await page.evaluate(() => ({
    order: window.__hum.channelNodes.map(n => n.channel.name),
    bassSame: window.__refs.bass === window.__hum.channelNodesByName.get('bass'),
    pluckSame: window.__refs.pluck === window.__hum.channelNodesByName.get('pluck')
  }));
  expect(r.order).toEqual(['pluck', 'bass']);
  expect(r.bassSame).toBe(true);
  expect(r.pluckSame).toBe(true);
});

test('duplicate channel names resolve to distinct registry keys (#2, #3)', async ({ page }) => {
  await applyEdit(page, 'bpm 120\nlead saw c4 e4\nlead sin g4 a4\nlead tri c5 e5');
  await startPlayback(page);

  const keys = await page.evaluate(() =>
    [...window.__hum.channelNodesByName.keys()]);
  expect(keys).toEqual(['lead', 'lead#2', 'lead#3']);
});

test('parse error suspends liveUpdate — existing graph keeps advancing', async ({ page }) => {
  await applyEdit(page, 'bpm 120\nbass saw c3 e3 g3 c4');
  await startPlayback(page);
  await waitForPhaseDelta(page, 1);

  const stepBefore = await page.evaluate(() => window.__hum.scheduler.step);

  await applyEdit(page, 'bpm 120\nbass saw c3 xyz g3 c4');
  await page.waitForTimeout(200);

  const r = await page.evaluate(() => ({
    step: window.__hum.scheduler.step,
    hasBass: window.__hum.channelNodesByName.has('bass'),
    isPlaying: window.__hum.isPlaying
  }));
  expect(r.step).toBeGreaterThan(stepBefore); // clock kept ticking
  expect(r.hasBass).toBe(true);
  expect(r.isPlaying).toBe(true);
});

test('stop → revert → start → re-edit applies the diff (lastParseKey regression)', async ({ page }) => {
  // Before the fix, lastParseKey persisted across stop. If the user edited to T2
  // during playback, stopped, reverted to T1, started (graph = T1), and edited
  // back to T2, liveUpdate saw key(T2) === lastParseKey and returned early —
  // the graph stayed at T1 while the text said T2.
  const T1 = 'bpm 120\nlead sin c4 e4 g4 c5';
  const T2 = 'bpm 120\nlead sin c4 e4 g4 c5\nbass saw c2 g2';

  await applyEdit(page, T1);
  await startPlayback(page);
  await applyEdit(page, T2);
  expect((await snapshot(page)).names).toEqual(['lead', 'bass']);

  await page.click('#play-btn');
  await page.waitForFunction(() => !window.__hum.isPlaying);

  await applyEdit(page, T1);
  await startPlayback(page);
  expect((await snapshot(page)).names).toEqual(['lead']);

  await applyEdit(page, T2);
  expect((await snapshot(page)).names).toEqual(['lead', 'bass']);
});

test('parse-error edit does not poison lastParseKey; later valid edit applies', async ({ page }) => {
  // An error-state edit must not advance lastParseKey, otherwise a subsequent
  // valid edit identical-by-key to the error text would skip diffing.
  await applyEdit(page, 'bpm 120\nlead sin c4 e4');
  await startPlayback(page);

  await applyEdit(page, 'bpm 120\nlead sin c4 e4 : wobble 1'); // unknown effect → errors
  expect((await snapshot(page)).names).toEqual(['lead']); // liveUpdate suspended

  await applyEdit(page, 'bpm 120\nlead sin c4 e4\nbass saw c2'); // valid, adds channel
  expect((await snapshot(page)).names).toEqual(['lead', 'bass']);
});

test('compound edit applies bpm, add, remove, and waveform swap atomically', async ({ page }) => {
  await applyEdit(page, 'bpm 120\nlead sin c4 e4\ndrums noise x . x .');
  await startPlayback(page);

  await applyEdit(page, 'bpm 150\nlead tri c4 e4\nbass saw c2 g2');

  const s = await snapshot(page);
  expect(s.names).toEqual(['lead', 'bass']);
  expect(s.dur).toBeCloseTo(60 / 150 / 2, 6);
  const leadType = await page.evaluate(
    () => window.__hum.channelNodesByName.get('lead').source.type
  );
  expect(leadType).toBe('triangle');
});

test('removing all channels suspends liveUpdate; existing graph keeps playing', async ({ page }) => {
  await applyEdit(page, 'bpm 120\nlead sin c4 e4');
  await startPlayback(page);

  await applyEdit(page, ''); // empty text: liveUpdate's channels==0 guard suspends

  const s = await snapshot(page);
  expect(s.names).toEqual(['lead']);
  expect(s.isPlaying).toBe(true);
});

test('rapid sequential edits converge to the final source', async ({ page }) => {
  await applyEdit(page, 'bpm 120\nbass saw c3 e3');
  await startPlayback(page);

  const edits = [
    'bpm 120\nbass saw c3 e3\nlead sin c4 e4',
    'bpm 140\nbass saw c3 e3\nlead sin c4 e4',
    'bpm 140\nbass sin c3 e3\nlead sin c4 e4',
    'bpm 140\nbass sin c3 e3\nlead sin c4 e4\npad tri a3 b3',
    'bpm 140\nlead sin c4 e4\npad tri a3 b3'
  ];
  for (const e of edits) await applyEdit(page, e);

  const s = await snapshot(page);
  expect(s.names).toEqual(['lead', 'pad']);
  expect(s.keys.sort()).toEqual(['lead', 'pad']);
  expect(s.isPlaying).toBe(true);
  expect(s.dur).toBeCloseTo(60 / 140 / 2, 6);
});
