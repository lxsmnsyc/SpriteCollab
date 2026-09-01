# The compact sprites

The collection's sprite folders repacked: one sheet per coat, one
description beside it. Same pixels — every frame is checked against the
folder it came from. Built by [`tools/`](../tools/README.md).

## Layout

```
compact/
  index.json
  kanto/0001/0000/
    sheet.json      structure, shared by every coat
    frames.bin      per-frame numbers
    regular.png  shiny.png  female.png  shiny_female.png
```

`{region}/{dex}/{form}/`, the numbers as four digits.

**Region is not always the dex number's region.** Alolan Raichu is dex
26 but lives under `alola/0026/0001`. Resolve paths through
`index.json`, which lists every form:

```jsonc
{ "version": 1,
  "regions": [{ "region": "kanto", "forms": 285 }, …],
  "slots": [{ "region": "kanto", "dex": 1, "form": 0, "path": "kanto/0001/0000",
              "coats": ["regular", "shiny"], "width": 92, "height": 214 }] }
```

## `sheet.json`

```jsonc
{ "version": 2,
  "dex": 1, "form": 0, "name": "Bulbasaur", "formName": null,
  "region": "kanto", "compact": true, "shadowSize": 1,
  "coats": ["regular", "shiny"],
  "sheet": { "width": 92, "height": 214,
             "pictures": [[0, 171, 17, 21], …] },   // [x, y, w, h]
  "anims": [ … ], "sprites": [ … ], "credits": { … },
  "derived": [] }
```

Every coat's PNG uses the same layout, so `pictures[7]` is in the same
place in all of them.

### `anims` — what exists and how long it runs

```jsonc
{ "anim": 9, "index": 0, "frameWidth": 40, "frameHeight": 40,
  "durations": [4, 4, 4, 4, 4, 4],        // per step, frames of 60 Hz
  "rushFrame": null, "hitFrame": null, "returnFrame": null,
  "copyOf": null, "target": 9 }
```

`durations` has one entry per column. `rushFrame`/`hitFrame`/
`returnFrame` are which step of an attack lunges, lands and returns.

An animation with `copyOf` set is drawn from `target` and has no entry
in `sprites` — take its `durations`, draw `target`'s frames.

### `sprites` — where the frames are

```jsonc
{ "anim": 9,
  "frameWidth": 33, "frameHeight": 30,     // the frame box, after cropping
  "sourceFrameWidth": 40, "sourceFrameHeight": 40, "trim": [3, 0],
  "columns": 6, "rows": 8,
  "frames": [538, 48] }                    // offset, count in frames.bin
```

Frames are row-major: `row * columns + step`. `rows` are directions in
this order:

```
0 Down  1 DownRight  2 Right  3 UpRight  4 Up  5 UpLeft  6 Left  7 DownLeft
```

`sourceFrameWidth`/`Height` and `trim` say where the box sat in the
original folder. A renderer does not need them.

### Animation numbers

Append-only, so safe to hard-code.

```
 0 Idle          10 Swing         20 Slam          30 Emit
 1 Sleep         11 Slice         21 Withdraw      31 Swell
 2 Hurt          12 SpAttack      22 Twirl         32 Ricochet
 3 Attack        13 Shock         23 RearUp        33 MultiScratch
 4 Charge        14 QuickStrike   24 Shake         34 Bite
 5 Shoot         15 Strike        25 Lick          35 Appeal
 6 Double        16 Jab           26 Dance         36 Chop
 7 Hop           17 Punch         27 Uppercut      37 Hover
 8 Rotate        18 Kick          28 Gas           38 Rumble
 9 Walk          19 MultiStrike   29 Stomp         39 Sound
```

The first eleven are on nearly every pokemon; the rest are rare. Cutscene
poses (`EventSleep`, `Laying`, …) are not in this tree.

## `frames.bin`

```
offset  bytes  what
     0      4  "PMDF"
     4      2  uint16  version, currently 2
     6      2  uint16  distinct frames
     8      4  uint32  frames pointing at them
    12    ...  deflate( records × 14 × int16, column by column
                        ++ indices × uint16 )
```

Inflate from offset 12. First `records × 28` bytes are the table, the
rest is the index stream, one `uint16` per frame.

**The table is column-major.** Column `c` of record `r` is at
`table[c * records + r]`.

```
 0,1  shadow x, y      10  cell    index into sheet.pictures
 2,3  center x, y      11  flip    1 to mirror about the picture's own axis
 4,5  head x, y     12,13  at x, y the picture's corner in the frame box
 6,7  left x, y
 8,9  right x, y
```

Anchors are relative to the frame box and **may be negative**. An absent
anchor is `-32768` in both slots — `[0, 0]` is a real coordinate. In
practice all five are present on ~100% of frames; an empty frame has
none.

```js
const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const records = view.getUint16(6, true);
const count = view.getUint32(8, true);
const body = inflate(bytes.subarray(12));
const table = new Int16Array(body.buffer.slice(body.byteOffset, body.byteOffset + records * 28));
const indices = new Uint16Array(body.buffer.slice(body.byteOffset + records * 28, body.byteOffset + records * 28 + count * 2));
const column = (record, at) => table[at * records + record];
```

Copy rather than view in place — inflate output may not be two-byte
aligned.

## Drawing a frame

```js
const target = sheet.sprites.find((one) => one.anim === 9);        // Walk
const record = indices[target.frames[0] + row * target.columns + step];
const [px, py, pw, ph] = sheet.sheet.pictures[column(record, 10)];
const x = column(record, 12), y = column(record, 13);

if (column(record, 11) === 1) {
  context.save();
  context.translate(x + pw, y);
  context.scale(-1, 1);
  context.drawImage(image, px, py, pw, ph, 0, 0, pw, ph);
  context.restore();
} else {
  context.drawImage(image, px, py, pw, ph, x, y, pw, ph);
}
```

Bulbasaur's first `Walk` frame facing `Down`:

```
[17, 24, 16, 23, 11, 24, 16, 18, 21, 24, 0, 0, 8, 6]
```

Shadow `(17, 24)`, body `(16, 23)`, head `(11, 24)`, hands `(16, 18)`
and `(21, 24)`, picture 0 drawn unmirrored at `(8, 6)`.

Two easy mistakes: a picture is smaller than its frame, so draw it at
`at`; and `flip` mirrors the picture about its own axis, not the
frame's.

## Coats

`coats` says which PNGs are there. They share one layout, so swapping a
shiny in changes nothing else. Where a coat was not drawn for some
animation its part of the sheet is transparent, so a frame can be empty
in one coat and not another.

## Credits

Every sheet carries each coat's credits, resolved through the
collection's `credit_names.txt`:

```jsonc
"credits": { "regular": [
  { "date": "2020-10-07 17:58:43.323442", "name": "CHUNSOFT", "discord": null,
    "contact": "https://www.spike-chunsoft.com/",
    "status": "CUR", "license": "Unspecified", "anims": ["Walk", …] }] }
```

The collection is [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/):
non-commercial use, credit required. If you ship these sheets, ship the
credit. Some sheets declare a different `license` — read the field.

### `derived`

Animations a coat gained by recolouring the other of its pair, because
one was finished for a clip the other was not:

```jsonc
"derived": [{ "coat": "shiny", "anim": 36, "from": "regular" }]
```

Those frames are the tool's pixels, not the collection's. Everything
else is the artist's.

## Edited sheets

A few sheets are ours rather than the collection's. [`EDITS.md`](EDITS.md)
lists them. Add a row before editing one.

## Rebuilding

Generated — edit `sprite/` and build again.

```bash
node tools/src/bin.ts 1-151
node tools/src/status-bin.ts --gaps
```
