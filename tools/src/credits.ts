import { existsSync, readFileSync } from 'node:fs';

/**
 * Who drew a sheet, and under what terms.
 *
 * Every sprite folder carries a `credits.txt`: one tab-separated line
 * per submission, saying when it landed, who made it, whether it is
 * the current version, which licence it came under and which
 * animations it touched. The author is usually a Discord mention
 * rather than a name, and `credit_names.txt` at the root of the
 * collection is the table that turns one into the other.
 *
 * The licence the collection is under asks for attribution, so this is
 * not optional metadata: a compact tree that dropped it would be a
 * tree nobody is allowed to use. It is resolved rather than copied so
 * that a reader has a name to show without carrying a lookup table of
 * its own.
 */

/** One submission, as `credits.txt` records it. */
export interface Credit {
  /** When it landed, as the file writes it. */
  date: string;
  /**
   * Who made it, by a name a person can read: what
   * `credit_names.txt` resolves the author to, or the name the file
   * gave where it gave one rather than a mention. Nothing where the
   * table does not know them
   */
  name: string | null;
  /**
   * Their Discord account, as the number alone rather than as the
   * `<@!…>` mention the file writes. It is what the collection keys an
   * author by, so it is the one handle that survives a rename
   */
  discord: string | null;
  contact: string | null;
  /** `CUR` for the version in the folder, `OLD` for one it replaced. */
  status: string;
  /** `CC_BY-NC_4`, `PMDCollab_1`, `Unspecified` and the like. */
  license: string;
  /** The animations that submission touched, as it named them. */
  anims: string[];
}

/** What an author is called, and where to find them. */
export interface Author {
  name: string;
  contact: string | null;
}

/** Something to resolve an author with, which may know nothing. */
export type Authors = (author: string) => Author | null;

/**
 * Reads `credit_names.txt`: a header line, then a name, the Discord
 * mention it belongs to and a contact, tab separated. The mention is
 * the key, since that is what a `credits.txt` line holds
 */
export default function readCreditNames(path: string): Authors {
  if (!existsSync(path)) {
    return () => null;
  }
  const held = new Map<string, Author>();
  const [, ...lines] = readFileSync(path, 'utf8').split('\n');

  for (const line of lines) {
    const [name, discord, contact] = line.split('\t');

    if (name == null || discord == null || discord.trim().length === 0) {
      continue;
    }
    held.set(discord.trim(), {
      name: name.trim(),
      contact: contact == null || contact.trim().length === 0 ? null : contact.trim(),
    });
  }
  return (author) => held.get(author.trim()) ?? null;
}

/**
 * One folder's `credits.txt`, resolved.
 *
 * A line this cannot read is dropped rather than refused: attribution
 * is worth keeping even where one line of it is malformed, and a run
 * that stopped on a stray line would stop on somebody else's typo
 */
export function readCredits(lines: string[], authors: Authors = () => null): Credit[] {
  const found: Credit[] = [];

  for (const line of lines) {
    const parts = line.split('\t');

    if (parts.length < 2) {
      continue;
    }
    const author = parts[1].trim();
    const known = authors(author);
    // An author credited by name rather than by mention is already
    // legible, which is what the collection does for Chunsoft. A
    // mention nothing resolves stays unnamed rather than being shown
    // as a number
    const legible = known?.name ?? (author.startsWith('<@') ? null : author);
    const discord = /^<@!?([0-9]+)>$/.exec(author);

    found.push({
      date: parts[0].trim(),
      name: legible == null || legible.length === 0 ? null : legible,
      discord: discord == null ? null : discord[1],
      contact: known?.contact ?? null,
      status: parts[2]?.trim() ?? '',
      license: parts[3]?.trim() ?? '',
      anims:
        parts[4] == null
          ? []
          : parts[4]
              .split(',')
              .map((anim) => anim.trim())
              .filter((anim) => anim.length > 0),
    });
  }
  return found;
}
