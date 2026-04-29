import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

// ── Extract parser from index.html ────────────────────────────────────

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
let src = scriptMatch[1];

// Strip browser-only code so we can eval in Node
src = src.replace(/^const timerWorkerBlob[\s\S]*?const timerWorker[^\n]*/m, '');
src = src.replace(/class Scheduler[\s\S]*$/, '');

// Expose parser and helpers via module scope
const module = {};
const code = src + '\nmodule.exports = { NOTE_FREQ, NOTE_NAMES, WAVEFORMS, parse, parseNum };';
const fn = new Function('module', code);
fn(module);

const { NOTE_FREQ, NOTE_NAMES, WAVEFORMS, parse, parseNum } = module.exports;

// ── Note Frequency Table ────────────────────────────────────────────

describe('note frequency table', () => {
  it('has A4 = 440Hz', () => {
    assert.equal(Math.round(NOTE_FREQ['a4']), 440);
  });

  it('has middle C (C4) ≈ 261.63Hz', () => {
    assert.ok(Math.abs(NOTE_FREQ['c4'] - 261.63) < 0.1);
  });

  it('covers octaves 0-8', () => {
    assert.ok(NOTE_FREQ['c0'] > 0);
    assert.ok(NOTE_FREQ['b8'] > 0);
    assert.equal(NOTE_FREQ['c9'], undefined);
  });

  it('has all 12 note names per octave', () => {
    for (const name of NOTE_NAMES) {
      assert.ok(NOTE_FREQ[name + '4'] > 0, `missing ${name}4`);
    }
  });

  it('supports sharp notation', () => {
    assert.ok(NOTE_FREQ['c#4'] > NOTE_FREQ['c4']);
    assert.ok(NOTE_FREQ['f#3'] > NOTE_FREQ['f3']);
  });

  it('supports flat notation', () => {
    assert.ok(NOTE_FREQ['eb4'] > 0);
    assert.ok(NOTE_FREQ['bb3'] > 0);
    assert.ok(NOTE_FREQ['db5'] > 0);
    assert.ok(NOTE_FREQ['ab2'] > 0);
    assert.ok(NOTE_FREQ['gb4'] > 0);
  });

  it('flats equal corresponding sharps', () => {
    assert.equal(NOTE_FREQ['eb4'], NOTE_FREQ['d#4']);
    assert.equal(NOTE_FREQ['bb3'], NOTE_FREQ['a#3']);
    assert.equal(NOTE_FREQ['db5'], NOTE_FREQ['c#5']);
    assert.equal(NOTE_FREQ['ab2'], NOTE_FREQ['g#2']);
    assert.equal(NOTE_FREQ['gb4'], NOTE_FREQ['f#4']);
  });

  it('fb equals e (same octave)', () => {
    assert.equal(NOTE_FREQ['fb4'], NOTE_FREQ['e4']);
  });

  it('cb equals b (octave below)', () => {
    assert.equal(NOTE_FREQ['cb4'], NOTE_FREQ['b3']);
  });

  it('cb0 does not exist (would be b-1)', () => {
    assert.equal(NOTE_FREQ['cb0'], undefined);
  });

  it('octaves double in frequency', () => {
    assert.ok(Math.abs(NOTE_FREQ['a5'] / NOTE_FREQ['a4'] - 2) < 0.001);
    assert.ok(Math.abs(NOTE_FREQ['c3'] / NOTE_FREQ['c2'] - 2) < 0.001);
  });
});

// ── parseNum ────────────────────────────────────────────────────────

describe('parseNum', () => {
  it('parses integers', () => {
    assert.equal(parseNum('440'), 440);
  });

  it('parses decimals', () => {
    assert.equal(parseNum('0.5'), 0.5);
  });

  it('parses leading dot shorthand', () => {
    assert.equal(parseNum('.05'), 0.05);
  });

  it('parses k suffix (thousands)', () => {
    assert.equal(parseNum('6k'), 6000);
    assert.equal(parseNum('1.5k'), 1500);
  });

  it('is case insensitive for k', () => {
    assert.equal(parseNum('6K'), 6000);
  });

  it('returns NaN for empty/undefined', () => {
    assert.ok(isNaN(parseNum('')));
    assert.ok(isNaN(parseNum(undefined)));
  });

  it('trims whitespace', () => {
    assert.equal(parseNum('  440  '), 440);
  });
});

// ── Parser: BPM ─────────────────────────────────────────────────────

describe('parser: bpm', () => {
  it('parses bpm', () => {
    const hum = parse('bpm 140');
    assert.equal(hum.bpm, 140);
  });

  it('defaults to 120 when no bpm', () => {
    const hum = parse('lead tri c4');
    assert.equal(hum.bpm, 120);
  });

  it('accepts decimal bpm', () => {
    const hum = parse('bpm 99.5');
    assert.equal(hum.bpm, 99.5);
  });

  it('is case insensitive', () => {
    const hum = parse('BPM 100');
    assert.equal(hum.bpm, 100);
  });

  it('clamps bpm below 20', () => {
    const hum = parse('bpm 10');
    assert.equal(hum.bpm, 20);
    assert.equal(hum.errors.length, 1);
  });

  it('clamps bpm above 999', () => {
    const hum = parse('bpm 1000');
    assert.equal(hum.bpm, 999);
    assert.equal(hum.errors.length, 1);
  });

  it('accepts k shorthand', () => {
    // bpm 1k = 1000, clamped to 999
    const hum = parse('bpm 1k');
    assert.equal(hum.bpm, 999);
  });
});

// ── Parser: Channel Definitions ─────────────────────────────────────

describe('parser: channels', () => {
  it('parses a basic channel', () => {
    const hum = parse('bass saw c2 . e2 .');
    assert.equal(hum.channels.length, 1);
    assert.equal(hum.channels[0].name, 'bass');
    assert.equal(hum.channels[0].waveform, 'saw');
    assert.equal(hum.channels[0].pattern.length, 4);
  });

  it('parses all waveforms', () => {
    for (const wf of WAVEFORMS) {
      const hum = parse(`ch ${wf} c4`);
      assert.equal(hum.channels.length, 1, `failed for ${wf}`);
      assert.equal(hum.channels[0].waveform, wf);
    }
  });

  it('is case insensitive for waveforms', () => {
    const hum = parse('bass SAW c2 . e2 .');
    assert.equal(hum.channels.length, 1);
    assert.equal(hum.channels[0].waveform, 'saw');
  });

  it('parses multiple channels', () => {
    const hum = parse('bass saw c2\nlead tri c4');
    assert.equal(hum.channels.length, 2);
    assert.equal(hum.channels[0].name, 'bass');
    assert.equal(hum.channels[1].name, 'lead');
  });

  it('limits to 8 channels', () => {
    const lines = [];
    for (let i = 0; i < 10; i++) lines.push(`ch${i} sin c4`);
    const hum = parse(lines.join('\n'));
    assert.equal(hum.channels.length, 8);
    assert.ok(hum.errors.length >= 2);
  });

  it('handles channel name containing waveform substring', () => {
    const hum = parse('sawbass saw c2 . e2 .');
    assert.equal(hum.channels.length, 1);
    assert.equal(hum.channels[0].name, 'sawbass');
    assert.equal(hum.channels[0].pattern.length, 4);
  });

  it('handles channel name same as waveform', () => {
    const hum = parse('tri tri c4 e4 g4');
    assert.equal(hum.channels.length, 1);
    assert.equal(hum.channels[0].name, 'tri');
    assert.equal(hum.channels[0].pattern.length, 3);
  });

  it('skips lines with fewer than 3 tokens', () => {
    const hum = parse('bpm 140\nhello\nlead tri c4');
    assert.equal(hum.channels.length, 1);
  });
});

// ── Parser: Pattern Tokens ──────────────────────────────────────────

describe('parser: pattern tokens', () => {
  it('parses note names', () => {
    const hum = parse('lead tri c4 e4 g4');
    const types = hum.channels[0].pattern.map(s => s.type);
    assert.deepEqual(types, ['note', 'note', 'note']);
  });

  it('stores frequency on notes', () => {
    const hum = parse('lead tri a4');
    assert.equal(Math.round(hum.channels[0].pattern[0].freq), 440);
  });

  it('stores note name', () => {
    const hum = parse('lead tri c#4');
    assert.equal(hum.channels[0].pattern[0].name, 'c#4');
  });

  it('parses dot rest', () => {
    const hum = parse('lead tri . . c4 .');
    const types = hum.channels[0].pattern.map(s => s.type);
    assert.deepEqual(types, ['rest', 'rest', 'note', 'rest']);
  });

  it('parses underscore rest', () => {
    const hum = parse('lead tri _ c4 _');
    const types = hum.channels[0].pattern.map(s => s.type);
    assert.deepEqual(types, ['rest', 'note', 'rest']);
  });

  it('parses x trigger', () => {
    const hum = parse('kick noise x . . x');
    const types = hum.channels[0].pattern.map(s => s.type);
    assert.deepEqual(types, ['trigger', 'rest', 'rest', 'trigger']);
  });

  it('ignores bar lines |', () => {
    const hum = parse('kick noise x . . x | x . . x');
    assert.equal(hum.channels[0].pattern.length, 8);
  });

  it('ignores commas', () => {
    const hum = parse('lead tri c4 e4, g4 c5');
    assert.equal(hum.channels[0].pattern.length, 4);
  });

  it('reports unknown notes as errors', () => {
    const hum = parse('lead tri c4 z4 g4');
    assert.equal(hum.channels[0].pattern.length, 3);
    assert.equal(hum.channels[0].pattern[1].type, 'rest'); // z4 becomes rest
    assert.ok(hum.errors.some(e => e.message.includes('z4')));
  });

  it('rejects empty pattern', () => {
    const hum = parse('lead tri : vol .5');
    assert.equal(hum.channels.length, 0);
    assert.ok(hum.errors.some(e => e.message.includes('empty')));
  });

  it('parses sharps and flats in patterns', () => {
    const hum = parse('lead tri c#4 eb4 f#3 bb2');
    assert.equal(hum.channels[0].pattern.length, 4);
    assert.ok(hum.channels[0].pattern.every(s => s.type === 'note'));
  });
});

// ── Parser: Effects ─────────────────────────────────────────────────

describe('parser: effects', () => {
  it('parses lpf', () => {
    const hum = parse('bass saw c2 : lpf 400');
    assert.equal(hum.channels[0].effects.lpf, 400);
  });

  it('parses hpf', () => {
    const hum = parse('hat noise x : hpf 8000');
    assert.equal(hum.channels[0].effects.hpf, 8000);
  });

  it('parses decay', () => {
    const hum = parse('kick noise x : decay .05');
    assert.equal(hum.channels[0].effects.decay, 0.05);
  });

  it('parses vol', () => {
    const hum = parse('lead tri c4 : vol .6');
    assert.equal(hum.channels[0].effects.vol, 0.6);
  });

  it('clamps vol to 0-1', () => {
    const hum = parse('lead tri c4 : vol 2');
    assert.equal(hum.channels[0].effects.vol, 1);
    const hum2 = parse('lead tri c4 : vol -1');
    assert.equal(hum2.channels[0].effects.vol, 0);
  });

  it('parses multiple effects', () => {
    const hum = parse('kick noise x : lpf 80 hpf 20 decay .05 vol .8');
    const fx = hum.channels[0].effects;
    assert.equal(fx.lpf, 80);
    assert.equal(fx.hpf, 20);
    assert.equal(fx.decay, 0.05);
    assert.equal(fx.vol, 0.8);
  });

  it('accepts k shorthand in effects', () => {
    const hum = parse('hat noise x : hpf 6k');
    assert.equal(hum.channels[0].effects.hpf, 6000);
  });

  it('defaults vol to 1.0', () => {
    const hum = parse('lead tri c4');
    assert.equal(hum.channels[0].effects.vol, 1.0);
  });

  it('defaults filters to null', () => {
    const hum = parse('lead tri c4');
    assert.equal(hum.channels[0].effects.lpf, null);
    assert.equal(hum.channels[0].effects.hpf, null);
    assert.equal(hum.channels[0].effects.decay, null);
  });

  it('reports unknown effects', () => {
    const hum = parse('lead tri c4 : reverb .5');
    assert.ok(hum.errors.some(e => e.message.includes('reverb')));
  });

  it('reports invalid values', () => {
    const hum = parse('lead tri c4 : lpf');
    assert.ok(hum.errors.some(e => e.message.includes('invalid value')));
  });

  it('handles no effects (no colon)', () => {
    const hum = parse('lead tri c4 e4 g4');
    assert.equal(hum.channels.length, 1);
    assert.equal(hum.channels[0].effects.vol, 1.0);
  });
});

// ── Parser: Comments ────────────────────────────────────────────────

describe('parser: comments', () => {
  it('ignores full-line comments', () => {
    const hum = parse('-- this is a comment\nbpm 140');
    assert.equal(hum.bpm, 140);
    assert.equal(hum.channels.length, 0);
  });

  it('strips inline comments', () => {
    const hum = parse('lead tri c4 e4 -- melody');
    assert.equal(hum.channels.length, 1);
    assert.equal(hum.channels[0].pattern.length, 2);
  });

  it('handles comment after effects', () => {
    const hum = parse('lead tri c4 : vol .5 -- quiet');
    assert.equal(hum.channels[0].effects.vol, 0.5);
  });

  it('handles empty lines', () => {
    const hum = parse('\n\nbpm 140\n\nlead tri c4\n\n');
    assert.equal(hum.bpm, 140);
    assert.equal(hum.channels.length, 1);
  });
});

// ── Parser: Multi-line Continuation ─────────────────────────────────

describe('parser: multi-line continuation', () => {
  it('joins indented lines to previous channel', () => {
    const hum = parse('lead tri\n  c4 e4 g4\n  c5 g4 e4');
    assert.equal(hum.channels.length, 1);
    assert.equal(hum.channels[0].pattern.length, 6);
  });

  it('handles effects on continuation line', () => {
    const hum = parse('lead tri\n  c4 e4 g4\n  : vol .5');
    assert.equal(hum.channels[0].pattern.length, 3);
    assert.equal(hum.channels[0].effects.vol, 0.5);
  });

  it('handles comments on continuation lines', () => {
    const hum = parse('lead tri\n  c4 e4 -- bar 1\n  g4 . : vol .5');
    assert.equal(hum.channels[0].pattern.length, 4);
    assert.equal(hum.channels[0].effects.vol, 0.5);
  });

  it('stops continuation at non-indented line', () => {
    const hum = parse('lead tri\n  c4 e4\nbass saw\n  c2 e2');
    assert.equal(hum.channels.length, 2);
    assert.equal(hum.channels[0].pattern.length, 2);
    assert.equal(hum.channels[1].pattern.length, 2);
  });

  it('stops continuation at blank line', () => {
    const hum = parse('lead tri\n  c4 e4\n\nbass saw c2');
    assert.equal(hum.channels.length, 2);
  });

  it('handles tab indentation', () => {
    const hum = parse('lead tri\n\tc4 e4 g4');
    assert.equal(hum.channels[0].pattern.length, 3);
  });

  it('single-line channels still work', () => {
    const hum = parse('lead tri c4 e4 g4 : vol .5');
    assert.equal(hum.channels.length, 1);
    assert.equal(hum.channels[0].pattern.length, 3);
    assert.equal(hum.channels[0].effects.vol, 0.5);
  });

  it('handles bar lines across continuations', () => {
    const hum = parse('kick noise\n  x . . x | x . . x\n  | x . . x | x . . x');
    assert.equal(hum.channels[0].pattern.length, 16);
  });

  it('mixed single-line and multi-line', () => {
    const hum = parse('lead tri c4 e4 : vol .5\nbass saw\n  c2 . e2 .\n  : lpf 200');
    assert.equal(hum.channels.length, 2);
    assert.equal(hum.channels[0].pattern.length, 2);
    assert.equal(hum.channels[1].pattern.length, 4);
    assert.equal(hum.channels[1].effects.lpf, 200);
  });
});

// ── Parser: Error Handling ──────────────────────────────────────────

describe('parser: error handling', () => {
  it('reports line numbers in errors', () => {
    const hum = parse('bpm 140\nlead foo c4');
    assert.ok(hum.errors.some(e => e.line === 2));
  });

  it('reports unknown waveform', () => {
    const hum = parse('lead foo c4 e4');
    assert.ok(hum.errors.some(e => e.message.includes('waveform')));
  });

  it('reports unknown notes', () => {
    const hum = parse('lead tri c4 z9');
    assert.ok(hum.errors.some(e => e.message.includes('z9')));
  });

  it('reports max channels exceeded', () => {
    const lines = Array.from({length: 9}, (_, i) => `ch${i} sin c4`);
    const hum = parse(lines.join('\n'));
    assert.ok(hum.errors.some(e => e.message.includes('maximum')));
  });

  it('continues parsing after errors', () => {
    const hum = parse('bad line\nlead tri c4');
    assert.equal(hum.channels.length, 1);
  });

  it('handles empty input', () => {
    const hum = parse('');
    assert.equal(hum.bpm, 120);
    assert.equal(hum.channels.length, 0);
    assert.equal(hum.errors.length, 0);
  });

  it('handles whitespace-only input', () => {
    const hum = parse('   \n\n  \n');
    assert.equal(hum.channels.length, 0);
  });

  it('does not crash on malformed lines', () => {
    assert.doesNotThrow(() => {
      parse('= = =\n[[[]\n::: \n|||');
    });
  });
});

// ── Parser: Real-world Hum Files ────────────────────────────────────

describe('parser: real hum files', () => {
  it('parses glass.hum', () => {
    const text = readFileSync(new URL('./glass.hum', import.meta.url), 'utf8');
    const hum = parse(text);
    assert.equal(hum.bpm, 96);
    assert.equal(hum.channels.length, 6);
    assert.equal(hum.errors.length, 0);
    assert.equal(hum.channels[0].name, 'lead');
    assert.equal(hum.channels[0].waveform, 'tri');
  });

  it('parses neon-drift.hum', () => {
    const text = readFileSync(new URL('./neon-drift.hum', import.meta.url), 'utf8');
    const hum = parse(text);
    assert.equal(hum.bpm, 138);
    assert.equal(hum.channels.length, 8);
    assert.equal(hum.errors.length, 0);
  });

  it('parses tidal-memory.hum', () => {
    const text = readFileSync(new URL('./tidal-memory.hum', import.meta.url), 'utf8');
    const hum = parse(text);
    assert.equal(hum.bpm, 64);
    assert.equal(hum.channels.length, 7);
    assert.equal(hum.errors.length, 0);
  });

  it('parses slow-erosion.hum', () => {
    const text = readFileSync(new URL('./slow-erosion.hum', import.meta.url), 'utf8');
    const hum = parse(text);
    assert.equal(hum.bpm, 52);
    assert.equal(hum.channels.length, 8);
    assert.equal(hum.errors.length, 0);
  });

  it('parses phosphene.hum', () => {
    const text = readFileSync(new URL('./phosphene.hum', import.meta.url), 'utf8');
    const hum = parse(text);
    assert.equal(hum.bpm, 88);
    assert.equal(hum.channels.length, 8);
    assert.equal(hum.errors.length, 0);
  });

  it('default hum in index.html parses without errors', () => {
    const match = html.match(/const DEFAULT_HUM = `([\s\S]*?)`;/);
    const hum = parse(match[1]);
    assert.ok(hum.channels.length > 0);
    assert.equal(hum.errors.length, 0);
  });
});

// ── Scheduler Timing ────────────────────────────────────────────────

// Minimal Scheduler reimplementation for timing tests
// Mirrors the logic in index.html without Web Audio dependencies
class TestScheduler {
  constructor(bpm, startTimeOffset = 0.1) {
    this.stepDuration = 60 / bpm / 2;
    this.currentStep = 0;
    this.startTime = startTimeOffset;
    this.log = []; // { step, time, channelSteps: { name: stepIdx } }
  }

  stepTime(step) {
    return this.startTime + step * this.stepDuration;
  }

  scheduleStep(time, channels) {
    const entry = { step: this.currentStep, time, channelSteps: {} };
    for (const ch of channels) {
      entry.channelSteps[ch.name] = this.currentStep % ch.pattern.length;
    }
    this.log.push(entry);
  }

  run(steps, channels) {
    for (let i = 0; i < steps; i++) {
      this.scheduleStep(this.stepTime(this.currentStep), channels);
      this.currentStep++;
    }
    return this.log;
  }
}

describe('scheduler: step timing', () => {
  it('step times are evenly spaced', () => {
    const sched = new TestScheduler(120);
    const log = sched.run(100, []);
    for (let i = 1; i < log.length; i++) {
      const gap = log[i].time - log[i - 1].time;
      assert.ok(Math.abs(gap - sched.stepDuration) < 1e-10,
        `step ${i}: gap ${gap} !== ${sched.stepDuration}`);
    }
  });

  it('step times are evenly spaced at odd bpm', () => {
    const sched = new TestScheduler(137);
    const log = sched.run(10000, []);
    for (let i = 1; i < log.length; i++) {
      const gap = log[i].time - log[i - 1].time;
      assert.ok(Math.abs(gap - sched.stepDuration) < 1e-9,
        `step ${i}: gap ${gap} !== ${sched.stepDuration}`);
    }
  });

  it('base-computed times match expected values exactly', () => {
    const bpm = 96;
    const sched = new TestScheduler(bpm);
    const log = sched.run(1000, []);
    const stepDur = 60 / bpm / 2;
    for (const entry of log) {
      const expected = sched.startTime + entry.step * stepDur;
      assert.equal(entry.time, expected, `step ${entry.step} time mismatch`);
    }
  });

  it('no drift from accumulated addition', () => {
    // Simulate the OLD buggy approach (accumulation) vs new (base-computed)
    const bpm = 138;
    const stepDur = 60 / bpm / 2;
    const startTime = 0.1;
    const steps = 100000;

    // Accumulated addition: what the old code did (drifts due to FP rounding)
    let accumulated = startTime;
    for (let i = 1; i < steps; i++) {
      accumulated += stepDur;
    }

    // Base-computed: what the scheduler now does (no drift by construction)
    const baseComputed = startTime + (steps - 1) * stepDur;

    // Accumulated should have drifted from the base-computed value
    const drift = Math.abs(accumulated - baseComputed);
    assert.ok(drift > 0, 'expected floating-point drift from accumulation');

    // The scheduler uses base-computed times, which match exactly
    const sched = new TestScheduler(bpm);
    const log = sched.run(steps, []);
    const lastEntry = log[log.length - 1];
    assert.equal(lastEntry.time, sched.startTime + lastEntry.step * sched.stepDuration);
  });
});

describe('scheduler: channel sync', () => {
  it('all channels receive the same time per step', () => {
    const hum = parse('bpm 120\nkick noise x . . x\nlead tri c4 e4 g4 .\nbass saw c2 . e2 .');
    const sched = new TestScheduler(120);
    const log = sched.run(64, hum.channels);
    // Every step has one time — all channels are scheduled at that time
    for (const entry of log) {
      assert.equal(typeof entry.time, 'number');
      // All channel step indices are computed from the same global step
      for (const ch of hum.channels) {
        assert.equal(entry.channelSteps[ch.name], entry.step % ch.pattern.length);
      }
    }
  });

  it('equal-length channels stay in sync forever', () => {
    const hum = parse('bpm 140\na tri c4 e4 g4 . c4 e4 g4 .\nb saw c2 . e2 . g2 . c2 .');
    assert.equal(hum.channels[0].pattern.length, hum.channels[1].pattern.length);
    const sched = new TestScheduler(140);
    const log = sched.run(10000, hum.channels);
    for (const entry of log) {
      assert.equal(entry.channelSteps['a'], entry.channelSteps['b'],
        `step ${entry.step}: channels out of sync`);
    }
  });

  it('channels with divisible lengths stay bar-aligned', () => {
    // 16-step melody, 8-step drums — drums should restart every 8 steps
    const hum = parse(
      'lead tri c4 e4 g4 . c4 e4 g4 . c4 e4 g4 . c4 e4 g4 .\n' +
      'kick noise x . . . x . . .'
    );
    assert.equal(hum.channels[0].pattern.length, 16);
    assert.equal(hum.channels[1].pattern.length, 8);
    const sched = new TestScheduler(120);
    const log = sched.run(160, hum.channels);
    for (const entry of log) {
      // When lead is at step 0 or 8, kick should be at step 0
      if (entry.channelSteps['lead'] === 0) {
        assert.equal(entry.channelSteps['kick'], 0,
          `step ${entry.step}: kick not aligned on lead bar 1`);
      }
      if (entry.channelSteps['lead'] === 8) {
        assert.equal(entry.channelSteps['kick'], 0,
          `step ${entry.step}: kick not aligned on lead bar 2`);
      }
    }
  });

  it('step 0 of all channels aligns at the start', () => {
    const hum = parse('bpm 96\na tri c4 e4\nb saw c2 .\nc noise x .');
    const sched = new TestScheduler(96);
    const log = sched.run(1, hum.channels);
    for (const ch of hum.channels) {
      assert.equal(log[0].channelSteps[ch.name], 0,
        `${ch.name} not at step 0 on first beat`);
    }
  });

  it('all demo hums have matching channel lengths', () => {
    const files = ['glass.hum', 'neon-drift.hum', 'phosphene.hum', 'dust-and-iron.hum'];
    for (const file of files) {
      const text = readFileSync(new URL('./' + file, import.meta.url), 'utf8');
      const hum = parse(text);
      const lengths = hum.channels.map(c => c.pattern.length);
      const maxLen = Math.max(...lengths);
      for (let i = 0; i < lengths.length; i++) {
        assert.ok(maxLen % lengths[i] === 0,
          `${file}: ${hum.channels[i].name} has ${lengths[i]} steps, doesn't divide evenly into ${maxLen}`);
      }
    }
  });
});
