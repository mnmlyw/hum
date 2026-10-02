# hum

A fantasy synth in a single HTML file. You open it, you type, you hear music.

```
bpm 96

-- glass
lead tri
  . . f#4 . a4 . c#5 .
  : vol .5

bass saw c2 . e2 . g2 . c2 e2 : lpf 400
kick noise x . . x . . x . : lpf 55 decay .05
```

## Run it

Open `index.html` in any modern browser, or visit
**https://mnmlyw.github.io/hum/**. No build step. No dependencies.

## Learn it

[TUTORIAL.md](TUTORIAL.md) walks through every feature in 5 minutes —
one note → melody → drums → polyrhythm. Prefer a browser? open
[tutorial.html](tutorial.html) — same content, same cyberdream theme as
the app, with the code examples run through hum's own syntax highlighter.
[SPEC.md](SPEC.md) is the full reference if you'd rather read the grammar.

## Repo layout

```
index.html                  the app — DSL parser, audio engine, scheduler, editor, all of it
tutorial.html               styled, browsable version of TUTORIAL.md (hand-written, not a build step)
SPEC.md                     the language and runtime contract (this is the source of truth)
demos/                      shipped .hum files; load via the load button or drag-drop
tests/parser.test.js        Node test suite (parser + scheduler math, ~90 ms)
tests/live-update.test.js   Node tests for humKey + planLiveUpdate (~20 ms)
tools/check-spec.js         asserts SPEC.md claims still match index.html
tools/embed-presets.js      inlines demos/*.hum into index.html (`--check` verifies)
.github/workflows/          GitHub Actions CI
```

## Develop

```sh
npm install        # one-time
npm test           # Node tests, sub-second feedback
npm run test:all   # lint + spec + preset check + tests; what CI runs
npm run lint       # eslint
npm run check:spec # verify SPEC.md ↔ index.html
npm run preset:embed # re-embed demos/*.hum after editing a demo
```

A pre-commit hook runs the same chain as `npm run test:all` before each commit.

## Why one file

Portable. Email-able. No build step that can rot. Reading `index.html` end
to end is the documentation.
