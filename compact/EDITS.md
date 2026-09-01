# Edited sprites

Most sheets here are the collection's art repacked, verified pixel for
pixel. This lists the ones we changed by hand, which are derived work
rather than what the artist submitted.

| Edited sprite | Original sprite | Cause of editing |
|---|---|---|
| — | — | — |

Add a row before editing a sheet. Say what changed, what it was made
from, and why — "filled a missing animation", not "improved".

Recolours keep their mapping under `edits/`, named
`{dex}-{form}-{from}-{to}.json`, so the edit can be redone:

```bash
node tools/src/recolor-bin.ts apply 191/0 --coat regular \
  --map compact/edits/0191-0000-regular-shiny.json --as shiny
```

An edit that is not a recolour cannot be reproduced from a mapping. Say
so in its row.

## After a sync

A rebuild writes the collection's art and loses hand edits. For each
form listed here: rebuild, check whether the new revision makes the edit
unnecessary, then drop the row or redo it.

## Not listed here

Animations one coat gains from the other of its pair are the optimiser's
work, not ours, and come back on every rebuild. They are in `derived`
with the animation's number. Sunkern's shiny `Chop` is one.

## Finding them all

`sheet.json` and `index.json` both carry `derived`. An entry with
`"anim": null` is a coat from this table.

```bash
node -e 'for (const s of require("./compact/index.json").slots)
  if (s.derived.some((d) => d.anim == null)) console.log(s.path)'
```
