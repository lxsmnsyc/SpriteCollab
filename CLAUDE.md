# SpriteCollab (fork)

A fork of PMDCollab/SpriteCollab, personalised: the sprite folders are
repacked into `compact/` by the tools in `tools/`, and the source
folders are removed once a region is built and verified.

- `sprite/`, `portrait/` — the collection, upstream's
- `compact/` — built sheets, filed by region. [Format](compact/README.md)
- `compact/EDITS.md` — sheets we changed, and why
- `compact/GAPS.md` — what upstream has not drawn
- `tools/` — the optimiser, status and recolour tools. [Docs](tools/README.md)

## Docs

Keep them short, simple and straight to the point. State the thing and
stop. Prefer a table or a short list to prose; give one example, not
three. Rationale goes in code comments and commit messages, not between
the reader and the fact they came for.

## Working here

- `sprite/` is other people's art under CC BY-NC 4.0. Every sheet
  carries its credits; do not drop them.
- Never delete source folders without asking first, even where it was
  agreed earlier.
- `compact/` is generated. Edit `sprite/` and rebuild, unless the sheet
  is listed in `EDITS.md`.
- Tests build their own fixtures. Do not read `sprite/` from a test.
- Forms whose regular coat lacks one of the bare-minimum animations
  are not built. They stay in `sprite/` for upstream to finish.
  `--all` overrides.
- Count base forms only. `Alternate`, `Gigantamax`, `Mega`, `Altcolor`
  and `Cutscene` are left out of coverage and completeness reports —
  they are far less finished than base forms and skew every figure.
  Regional forms count. Everything is still built. `GAPS.md` lists
  missing game forms and shinies in a section of their own.
