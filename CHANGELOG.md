# Changelog

All notable changes to hum. Newest first.

## Unreleased

### Behavior
- **Esc stops/pauses playback.** Closes the keyboard control loop —
  Cmd/Ctrl+Enter starts (or force-applies while playing), Esc stops.
  No-op when already stopped, so the editor's escape-the-modal reflex
  stays safe.

### UI fix (round 2)
- Preset picker focus ring sometimes persisted even after the previous
  blur+refocus fix — Chrome occasionally re-acquired focus on the
  `<select>` after the change event resolved. Now the blur runs both
  synchronously and on the next animation frame, and the CSS strips
  both `:focus` and `:focus-visible` outlines as a backstop. The
  picker is a pop-and-go affordance; a sticky focus indicator on it
  has no meaning.

### Demos
- `demos/micro-cell.hum` — polyrhythm showcase. Five channels with
  coprime lengths (5, 7, 8, 11, 13); the texture never quite repeats.
  Exercises `_` rests.
- `demos/flux.hum` — fast feature platter at 200 BPM. Every waveform,
  every effect, sharps + flats, triggers on pitched channels.
- Both demos covered by parser tests (BPM, channel count, error-free
  parse, plus a structural assert that flux exercises all 5 waveforms).

### Language
- **Removed comma syntax.** Comma was previously accepted as a cosmetic
  pattern separator; simplifying down to whitespace + `|`. Rationale:
  one fewer thing to teach, one fewer edge case (was the parser
  treating attached `c4,` correctly? — turned out: not, despite test
  coverage saying so).
- SPEC, parser, parser tests, and check-spec.js all updated. Existing
  `.hum` files don't use commas so no demo content needed migration.

### UI fix
- Preset picker no longer keeps a persistent blue focus ring after
  loading a demo. After selection, focus returns to the editor and
  the picker's :focus styling is suppressed (a :focus-visible ring
  remains for keyboard navigation).

### Features
- **Per-channel mini-VU meters** in the footer. One bar per active
  channel, RMS-driven, clip indicator on saturation. Driven by a
  per-channel `AnalyserNode` inserted between `volumeGain` and the
  master analyser.
- **Auto-save to localStorage**: every settled edit persists. On
  reload the last buffer is restored. `?reset=1` skips restore and
  reseeds with the default hum.
- **Preset picker** in the footer. Loads any of the six shipped
  demos (glass, neon-drift, tidal-memory, slow-erosion, phosphene,
  dust-and-iron) without going through the file dialog. Demos are
  inlined into `index.html` via `<script type="text/hum">` blocks
  so the picker works over `file://` where fetch is blocked.
- **Floating translucent footer**: the footer now sits over the
  editor with a 40 px gradient fade so code scrolls behind it
  rather than being clipped above a hard line. Ported from the
  retired `bottom-bar-redesign` branch.

### Tooling
- `tools/embed-presets.js` keeps the inlined demo blocks in sync
  with `demos/`. `npm run preset:embed` writes; `npm run preset:check`
  verifies (used by `test:all` and CI).
- Removed dormant branches: `note-drag` (deferred indefinitely on
  technical limitations), `bottom-bar-redesign` (merged via
  cherry-port).

### Performance
- `drawViz` skips the canvas redraw when the analyser's time-domain
  buffer hasn't changed (rolling stride hash). Cuts idle GPU work
  during silent passages and sustained tones to near-zero.
- Step-dot active class is edge-triggered: only the two dots that
  flipped get touched per frame instead of toggling .active on all
  64 dots. Mirrors the existing prevPlaying pattern.
- `updateHighlight` memoizes the rendered HTML and skips the
  `innerHTML` rewrite + playhead-map rebuild when the new output
  matches the previous one (whitespace-only edits, undo to a known
  state, etc.).
- Pending waveform-swap cleanups now sit in a bounded queue
  (`MAX_PENDING_SWAPS = 16`); excess older entries are force-flushed
  rather than allowed to pile up if a user cycles waveforms faster
  than the 210 ms cleanup window. `teardownGraph` drains the queue
  on stop.
- `tools/check-spec.js` replaced two inline-`new RegExp` loops with
  single alternation matches.

### Behavior
- **Cmd/Ctrl+Enter while playing now force-applies the pending edit**
  instead of stopping playback. Cancels the 300 ms debounce and runs
  `onInput()` synchronously, so structural changes land immediately
  without waiting on the timer. Playback stays alive. Cmd/Ctrl+Enter
  while stopped continues to start playback.

### SPEC alignment
- Removed the stale "apply" button entry from Controls — live-coding's
  debounced auto-application replaced it; SPEC now documents the
  live-update model and the new Cmd+Enter force-apply path.
- Pattern tokens: documented `,` as a cosmetic separator alongside `|`
  (the parser has accepted both since the original release).
- Triggers: SPEC now describes that `x` fires the envelope at the
  channel's most recent frequency, not just on noise channels.
- Channel name relaxed from "any identifier" to "any non-whitespace
  token", matching what the parser actually accepts.
- Step-dot indicator: documented the 64-dot visual cap.

### Tooling
- `tools/check-spec.js` gained 3 asserts (apply absent, Cmd+Enter
  branches on isPlaying, comma separator) so future drift on these
  points fails the build.

### Mobile UI
- Pattern-token toolbar appears above the canvas on coarse-pointer devices;
  taps insert `.` `x` `|` `:` `#` `bpm` at the caret.
- iOS safe-area insets honoured on editor (top, sides) and footer (bottom).
- Editor font-size raised to 16 px on touch to suppress iOS focus-zoom;
  footer buttons get thumb-sized padding.
- Three Playwright tests under an emulated Pixel 5 viewport guard the new
  behavior. Desktop layout unchanged.



### Tooling
- `npm run test:all` runs Node + Playwright in one command.
- `npm run check:spec` verifies SPEC.md claims still match the code.
- `npm run lint` enforces no-unused-vars / no-undef across tests and tools.
- GitHub Actions runs both suites + spec checker on push and PR.
- Pre-commit hook runs the fast Node suite locally.

### Tests
- 50-run fast-check property: any sequence of valid live edits converges
  to the same graph as a fresh build of the final hum.
- Round-trip property: `parse(humToText(parse(text)))` equals
  `parse(text)` for any generated hum.
- Default-hum smoke test: the shipped 6-channel example produces audible
  output above the silence threshold.

### Internal
- Step factory (`Step.rest()`, `Step.trigger()`, `Step.note(freq, name)`)
  centralizes the pattern-step schema so future kinds extend in one place.
- Test-hook contract documented inline at the `__hum` block.

## 2026-04-28 — Audit and refactor pass

### Fixed
- `startPlayback` is now re-entrancy-guarded — rapid play clicks no
  longer leak worker listeners or spawn duplicate Schedulers.
- Channels removed mid-play are drained on stop; a stop before the
  quantized boundary no longer leaves the removed channel playing for
  ~1 s of pre-scheduled audio.
- Parser clamps negative `decay` and rejects non-finite effect values
  (`Infinity`, `1e309`, `-Infinity`); these would previously throw
  inside `scheduler.tick` and stall it.
- `lastParseKey` is reset on stop and set on start, so a revert-while-
  stopped plus a re-edit no longer silently skips the diff.
- `attack` / `sustain` / `release` removed from `EFFECT_NAMES` — they
  were accepted by the parser but never reached the audio graph.
- `drawViz` no longer churns ~3,840 classList ops/sec while idle;
  cleanup is edge-triggered on the playing → stopped transition.
- `buildStepDots` no longer rebuilds the step bar on every empty edit.
- Drag-drop now lowercases the file suffix before checking `.hum`.

### Refactor
- `createChannelNode` reads as a signal-flow declaration via
  `makeGain` / `makeFilter` / `chain` helpers.
- `Scheduler.tick` and rewinds share `cancelChannelEventsFrom` and
  `scheduleStep` helpers.

### Documentation
- SPEC signal chain diagram updated to match `createChannelNode` (added
  `sourceGain`, fixed filter order).
- SPEC ramp claim rewritten to reflect what actually ships.
