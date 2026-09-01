# The sprite optimizer

`sprite-optimize` turns the collection's sprite folders into compact,
deduplicated sheets and a description beside them. Across the
original hundred and fifty-one it takes 171 MB of PNGs down to 7.2 MB —
the same pixels, checked frame by frame — and it is meant to be run
again on whatever changed each time this fork is synced with
PMDCollab's.

```
node tools/src/bin.ts 1-3 --dry-run     # say what it would come to
node tools/src/bin.ts 1-3               # write compact/
node tools/src/bin.ts 1-3 --prune       # and take the folders away
```

It reports a line per form and then a line per species, which weighs the
whole of `sprite/{dex}` against the whole of `compact/sprite/{dex}` —
folders and all, including whatever a species folder holds that is not a
sprite:

```
form      sheet       kept/frames   before       after   saved
1/0       79x252      42/706       508.2 K ->   18.2 K   96.4%
1/1       79x252      42/706       511.8 K ->   19.2 K   96.2%
0001 Bulbasaur        kanto         2 forms   1020.0 K ->   37.4 K   96.3%

26/0      252x236     61/882         1.5 M ->   57.4 K   96.2%
26/1      305x281     74/888       778.7 K ->   39.3 K   95.0%
0026 Raichu           kanto,alola   2 forms     2.6 M ->   96.7 K   96.4%
```

A species with a regional form is filed in more than one place, and is
weighed across all of them.

A species is measured before anything is built, so a `--prune` run
reports the folders it is about to take away rather than what is left.

## Why the collection is big

`sprite/` is 1.4 GB, and almost none of that is drawing. A form is a
folder of about a hundred files: for every animation, three PNGs — the
drawing, a `-Shadow` image whose blob marks where the shadow sits, and
an `-Offsets` image whose coloured pixels mark the body, head and
hands. Each is written as 8-bit-per-channel truecolour with an alpha
channel, which spends 32 bits a pixel on art drawn in a dozen colours;
every frame is padded out to the widest lunge of its own clip; the same
standing pose is drawn again in every clip that holds it; the rows
facing left are the rows facing right drawn backwards; and two thirds
of the animations are cutscene poses nothing downstream ever draws.

That layout is right for editing: a submission is a folder somebody
opens in Aseprite. It is wasteful for everything else, and this fork
wants everything else.

## What the optimizer does

Six things, in this order. None of them changes a pixel.

1. **Keeps only the animations that are supported.** The collection
   draws from a much larger vocabulary than any engine reading these
   sheets does — `EventSleep`, `Laying`, `LostBalance` and twenty more
   are cutscene poses. [`anims.ts`](src/anims.ts) is the list of the
   forty that are supported, copied from `src/data/ids/sprite-anims.ts`
   in Overwander and Poketerra, where the two files are identical.
   Everything else stays in the collection and out of the sheet. On
   Bulbasaur that is a third of the frames before anything else runs.

2. **Reads the anchors out of the marker images.** The `-Shadow` and
   `-Offsets` PNGs exist to be read once. Their marks become five
   coordinates per frame, and the two images — two thirds of the files
   in the folder — are never written again.

   The colours are worth stating, because getting one wrong costs an
   anchor silently: `-Offsets` marks the body in **black** and the head
   and two hands in red, green and blue. `-Shadow` marks the shadow with
   a single **white** pixel and draws red, green and blue rings around
   it for the three shadow sizes — it is not a blob to be averaged,
   however much it looks like one.

   Since a missing anchor breaks nothing that the round-trip check can
   see — the sheet is still pixel-perfect, the anchor is just absent —
   every run reports how many of its frames carry each one:

   ```
   anchors  shadow 100.0%  center 99.9%  head 99.9%  left 99.9%  right 99.9%
   ```

   Anything reading near zero is a matcher looking for the wrong colour.

3. **Crops every frame to what is drawn in it.** A clip's box has to
   hold its widest lunge and every other frame rattles around inside
   that box. Each frame keeps its own bounding rectangle and the corner
   it sits at.

4. **Stores each distinct picture once.** Frames are compared by their
   pixels, and by their pixels mirrored, across *every clip of the form
   at once* — a pokemon standing still is drawn the same in its `Idle`,
   its `Charge` and the first frame of its `Attack`. Cropping is what
   makes those comparable, since each was carrying its own clip's
   padding beforehand. A left-facing row that is the right-facing one
   reflected is stored as a flag rather than as pixels. Bulbasaur's 706
   frames come to 42 pictures.

5. **Packs the pictures into one sheet per coat.** MaxRects: the free
   space is kept as a list of overlapping maximal rectangles and each
   picture goes into the one it wastes least of. A greedy packer is only
   as good as what it puts down first, and no single measure of *awkward
   piece* wins on every sheet, so four orderings and two fitting rules
   are tried — against a range of widths around the square root of the
   total area, since the sheet has no width to fit into — and the
   smallest result wins, with a sheet within a fiftieth of the best
   preferred when it is squarer. Sheets come out about 90% full.

6. **Writes the smallest PNG container that gives the same pixels
   back.** The codec in [`png.ts`](src/png.ts) encodes indexed at 1, 2,
   4 and 8 bits and truecolour, filtered and unfiltered, decodes each
   candidate and keeps the smallest one that round-trips exactly.
   Filtering nearly always loses: it exists to turn photographic
   gradients into small differences, and on flat colour it turns long
   runs of one palette index into noise.

### The four coats share one description

A form has up to four drawings — ordinary, shiny, female, shiny female
— and they are the same pokemon in other colours: the same frames, held
for the same time, in the same order. So they share one description and
one layout, and every comparison above is made **across all of them at
once**. Two frames are the same picture only when they are the same
picture in every coat; otherwise the shiny would want a different layout
from the ordinary drawing and one description could not describe both.

Every clip is compared against the same set of coats, including ones
that did not draw it — where a coat has no drawing, it reads as nothing
drawn. Comparing each clip against only the coats that happen to have it
would sort the clips into groups that can never share a picture with
each other, which gives away a good part of the sheet for nothing.

### Coats are not always drawn on the same grid

Sharing one description does not mean the coats are stored alike. A
shiny is sometimes finished for seven of the eight directions where the
ordinary drawing has all eight, and — less obviously — it is sometimes
padded to a **different cell size**: the shiny of Charizard's Mega X
uses an 80×88 cell for its `Attack` where the ordinary drawing uses
88×96, and a 48-tall cell where the other uses 56. Its `AnimData.xml`
says so; nothing about the folder layout hints at it.

So every coat is read through a grid of its own, taken from its own
description, and the grids are lined up on **the centre of the cell** —
the point a PMD frame is padded around. The same drawing in a smaller
cell has the same content in the same place once both are measured from
the middle. The frame the coats share is the rectangle that holds all of
them, and each coat is told where that rectangle falls inside its own
cell; where the shared frame reaches past a coat's cell, or past the
edge of its drawing, there is nothing drawn.

Getting this wrong is not a small error. Read against the ordinary
drawing's grid, the shiny Mega X came out misaligned by a few pixels in
every frame, which meant almost nothing deduplicated — 223 pictures
where there should be 37, on a sheet of 573×1288 rather than 245×201,
with visibly torn frames in the shiny.

A coat that disagrees about how many frames there are, rather than how
big they are, cannot be lined up at all; it is left out of the sheet
rather than drawn wrong.

### What is carried along

`RushFrame`, `HitFrame` and `ReturnFrame` are kept even though nothing
here looks at them, and so is every animation's `CopyOf`, so the
description a folder had can be rebuilt from the one it became.

Each coat's `credits.txt` is kept, resolved rather than copied: the
author is usually a Discord mention, and `credit_names.txt` at the root
of the collection is the table that turns one into a name. Both are kept
— the name to show, the account id because that is what the collection
keys an author by and the one handle that survives a rename. The licence
the collection is under asks for attribution, so this is not optional
metadata: a compact tree that dropped it would be a tree nobody is
allowed to use.

## Where things end up

Source folders are filed under four numbers — species, form, coat,
gender — each four digits, each a folder inside the last, with the
trailing defaults left off. Bulbasaur is `sprite/0001`, his shiny is
`sprite/0001/0000/0001`, and Pikachu's Libre form is `sprite/0025/0006`.

The compact tree is filed by **region**, then by species and form, with
both numbers written out every time so a reader builds a path without
knowing that rule:

```
compact/
  index.json                        every form the tree holds
  kanto/0001/0000/
    sheet.json                      the structure, shared by the coats
    frames.bin                      the per-frame numbers
    regular.png
    shiny.png
    female.png                      where the form has one
    shiny_female.png
  alola/0026/0001/                  Alolan Raichu, dex 26
  galar/0052/0002/                  Galarian Meowth
  hisui/0058/0001/                  Hisuian Growlithe
```

Filing by region is what makes the tree loadable in pieces: a game set
in one region wants that region's sheets and nothing else, and a
thousand species in one directory is a directory nobody can look at.

A dex number settles the region for most of them — the first hundred and
fifty-one are Kanto's, and each generation took the next stretch — but
not for the **regional forms**. Alolan Raichu is dex 26, which is
Kanto's, and it belongs with Alola: it was drawn for that region and it
is that region's game that wants it. So the form's name is read first
and the dex only where the name says nothing, which puts Kanto's 320
forms across five regions:

```
kanto 283   alola 18   galar 12   hisui 4   paldea 3
```

Hisui has no dex range of its own, being Sinnoh some centuries earlier,
and exists here only as the region its forms are filed under. Anything
outside every range is `unknown`, which is where the three that are
drawn like pokemon without being pokemon land — the collection numbers
Missingno, an egg and a substitute right alongside the rest.

`index.json` lists every form the tree holds, with its region and its
path, and counts the forms each region has:

```jsonc
{
  "version": 1,
  "regions": [{ "region": "kanto", "forms": 283 }, { "region": "alola", "forms": 18 }, …],
  "slots": [
    { "region": "kanto", "dex": 1, "form": 0, "path": "kanto/0001/0000",
      "coats": ["regular", "shiny"], "width": 79, "height": 252 }
  ]
}
```

### `sheet.json`

```jsonc
{
  "version": 2,
  "dex": 1, "form": 0,
  "name": "Bulbasaur", "formName": null,   // from tracker.json, where it was read
  "region": "kanto",                        // where the tree files it
  "compact": true,                          // frames are cropped
  "shadowSize": 1,
  "coats": ["regular", "shiny"],            // which files are beside this one

  "sheet": {
    "width": 79, "height": 252,
    "pictures": [[x, y, width, height], …]  // where each kept picture is
  },

  "anims": [                                // AnimData.xml, copies resolved
    { "anim": 9, "index": 0,                // 9 is Walk — see anims.ts
      "frameWidth": 40, "frameHeight": 40,
      "durations": [4, 4, 4, 4, 4, 4],
      "rushFrame": null, "hitFrame": null, "returnFrame": null,
      "copyOf": null, "target": 9 }
  ],

  "sprites": [                              // one per animation that is drawn
    { "anim": 9,
      "frameWidth": 33, "frameHeight": 30,  // after cropping
      "sourceFrameWidth": 40, "sourceFrameHeight": 40,
      "trim": [3, 0],                       // where the kept part started
      "columns": 6, "rows": 8,
      "frames": [124, 48] }                 // offset and count in frames.bin
  ],

  "credits": {
    "regular": [
      { "date": "2020-10-07 17:58:43.323442",
        "name": "CHUNSOFT", "discord": null,
        "contact": "https://www.spike-chunsoft.com/",
        "status": "CUR", "license": "Unspecified",
        "anims": ["Walk", "Attack", …] }
    ]
  }
}
```

Animations are numbers rather than names: the numbering in
[`anims.ts`](src/anims.ts) is **append-only**, so a number written into
a sheet means the same thing for ever.

`rows` is how many of the eight directions are drawn, always in this
order — `Down`, `DownRight`, `Right`, `UpRight`, `Up`, `UpLeft`, `Left`,
`DownLeft`. An animation whose `copyOf` is set has no entry in
`sprites`: it is drawn from `target`.

### `frames.bin`

The per-frame data is where a description's bytes actually go. A form
has on the order of a thousand frames, each carrying five anchors, which
picture it is, whether it is mirrored and where it sits — fourteen small
whole numbers. As JSON that is about seventy bytes a frame once the
brackets, commas and `null`s are counted, and across the collection it
came to three times what the drawings themselves cost. So the numbers
live in a file of their own.

```
magic     4 bytes, "PMDF"
version   uint16
records   uint16, how many distinct frames there are
indices   uint32, how many frames point at them
deflate(records × 14 × int16, column by column
        ++ indices × uint16)
```

Three things are going on, and each is worth roughly what the last one
was:

- **A frame is fourteen `int16`s, not a JSON object**: 28 bytes rather
  than about 70.
- **Each distinct frame is stored once**, and the frames point at it —
  a pose held still is the same anchors and the same picture in the same
  place, whichever clip it is in. Bulbasaur's 706 frames are 425 records.
- **The table is written a column at a time** — every frame's shadow x,
  then every frame's shadow y, and so on — then deflated. One column
  holds one kind of number, so its values are alike and mostly small,
  and deflate finds far more to say about that than about fourteen
  unrelated numbers repeated in a row. 13.0 K becomes 3.7 K.

A record is `shadow`, `center`, `head`, `left` and `right` as x and y,
then the picture, whether it is mirrored, and the corner it sits at.
An anchor the frame does not carry is `-32768` in both of its slots.
Anchors are read off the marker images before cropping and then rebased,
so a shadow that sits below the feet lands on a negative coordinate
rather than being lost with the padding it was drawn in.

### Drawing a frame from this

```js
const target = sheet.sprites.find((s) => s.anim === SpriteAnim.Walk);
const frame = frames.records[frames.indices[target.frames[0] + direction * target.columns + step]];
const [x, y, w, h] = sheet.sheet.pictures[frame.cell];

// frame.flip means draw it mirrored about its own vertical axis
context.drawImage(image, x, y, w, h, frame.at[0], frame.at[1], w, h);
```

`durations` on the matching entry in `anims` says how long each step is
held, in frames of 60 Hz.

## The round trip is checked, not assumed

Every claim above is only worth as much as its being true, so unless
`--no-verify` says otherwise the tool reads every frame of every coat
back off the finished sheet — pull the picture the description names,
mirror it if it says to, put it where it says — and compares it pixel
for pixel with the frame in the folder it came from.

Nothing is deleted on the strength of a sheet that did not read back as
what it replaced: `--prune` only takes a form's folders away after that
form has been verified and written.

## Pruning, carefully

`--prune` removes the **files** of the folders a sheet was built from,
then removes each folder if nothing is left in it, walking upwards and
stopping at the first folder that still holds something.

It works that way because a species folder is also the base form's own
drawing: `sprite/0025` holds Pikachu's ordinary sheet *and* the folders
for his shiny, his female form and every alternate form. Deleting it
outright would take all of them.

## Knowing what is there: `sprite-status`

The optimizer's report says what a run cost. This says what there is to
run on — which of the four coats a form has, which animations they draw,
and which of them the sheet can use:

```
node tools/src/status-bin.ts 1-6
node tools/src/status-bin.ts 6 --anims
node tools/src/status-bin.ts 1-151 --coverage
node tools/src/status-bin.ts 1-151 --gaps
```

```
form       name                   coats   anims   partial   extra   built
6/0        Charizard              RS..   12/40         0       1     yes
6/1        Charizard Mega_X       R~..   11/40         0       1     yes
6/3        Charizard Gigantamax   RS..    2/40         0       0     yes
6/5        Charizard Alternate    RS..   13/40         0       0     yes
```

The coats column reads `R S F Y` — ordinary, shiny, female, shiny female
— with a dot for a coat that is not drawn, a `~` for one padded to a
different cell size, and a `!` for one whose frame count cannot be lined
up with the first coat's and which is therefore left out of the sheet.

- **anims** is how many of the forty supported animations any coat
  draws.
- **partial** is how many of those are drawn in some coats and not
  others — the one thing here that is a fault in the art rather than a
  fact about it.
- **extra** is how many animations the folder holds that nothing
  downstream supports, which is what the sheet leaves behind.
- **built** says whether the compact tree holds this form, and `stale`
  where a source file has been touched since the sheet was written.

`--anims` names them all rather than counting them, per form, along with
which coats each partial animation is missing from and which animations
a coat was repadded or left out for. `--coverage` counts, for every one
of the forty, how many forms draw it — Kanto has `Rotate` on all 320 and
`Swell`, `Bite`, `Chop` and `Sound` on none. `--gaps` shows only the
forms with something to act on: a partial animation, a coat that could
not be lined up, or a sheet that is missing or out of date. `--json`
gives the whole thing as data.

A coat that simply is not there is not counted as a gap. Most pokemon
have no female form, and a shiny nobody has drawn is for the collection
to decide rather than for this to complain about.

Nothing here decodes an image: an animation's grid is its frame size out
of `AnimData.xml` against the size in the PNG's header, which is
thirty-three bytes. A report over all of Kanto takes a second or two
where a build takes minutes.

## Syncing with upstream

```bash
git fetch upstream
git merge upstream/master              # brings back sprite/ folders
node tools/src/bin.ts <what changed>   # rebuild just those
node tools/src/bin.ts <what changed> --prune
```

`sprite-status --gaps` after a merge lists what needs rebuilding, since
a form whose folder is newer than its sheet reads as `stale`.
`git diff --name-only HEAD@{1} -- sprite/` names the folders that moved,
and the species numbers in those paths are what to pass.
The index is merged rather than replaced, so a run over a handful of
species leaves the rest of `compact/index.json` alone.

## Options

```
--root <dir>     where the source folders are          (default sprite)
--tracker <file> the collection's record of names      (default tracker.json)
--credits <file> the table of author names             (default credit_names.txt)
--out <dir>      where the compact tree goes           (default compact)
--no-compact     keep every frame at its authored size
--no-verify      skip reading every frame back off the sheet
--prune          delete the source folders once the sheet checks out
--dry-run        build and report, write nothing
--quiet          totals only
```

An index is a species number as the sprite folder writes it. Ranges and
lists are both taken: `0001`, `1`, `1-151`, `1,4,7`. No index at all is
the whole collection. Every form of a species is processed, alternates,
megas and gigantamaxes included, and so is every coat of every form. A
form that cannot be read is reported and the run carries on; the exit
status is non-zero if anything failed or any frame did not read back as
it was drawn.

## The code

Plain Node with no runtime dependencies at all — the PNG codec and the
XML reader are both here, because the collection is one format written
one way and a general library for either would be more code than this.
Node runs the TypeScript directly.

| | |
|---|---|
| [`xml.ts`](src/xml.ts) | as much of XML as `AnimData.xml` needs |
| [`anims.ts`](src/anims.ts) | the animations anything downstream supports |
| [`anim-data.ts`](src/anim-data.ts) | the description, with `CopyOf` resolved |
| [`credits.ts`](src/credits.ts) | who drew it, and under what terms |
| [`png.ts`](src/png.ts) | decoding, and encoding into the smallest container |
| [`raster.ts`](src/raster.ts) | RGBA buffers |
| [`archive.ts`](src/archive.ts) | one coat's folder, read |
| [`slots.ts`](src/slots.ts) | where the collection files a sprite |
| [`tracker.ts`](src/tracker.ts) | what a species and a form are called |
| [`trim.ts`](src/trim.ts) | the rectangle that holds every frame of a clip |
| [`markers.ts`](src/markers.ts) | the anchors, off the two marker images |
| [`dedupe.ts`](src/dedupe.ts) | which frames are the same picture |
| [`packing.ts`](src/packing.ts) | where each picture goes on the sheet |
| [`frames.ts`](src/frames.ts) | the per-frame numbers, packed |
| [`sheet.ts`](src/sheet.ts) | all of the above, into one sheet |
| [`regions.ts`](src/regions.ts) | which region a form is filed under |
| [`status.ts`](src/status.ts) | what is drawn, without decoding it |
| [`verify.ts`](src/verify.ts) | reading it back and comparing |
| [`write.ts`](src/write.ts) | where it lands, and how sources are removed |
| [`run.ts`](src/run.ts) | one run, as a value a test can assert on |
| [`cli.ts`](src/cli.ts) | the command line |
| [`status-cli.ts`](src/status-cli.ts) | the other one |

```bash
cd tools
pnpm install
pnpm test
pnpm typecheck
```

The tests build their own sprite folders rather than reaching into the
collection: two gigabytes of other people's art is not a fixture, and a
test that reads it fails the day somebody submits a revision.
