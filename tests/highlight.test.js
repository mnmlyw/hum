import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { loadBlocks } from '../tools/hum-blocks.js';

const { highlightHum, parse } = loadBlocks(['hum-core']);

const DEMOS = new URL('../demos/', import.meta.url);
const demos = readdirSync(DEMOS)
  .filter((f) => f.endsWith('.hum'))
  .map((f) => [f, readFileSync(new URL(f, DEMOS), 'utf8')]);

const unescape = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const textOf = (html) => unescape(html.replace(/<[^>]*>/g, ''));

// Slots covered by .pt spans per channel: { chIdx: Set(step) }
function playheadSlots(html) {
  const slots = {};
  for (const m of html.matchAll(/<span class="pt" data-ch="(\d+)" data-s="(\d+)"(?: data-h="(\d+)")?>/g)) {
    const ch = Number(m[1]);
    const s = Number(m[2]);
    const h = Number(m[3] || 1);
    slots[ch] ??= [];
    for (let k = 0; k < h; k++) slots[ch].push(s + k);
  }
  return slots;
}

describe('highlightHum', () => {
  it('renders exactly the source text (overlay stays aligned with the textarea)', () => {
    for (const [file, text] of demos) {
      assert.equal(textOf(highlightHum(text)), text, file);
    }
    const tricky = 'bpm 120\nlead sin c4 <b>&amp; [c4 e4\n  : vol .5 -- a < b';
    assert.equal(textOf(highlightHum(tricky)), tricky);
  });

  it('gives every parsed step exactly one playhead slot', () => {
    for (const [file, text] of demos) {
      const hum = parse(text);
      const slots = playheadSlots(highlightHum(text));
      hum.channels.forEach((c, i) => {
        const expected = c.pattern.map((_, s) => s);
        assert.deepEqual(slots[i], expected, `${file}: channel ${i} (${c.name})`);
      });
      assert.equal(Object.keys(slots).length, hum.channels.length, `${file}: no stray channels`);
    }
  });

  it('keeps channel indices aligned when a header-shaped line is dropped by the parser', () => {
    // `empty` has no pattern, so parse() drops it; `bass` must still be ch 1.
    const text = 'bpm 120\nlead sin c4 e4\nempty saw\nbass saw c2 . c2';
    const hum = parse(text);
    assert.deepEqual(hum.channels.map((c) => c.name), ['lead', 'bass']);
    const slots = playheadSlots(highlightHum(text));
    assert.deepEqual(slots, { 0: [0, 1], 1: [0, 1, 2] });
  });

  it('maps held notes and chords onto the slots they consume', () => {
    const slots = playheadSlots(highlightHum('a sin c4*3 [c4 e4]*2 .'));
    assert.deepEqual(slots, { 0: [0, 1, 2, 3, 4, 5] });
  });

  it('marks errors', () => {
    const html = highlightHum('a sin c4 zz9 c4!? : lpf 2k bogus');
    assert.match(html, /<span class="er">zz9<\/span>/);
    assert.match(html, /<span class="er">!\?<\/span>/);
    assert.match(html, /<span class="er">bogus<\/span>/);
    assert.match(html, /<span class="nu">2k<\/span>/);
    assert.match(highlightHum('a wobble c4'), /<span class="er">wobble<\/span>/);
  });
});
