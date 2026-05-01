# tutorial

a 5-minute walkthrough of every feature in hum. type each block into the
editor and press play. each one builds on the last.

## 1. one note

```
bpm 120
lead sin c4
```

a line is a channel. `lead` is its name. `sin` is the waveform. `c4` is
middle C. you'll hear it pulse once per beat.

## 2. a melody

```
bpm 120
lead sin c4 e4 g4 c5
```

each token is one step (an 8th note). four tokens = four pitches. the
pattern loops forever.

## 3. rests

```
bpm 120
lead sin c4 . . e4 . . g4 .
```

`.` is a rest. so is `_` if you prefer. rest tokens count as steps too —
this pattern is 8 steps long, not 3.

## 4. a second channel

```
bpm 120
lead sin c4 e4 g4 c5
bass saw c2 . g2 .
```

two lines, two channels. they play at the same time. waveforms: `sin`,
`tri`, `sqr`, `saw`, `noise`. octaves run 0–8.

## 5. effects

```
bpm 120
lead sin c4 e4 g4 c5 : vol .5
bass saw c2 . g2 .   : lpf 400
```

after `:` you can set effects. `vol` (0–1), `lpf` (low-pass filter Hz),
`hpf` (high-pass), `decay` (seconds — makes notes percussive). `.5` is
shorthand for `0.5`; `400` is just a number; `2k` means 2000.

## 6. drums

```
bpm 120
kick noise x . . . x . . . : lpf 50 decay .05
hat  noise . . x . . . x . : hpf 8k decay .015
```

`noise` is the noise waveform. `x` triggers a hit. high-pass + short
decay = hi-hat. low-pass + slightly-longer decay = kick.

## 7. multi-line patterns

```
bpm 96
lead tri
  c4 e4 g4 c5
  g4 e4 c4 .
  : vol .4
```

indent any line to continue the previous channel. the pattern above
plays as `c4 e4 g4 c5 g4 e4 c4 .` — one 8-step loop. effects can live on
their own line too.

## 8. polyrhythm — the trick

```
bpm 120
lead sin c4 e4 g4 c5 e4 g4 c5
kick noise x . . . x . . .
```

the lead has 7 steps, the kick has 8. they loop independently and never
re-align. give two channels different lengths and you get polyrhythm
for free. coprime lengths (5 vs 7, 7 vs 11) drift forever.

## 9. live coding

playback runs while you type. edits land after a 300 ms pause:

- pattern changes (note swaps, rests added) take effect on the next
  scheduler tick.
- structural changes (new channel, swapped waveform, removed channel)
  quantize to the next step boundary so they land musically.
- press **Cmd/Ctrl+Enter** to apply immediately without waiting on the
  debounce.
- press **Esc** to stop. press it again with **Cmd/Ctrl+Enter** to start
  fresh. there is no rewind — start always means step 0.

## 10. all together

a full mini-song using everything above:

```
bpm 96

-- glass
lead tri
  . . f#4 . a4 . c#5 .
  d5 . . . c#5 . a4 .
  : vol .5

bass saw
  d2 . . d2 . . d3 .
  : lpf 200

kick noise x . . . . . x . : lpf 50 decay .06
hat  noise . . x . . . x . : hpf 8k decay .03
```

four channels, two waveforms, two filters, one decay. a verse loop in
sixteen lines.

## what to try next

- open one of the demos via the **presets** picker and read it. they're
  the same `.hum` text you've been writing.
- give two melodic channels different lengths (e.g. 7 vs 11) and listen
  to them drift. this is hum's core pleasure.
- aim a long `decay` (`.5`, `1.5`) at a `sin` channel — it becomes a
  pluck or a bell.
- save your song with the **save** button, drag the file onto the page
  later to load it. `.hum` files are plain text — open them in any
  editor.

that's the whole language. the [SPEC](SPEC.md) is the full reference;
the [demos/](demos/) folder has six longer examples to read.
