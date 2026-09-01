# Sprite tools

Plain Node, no runtime dependencies — the PNG codec and XML reader are
here. Node runs the TypeScript directly.

```bash
cd tools && pnpm install && pnpm test
```

## `sprite-optimize`

Packs sprite folders into compact sheets. Kanto: 171 MB → 7.4 MB, same
pixels.

```bash
node tools/src/bin.ts 1-151 --dry-run    # report only
node tools/src/bin.ts 1-151              # write compact/
node tools/src/bin.ts 1-151 --prune      # and delete the sources
```

```
form      sheet       kept/frames   before       after   saved
1/0       79x252      42/706       508.2 K ->   18.2 K   96.4%
1/1       79x252      42/706       511.8 K ->   19.2 K   96.2%
0001 Bulbasaur        kanto         2 forms   1020.0 K ->   37.4 K   96.3%

anchors  shadow 100.0%  center 99.9%  head 99.9%  left 99.9%  right 99.9%
```

The species line weighs all of `sprite/{dex}` against all of
`compact/{region}/{dex}`, measured before pruning.

```
--root <dir>     source folders                    (default sprite)
--tracker <file> the collection's record           (default tracker.json)
--credits <file> author names                      (default credit_names.txt)
--out <dir>      where the tree goes               (default compact)
--no-compact     keep frames at their authored size
--no-merge       leave a coat missing an animation its pair has
--no-verify      skip reading every frame back
--prune          delete sources once verified
--dry-run        build and report, write nothing
--quiet          totals only
```

An index is `0001`, `1`, `1-151` or `1,4,7`. No index means everything.
Every form and coat is processed. A form that fails is reported and the
run continues; exit is non-zero if anything failed or mismatched.

### What it does

1. **Keeps only the forty-eight supported animations**
   ([`anims.ts`](src/anims.ts): Overwander and Poketerra's forty, plus
   eight the collection draws in all eight facings and they have yet to
   list). Cutscene poses stay in `sprite/`. A third of Bulbasaur's
   frames.
2. **Reads the anchors** out of the `-Shadow` and `-Offsets` images, so
   those never ship again.
3. **Crops each frame** to what is drawn in it.
4. **Stores each distinct picture once**, across every clip at once — a
   standing pose is the same in `Idle`, `Charge` and `Attack`. A
   mirrored row is stored as a flag. Bulbasaur: 706 frames → 42 pictures.
5. **Packs** with MaxRects — four orderings × two fit rules × a width
   sweep, smallest wins. Sheets come out ~90% full.
6. **Encodes** as the smallest PNG container that round-trips exactly.
   Indexed at 1/2/4/8 bits and truecolour, filtered and not. Filtering
   nearly always loses on flat colour.

Before any of that, a coat missing an animation its pair has is given
it — see below.

`RushFrame`, `HitFrame`, `ReturnFrame`, `CopyOf` and every coat's
`credits.txt` are carried through.

### Merging a pair

A coat is often finished for a clip its partner is not: Sunkern's
ordinary coat has `Chop` and its shiny has not. The two are the same
drawing in other colours, so the mapping learned from the clips they
share recovers the missing one, and the output is the union of both.

Only within a pair — **ordinary with shiny**, **female with shiny
female**. A female coat is a different drawing, and no palette turns one
into the other.

The mapping must cover the clip completely, or it is refused and the
animation stays missing:

- **ambiguous** — a colour maps two ways across the shared clips
- **unknown colours** — the clip uses a colour those clips never showed

Derived animations are listed in `sheet.json` as `derived`, since they
are this tool's pixels rather than the collection's. `--no-merge` turns
it off.

### Marker colours

`-Offsets` marks the body **black**, head red, hands green and blue.
`-Shadow` marks the shadow with one **white** pixel inside coloured size
rings — not a blob to average.

Reading one wrong loses an anchor without failing anything, so every run
reports coverage. Near-zero means a matcher on the wrong colour.

### Coats

The four coats share one description and one layout, so every comparison
is made across all of them at once, including coats that did not draw a
clip.

The gender level under a form has three values: `0000` for the drawing
used whatever the pokemon is, `0002` for a female one, `0001` for a
male. Where a male drawing exists — only Xatu and Camerupt — it is the
ordinary coat and the `0000` one is the female, since neither has a
`0002` folder.

They are not always on the same grid: Charizard Mega X's shiny uses an
80×88 cell where the ordinary drawing uses 88×96. Each coat is read
through its own grid, aligned on the **cell centre**. Read against the
wrong grid, that sheet came out at 223 pictures and 573×1288 instead of
37 and 245×201, with torn frames.

A coat disagreeing about *frame count* cannot be aligned and is left out.

### `frames.bin`

Per-frame data was three times what the drawings cost as JSON. Now:
14 `int16` per frame, each distinct frame stored once, column-major,
deflated. Bulbasaur: 70 K → 3.7 K. Format in
[`compact/README.md`](../compact/README.md).

### Regions

Filed by region so a game can load one without the rest. A regional form
follows its name, not its dex — Alolan Raichu is dex 26, under `alola`.
Kanto's 320 forms: kanto 283, alola 18, galar 12, hisui 4, paldea 3.

### Verification

Unless `--no-verify`, every frame of every coat is read back off the
sheet and compared pixel for pixel with the source. `--prune` only
deletes a form after that passes.

Pruning removes **files**, then empties folders upward — a species
folder is also its base form's drawing and holds every other form.

## `sprite-status`

What there is to run on. Decodes nothing; a whole-collection report
takes a second.

```bash
node tools/src/status-bin.ts 1-6
node tools/src/status-bin.ts 6 --anims
node tools/src/status-bin.ts 1-151 --coverage
node tools/src/status-bin.ts 1-151 --gaps
```

```
form       name                   coats   anims   partial   extra   built
6/0        Charizard              RS..   12/40         0       1     yes
6/1        Charizard Mega_X       R~..   11/40         0       1     yes
```

Coats read `R S F Y`, with `.` absent, `~` padded to another cell size,
`!` unalignable and left out of the sheet.

- **anims** — how many of the forty-eight any coat draws
- **partial** — drawn in some coats and not others
- **extra** — animations the sheet leaves behind
- **built** — `yes` / `stale` / `no`

`--gaps` shows only forms needing action. A missing coat is not a gap;
most pokemon have no female form. It reads `sprite/`, so a pruned region
reports nothing.

## `sprite-recolor`

Coats are one drawing in different colours on a shared layout, so a new
coat is a substitution.

```bash
node tools/src/recolor-bin.ts extract 1/0 --file bulbasaur.png
node tools/src/recolor-bin.ts apply   1/0 --map bulbasaur.png --as shiny

node tools/src/recolor-bin.ts learn 3/0 --from regular --to shiny --file v.json
node tools/src/recolor-bin.ts apply 3/0 --coat female --map v.json --as shinyFemale
```

- **extract** — the palette as a strip of blocks to repaint (keep the
  order and count), or as hex pairs with `--file x.json`
- **learn** — the mapping between two coats of one form
- **apply** — writes the result as another coat and adds it to `coats`

Nothing moves a pixel or changes alpha; a swap that would is refused.

Where two coats really are a palette swap this is exact — Venusaur's
female through his regular→shiny mapping gives his shiny female byte for
byte, as does 10 of the 22 four-coat forms. Otherwise it reports rather
than guesses:

- **ambiguous** — one colour stands over two; left out of the mapping
- **untouched** — the coat uses colours the mapping never learned

`--dry-run` says which before writing. Record edits in
[`compact/EDITS.md`](../compact/EDITS.md).

## Syncing with upstream

```bash
git fetch upstream && git merge upstream/master
node tools/src/status-bin.ts --gaps        # stale and missing forms
node tools/src/bin.ts <species>
```

The index merges, so a partial run leaves the rest alone.

## Files

| | |
|---|---|
| [`xml.ts`](src/xml.ts) | as much XML as `AnimData.xml` needs |
| [`anims.ts`](src/anims.ts) | the forty-eight supported animations |
| [`anim-data.ts`](src/anim-data.ts) | the description, `CopyOf` resolved |
| [`credits.ts`](src/credits.ts) | who drew it, under what terms |
| [`png.ts`](src/png.ts) | decode, and encode into the smallest container |
| [`raster.ts`](src/raster.ts) | RGBA buffers |
| [`archive.ts`](src/archive.ts) | one coat's folder |
| [`slots.ts`](src/slots.ts) | where the collection files a sprite |
| [`regions.ts`](src/regions.ts) | which region a form belongs to |
| [`tracker.ts`](src/tracker.ts) | species and form names |
| [`trim.ts`](src/trim.ts) | the rectangle holding every frame of a clip |
| [`markers.ts`](src/markers.ts) | the anchors |
| [`dedupe.ts`](src/dedupe.ts) | which frames are the same picture |
| [`packing.ts`](src/packing.ts) | where each picture goes |
| [`frames.ts`](src/frames.ts) | the per-frame numbers, packed |
| [`recolor.ts`](src/recolor.ts) | palettes and swaps |
| [`sheet.ts`](src/sheet.ts) | all of it, into one sheet |
| [`status.ts`](src/status.ts) | what is drawn, without decoding |
| [`verify.ts`](src/verify.ts) | reading it back and comparing |
| [`write.ts`](src/write.ts) | where it lands, and how sources go |
| [`run.ts`](src/run.ts) | one run, as a value a test can assert on |

Tests build their own sprite folders — reading the collection would fail
the day somebody submits a revision.
