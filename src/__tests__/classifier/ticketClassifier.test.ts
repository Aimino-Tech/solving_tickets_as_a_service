import { describe, it, expect } from 'vitest';
import { classifyTicket } from '../../classifier/ticketClassifier.js';

describe('ticketClassifier', () => {
  it('classifies code tickets with bug keywords', () => {
    const result = classifyTicket('Fix login error when password has special chars');
    expect(result.isCodeRelated).toBe(true);
    expect(result.category).toBe('code');
  });

  it('classifies research tickets', () => {
    const result = classifyTicket('Research competitor pricing strategies for Q3');
    expect(result.isCodeRelated).toBe(false);
    expect(result.category).toBe('research');
  });

  it('classifies design tickets', () => {
    const result = classifyTicket('Design new onboarding flow mockup in Figma');
    expect(result.isCodeRelated).toBe(false);
    expect(result.category).toBe('design');
  });

  it('classifies content tickets', () => {
    const result = classifyTicket('Write documentation for REST API endpoints');
    expect(result.isCodeRelated).toBe(false);
    expect(result.category).toBe('content');
  });

  it('classifies process tickets', () => {
    const result = classifyTicket('Plan Q3 sprint roadmap and milestones');
    expect(result.isCodeRelated).toBe(false);
    expect(result.category).toBe('process');
  });

  it('uses labels to classify', () => {
    const result = classifyTicket('Investigate X', null, ['research']);
    expect(result.isCodeRelated).toBe(false);
    expect(result.category).toBe('research');
  });

  it('code labels override text analysis', () => {
    const result = classifyTicket('Research topic', null, ['bug']);
    expect(result.isCodeRelated).toBe(true);
  });

  it('classifies ambiguous tickets as other', () => {
    const result = classifyTicket('General note about something');
    expect(result.isCodeRelated).toBe(false);
    expect(result.category).toBe('other');
  });
});
