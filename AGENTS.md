# AGENTS.md

## Cursor Cloud specific instructions

`hum` is a single-file, zero-build fantasy synth: the entire app (DSL parser,
audio engine, scheduler, editor UI) lives in `index.html`. There is no backend,
no bundler, and no framework. `tests/` and `tools/` are small Node scripts used
for CI only. See `README.md` for the canonical dev commands.

### Running the app
- The app is a static file. Serve the repo root over HTTP and open
  `index.html`, e.g. `python3 -m http.server 8000` then browse to
  `http://localhost:8000/index.html`. Opening the file directly (`file://`)
  also works, but serving over HTTP matches the deployed GitHub Pages setup.
- Audio only starts after a user gesture — click the **play** button (bottom
  left) or press **Cmd/Ctrl+Enter**. This is browser autoplay policy, not a bug.
  Playback shows an animated waveform along the bottom and moving cyan
  highlights over the currently-playing note tokens.
- There is no dev server / hot reload; just reload the page after editing
  `index.html`.

### Tests / lint / checks (all Node-based, run from repo root)
- Standard commands are documented in `README.md`. `npm run test:all` is exactly
  what CI runs: `lint` → `check:spec` → `preset:check` → `test`.
- `check:spec` (`tools/check-spec.js`) asserts that factual claims in `SPEC.md`
  still match constants/behavior in `index.html`. If you change either
  `SPEC.md` or the relevant code in `index.html`, this can fail — keep them in
  sync.
- `preset:check` (`tools/embed-presets.js --check`) verifies the demo `.hum`
  files under `demos/` are embedded in `index.html`. If you add/edit a demo,
  run `npm run preset:embed` to re-embed, then commit `index.html`.
- The pre-commit hook (`.husky/pre-commit`) runs the same lint + spec + preset +
  test chain, so commits are blocked on any failure.

### GUI testing caveat
- During idle periods (no mouse/keyboard input) the VM desktop shows a
  screensaver: a black screen with a spinning 3D cube. This is the OS
  screensaver, NOT an app crash. It disappears on the next mouse/keyboard
  interaction. When recording GUI demos, keep interacting (or keep the clip
  short) so the idle screensaver doesn't appear in the footage.
