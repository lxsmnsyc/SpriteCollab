import { resolve } from 'node:path';
import run from './run.ts';
import { spriteAnimName } from './anims.ts';
import type { SlotReport, SpeciesReport } from './run.ts';

/**
 * The command line.
 *
 * An index is what the sprite folder calls a species: the four-digit
 * name of a folder under it. Ranges and lists are taken as written, so
 * a region is one argument, and no index at all means the whole
 * collection.
 */

const USAGE = `sprite-optimize — pack the sprite folders into compact sheets

  sprite-optimize <index...> [options]

An index is a species number as the sprite folder writes it. Ranges and
lists are both taken: "0001", "1", "1-151", "1,4,7". No index at all is
the whole collection.

Options
  --root <dir>     where the source folders are        (default sprite)
  --tracker <file> the collection's record of names     (default tracker.json)
  --credits <file> the table of author names            (default credit_names.txt)
  --out <dir>      where the compact tree goes         (default compact)
  --no-compact     keep every frame at its authored size
  --no-merge       leave a coat missing an animation its pair has
  --no-verify      skip reading every frame back off the sheet
  --prune          delete the source folders once the sheet checks out
  --dry-run        build and report, write nothing
  --quiet          totals only
  --help           this

Examples
  sprite-optimize 1-151                 the original hundred and fifty-one
  sprite-optimize 25 --dry-run          say what Pikachu would come to
  sprite-optimize 1-151 --prune         and take the folders away after
`;

/** One argument as the species it names, however it was written. */
export function parseIndex(argument: string): number[] {
  const found: number[] = [];

  for (const part of argument.split(',')) {
    const trimmed = part.trim();

    if (trimmed.length === 0) {
      continue;
    }
    const range = /^([0-9]+)\s*(?:-|\.\.)\s*([0-9]+)$/.exec(trimmed);

    if (range != null) {
      const from = Number.parseInt(range[1], 10);
      const to = Number.parseInt(range[2], 10);

      for (let at = Math.min(from, to); at <= Math.max(from, to); at += 1) {
        found.push(at);
      }
      continue;
    }
    if (!/^[0-9]+$/.test(trimmed)) {
      throw new Error(`${trimmed} is not a species number or a range of them`);
    }
    found.push(Number.parseInt(trimmed, 10));
  }
  return found;
}

export interface Arguments {
  species: number[];
  root: string;
  tracker: string;
  creditNames: string;
  output: string;
  compact: boolean;
  merge: boolean;
  verify: boolean;
  prune: boolean;
  dryRun: boolean;
  quiet: boolean;
  help: boolean;
}

/** The command line as the run wants it. */
export function parseArguments(argv: string[]): Arguments {
  const parsed: Arguments = {
    species: [],
    root: 'sprite',
    tracker: 'tracker.json',
    creditNames: 'credit_names.txt',
    output: 'compact',
    compact: true,
    merge: true,
    verify: true,
    prune: false,
    dryRun: false,
    quiet: false,
    help: false,
  };

  for (let at = 0; at < argv.length; at += 1) {
    const argument = argv[at];

    switch (argument) {
      case '--help':
      case '-h':
        parsed.help = true;
        break;
      case '--root':
        parsed.root = argv[++at] ?? parsed.root;
        break;
      case '--tracker':
        parsed.tracker = argv[++at] ?? parsed.tracker;
        break;
      case '--credits':
        parsed.creditNames = argv[++at] ?? parsed.creditNames;
        break;
      case '--out':
        parsed.output = argv[++at] ?? parsed.output;
        break;
      case '--no-compact':
        parsed.compact = false;
        break;
      case '--no-merge':
        parsed.merge = false;
        break;
      case '--no-verify':
        parsed.verify = false;
        break;
      case '--prune':
        parsed.prune = true;
        break;
      case '--dry-run':
        parsed.dryRun = true;
        break;
      case '--quiet':
        parsed.quiet = true;
        break;
      default:
        if (argument.startsWith('-')) {
          throw new Error(`There is no ${argument} option`);
        }
        parsed.species.push(...parseIndex(argument));
    }
  }
  return parsed;
}

/** Bytes, as something a person reads. */
export function bytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} K`;
  }
  return `${(value / (1024 * 1024)).toFixed(1)} M`;
}

/** How much smaller one thing got, as a share of what it was. */
export function saved(before: number, after: number): string {
  return before === 0 ? '—' : `${(100 - (after / before) * 100).toFixed(1)}%`;
}

/** One species, as the line that closes off its forms. */
function speciesLine(report: SpeciesReport): string {
  const name = `${String(report.dex).padStart(4, '0')} ${report.name ?? ''}`.trim().padEnd(21);

  return `${name} ${report.regions.join(',').padEnd(13)} ${`${report.forms} form${
    report.forms === 1 ? '' : 's'
  }`.padEnd(8)} ${bytes(report.before).padStart(8)} -> ${bytes(report.after).padStart(8)}  ${saved(
    report.before,
    report.after,
  ).padStart(6)}`;
}

function line(report: SlotReport): string {
  const name = `${report.dex}/${report.form}`.padEnd(9);
  const size = `${report.width}x${report.height}`.padEnd(11);
  const pictures = `${report.pictures}/${report.frames}`.padEnd(11);

  return `${name} ${size} ${pictures} ${bytes(report.before).padStart(8)} -> ${bytes(
    report.after,
  ).padStart(8)}  ${saved(report.before, report.after).padStart(6)}${
    report.mismatches.length > 0 ? `  ${report.mismatches.length} MISMATCHED` : ''
  }`;
}

export default function main(argv: string[]): number {
  const options = parseArguments(argv);

  if (options.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  const root = resolve(options.root);
  const output = resolve(options.output);

  if (!options.quiet) {
    process.stdout.write(
      `${'form'.padEnd(9)} ${'sheet'.padEnd(11)} ${'kept/frames'.padEnd(11)} ${'before'.padStart(
        8,
      )}    ${'after'.padStart(8)}  ${'saved'.padStart(6)}\n`,
    );
  }
  const report = run({
    root,
    output,
    species: options.species,
    tracker: resolve(options.tracker),
    creditNames: resolve(options.creditNames),
    compact: options.compact,
    merge: options.merge,
    verify: options.verify,
    prune: options.prune,
    dryRun: options.dryRun,
    onSlot: options.quiet
      ? undefined
      : (slot) => {
          process.stdout.write(`${line(slot)}\n`);
          for (const held of slot.derived) {
            const what = held.anim == null ? 'every clip' : spriteAnimName(held.anim);

            process.stdout.write(`          ${held.coat} gained ${what} from ${held.from}\n`);
          }
          for (const held of slot.dropped) {
            process.stdout.write(
              `          dropped the ${held.coat} coat: no art for it` +
                `${held.ours ? ', and it was ours — redo it from compact/EDITS.md' : ''}\n`,
            );
          }
          for (const held of slot.refused) {
            process.stdout.write(
              `          ${held.coat} could not be given ${spriteAnimName(held.anim)}: ${held.reason}\n`,
            );
          }
        },
    onSpecies: options.quiet
      ? undefined
      : (held) => {
          process.stdout.write(`${speciesLine(held)}\n\n`);
        },
  });
  const mismatched = report.slots.filter((slot) => slot.mismatches.length > 0);
  const anchors = report.anchors;
  const derived = report.slots.reduce((total, slot) => total + slot.derived.length, 0);
  const refused = report.slots.reduce((total, slot) => total + slot.refused.length, 0);

  if (!options.quiet && derived + refused > 0) {
    process.stdout.write(
      `carried  ${derived} animation${derived === 1 ? '' : 's'} between coats, ${refused} refused\n`,
    );
  }
  // Said even under --quiet: a dropped coat of ours is work to redo,
  // and a run that swallows it is how the tree goes quietly wrong
  const ours = report.slots.flatMap((slot) => slot.dropped.filter((one) => one.ours));
  const dropped = report.slots.reduce((total, slot) => total + slot.dropped.length, 0);

  if (dropped > 0) {
    process.stdout.write(
      `dropped  ${dropped} coat${dropped === 1 ? '' : 's'} with no art to rebuild from` +
        `${ours.length > 0 ? `, ${ours.length} of them ours — see compact/EDITS.md` : ''}\n`,
    );
  }

  if (!options.quiet && anchors.frames > 0) {
    process.stdout.write(
      `anchors  ${(['shadow', 'center', 'head', 'left', 'right'] as const)
        .map(
          (key) => `${key} ${((anchors[key] / anchors.frames) * 100).toFixed(1)}%`,
        )
        .join('  ')}\n`,
    );
  }

  process.stdout.write(
    `${report.species.length} species, ${report.slots.length} forms  ${bytes(
      report.before,
    )} -> ${bytes(report.after)}  ${saved(report.before, report.after)} smaller\n`,
  );
  for (const failure of report.failed) {
    process.stderr.write(`${failure.dex}/${failure.form}: ${failure.error}\n`);
  }
  for (const slot of mismatched) {
    process.stderr.write(
      `${slot.dex}/${slot.form}: ${slot.mismatches.length} frames did not read back as they were drawn\n`,
    );
  }
  return report.failed.length > 0 || mismatched.length > 0 ? 1 : 0;
}
