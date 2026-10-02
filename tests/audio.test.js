import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { OfflineAudioContext } from 'node-web-audio-api';
import { loadBlocks } from '../tools/hum-blocks.js';

// Renders hum-engine offline through node-web-audio-api. Steps are written
// up front; the Scheduler's timing is covered in scheduler.test.js.
//
// node-web-audio-api is not a browser, so assertions stick to what holds in
// Chrome too:
//   - Its DynamicsCompressor differs from Chrome's (demo peaks run ~2× higher),
//     so master-bus levels aren't asserted.
//   - It can emit NaN after some setTargetAtTime sequences around chord
//     voices that Chrome renders cleanly, so envelope-shape tests use
//     chord-free patterns.

const SR = 44100;

// Build the graph for `text` on a fresh offline context. Nothing scheduled.
function setup(text, seconds, { bus = false } = {}) {
  const e = loadBlocks(['hum-core', 'hum-engine']);
  const ctx = new OfflineAudioContext(1, Math.ceil(SR * seconds), SR);
  e.initAudio(ctx);
  if (!bus) {
    // Tap the summed channel chains before the master compressor.
    e.analyserNode.disconnect();
    e.analyserNode.connect(ctx.destination);
  }
  const hum = e.parse(text);
  assert.deepEqual(hum.errors, []);
  e.buildGraph(hum);
  const dur = 60 / hum.bpm / 2;
  const t0 = 0.01;
  return { e, ctx, dur, stepAt: (s) => t0 + s * dur };
}

const finish = async (ctx) => (await ctx.startRendering()).getChannelData(0);

// Schedule every step up to `seconds`, then render.
async function render(text, seconds, opts) {
  const r = setup(text, seconds, opts);
  for (let step = 0; r.stepAt(step) < seconds; step++) {
    for (const node of r.e.channelNodes) r.e.scheduleStep(node, step, r.stepAt(step), r.dur);
  }
  return { ...r, data: await finish(r.ctx) };
}

const peakOf = (d, from = 0, to = d.length) => {
  let p = 0;
  for (let i = Math.max(0, from); i < Math.min(to, d.length); i++) p = Math.max(p, Math.abs(d[i]));
  return p;
};
const sample = (t) => Math.round(t * SR);
// Peak within ±ms around time t.
const peakAround = (d, t, ms) => peakOf(d, sample(t - ms / 1000), sample(t + ms / 1000) + 1);

// A sine of amplitude A at frequency f moves at most 2πfA/SR per sample.
// Anything faster is a discontinuity — an audible click.
function assertNoClicks(d, maxFreq, label) {
  const bound = 1.5 * 2 * Math.PI * maxFreq * peakOf(d) / SR;
  for (let i = 1; i < d.length; i++) {
    const delta = Math.abs(d[i] - d[i - 1]);
    if (delta > bound) {
      assert.fail(`${label}: click at ${(i / SR).toFixed(4)}s (Δ ${delta.toFixed(4)} > ${bound.toFixed(4)})`);
    }
  }
}

describe('audio: demos', () => {
  const dir = new URL('../demos/', import.meta.url);
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.hum'))) {
    it(`${file} renders finite, non-silent audio through the master bus`, async () => {
      const { data } = await render(readFileSync(new URL(file, dir), 'utf8'), 6, { bus: true });
      const bad = data.findIndex((v) => !Number.isFinite(v));
      assert.equal(bad, -1, `non-finite sample at ${(bad / SR).toFixed(4)}s`);
      assert.ok(peakOf(data) > 0.05, 'audible');
    });
  }
});

describe('audio: envelopes', () => {
  it('notes, rests, holds, accents and ghosts start and stop without clicks', async () => {
    const src = 'bpm 132\na sin c4 . e4*3 g4! c5? . c5 c5 a4*2 . g4? e4!';
    const { data } = await render(src, 4);
    assertNoClicks(data, 523.3, src);
  });

  it('a live-edit rewind in the middle of a decay tail does not click', async () => {
    const { e, ctx, dur, stepAt } = setup('bpm 120\na sin a4 a4 . . : decay 1.5', 2);
    const node = e.channelNodes[0];
    for (let s = 0; s < 4; s++) e.scheduleStep(node, s, stepAt(s), dur);
    // Rewind while step 1's tail is still ringing, then write the rest of
    // the bar again — what Scheduler.rewindTo does on a structural edit.
    const cut = stepAt(1) + 0.1;
    e.cancelChannelEventsFrom(node, cut);
    assert.ok(e.envValueAt(node.env, cut) > 0.5, 'tail still loud at the cut');
    e.scheduleStep(node, 2, stepAt(2), dur);
    e.scheduleStep(node, 3, stepAt(3), dur);
    const d = await finish(ctx);
    assertNoClicks(d, 440, 'rewind mid-decay');
    assert.ok(peakAround(d, stepAt(2) + 0.05, 1) < 0.01, 'silent after the rest');
  });

  it('a decay tail fades to silence before a pitch change', async () => {
    const { data, stepAt } = await render('bpm 120\na sin c4 e4 g4 c5 : decay 2', 2);
    const peak = peakOf(data);
    for (let s = 1; s < 4; s++) {
      const at = peakAround(data, stepAt(s), 0.5);
      assert.ok(at < 0.25 * peak, `step ${s}: ${at.toFixed(3)} at the retune (peak ${peak.toFixed(3)})`);
    }
    assertNoClicks(data, 523.3, 'decay retunes');
  });

  it('a same-pitch retrigger keeps ringing instead of fading out', async () => {
    const { data, stepAt } = await render('bpm 120\na sin c4 c4 c4 c4 : decay 2', 2);
    const peak = peakOf(data);
    for (let s = 1; s < 4; s++) {
      assert.ok(peakAround(data, stepAt(s), 0.5) > 0.3 * peak, `step ${s} dropped out`);
    }
  });

  it('rests are silent', async () => {
    const { data, stepAt, dur } = await render('bpm 120\na saw c3 . . .', 1);
    // Rest slots: after the release, until the next attack.
    assert.ok(peakOf(data, sample(stepAt(1) + 0.02), sample(stepAt(4) - 0.001)) < 1e-3);
    assert.ok(peakOf(data, sample(stepAt(0) + 0.005), sample(stepAt(0) + dur - 0.02)) > 0.1, 'note sounds');
  });
});
