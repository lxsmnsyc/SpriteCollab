---
name: shadow-sprites
description: Make Shadow Pokémon sprites for compact/ by inverting colours and painting the eyes red. Use when asked for a Shadow form of a species, or a shiny of an existing Shadow form (Lugia, Mewtwo).
---

# Shadow sprites

Colours are flattened per part, inverted, and laid back over a sheet's
own shading. The script does the pixels; you decide which colours make
up each part.

```bash
node .claude/skills/shadow-sprites/shadow.ts palette 250/0 regular   # colours, and what each touches
node .claude/skills/shadow-sprites/shadow.ts preview plan.json       # writes shadow-preview*.png at the root
node .claude/skills/shadow-sprites/shadow.ts install plan.json       # writes the coat, indexes, keeps the plan
```

## Which case

| Shadow form upstream? | Do | Example |
|---|---|---|
| No | Regular **and** shiny of a new form, from the base form's regular and shiny | Ho-Oh → `250/2` |
| Yes | Shiny only, scheme from the base form's shiny | Lugia `249/1`, Mewtwo `150/3` |

Calyrex's `Shadow_Rider` is a battle form, not a Shadow Pokémon.

## No Shadow form yet

1. `palette <dex>/0 regular`. Group colours into parts, one per hue ramp;
   `touches` tells a part's shade from its neighbour's. Leave the outline
   black out.
2. Each part's `base` is its flat colour: the main tone, not the highlight
   or shade. A part that inverts to near black (white, pale grey) gets
   `"darken": 0.3` so its shading survives.
3. Eyes. A colour only the eyes use goes in `red`. Eyes sharing a body
   colour need an `eyes` rule: a small patch of `white` touching only
   `face` colours, at least one `touch` colour, with a `near` colour within
   `reach` pixels. Tune it until `shadow-preview-eyes.png` shows eyes and
   nothing else.
4. `preview`, show the user both images, `install` when approved. Target is
   the next free form number, with `"name": "Shadow"`.
5. Repeat for the shiny: `palette <dex>/0 shiny`, a plan with the shiny's
   own colours, source and target coat `shiny`, same target form.

## Shadow form already drawn

1. `palette <dex>/<shadow form> regular` and `palette <dex>/0 shiny`.
2. Parts are the Shadow drawing's colours. Each part's `scheme` lists the
   flat colours of the matching part of the base shiny; they are averaged
   and inverted. A part whose scheme inverts to black gets `darken` (0.75
   for Lugia). Leave the eyes out: they are red already.
3. Source is the Shadow form's `regular`, target its `shiny`. Preview,
   show, install.

## Plan

```json
{
  "source": { "form": "250/0", "coat": "regular" },
  "target": { "form": "250/2", "coat": "regular", "name": "Shadow" },
  "families": [
    { "part": "body", "base": "#d73f00", "members": ["#ff875f", "#d73f00", "#9f0000"] },
    { "part": "belly", "base": "#ffffff", "members": ["#ffffff", "#b7cfff"], "darken": 0.3 },
    { "part": "plates", "base": "#d6e9fa", "members": ["#d6e9fa"], "scheme": ["#c84878", "#d8313f"] }
  ],
  "red": [],
  "eyes": { "white": "#ffffff", "face": ["#d73f00", "#9f0000", "#000000"], "touch": ["#d73f00"],
            "near": ["#dfb700"], "reach": 3, "max": 4 }
}
```

Colours in no part stay as they are. `override` maps a colour's result by
hand, for a part that inverts too close to its neighbour.

## After

- `install` keeps the plan as `compact/edits/{dex}-{form}-shadow-{coat}.json`.
  Add a row to `compact/EDITS.md` naming it.
- The source's credits carry over: the drawing is theirs, the colours ours.
- Delete `shadow-preview*.png`.
