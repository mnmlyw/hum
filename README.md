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
[tutorial.html](tutorial.html) — the same content, generated from the
markdown, with every example playable on hum's own engine.
[SPEC.md](SPEC.md) is the full reference if you'd rather read the grammar.

## Repo layout

```
index.html                  the app — DSL parser, audio engine, scheduler, editor, all of it
tutorial.html               generated from TUTORIAL.md; playable examples (don't edit by hand)
SPEC.md                     the language and runtime contract (this is the source of truth)
demos/                      shipped .hum files; load via the load button or drag-drop
tests/                      Node tests: parser, live-update planner, scheduler,
                            highlighter, offline audio render
tools/hum-blocks.js         loads index.html's hum-core / hum-engine scripts into Node
tools/check-spec.js         asserts SPEC.md claims still match index.html
tools/embed-presets.js      inlines demos/*.hum into index.html
tools/build-tutorial.js     builds tutorial.html (template: tools/tutorial.template.html)
.github/workflows/          GitHub Actions CI
```

## Develop

```sh
npm install        # one-time
npm test           # Node tests, sub-second feedback
npm run check      # lint + sync check + spec check + tests; what CI and pre-commit run
npm run sync       # after editing a demo, TUTORIAL.md, or index.html's core/engine
```

`index.html` keeps its code in three `<script>` blocks: `hum-core` (pure
parser, scheduler timing, highlighter), `hum-engine` (Web Audio) and the
app. Tests and `tutorial.html` reuse the first two, so there's one copy
of every line of logic.

## Why one file

Portable. Email-able. No build step that can rot. Reading `index.html` end
to end is the documentation.
