# Changelog

All notable changes to hum. Newest first.

## Unreleased

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
