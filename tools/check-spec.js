// Verifies that load-bearing factual claims in SPEC.md match the code in
// index.html. Not a generic doc linter — a hand-written set of asserts each
// tied to one concrete claim. When SPEC and code drift, this fails the build.
//
// Add a check here when you add a SPEC claim that's worth treating as a
// contract. Implementation details that aren't promised in SPEC stay out.

import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const spec = readFileSync(new URL('../SPEC.md', import.meta.url), 'utf8');

const checks = [
  ['Web Worker timer (immune to tab throttling)', () => {
    assert.match(spec, /Web Worker/, 'SPEC mentions Web Worker but text drifted');
    assert.match(html, /new Worker\(/, 'SPEC claims Web Worker timer; no `new Worker(` in code');
  }],

  ['Tick interval = 25ms, lookahead = 150ms', () => {
    assert.match(spec, /25\s*ms tick/i);
    assert.match(spec, /150\s*ms lookahead/i);
    assert.match(html, /TICK_MS\s*=\s*25\b/, 'SPEC says 25ms tick; constant differs');
    assert.match(html, /SCHEDULE_AHEAD\s*=\s*0\.15\b/, 'SPEC says 150ms lookahead; constant differs');
  }],

  ['Max channels = 8', () => {
    assert.match(spec, /8 channels max/i);
    assert.match(html, /MAX_CHANNELS\s*=\s*8\b/, 'SPEC says 8 channels max; code differs');
  }],

  ['BPM range 20–999', () => {
    assert.match(spec, /\b20-999\b/);
    assert.match(html, /result\.bpm\s*<\s*20\s*\|\|\s*result\.bpm\s*>\s*999/);
  }],

  ['Effects table = exactly {lpf, hpf, decay, vol}', () => {
    const m = html.match(/EFFECT_NAMES\s*=\s*new Set\(\[([^\]]+)\]\)/);
    assert.ok(m, 'EFFECT_NAMES declaration not found');
    const codeEffects = m[1].match(/'(\w+)'/g).map((s) => s.slice(1, -1)).sort();
    assert.deepEqual(codeEffects, ['decay', 'hpf', 'lpf', 'vol'],
      `EFFECT_NAMES drifted from SPEC effect table: code = ${codeEffects.join(',')}`);
    // One alternation regex instead of constructing four — same correctness,
    // identifies missing entries individually via the post-match diff.
    const fxFound = (spec.match(/\|\s+`(lpf|hpf|decay|vol)`/g) || [])
      .map((s) => s.match(/`(\w+)`/)[1]);
    const fxMissing = ['lpf', 'hpf', 'decay', 'vol'].filter((f) => !fxFound.includes(f));
    assert.deepEqual(fxMissing, [], `SPEC effect table missing: ${fxMissing.join(', ')}`);
  }],

  ['Waveforms = exactly {sin, tri, sqr, saw, noise}', () => {
    const m = html.match(/WAVEFORMS\s*=\s*\[([^\]]+)\]/);
    assert.ok(m, 'WAVEFORMS declaration not found');
    const codeWaves = m[1].match(/'(\w+)'/g).map((s) => s.slice(1, -1)).sort();
    assert.deepEqual(codeWaves, ['noise', 'saw', 'sin', 'sqr', 'tri'],
      `WAVEFORMS drifted: code = ${codeWaves.join(',')}`);
    const wfFound = (spec.match(/`(sin|tri|sqr|saw|noise)`/g) || [])
      .map((s) => s.match(/`(\w+)`/)[1]);
    const wfMissing = ['sin', 'tri', 'sqr', 'saw', 'noise'].filter((w) => !wfFound.includes(w));
    assert.deepEqual(wfMissing, [], `SPEC waveform list missing: ${wfMissing.join(', ')}`);
  }],

  ['Signal chain: source → sourceGain → envelopeGain → hpf → lpf → volumeGain → analyser', () => {
    assert.match(
      spec,
      /source → sourceGain → envelopeGain → hpf → lpf → volumeGain → analyser/,
      'SPEC signal-chain text differs from expected order'
    );
    const cn = html.match(/function createChannelNode[\s\S]*?\n}\n/);
    assert.ok(cn, 'createChannelNode not found');
    const chainCall = cn[0].match(/chain\(([^)]+)\)/);
    assert.ok(chainCall, 'createChannelNode does not call chain(...)');
    const args = chainCall[1].split(',').map((s) => s.trim());
    assert.deepEqual(
      args,
      ['source', 'sourceGain', 'envelopeGain', 'filterHPF', 'filterLPF', 'volumeGain', 'analyserNode'],
      `signal chain in code drifted: ${args.join(' → ')}`
    );
  }],

  ['DynamicsCompressorNode on master bus, 3ms attack', () => {
    assert.match(spec, /DynamicsCompressorNode/);
    assert.match(html, /createDynamicsCompressor/);
    assert.match(html, /compressor\.attack\.value\s*=\s*0\.003\b/,
      'SPEC says 3ms compressor attack; code differs');
  }],

  ['Octave range 0-8, A4 = 440Hz', () => {
    assert.match(spec, /Octave range:\s*0-8/);
    assert.match(spec, /A4\s*=\s*440Hz/);
    assert.match(html, /440\s*\*\s*Math\.pow\(2/);
    assert.match(html, /oct\s*<=\s*8/);
  }],

  ['300ms input debounce', () => {
    assert.match(spec, /300\s*ms debounce/);
    assert.match(html, /setTimeout\(onInput,\s*300\)/);
  }],

  ['Apply button is documented absent (live-coding replaced it)', () => {
    // SPEC must not promise an apply button, and the DOM must not contain one.
    assert.doesNotMatch(spec, /\*\*apply\*\*\s+— appears/i,
      'SPEC re-introduced the pre-live-coding apply button');
    assert.doesNotMatch(html, /id=["']apply-btn["']/,
      'index.html grew an #apply-btn but SPEC says force-apply is keyboard-only');
  }],

  ['Cmd+Enter branches on isPlaying (force-apply vs play)', () => {
    assert.match(spec, /Cmd\/Ctrl\+Enter \*while playing\*/i,
      'SPEC must document the playing-side force-apply behavior');
    // The keyboard handler must distinguish the two states; flat playBtn.click()
    // would mean Cmd+Enter stops while playing instead of force-applying.
    const block = html.match(/key === 'Enter'[\s\S]{0,1000}?(?:\}\);|playBtn\.click\(\)\s*;\s*\})/);
    assert.ok(block, 'Cmd+Enter handler block not found');
    assert.match(block[0], /if\s*\(\s*isPlaying\s*\)/,
      'Cmd+Enter handler does not branch on isPlaying');
    assert.match(block[0], /onInput\s*\(\s*\)/,
      'Cmd+Enter playing branch does not call onInput()');
  }],

  ['Comma is an accepted (cosmetic) pattern separator', () => {
    assert.match(spec, /\bseparators\b[\s\S]{0,80}`,`/,
      'SPEC pattern-tokens list must mention `,` alongside `|`');
    assert.match(html, /t !== '\|' && t !== ','/,
      'parser dropped the comma filter');
  }],
];

let failed = 0;
for (const [label, check] of checks) {
  try {
    check();
    console.log(`✓ ${label}`);
  } catch (e) {
    console.error(`✗ ${label}\n  ${e.message}`);
    failed++;
  }
}
console.log('');
if (failed) {
  console.error(`${failed} drift(s) — SPEC and code disagree`);
  process.exit(1);
}
console.log('SPEC ↔ code aligned');
