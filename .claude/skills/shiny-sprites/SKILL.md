---
name: shiny-sprites
description: Make a shiny coat for a sheet in compact/ that has none, from a reference image of the shiny. Use when asked for a shiny of a species upstream has not drawn.
---

# Shiny sprites

A coat is split into parts along its outlines, each part flattened to
one colour, that colour swapped for the shiny's, and the coat's own
shading laid back over it. The script does the pixels; you decide the
parts and their colours.

```bash
node .claude/skills/shiny-sprites/shiny.ts palette 916/0          # colours, and what each touches
node .claude/skills/shiny-sprites/shiny.ts preview plan.json      # writes shiny-preview.png at the root
node .claude/skills/shiny-sprites/shiny.ts install plan.json      # writes the coat, indexes, keeps the plan
```

## Steps

1. **Outlines.** `palette`. Black is always a line. List any other
   colour drawn as a line between parts in `outline`.
2. **Parts.** Group colours into parts, one per thing the shiny colours
   differently (body, head, fins, eyes). A shade two parts share goes in
   both. Each part's `base` is its flat colour.
3. **Palette.** Each part's `to` is the shiny's flat colour, sampled from
   the reference. Check the eyes like any other part.
4. **Preview.** Panels are regular, flat parts, shiny. Check the flat
   panel first: every part should be one solid colour where it belongs.
   Show the user; `install` when approved.

## Telling parts apart

A shared colour goes to the part of the nearest colour only one part
uses, never across an outline. When that is not enough:

| Problem | Fix |
|---|---|
| A part drawn only in shared colours, walled in by outlines | List it first; it takes the patch |
| Same, with no outline around it (Oinkologne's head) | `seed`: grows from its colours near a `near` colour (the snout) |
| Small marks in a big part's colour (Pa'u wing tips) | `patch`: patches up to this size; `away` lists colours they must not touch |
| Effects in the body's colours (Naclstack's flakes) | `loose`: bits touching nothing but outline |
| A few pixels on the wrong side | `pixels`: `[x, y, part]` |
| Shadows too deep on a part turned light | `contrast`: below 1 keeps less of their depth |

## Plan

```json
{
  "form": "916/0",
  "parts": [
    { "part": "head", "base": "#402f4e", "to": "#f8e6f0", "members": ["#402f4e", "#2a1d35"],
      "seed": { "near": ["#ef3886", "#a6215a"], "reach": 2, "spread": 5 }, "contrast": 0.6 },
    { "part": "body", "base": "#71617f", "to": "#ecbdd3",
      "members": ["#9485a1", "#71617f", "#554564", "#402f4e", "#2a1d35"], "contrast": 0.6 },
    { "part": "snout", "base": "#ef3886", "to": "#eb62a4", "members": ["#ef3886", "#a6215a"] }
  ]
}
```

`from` and `to` default to `regular` and `shiny`. A part's `swaps` sets
its colours by hand instead of the worked-out shading. `override` swaps
colours wherever they are, including colours in no part; anything else
in no part stays as it is.

## After

- `install` keeps the plan as `compact/edits/{dex}-{form}-regular-shiny.json`.
  Add a row to `compact/EDITS.md` naming it.
- The coat's credits carry over: the drawing is theirs, the colours ours.
- Delete `shiny-preview.png`.
