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
- Standard commands are documented in `README.md`. `npm run check` is exactly
  what CI and the pre-commit hook run: `lint` → `sync:check` → `check:spec` →
  `test`.
- `index.html` has three script blocks: `hum-core` (pure: parser, planner,
  scheduler timing, highlighter), `hum-engine` (Web Audio, no DOM) and the app.
  Tests load the first two via `tools/hum-blocks.js`, so keep `hum-core` free
  of DOM/Web Audio and `hum-engine` free of editor DOM.
- `sync` regenerates derived files: demo `.hum`s embedded into `index.html`,
  and `tutorial.html` built from `TUTORIAL.md` + `tools/tutorial.template.html`
  (it inlines `hum-core`/`hum-engine`). After editing a demo, the tutorial, or
  either of those blocks, run `npm run sync` and commit the results;
  `sync:check` fails otherwise. Never edit `tutorial.html` by hand.
- `check:spec` (`tools/check-spec.js`) asserts that factual claims in `SPEC.md`
  still match constants/behavior in `index.html`. If you change either
  `SPEC.md` or the relevant code in `index.html`, this can fail — keep them in
  sync.
- `tests/audio.test.js` renders `hum-engine` through `node-web-audio-api`
  (`OfflineAudioContext`). That library differs from browsers in places (see
  the file header), so don't tighten its level assertions against it alone.

### GUI testing caveat
- During idle periods (no mouse/keyboard input) the VM desktop shows a
  screensaver: a black screen with a spinning 3D cube. This is the OS
  screensaver, NOT an app crash. It disappears on the next mouse/keyboard
  interaction. When recording GUI demos, keep interacting (or keep the clip
  short) so the idle screensaver doesn't appear in the footage.
