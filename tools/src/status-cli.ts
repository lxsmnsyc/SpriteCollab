import { resolve } from 'node:path';
import type { SpriteAnim } from './anims.ts';
import { SPRITE_ANIMS, spriteAnimName } from './anims.ts';
import type { FormStatus } from './status.ts';
import statuses, { completeness } from './status.ts';
import type { CoatKey } from './slots.ts';
import { COATS } from './slots.ts';
import readTracker from './tracker.ts';

/**
 * What is drawn, said plainly.
 *
 * The optimizer's own report says what a run cost. This says what is
 * there to run on: which of the four coats a form has, which of the
 * supported animations they draw, which are drawn in some coats and not
 * others, and which are in the folder but outside the vocabulary
 * anything downstream reads.
 *
 * It is the thing to check before a build rather than after one, and
 * the thing to check after syncing with upstream: a form that has grown
 * a coat, or an animation, is a form to rebuild
 */

const USAGE = `sprite-status — what each sprite holds

  sprite-status <index...> [options]

An index is a species number as the sprite folder writes it. Ranges and
lists are both taken: "0001", "1", "1-151", "1,4,7". No index at all is
the whole collection.

Options
  --root <dir>     where the source folders are        (default sprite)
  --tracker <file> the collection's record             (default tracker.json)
  --out <dir>      where the compact tree is           (default compact)
  --anims          name the animations each form draws
  --coverage       count how many forms draw each animation
  --gaps           only forms with something missing or unbuilt
  --json           the whole report, as data
  --help           this

The coats column reads R S F Y — ordinary, shiny, female, shiny female —
with a dot for one that is not drawn, a ~ for one padded to a different
cell size, and a ! for one whose frame count cannot be lined up with the
first coat's and which is therefore left out of the sheet.
`;

/** One letter a coat, in the order they are filed. */
const LETTERS: Record<CoatKey, string> = {
  regular: 'R',
  shiny: 'S',
  female: 'F',
  shinyFemale: 'Y',
};

export interface Arguments {
  species: number[];
  root: string;
  tracker: string;
  output: string;
  anims: boolean;
  coverage: boolean;
  gaps: boolean;
  json: boolean;
  help: boolean;
}

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

export function parseArguments(argv: string[]): Arguments {
  const parsed: Arguments = {
    species: [],
    root: 'sprite',
    tracker: 'tracker.json',
    output: 'compact',
    anims: false,
    coverage: false,
    gaps: false,
    json: false,
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
      case '--out':
        parsed.output = argv[++at] ?? parsed.output;
        break;
      case '--anims':
        parsed.anims = true;
        break;
      case '--coverage':
        parsed.coverage = true;
        break;
      case '--gaps':
        parsed.gaps = true;
        break;
      case '--json':
        parsed.json = true;
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

/** The four coats as one word: which are there, and how they stand. */
export function coatLetters(status: FormStatus): string {
  return COATS.map((coat) => {
    const held = status.coats.find((one) => one.key === coat.key);

    if (held == null) {
      return '.';
    }
    if (held.misaligned.length > 0) {
      return '!';
    }
    return held.repadded.length > 0 ? '~' : LETTERS[coat.key];
  }).join('');
}

/**
 * Whether a form has anything worth acting on.
 *
 * A coat that is not there is not a gap: most pokemon have no female
 * form, and a shiny nobody has drawn is a thing for the collection to
 * decide rather than for this to complain about. An animation drawn in
 * one coat and not another is, and so is a coat left out of the sheet,
 * and so is a sheet that has not been built or is older than what it
 * was built from
 */
export function hasGap(status: FormStatus): boolean {
  return (
    status.partial.length > 0 ||
    status.coats.some((coat) => coat.misaligned.length > 0) ||
    !status.built ||
    status.stale === true
  );
}

/** The animations a form holds that nothing supports, named once each. */
export function extrasOf(status: FormStatus): string[] {
  return [...new Set(status.coats.flatMap((coat) => coat.unsupported))].sort();
}

function line(status: FormStatus): string {
  const named = `${status.dex}/${status.form}`.padEnd(9);
  const title = `${status.name ?? ''}${status.formName == null ? '' : ` ${status.formName}`}`
    .trim()
    .slice(0, 20)
    .padEnd(21);
  const built = status.built && status.stale !== true;

  return [
    named,
    title,
    coatLetters(status),
    `${status.anims.length}/${SPRITE_ANIMS.length}`.padStart(6),
    String(status.partial.length).padStart(8),
    String(extrasOf(status).length).padStart(6),
    (built ? 'yes' : status.built ? 'stale' : 'no').padStart(6),
  ].join('  ');
}

export default function main(argv: string[]): number {
  const options = parseArguments(argv);

  if (options.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  const tracker = resolve(options.tracker);
  const found = statuses(
    resolve(options.root),
    resolve(options.output),
    options.species,
    readTracker(tracker),
    completeness(tracker),
  );
  const shown = options.gaps ? found.filter(hasGap) : found;

  if (options.json) {
    process.stdout.write(`${JSON.stringify(shown, null, 2)}\n`);
    return 0;
  }
  process.stdout.write(
    `${'form'.padEnd(9)}  ${'name'.padEnd(21)}  coats  ${'anims'.padStart(6)}  ${'partial'.padStart(
      8,
    )}  ${'extra'.padStart(6)}  ${'built'.padStart(6)}\n`,
  );
  for (const status of shown) {
    process.stdout.write(`${line(status)}\n`);
    if (!options.anims) {
      continue;
    }
    process.stdout.write(`  draws    ${status.anims.map(spriteAnimName).join(' ')}\n`);
    if (status.partial.length > 0) {
      process.stdout.write(
        `  partial  ${status.partial
          .map(
            (anim) =>
              `${spriteAnimName(anim)}(${status.coats
                .filter((coat) => coat.anims.includes(anim))
                .map((coat) => LETTERS[coat.key])
                .join('')})`,
          )
          .join(' ')}\n`,
      );
    }
    const extra = extrasOf(status);

    if (extra.length > 0) {
      process.stdout.write(`  extra    ${extra.join(' ')}\n`);
    }
    for (const coat of status.coats) {
      if (coat.repadded.length > 0) {
        process.stdout.write(
          `  ${LETTERS[coat.key]} repadded  ${coat.repadded.map(spriteAnimName).join(' ')}\n`,
        );
      }
      if (coat.misaligned.length > 0) {
        process.stdout.write(
          `  ${LETTERS[coat.key]} left out  ${coat.misaligned.map(spriteAnimName).join(' ')}\n`,
        );
      }
    }
  }
  if (options.coverage) {
    process.stdout.write('\nanimation        forms\n');
    for (const anim of SPRITE_ANIMS) {
      const drawn = found.filter((status) => status.anims.includes(anim)).length;

      process.stdout.write(
        `${spriteAnimName(anim).padEnd(15)}  ${String(drawn).padStart(5)}  ${(
          (drawn / Math.max(found.length, 1)) *
          100
        )
          .toFixed(0)
          .padStart(3)}%\n`,
      );
    }
  }
  const gaps = found.filter(hasGap).length;
  const unbuilt = found.filter((status) => !status.built || status.stale === true).length;

  process.stdout.write(
    `\n${found.length} forms, ${found.reduce(
      (total, status) => total + status.coats.length,
      0,
    )} coats  ${gaps} with a gap  ${unbuilt} to build\n`,
  );
  return 0;
}

export type { SpriteAnim };
