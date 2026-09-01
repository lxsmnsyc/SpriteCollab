/**
 * As much of XML as `AnimData.xml` needs, and no more.
 *
 * The file is machine-written by SpriteBot and always the same shape:
 * a prolog, then nested elements holding either text or more elements.
 * There are no attributes, no namespaces, no CDATA and no comments
 * anywhere in the collection, so a parser that handles those would be
 * code nobody ever runs. Anything unexpected throws rather than being
 * guessed at — an archive this cannot read should stop a run, not come
 * out quietly half-parsed.
 *
 * Keeping it here rather than taking a dependency is what lets the
 * optimizer run from a checkout with nothing installed but its own
 * test runner.
 */

/** One element: what it is called, and what is inside it. */
export interface Element {
  name: string;
  /** Its child elements, in the order they were written. */
  children: Element[];
  /** Its text, with the surrounding whitespace dropped. */
  text: string;
}

const ENTITIES: Record<string, string | undefined> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

/** Text as it was authored, with the five named escapes put back. */
function unescapeText(source: string): string {
  return source.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
    }
    if (body.startsWith('#')) {
      return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
    }
    return ENTITIES[body] ?? whole;
  });
}

/**
 * The document's one root element.
 *
 * Read in a single pass with a stack: an opening tag pushes, a closing
 * tag pops and checks the name matches, and everything between them is
 * text belonging to whatever is on top
 */
export default function parseXml(source: string): Element {
  const stack: Element[] = [];
  let root: Element | null = null;
  let at = 0;

  while (at < source.length) {
    const open = source.indexOf('<', at);

    if (open < 0) {
      break;
    }
    if (open > at) {
      const held = stack[stack.length - 1];

      if (held != null) {
        held.text += source.slice(at, open);
      }
    }
    const close = source.indexOf('>', open);

    if (close < 0) {
      throw new Error('A tag was opened and never closed');
    }
    const tag = source.slice(open + 1, close);

    at = close + 1;
    // The prolog and anything else the writer put in angle brackets
    // that is not an element of its own
    if (tag.startsWith('?') || tag.startsWith('!')) {
      continue;
    }
    if (tag.startsWith('/')) {
      const ended = stack.pop();

      if (ended == null || ended.name !== tag.slice(1).trim()) {
        throw new Error(`Closing tag ${tag.slice(1).trim()} does not match what was open`);
      }
      ended.text = unescapeText(ended.text).trim();
      if (stack.length === 0) {
        root = ended;
      }
      continue;
    }
    const selfClosing = tag.endsWith('/');
    // Attributes are not read, only tolerated: the name is everything
    // up to the first space
    const name = (selfClosing ? tag.slice(0, -1) : tag).trim().split(/\s/)[0];

    if (name.length === 0) {
      throw new Error('An element was written with no name');
    }
    const element: Element = { name, children: [], text: '' };
    const parent = stack[stack.length - 1];

    parent?.children.push(element);
    if (selfClosing) {
      if (parent == null) {
        root = element;
      }
      continue;
    }
    stack.push(element);
  }

  if (stack.length > 0) {
    throw new Error(`${stack[stack.length - 1].name} was opened and never closed`);
  }
  if (root == null) {
    throw new Error('The document holds no elements');
  }
  return root;
}

/** Every child of one name, which is none where there are none. */
export function childrenNamed(element: Element, name: string): Element[] {
  return element.children.filter((child) => child.name === name);
}

/** The first child of one name, or nothing. */
export function childNamed(element: Element, name: string): Element | undefined {
  return element.children.find((child) => child.name === name);
}

/** One child's text as a whole number, or nothing where it is absent. */
export function numberIn(element: Element, name: string): number | null {
  const child = childNamed(element, name);

  if (child == null) {
    return null;
  }
  const value = Number.parseInt(child.text, 10);

  if (!Number.isFinite(value)) {
    throw new Error(`${name} is not a number: ${child.text}`);
  }
  return value;
}
