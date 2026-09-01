import { existsSync, readFileSync } from 'node:fs';
import { pad } from './slots.ts';

/**
 * The names the collection keeps for a species and its forms.
 *
 * `tracker.json` is the collection's own record of what has been drawn
 * and by whom. Almost none of it belongs in a sheet, but two things
 * do: what the species is called, and what the form is called, because
 * a compact tree filed under numbers is otherwise unreadable by a
 * person. Everything else — the bounties, the pending submissions, the
 * links to Discord attachments — is about running the collection
 * rather than about drawing it, and is left where it is.
 *
 * The file is optional. A run against a folder of sprites and nothing
 * else works, and the names are simply absent.
 */

interface TrackerNode {
  name?: string;
  subgroups?: Record<string, TrackerNode>;
}

export interface Names {
  /** What the species is called, or nothing where the record has no name. */
  name: string | null;
  /** What the form is called: the base form is nameless. */
  formName: string | null;
}

const NOTHING: Names = { name: null, formName: null };

/** Something to look names up in, which resolves nothing where there is no record. */
export type Tracker = (dex: number, form: number) => Names;

/** A name the record left blank is no name at all. */
function named(node: TrackerNode | undefined): string | null {
  const held = node?.name?.trim();

  return held == null || held.length === 0 ? null : held;
}

/** Reads the record, or resolves a tracker that knows nothing. */
export default function readTracker(path: string): Tracker {
  if (!existsSync(path)) {
    return () => NOTHING;
  }
  const held = JSON.parse(readFileSync(path, 'utf8')) as Record<string, TrackerNode>;

  return (dex, form) => {
    const species = held[pad(dex)];

    if (species == null) {
      return NOTHING;
    }
    return {
      name: named(species),
      // The base form is the species itself, and is nameless by
      // convention rather than by omission
      formName: form === 0 ? null : named(species.subgroups?.[pad(form)]),
    };
  };
}
