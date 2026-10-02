import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { loadBlocks } from '../tools/hum-blocks.js';

const {
  Scheduler, SCHEDULE_AHEAD, TICK_MS, parse, envValueAt, retunes,
} = loadBlocks(['hum-core']);

// The real Scheduler on a fake clock: io.scheduleStep / io.cancelFrom record
// what would have been written to Web Audio.
function harness(bpm, nodes, { startAt = 0.1 } = {}) {
  const clock = { currentTime: startAt };
  const calls = [];
  const cancels = [];
  const timer = {
    messages: [],
    listeners: new Set(),
    postMessage(msg) { this.messages.push(msg); },
    addEventListener(_type, fn) { this.listeners.add(fn); },
    removeEventListener(_type, fn) { this.listeners.delete(fn); },
    fire() { for (const fn of this.listeners) fn(); },
  };
  const sched = new Scheduler(clock, nodes, 60 / bpm / 2, {
    timer,
    scheduleStep: (node, step, t, dur) => calls.push({ node, step, t, dur }),
    cancelFrom: (node, t) => cancels.push({ node, t }),
  });
  return {
    clock, calls, cancels, timer, sched,
    // Advance the clock in TICK_MS increments, ticking like the worker would.
    run(seconds) {
      const ticks = Math.round(seconds / (TICK_MS / 1000));
      for (let i = 0; i < ticks; i++) {
        clock.currentTime += TICK_MS / 1000;
        timer.fire();
      }
    },
  };
}

const node = (name, extra = {}) => ({ name, notBefore: 0, stoppedAt: Infinity, ...extra });
const stepsFor = (calls, n) => calls.filter((c) => c.node === n).map((c) => c.step);

describe('scheduler: start / stop', () => {
  it('start posts a TICK_MS interval and schedules the lookahead window', () => {
    const a = node('a');
    const h = harness(120, [a]);
    h.sched.start();
    assert.deepEqual(h.timer.messages, [{ cmd: 'start', interval: TICK_MS }]);
    assert.equal(h.sched.t0, 0.1);
    for (const c of h.calls) assert.ok(c.t < 0.1 + SCHEDULE_AHEAD);
    assert.ok(h.sched.t0 + h.sched.step * h.sched.dur >= 0.1 + SCHEDULE_AHEAD,
      'first unscheduled step must lie beyond the lookahead');
  });

  it('stop detaches from the timer', () => {
    const h = harness(120, [node('a')]);
    h.sched.start();
    h.sched.stop();
    assert.equal(h.timer.listeners.size, 0);
    assert.deepEqual(h.timer.messages.at(-1), { cmd: 'stop' });
    const before = h.calls.length;
    h.run(1);
    assert.equal(h.calls.length, before, 'no steps after stop');
  });
});

describe('scheduler: step timing', () => {
  for (const bpm of [60, 96, 120, 137, 999]) {
    it(`schedules every step exactly once on the t0 + step·dur grid at ${bpm} bpm`, () => {
      const a = node('a');
      const h = harness(bpm, [a]);
      h.sched.start();
      h.run(30);
      const steps = stepsFor(h.calls, a);
      assert.deepEqual(steps, steps.map((_, i) => i), 'steps are 0,1,2,… with no gaps or repeats');
      for (const c of h.calls) {
        assert.equal(c.t, h.sched.t0 + c.step * h.sched.dur, `step ${c.step} off the grid`);
        assert.equal(c.dur, 60 / bpm / 2);
      }
    });
  }

  it('never schedules a step in the past', () => {
    const h = harness(140, [node('a')]);
    h.sched.start();
    let lastNow = h.clock.currentTime;
    const origFire = h.timer.fire.bind(h.timer);
    h.timer.fire = () => { lastNow = h.clock.currentTime; origFire(); };
    const origPush = h.calls.push.bind(h.calls);
    h.calls.push = (c) => { assert.ok(c.t >= lastNow, `step ${c.step} at ${c.t} < now ${lastNow}`); return origPush(c); };
    h.run(10);
  });

  it('skips steps missed during a main-thread stall and resumes on the grid', () => {
    const a = node('a');
    const h = harness(120, [a]);
    h.sched.start();
    h.run(1);
    const before = h.calls.length;
    h.clock.currentTime += 2; // 2 s stall, far beyond the lookahead
    h.timer.fire();
    const after = h.calls.slice(before);
    assert.ok(after.length > 0, 'resumes scheduling');
    for (const c of after) {
      assert.ok(c.t >= h.clock.currentTime, 'no catch-up burst of past steps');
      assert.equal(c.t, h.sched.t0 + c.step * h.sched.dur, 'still on the original grid');
    }
  });
});

describe('scheduler: channel sync', () => {
  it('all channels get the same time and step index', () => {
    const nodes = [node('kick'), node('lead'), node('bass')];
    const h = harness(120, nodes);
    h.sched.start();
    h.run(20);
    const byStep = new Map();
    for (const c of h.calls) {
      if (!byStep.has(c.step)) byStep.set(c.step, []);
      byStep.get(c.step).push(c);
    }
    for (const [step, cs] of byStep) {
      assert.equal(cs.length, nodes.length, `step ${step}: every channel scheduled`);
      assert.ok(cs.every((c) => c.t === cs[0].t), `step ${step}: same time for all channels`);
    }
  });

  it('respects notBefore and stoppedAt', () => {
    const late = node('late', { notBefore: 1 });
    const gone = node('gone', { stoppedAt: 1 });
    const h = harness(120, [late, gone], { startAt: 0 });
    h.sched.start();
    h.run(3);
    for (const c of h.calls) {
      if (c.node === late) assert.ok(c.t >= 1);
      if (c.node === gone) assert.ok(c.t < 1);
    }
    assert.ok(stepsFor(h.calls, late).length > 0);
    assert.ok(stepsFor(h.calls, gone).length > 0);
  });
});

describe('scheduler: live edits', () => {
  it('rewindTo re-schedules from the boundary and cancels queued events there', () => {
    const a = node('a');
    const b = node('b');
    const h = harness(120, [a, b]);
    h.sched.start();
    h.run(1);
    const boundary = h.sched.t0 + (h.sched.step - 1) * h.sched.dur;
    h.sched.rewindTo(boundary);
    assert.deepEqual(h.cancels.map((c) => [c.node.name, c.t]), [['a', boundary], ['b', boundary]]);
    const before = h.calls.length;
    h.timer.fire();
    const rescheduled = h.calls.slice(before).filter((c) => c.node === a);
    assert.equal(rescheduled[0].t, boundary, 'first step written again is the boundary step');
  });

  it('rewindTo never moves the step pointer forward', () => {
    const h = harness(120, [node('a')]);
    h.sched.start();
    const step = h.sched.step;
    h.sched.rewindTo(h.sched.t0 + (step + 10) * h.sched.dur);
    assert.equal(h.sched.step, step);
  });

  it('rebaseForTempo preserves phase and moves onto the new grid', () => {
    const a = node('a');
    const h = harness(120, [a]);
    h.sched.start();
    h.run(1.37);
    const phase = h.sched.getPhase();
    const newDur = 60 / 180 / 2;
    h.sched.rebaseForTempo(newDur);
    assert.ok(Math.abs(h.sched.getPhase() - phase) < 1e-9, 'fractional step position unchanged');
    assert.equal(h.sched.dur, newDur);
    const cancelAt = h.sched.t0 + h.sched.step * newDur;
    assert.ok(cancelAt >= h.clock.currentTime, 'cancels from the next boundary, not mid-step');
    assert.deepEqual(h.cancels.map((c) => c.t), [cancelAt]);
    const before = h.calls.length;
    h.run(1);
    for (const c of h.calls.slice(before)) {
      assert.equal(c.t, h.sched.t0 + c.step * newDur);
      assert.equal(c.dur, newDur);
    }
  });
});

describe('envValueAt', () => {
  const env = [
    { t: 0, v: 0, kind: 'set' },
    { t: 1, v: 1, kind: 'lin' },
    { t: 2, v: 0.01, kind: 'exp' },
    { t: 3, v: 0.5, kind: 'set' },
  ];

  it('is 0 before any event', () => assert.equal(envValueAt([], 5), 0));
  it('interpolates linear ramps', () => assert.equal(envValueAt(env, 0.25), 0.25));
  it('interpolates exponential ramps', () => {
    assert.ok(Math.abs(envValueAt(env, 1.5) - Math.sqrt(0.01)) < 1e-12);
  });
  it('holds through a set event until it lands', () => {
    assert.ok(Math.abs(envValueAt(env, 2.5) - 0.01) < 1e-12);
    assert.equal(envValueAt(env, 3), 0.5);
    assert.equal(envValueAt(env, 99), 0.5);
  });
});

describe('retunes', () => {
  const ch = (src) => parse(src).channels[0];

  it('is false with nothing sounding yet', () => {
    const c = ch('a sin c4');
    assert.equal(retunes({ channel: c, lastFreqs: null }, c.pattern[0]), false);
  });

  it('detects a pitch change on a sounding voice', () => {
    const c = ch('a sin c4 e4');
    const n = { channel: c, lastFreqs: [c.pattern[0].freq] };
    assert.equal(retunes(n, c.pattern[0]), false, 'same pitch');
    assert.equal(retunes(n, c.pattern[1]), true, 'new pitch');
  });

  it('ignores chord voices that were silent', () => {
    const c = ch('a sin c4 [c4 e4 g4]');
    const n = { channel: c, lastFreqs: [c.pattern[0].freq] };
    assert.equal(retunes(n, c.pattern[1]), false, 'voice 0 keeps c4; voices 1-2 start muted');
  });

  it('is false for noise and for rests/triggers', () => {
    const noise = ch('k noise x');
    assert.equal(retunes({ channel: noise, lastFreqs: [1] }, noise.pattern[0]), false);
    const c = ch('a sin c4 .');
    assert.equal(retunes({ channel: c, lastFreqs: [1] }, c.pattern[1]), false);
  });
});
