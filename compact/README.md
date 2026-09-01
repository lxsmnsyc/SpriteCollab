# The compact sprites

This tree is the collection's sprite folders rewritten into something a
program can load: one sheet per coat, one description beside it, and
nothing in either that a renderer does not need. It is built by
[`tools/`](../tools/README.md), which explains how; this explains how to
read what came out.

Nothing here is a new drawing. Every frame was read back off the
finished sheet and compared, pixel for pixel, with the frame in the
folder it came from. What changed is the packing, not the art.

## Finding a sheet

```
compact/
  index.json
  kanto/0001/0000/
    sheet.json      the structure, shared by every coat
    frames.bin      the per-frame numbers
    regular.png
    shiny.png
    female.png      where the form has one
    shiny_female.png
```

A path is `{region}/{dex}/{form}/`, the last two as four digits. Both
are always written out, so you never have to know the trailing-default
rule the source folders under `sprite/` follow.

**Region is not always the dex number's region.** Alolan Raichu is dex
26, which falls in Kanto's stretch, and it lives under `alola/0026/0001`
— a regional form goes with the region it was drawn for. So resolve a
path through `index.json` rather than computing one from a dex number,
unless you already know the form is not regional.

`index.json` lists everything the tree holds:

```jsonc
{
  "version": 1,
  "regions": [{ "region": "kanto", "forms": 283 }, { "region": "alola", "forms": 18 }, …],
  "slots": [
    { "region": "kanto", "dex": 1, "form": 0, "path": "kanto/0001/0000",
      "coats": ["regular", "shiny"], "width": 92, "height": 214 }
  ]
}
```

`slots` is sorted by region, then dex, then form. `coats` says which PNGs
are actually beside that `sheet.json` — most forms have `regular` and
`shiny` and nothing else, since most pokemon have no female form.

## `sheet.json`

```jsonc
{
  "version": 2,
  "dex": 1, "form": 0,
  "name": "Bulbasaur", "formName": null,   // null form name is the base form
  "region": "kanto",
  "compact": true,                          // frames are cropped to their content
  "shadowSize": 1,
  "coats": ["regular", "shiny"],

  "sheet": {
    "width": 92, "height": 214,
    "pictures": [[0, 171, 17, 21], [20, 88, 19, 21], …]   // [x, y, width, height]
  },

  "anims": [ … ],      // every animation, with its timings
  "sprites": [ … ],    // every animation that is drawn, with its grid
  "credits": { … }     // who drew each coat
}
```

Every coat's PNG is the **same layout**: `pictures[7]` is at the same
place in `regular.png` as in `shiny.png`. One description serves all of
them, which is the whole reason the coats are deduplicated against each
other rather than one at a time.

### Animations are numbers

`anim` is an index into a fixed list. **The numbering is append-only** —
a number written into a sheet means the same thing for ever — so it is
safe to hard-code:

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

The first eleven are drawn for nearly every pokemon. The rest are drawn
for some and not others: across Kanto, `Strike` is on 52 forms of 320,
`Rotate` on all of them, and `Swell`, `Bite`, `Chop` and `Sound` on none.
Check before you rely on one — `tools/sprite-status --coverage` counts
them.

The collection holds a good many animations beyond these forty —
`EventSleep`, `Laying`, `LostBalance` and a couple of dozen more, which
are cutscene poses. They are still in `sprite/`; they are not here.

### `anims` — what an animation is and how long it runs

```jsonc
{ "anim": 9, "index": 0,
  "frameWidth": 40, "frameHeight": 40,   // the cell as authored, before cropping
  "durations": [4, 4, 4, 4, 4, 4],       // per step, in frames of 60 Hz
  "rushFrame": null, "hitFrame": null, "returnFrame": null,
  "copyOf": null, "target": 9 }
```

`durations` has one entry per step of the animation, and its length is
the number of columns the grid has.

`rushFrame`, `hitFrame` and `returnFrame` are which step of an attack
the lunge starts on, lands on and comes back on, where the animation
says. Nothing in this repository reads them; they are carried through
because an engine will want them.

An animation with `copyOf` set is **drawn from another one**. It has its
own number, index and timings but no pixels of its own, and no entry in
`sprites`:

```jsonc
{ "anim": 15, "copyOf": 3, "target": 3,   // Strike is drawn from Attack
  "durations": [4, 2, 4, 2, 2, 2, 2, 2, 2, 2, 4],
  "rushFrame": 2, "hitFrame": 5, "returnFrame": 7 }
```

To play `Strike`, take its `durations` and draw `target`'s frames.

### `sprites` — where an animation's frames are

```jsonc
{ "anim": 9,
  "frameWidth": 33, "frameHeight": 30,          // the frame box, after cropping
  "sourceFrameWidth": 40, "sourceFrameHeight": 40,
  "trim": [3, 0],
  "columns": 6, "rows": 8,
  "frames": [538, 48] }                          // offset and count in frames.bin
```

`rows` is how many directions are drawn, always in this order:

```
0 Down   1 DownRight   2 Right   3 UpRight   4 Up   5 UpLeft   6 Left   7 DownLeft
```

`columns` is the steps in the animation. Frames are row-major, so the
frame for a direction and a step is at `row * columns + step` within
this animation's stretch of `frames.bin`.

`frameWidth` and `frameHeight` are the box a frame is drawn into — the
common area every frame of this animation needs, once the padding the
source carried has been cropped away. Everything positional in a frame
is relative to the top-left of that box.

`sourceFrameWidth`, `sourceFrameHeight` and `trim` describe where that
box sat in the original folder. They are there so a sheet can be traced
back to what it came from; a renderer does not need them.

## `frames.bin`

The per-frame data is most of what a description weighs — a form has on
the order of a thousand frames, each carrying five anchors, which
picture it is, whether it is mirrored and where it sits. As JSON that
came to three times what the drawings themselves cost, so it is a
binary file.

```
offset  bytes  what
     0      4  "PMDF"
     4      2  uint16   version, currently 2
     6      2  uint16   how many distinct frames there are
     8      4  uint32   how many frames point at them
    12    ...  deflate( records × 14 × int16, column by column
                        ++ indices × uint16 )
```

Inflate everything from offset 12. The first `records × 14 × 2` bytes
are the frame table, the rest is the index stream.

The table is stored **column by column**, not frame by frame: all of
frame 0..n's shadow x, then all of their shadow y, and so on for
fourteen columns. So column `c` of record `r` is at `table[c * records + r]`,
not `table[r * 14 + c]`. It is laid out that way because one column
holds one kind of number, which deflate has far more to say about than
fourteen unrelated numbers in a row.

The fourteen, in order:

```
 0,1  shadow x, y      where the shadow sits
 2,3  center x, y      the body
 4,5  head x, y
 6,7  left x, y        the hands
 8,9  right x, y
  10  cell             index into sheet.pictures
  11  flip             1 to draw the picture mirrored about its vertical axis
12,13 at x, y          the picture's corner inside the frame box
```

The five anchors are `[x, y]` relative to the top-left of the frame box,
and they may be **negative** — a shadow sits below the feet, and the box
was cropped to the drawing. An anchor the frame does not carry is
`-32768` in both of its slots; `[0, 0]` is a real coordinate and means
the corner, so test for the sentinel rather than for falsiness.

In practice all five are there on nearly every frame — across Kanto,
`shadow` on 100% and the other four on 99.9% — but an empty frame in the
middle of an animation carries none of them, so check.

The index stream is one `uint16` per frame, pointing into the table. Two
frames that are the same frame share a record, which is why the table is
shorter than the stream — Bulbasaur's 706 frames are 425 records.

### Reading it

```js
const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

if (new TextDecoder().decode(bytes.subarray(0, 4)) !== 'PMDF') throw new Error('not a frame table');
const version = view.getUint16(4, true);
const records = view.getUint16(6, true);
const count = view.getUint32(8, true);

const body = inflate(bytes.subarray(12));                 // any zlib inflate
const table = new Int16Array(body.buffer.slice(body.byteOffset, body.byteOffset + records * 28));
const indices = new Uint16Array(body.buffer.slice(body.byteOffset + records * 28, body.byteOffset + records * 28 + count * 2));

const column = (record, at) => table[at * records + record];
```

Copy rather than view in place if your inflate output might not be
aligned to two bytes — the snippet above copies with `slice`.

## Drawing a frame

```js
const target = sheet.sprites.find((one) => one.anim === 9);         // Walk
const record = indices[target.frames[0] + row * target.columns + step];

const [px, py, pw, ph] = sheet.sheet.pictures[column(record, 10)];
const flip = column(record, 11) === 1;
const x = column(record, 12);
const y = column(record, 13);

context.save();
if (flip) {
  context.translate(x + pw, y);
  context.scale(-1, 1);
  context.drawImage(image, px, py, pw, ph, 0, 0, pw, ph);
} else {
  context.drawImage(image, px, py, pw, ph, x, y, pw, ph);
}
context.restore();
```

Bulbasaur walking, facing `Down`, first step: the record is

```
[17, 24, 16, 23, 11, 24, 16, 18, 21, 24, 0, 0, 8, 6]
```

which is a shadow at `(17, 24)`, the body at `(16, 23)`, a head at
`(11, 24)`, hands at `(16, 18)` and `(21, 24)`, picture 0 —
`[0, 171, 17, 21]` on the sheet — drawn unmirrored at `(8, 6)` inside a
33×30 box.

Hold it for `anims.find((one) => one.anim === 9).durations[step]` frames
of 60 Hz, then move on. `rows` is 8, so a direction is a row; if an
animation has fewer rows than 8, only those directions are drawn.

Two things follow from the packing that are easy to get wrong:

- **A picture is smaller than its frame.** Draw it at `at`, not at the
  frame's corner, or the animation will wobble.
- **`flip` mirrors the picture about its own vertical axis**, not about
  the frame's. That is what makes a left-facing row cost nothing: it is
  the right-facing row's pixels read backwards.

## Coats

A form has up to four: `regular.png`, `shiny.png`, `female.png` and
`shiny_female.png`. `coats` in `sheet.json` says which are there, and
they share one description and one layout — swapping a shiny in is
swapping the image and changing nothing else.

Where a coat was not drawn for some animation, its part of the sheet is
left transparent. Sheets are also not always the same *drawing*: a
shiny is sometimes finished for seven of the eight directions where the
ordinary coat has all eight. `rows` describes the fullest coat, so a
frame can come out empty on one coat and not another.

## Credits and the licence

Every sheet carries the `credits.txt` of each coat it was built from,
resolved through the collection's `credit_names.txt`:

```jsonc
"credits": {
  "regular": [
    { "date": "2020-10-07 17:58:43.323442",
      "name": "CHUNSOFT", "discord": null,
      "contact": "https://www.spike-chunsoft.com/",
      "status": "CUR", "license": "Unspecified",
      "anims": ["Walk", "Attack", "Strike", …] }
  ]
}
```

`name` is a person, `discord` their account id where the author was
credited by mention, and `status` is `CUR` for the version in the sheet
or `OLD` for one it replaced. `anims` is what that submission touched,
by the names the collection uses — which include animations that are not
in this tree, since a submission may have drawn poses the sheet leaves
behind.

**This is not decoration.** The collection is under
[CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/): the art
may be copied, remixed and built upon for non-commercial use *as long as
appropriate credit is given*. If you ship these sheets, ship the credit
with them. Some sheets carry a different `license` — `PMDCollab_1`,
`PMDCollab_2`, `Unspecified` — so read the field rather than assuming.

## Rebuilding

The sheets are generated. Do not hand-edit them; edit the folders under
`sprite/` and build again:

```bash
node tools/src/bin.ts 1-151            # rebuild those species
node tools/src/status-bin.ts --gaps    # what is missing or out of date
```

[`tools/README.md`](../tools/README.md) covers what the optimizer does
and why.
