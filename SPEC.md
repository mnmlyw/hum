# hum — spec

A fantasy synth. One HTML file, zero dependencies. You open it, you type, you hear music.

## DSL

```
bpm 96

-- glass
lead tri
  . . f#4 . a4 . c#5 .
  d5 . . . c#5 . a4 .
  : vol .5

bass saw c2 . e2 . g2 . c2 e2 : lpf 400
kick noise x . . x . . x . : lpf 55 decay .05
```

### Structure

A hum is a sequence of lines. Each line is one of:

- **blank** — ignored
- **comment** — `-- text`, rest of line ignored
- **bpm** — `bpm <number>`, sets tempo (20-999)
- **channel** — `<name> <waveform> <pattern> : <effects>`
- **continuation** — indented line, appends to previous channel

### Channel definition

```
<name> <waveform> <pattern tokens...> : <effect pairs...>
```

- **name** — any non-whitespace token (`kick`, `bass`, `lead`, `pad2`); duplicates within one hum get `#2`, `#3`… registry keys
- **waveform** — one of: `sin`, `tri`, `sqr`, `saw`, `noise`
- **pattern** — space-separated tokens (see below)
- `:` — separates pattern from effects (optional if no effects)
- **effects** — space-separated name-value pairs (see below)

### Pattern tokens

- **note** — `c4`, `eb3`, `f#5` (letter + optional sharp/flat + octave 0-8)
- **trigger** — `x` (envelope fires using the channel's most recent frequency; primarily for noise/percussive hits, but accepted on any waveform)
- **rest** — `.` (also `_`)
- **bar line** — `|` (cosmetic, ignored by parser; e.g. `c4 | e4`)

Each token is one step (unless held). A step is an 8th note. 8 steps = 1 bar of 4/4.

#### Per-step modifiers

Any base token may be followed by one or more modifier characters:

- **hold** — `*N` (N ≥ 1) — sustain the envelope for N step slots without retriggering. `c4*4 e4` is a 5-step pattern: c4 held across steps 0–3, e4 at step 4. Total pattern length = sum of every token's slot count.
- **accent** — `!` — trigger this step at vel 1.5 (master compressor absorbs the headroom).
- **ghost** — `?` — trigger this step at vel 0.4 (audibly quieter, not silent).

Modifiers may stack in any postfix order: `c4!*4` and `c4*4!` are equivalent (accented note held for 4 steps). Constraints: a single token may carry at most one of each modifier kind, and accent + ghost together is an error. `*0` is rejected. `*1` is allowed but redundant.

Modifiers on rests are accepted; only `*N` is meaningful (`.*4` = four rests). Modifiers on `x` triggers work the same as on notes (`x*4` = sustained noise hit).

A bare token (`c4`) is identical to `c4!` minus the accent — i.e. `vel = 1`, `hold = 1`. Every existing `.hum` file from before phase 2 parses to identical step objects; the new fields default safely.

All channels play simultaneously. Each pattern loops independently. Different lengths create polyrhythmic drift.

### Effects

After the `:`, name-value pairs separated by spaces:

| effect | value | description |
|--------|-------|-------------|
| `lpf`  | hz    | low-pass filter cutoff |
| `hpf`  | hz    | high-pass filter cutoff |
| `decay`| seconds | percussive envelope decay time |
| `vol`  | 0-1   | channel volume |

Number shorthands: `.05` for `0.05`, `6k` for `6000`

### Multi-line continuation

Indented lines append to the previous channel:

```
lead tri
  c4 e4 g4 c5     -- bar 1
  g4 e4 c4 .      -- bar 2
  : vol .5
```

Is equivalent to `lead tri c4 e4 g4 c5 g4 e4 c4 . : vol .5`. Comments are stripped per-line before joining.

### Limits

- 8 channels max
- Monophonic per channel (chords require multiple channels)
- Octave range: 0-8 (C0 ~16Hz to B8 ~7902Hz), A4 = 440Hz
- Sharps (`c#4`) and flats (`eb4`, `bb3`)
- No nesting, no expressions, no variables
- `.hum` files are plain text — the DSL is the format

## Audio engine

- Web Audio API, single `AudioContext`
- Per-channel signal chain: `source → sourceGain → envelopeGain → hpf → lpf → volumeGain → meter → analyser → compressor → destination` (filters are always present; `hpf` defaults to 0 Hz and `lpf` to 20 kHz when no effect is set; `meter` is a per-channel `AnalyserNode` driving the footer mini-VU bars)
- Pitched waveforms: continuous `OscillatorNode`, frequency set per step
- Noise: looped `AudioBufferSourceNode` (2s random buffer)
- `DynamicsCompressorNode` on master bus prevents clipping
- Short ramps and crossfades at gain transitions to suppress clicks: 5 ms equal-power crossfade on waveform swap, 10 ms `setTargetAtTime` ramps on effect-value changes, end-of-step linear fade to 0 over the last 10 ms of each non-decay note, 3 ms attack on the master `DynamicsCompressorNode`. Note onsets themselves are instantaneous (`setValueAtTime(1, t)`).

## Scheduler

- Chris Wilson lookahead pattern: JS timer schedules Web Audio events ahead of time
- `setInterval` runs in a Web Worker (immune to background tab throttling)
- 25ms tick interval, 150ms lookahead window
- Step times computed from base (`startTime + step * stepDuration`), no accumulation drift
- First tick fires synchronously after `scheduler.start()`, filling the full 150 ms lookahead before control returns to the user

## Editor

- Full-screen `<textarea>` with transparent text
- Syntax highlight overlay renders colored HTML behind the textarea
- Cyberdream color palette (scottmckendry)
- Scroll sync between textarea and highlight layer
- Tab key inserts 2 spaces, 300ms debounce on input
- Inline error highlighting: invalid tokens get red wavy underline

### Syntax highlighting colors

comments: grey, `bpm`: magenta, waveforms: cyan, channel names: white dim, notes: green, triggers: pink, rests: grey dim, bar lines: grey dim, colon: purple, effects: blue, numbers: orange

### Note playhead

Playing notes get inverse video (cyan background, dark text). Playing rests brighten. Updated every frame via `data-ch` and `data-s` attributes on pattern token spans.

## Controls

Edits during playback apply automatically: the editor's `input` event runs the
parser and live-updates the audio graph after a 300 ms debounce. Pattern and
effect changes take effect on the next scheduler tick; structural changes
(adding, removing, or swapping waveform on a channel) are quantized to the
next step boundary.

- **play / stop** — button. Cmd/Ctrl+Enter starts playback when stopped;
  Esc stops/pauses while playing (no-op when stopped).
- **force-apply** — Cmd/Ctrl+Enter *while playing* cancels the pending
  debounce and applies the latest edit immediately.
- **load** — opens file picker for `.hum` files.
- **save** — downloads `.hum` file (or Cmd+S), named from the first `-- comment`.
- **drag-and-drop** — drop a `.hum` file onto the page to load it.

## Visualizer

- Canvas waveform strip (48px) in footer
- Step dot indicator: one dot per step of longest pattern (visually capped at 64; longer patterns still play correctly, only the strip is truncated)
- Downbeat dots (every 8 steps) brighter than offbeats
- Active dot: cyan

## Branches

- `main` — stable; includes live-coding and mobile UI
- `note-drag` — pitch shift by dragging notes
- `bottom-bar-redesign` — floating translucent footer

## Mobile

Activated by `(hover: none) and (pointer: coarse)`:

- iOS safe-area insets respected on the editor (top/sides) and footer (bottom).
- Editor font-size raised to 16 px to suppress iOS focus-zoom.
- Footer button padding increased for thumb-sized tap targets.
- A pattern-token toolbar above the canvas inserts `.`, `x`, `|`, `:`, `#`,
  `bpm` at the caret on tap. Hidden on desktop.
