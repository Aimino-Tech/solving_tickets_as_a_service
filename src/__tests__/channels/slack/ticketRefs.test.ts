import { describe, expect, it } from 'vitest';
import { extractTicketRefs } from '../../../channels/slack/ticketRefs.js';

describe('extractTicketRefs', () => {
  it('extracts a bare ticket identifier', () => {
    expect(extractTicketRefs('fix AIM-1234 please')).toEqual(['AIM-1234']);
  });

  it('extracts an identifier inside a markdown link', () => {
    const text = 'fix [AIM-1234](https://linear.app/aimino/issue/AIM-1234/whatever)';
    expect(extractTicketRefs(text)).toEqual(['AIM-1234']);
  });

  it('normalizes lowercase identifiers to uppercase', () => {
    expect(extractTicketRefs('fix aim-42 now')).toEqual(['AIM-42']);
  });

  it('deduplicates repeated identifiers preserving first-seen order', () => {
    expect(extractTicketRefs('AIM-7 AIM-7 fix AIM-7')).toEqual(['AIM-7']);
  });

  it('extracts multiple distinct identifiers in order', () => {
    expect(extractTicketRefs('fix AIM-1 and AIM-2')).toEqual(['AIM-1', 'AIM-2']);
  });

  it('does not match identifiers that lack the AIM prefix', () => {
    expect(extractTicketRefs('fix XYZ-1 please')).toEqual([]);
  });

  it('does not match standalone digits', () => {
    expect(extractTicketRefs('fix issue 123 please')).toEqual([]);
  });

  it('returns an empty array when no ticket is referenced', () => {
    expect(extractTicketRefs('good morning')).toEqual([]);
  });

  it('returns an empty array for empty input', () => {
    expect(extractTicketRefs('')).toEqual([]);
  });

  it('does not match when the number is glued to trailing letters', () => {
    expect(extractTicketRefs('AIM-1234abc')).toEqual([]);
  });
});
