import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

// ── Extract live-update planner from index.html ───────────────────────

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
let src = scriptMatch[1];

// Strip browser-only tail so we can eval in Node (same pattern as parser.test.js).
src = src.replace(/^const timerWorkerBlob[\s\S]*?const timerWorker[^\n]*/m, '');
src = src.replace(/class Scheduler[\s\S]*$/, '');

const module = {};
const code = src + '\nmodule.exports = { parse, humKey, keysFor, nextBoundaryAt, planLiveUpdate, SCHEDULE_AHEAD };';
const fn = new Function('module', code);
fn(module);

const { parse, humKey, keysFor, nextBoundaryAt, planLiveUpdate, SCHEDULE_AHEAD } = module.exports;

// ── humKey ──────────────────────────────────────────────────────────

describe('humKey', () => {
  it('includes bpm and channel order', () => {
    const a = parse('bpm 120\nlead sin c4\nbass saw c2');
    const b = parse('bpm 96\nlead sin c4\nbass saw c2');
    assert.notEqual(humKey(a), humKey(b));
  });

  it('changes when only velocity changes (accent)', () => {
    const plain = parse('bpm 120\nlead sin c4 e4');
    const accented = parse('bpm 120\nlead sin c4! e4');
    assert.notEqual(humKey(plain), humKey(accented));
  });

  it('changes when only velocity changes (ghost)', () => {
    const plain = parse('bpm 120\nlead sin c4 e4');
    const ghost = parse('bpm 120\nlead sin c4? e4');
    assert.notEqual(humKey(plain), humKey(ghost));
  });

  it('changes when effects change', () => {
    const a = parse('bpm 120\nlead sin c4 : vol .5');
    const b = parse('bpm 120\nlead sin c4 : vol .6');
    assert.notEqual(humKey(a), humKey(b));
  });

  it('changes when waveform changes', () => {
    const a = parse('bpm 120\nlead sin c4');
    const b = parse('bpm 120\nlead tri c4');
    assert.notEqual(humKey(a), humKey(b));
  });

  it('is stable for identical parses', () => {
    const text = 'bpm 120\nlead sin c4 e4 g4 : vol .5';
    assert.equal(humKey(parse(text)), humKey(parse(text)));
  });

  it('includes chord velocities', () => {
    const a = parse('bpm 120\npad sin [c4 e4 g4]');
    const b = parse('bpm 120\npad sin [c4 e4 g4]!');
    assert.notEqual(humKey(a), humKey(b));
  });
});

// ── keysFor ─────────────────────────────────────────────────────────

describe('keysFor (live update registry)', () => {
  it('assigns #2, #3 for duplicate channel names', () => {
    const hum = parse('bpm 120\nlead sin c4\nlead tri e4\nlead saw g4');
    assert.deepEqual(keysFor(hum.channels), ['lead', 'lead#2', 'lead#3']);
  });
});

// ── nextBoundaryAt ──────────────────────────────────────────────────

describe('nextBoundaryAt', () => {
  it('returns the next step boundary beyond lookahead + margin', () => {
    const t0 = 1.0;
    const dur = 0.25;
    const now = 1.0;
    // safe = 1.0 + 0.15 + 0.02 = 1.17; phase = 0.68; ceil = 1; boundary = 1.25
    assert.equal(nextBoundaryAt(now, t0, dur, 0.15), 1.25);
  });

  it('advances to the following boundary when already past the first', () => {
    const t0 = 0;
    const dur = 0.5;
    const now = 0.6;
    // safe = 0.77; phase = 1.54; ceil = 2; boundary = 1.0
    assert.equal(nextBoundaryAt(now, t0, dur, 0.15), 1.0);
  });

  it('matches SCHEDULE_AHEAD constant used in the app', () => {
    assert.equal(SCHEDULE_AHEAD, 0.15);
  });
});

// ── planLiveUpdate ──────────────────────────────────────────────────

function planFrom(text, { lastKey = '', nodes = [], now = 0, t0 = 0, dur = null } = {}) {
  const hum = parse(text);
  return planLiveUpdate({
    lastKey,
    hum,
    nodes,
    now,
    t0,
    dur: dur ?? (60 / hum.bpm / 2),
    scheduleAhead: SCHEDULE_AHEAD,
  });
}

describe('planLiveUpdate', () => {
  it('skips when humKey is unchanged', () => {
    const hum = parse('bpm 120\nlead sin c4');
    const key = humKey(hum);
    const plan = planLiveUpdate({
      lastKey: key,
      hum,
      nodes: [{ registryKey: 'lead', waveform: 'sin' }],
      now: 0,
      t0: 0,
      dur: 0.25,
      scheduleAhead: SCHEDULE_AHEAD,
    });
    assert.equal(plan.action, 'skip');
    assert.equal(plan.reason, 'unchanged');
  });

  it('skips invalid hum with parse errors', () => {
    const hum = parse('bpm 120\nlead sin z9');
    assert.ok(hum.errors.length > 0);
    const plan = planLiveUpdate({
      lastKey: '',
      hum,
      nodes: [{ registryKey: 'lead', waveform: 'sin' }],
      now: 0,
      t0: 0,
      dur: 0.25,
      scheduleAhead: SCHEDULE_AHEAD,
    });
    assert.equal(plan.action, 'skip');
    assert.equal(plan.reason, 'invalid');
  });

  it('skips empty channel list', () => {
    const hum = parse('bpm 120');
    const plan = planLiveUpdate({
      lastKey: '',
      hum,
      nodes: [],
      now: 0,
      t0: 0,
      dur: 0.25,
      scheduleAhead: SCHEDULE_AHEAD,
    });
    assert.equal(plan.action, 'skip');
    assert.equal(plan.reason, 'invalid');
  });

  it('does not skip accent-only edits (regression for #1)', () => {
    const before = parse('bpm 120\nlead sin c4 e4');
    const after = parse('bpm 120\nlead sin c4! e4');
    const plan = planLiveUpdate({
      lastKey: humKey(before),
      hum: after,
      nodes: [{ registryKey: 'lead', waveform: 'sin' }],
      now: 0,
      t0: 0,
      dur: 0.25,
      scheduleAhead: SCHEDULE_AHEAD,
    });
    assert.equal(plan.action, 'apply');
    assert.equal(plan.swaps.length, 0);
    assert.equal(plan.removals.length, 0);
    assert.equal(plan.additions.length, 0);
    assert.equal(plan.updates.length, 1);
    assert.equal(plan.updates[0].channel.pattern[0].vel, 1.5);
  });

  it('detects tempo change without structural ops', () => {
    const before = parse('bpm 120\nlead sin c4');
    const after = parse('bpm 140\nlead sin c4');
    const plan = planLiveUpdate({
      lastKey: humKey(before),
      hum: after,
      nodes: [{ registryKey: 'lead', waveform: 'sin' }],
      now: 0,
      t0: 0,
      dur: 60 / 120 / 2,
      scheduleAhead: SCHEDULE_AHEAD,
    });
    assert.equal(plan.action, 'apply');
    assert.ok(Math.abs(plan.tempoChange - 60 / 140 / 2) < 1e-9);
    assert.equal(plan.structuralChange, false);
  });

  it('detects channel removal', () => {
    const before = parse('bpm 120\nlead sin c4\nbass saw c2');
    const after = parse('bpm 120\nlead sin c4');
    const plan = planLiveUpdate({
      lastKey: humKey(before),
      hum: after,
      nodes: [
        { registryKey: 'lead', waveform: 'sin' },
        { registryKey: 'bass', waveform: 'saw' },
      ],
      now: 0,
      t0: 0,
      dur: 0.25,
      scheduleAhead: SCHEDULE_AHEAD,
    });
    assert.deepEqual(plan.removals, ['bass']);
    assert.equal(plan.structuralChange, true);
  });

  it('detects channel addition', () => {
    const before = parse('bpm 120\nlead sin c4');
    const after = parse('bpm 120\nlead sin c4\nbass saw c2');
    const plan = planLiveUpdate({
      lastKey: humKey(before),
      hum: after,
      nodes: [{ registryKey: 'lead', waveform: 'sin' }],
      now: 0,
      t0: 0,
      dur: 0.25,
      scheduleAhead: SCHEDULE_AHEAD,
    });
    assert.equal(plan.additions.length, 1);
    assert.equal(plan.additions[0].registryKey, 'bass');
    assert.equal(plan.structuralChange, true);
  });

  it('detects waveform swap', () => {
    const before = parse('bpm 120\nlead sin c4');
    const after = parse('bpm 120\nlead tri c4');
    const plan = planLiveUpdate({
      lastKey: humKey(before),
      hum: after,
      nodes: [{ registryKey: 'lead', waveform: 'sin' }],
      now: 0,
      t0: 0,
      dur: 0.25,
      scheduleAhead: SCHEDULE_AHEAD,
    });
    assert.deepEqual(plan.swaps, [{ registryKey: 'lead', newWaveform: 'tri' }]);
    assert.equal(plan.structuralChange, true);
  });

  it('reorders channelOrder to match parse order', () => {
    const before = parse('bpm 120\nlead sin c4\nbass saw c2');
    const after = parse('bpm 120\nbass saw c2\nlead sin c4');
    const plan = planLiveUpdate({
      lastKey: humKey(before),
      hum: after,
      nodes: [
        { registryKey: 'lead', waveform: 'sin' },
        { registryKey: 'bass', waveform: 'saw' },
      ],
      now: 0,
      t0: 0,
      dur: 0.25,
      scheduleAhead: SCHEDULE_AHEAD,
    });
    assert.deepEqual(plan.channelOrder, ['bass', 'lead']);
    assert.equal(plan.structuralChange, false);
  });

  it('handles duplicate channel names via registry keys', () => {
    const hum = parse('bpm 120\nlead sin c4\nlead tri e4');
    const plan = planLiveUpdate({
      lastKey: '',
      hum,
      nodes: [{ registryKey: 'lead', waveform: 'sin' }],
      now: 0,
      t0: 0,
      dur: 0.25,
      scheduleAhead: SCHEDULE_AHEAD,
    });
    assert.equal(plan.additions.length, 1);
    assert.equal(plan.additions[0].registryKey, 'lead#2');
    assert.deepEqual(plan.channelOrder, ['lead', 'lead#2']);
  });

  it('pattern-only edit updates survivor without structural change', () => {
    const before = parse('bpm 120\nlead sin c4 e4');
    const after = parse('bpm 120\nlead sin c4 g4');
    const plan = planLiveUpdate({
      lastKey: humKey(before),
      hum: after,
      nodes: [{ registryKey: 'lead', waveform: 'sin' }],
      now: 0,
      t0: 0,
      dur: 0.25,
      scheduleAhead: SCHEDULE_AHEAD,
    });
    assert.equal(plan.structuralChange, false);
    assert.equal(plan.updates[0].channel.pattern[1].name, 'g4');
  });

  it('computes boundary from scheduler state', () => {
    const plan = planFrom('bpm 120\nlead sin c4', {
      nodes: [{ registryKey: 'lead', waveform: 'sin' }],
      now: 1.0,
      t0: 1.0,
      dur: 0.25,
    });
    assert.equal(plan.boundary, 1.25);
  });
});
