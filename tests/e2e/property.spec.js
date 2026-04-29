import { test, expect } from '@playwright/test';
import fc from 'fast-check';
import { gotoApp, applyEdit, startPlayback } from './helpers.js';

// Property:
//   For any sequence of valid edits [H0, H1, …, HN], the live graph after
//   start(H0) + applyEdit(H1) + … + applyEdit(HN) is structurally equivalent
//   to a freshly-built graph from HN alone.
//
// "Structurally equivalent" = same registry keys in the same channelNodes
// order, scheduler.dur reflects HN.bpm, and each surviving node's channel
// metadata (waveform, effects, pattern types) matches HN.
//
// Excludes the duplicate-name-deletion path (logged BLOCKED in the audit)
// by generating each hum with unique channel names — that's the one place
// the diff engine doesn't preserve identity correctly.

const NOTES = ['c4', 'd4', 'e4', 'f4', 'g4', 'a4', 'b4', 'c5'];
const PITCHED = ['sin', 'tri', 'sqr', 'saw'];
const NAMES = ['lead', 'bass', 'pad', 'arp', 'kick', 'hat'];

const arbBpm = fc.integer({ min: 60, max: 180 });

const arbPitchedStep = fc.oneof(
  fc.constantFrom('.'),
  fc.constantFrom(...NOTES)
);
const arbNoiseStep = fc.constantFrom('x', '.');

const arbPattern = (waveform) => fc.array(
  waveform === 'noise' ? arbNoiseStep : arbPitchedStep,
  { minLength: 1, maxLength: 8 }
);

const arbEffects = fc.record({
  vol: fc.option(fc.double({ min: 0.05, max: 1, noNaN: true }), { nil: null }),
  lpf: fc.option(fc.integer({ min: 100, max: 8000 }), { nil: null }),
  decay: fc.option(fc.double({ min: 0.02, max: 0.3, noNaN: true }), { nil: null })
});

function effectsToString(fx) {
  const parts = [];
  if (fx.vol !== null) parts.push(`vol ${fx.vol.toFixed(2)}`);
  if (fx.lpf !== null) parts.push(`lpf ${fx.lpf}`);
  if (fx.decay !== null) parts.push(`decay ${fx.decay.toFixed(2)}`);
  return parts.length ? ` : ${parts.join(' ')}` : '';
}

const arbChannel = (name) =>
  fc.constantFrom(...PITCHED, 'noise').chain((waveform) =>
    fc.tuple(arbPattern(waveform), arbEffects).map(([pattern, effects]) => ({
      name, waveform, pattern, effects
    }))
  );

// 1–4 channels, unique names per hum
const arbHum = fc.tuple(
  arbBpm,
  fc.uniqueArray(fc.constantFrom(...NAMES), { minLength: 1, maxLength: 4 })
).chain(([bpm, names]) =>
  fc.tuple(...names.map((n) => arbChannel(n))).map((channels) => ({ bpm, channels }))
);

function humToText(hum) {
  const lines = [`bpm ${hum.bpm}`];
  for (const ch of hum.channels) {
    lines.push(`${ch.name} ${ch.waveform} ${ch.pattern.join(' ')}${effectsToString(ch.effects)}`);
  }
  return lines.join('\n');
}

// 1–6 edits per case so each example traverses a meaningful path
const arbEditSequence = fc.array(arbHum, { minLength: 1, maxLength: 6 });

async function getStructure(page) {
  return page.evaluate(() => {
    const h = window.__hum;
    return {
      dur: h.scheduler ? h.scheduler.dur : null,
      orderedKeys: h.channelNodes.map((n) => n.registryKey),
      registryKeys: [...h.channelNodesByName.keys()].sort(),
      channels: h.channelNodes.map((n) => ({
        key: n.registryKey,
        name: n.channel.name,
        waveform: n.channel.waveform,
        effects: n.channel.effects,
        patternTypes: n.channel.pattern.map((s) => s.type)
      }))
    };
  });
}

// Round-trip: serializing a parsed hum and re-parsing must yield the same
// channel structure. Catches any future grammar change that breaks
// idempotence — e.g. new tokens that humToText doesn't faithfully emit.
test('property: parse(humToText(hum)) round-trips through serialization', async ({ page }) => {
  await gotoApp(page);
  await fc.assert(
    fc.asyncProperty(arbHum, async (hum) => {
      const text1 = humToText(hum);
      const parsed1 = await page.evaluate((t) => window.__hum.parse(t), text1);
      expect(parsed1.errors).toEqual([]);

      // Re-serialize from the parsed result and re-parse.
      const text2 = humToText({
        bpm: parsed1.bpm,
        channels: parsed1.channels.map((c) => ({
          name: c.name,
          waveform: c.waveform,
          pattern: c.pattern.map((s) =>
            s.type === 'rest' ? '.' : s.type === 'trigger' ? 'x' : s.name
          ),
          effects: c.effects
        }))
      });
      const parsed2 = await page.evaluate((t) => window.__hum.parse(t), text2);

      expect(parsed2.bpm).toBe(parsed1.bpm);
      expect(parsed2.channels.length).toBe(parsed1.channels.length);
      for (let i = 0; i < parsed1.channels.length; i++) {
        const a = parsed1.channels[i];
        const b = parsed2.channels[i];
        expect(b.name).toBe(a.name);
        expect(b.waveform).toBe(a.waveform);
        expect(b.effects).toEqual(a.effects);
        expect(b.pattern.map((s) => s.type)).toEqual(a.pattern.map((s) => s.type));
      }
    }),
    { numRuns: 50, seed: 0xBEEF }
  );
});

test('property: any edit sequence converges to the same graph as a fresh build of the final hum', async ({ page }) => {
  await gotoApp(page);

  await fc.assert(
    fc.asyncProperty(arbEditSequence, async (edits) => {
      // Live path: start with first hum, apply the rest as edits.
      await applyEdit(page, humToText(edits[0]));
      const wasPlaying = await page.evaluate(() => window.__hum.isPlaying);
      if (!wasPlaying) await startPlayback(page);
      for (let i = 1; i < edits.length; i++) {
        await applyEdit(page, humToText(edits[i]));
      }
      const live = await getStructure(page);

      // Fresh path: stop, apply only the final hum, restart from scratch.
      await page.click('#play-btn');
      await page.waitForFunction(() => !window.__hum.isPlaying);
      await applyEdit(page, humToText(edits[edits.length - 1]));
      await startPlayback(page);
      const fresh = await getStructure(page);

      expect(live.dur).toBeCloseTo(fresh.dur, 6);
      expect(live.orderedKeys).toEqual(fresh.orderedKeys);
      expect(live.registryKeys).toEqual(fresh.registryKeys);
      expect(live.channels).toEqual(fresh.channels);

      // Reset between runs so each shrunk example starts from a clean slate.
      await page.click('#play-btn');
      await page.waitForFunction(() => !window.__hum.isPlaying);
    }),
    { numRuns: 50, seed: 0xC0FFEE, verbose: true }
  );
});
