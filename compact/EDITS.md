# Edited sprites

Most sheets here are the collection's art repacked, verified pixel for
pixel. This lists the ones we changed by hand, which are derived work
rather than what the artist submitted.

| Edited sprite | Original sprite | Cause of editing |
|---|---|---|
| `kanto/0111/0000` shiny female | `kanto/0111/0000` female | No shiny female was drawn. Recoloured through Rhyhorn's own regular-to-shiny mapping. |
| `hoenn/0317/0001` shiny female | `hoenn/0317/0001` female | No shiny female was drawn. Recoloured through Swalot Altcolor's own regular-to-shiny mapping. |
| `unova/0502/0000` shiny | `unova/0502/0000` regular | The artist's shiny is a separate drawing, not a recolour: different cell sizes, different clip lengths, and most of each sprite drawn in one coat only. Rebuilt from the regular. |
| `unova/0566/0000` shiny | `unova/0566/0000` regular | The same. |
| `unova/0502/0001` Alternate | the old `0502` shiny folder | Moved, not edited. The drawing it replaced, kept as a form of its own. |
| `unova/0566/0001` Alternate | the old `0566` shiny folder | The same, and where `FlapAround` lives now. |

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

Dewott and Archen are recoloured a step earlier: their shiny **folder**
is rebuilt from the regular's before the sheet is built, so the coat has
the regular's animations and step counts. Recolour each `-Anim.png`
through the mapping, copy the `-Offsets`, `-Shadow` and `AnimData.xml`
across unchanged, then build the form.

Their old shiny folders became form `0001` of each species, which is
where the drawings they replaced still are. The two form names are ours,
added to `tracker.json`; an upstream sync overwrites that file, and the
names already written into the sheets are not affected.

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
