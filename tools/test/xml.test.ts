import { describe, expect, it } from 'vitest';
import parseXml, { childNamed, childrenNamed, numberIn } from '../src/xml.ts';

describe('parseXml', () => {
  it('reads the prolog, the root and its text', () => {
    const root = parseXml('<?xml version="1.0" ?>\n<AnimData>\n\t<ShadowSize>1</ShadowSize>\n</AnimData>');

    expect(root.name).toBe('AnimData');
    expect(numberIn(root, 'ShadowSize')).toBe(1);
  });

  it('keeps children in the order they were written', () => {
    const root = parseXml('<Anims><Anim><Name>Walk</Name></Anim><Anim><Name>Idle</Name></Anim></Anims>');

    expect(childrenNamed(root, 'Anim').map((anim) => childNamed(anim, 'Name')?.text)).toEqual([
      'Walk',
      'Idle',
    ]);
  });

  it('puts the named escapes back', () => {
    expect(parseXml('<Name>a &amp; b &lt;c&gt;</Name>').text).toBe('a & b <c>');
  });

  it('takes a self-closing element as an empty one', () => {
    const root = parseXml('<Anim><Durations/></Anim>');

    expect(childNamed(root, 'Durations')?.children).toEqual([]);
  });

  it('resolves nothing for a field that is not there', () => {
    expect(numberIn(parseXml('<Anim><Name>Walk</Name></Anim>'), 'HitFrame')).toBeNull();
  });

  it('refuses a document whose tags do not match', () => {
    expect(() => parseXml('<Anims><Anim></Anims>')).toThrow(/does not match/);
  });

  it('refuses a document left open', () => {
    expect(() => parseXml('<Anims><Anim>')).toThrow(/never closed/);
  });

  it('refuses a document with nothing in it', () => {
    expect(() => parseXml('<?xml version="1.0" ?>')).toThrow(/no elements/);
  });
});
