import { describe, expect, it } from 'vitest';
import type { Member } from '../types';
import { buildMentionOptions, invalidMentionLabels, messageMentionsUser, uniqueMembers } from './presence';

const member = (id: string, name: string): Member => ({ id, name, color: '#627d31' });

describe('presence normalization', () => {
  it('deduplicates connection-derived members by server user identity', () => {
    expect(uniqueMembers([member('one', 'Old'), member('one', 'Current'), member('two', 'Second')]))
      .toEqual([member('one', 'Current'), member('two', 'Second')]);
  });

  it('creates unambiguous mention labels for duplicate display names', () => {
    const options = buildMentionOptions([member('one', 'Pear User'), member('two', 'Pear User')]);
    expect(options.map((option) => option.label)).toEqual(['PearUser-one', 'PearUser-two']);
    expect(messageMentionsUser('Hello @PearUser-two!', member('two', 'Pear User'), options)).toBe(true);
    expect(invalidMentionLabels('Hello @Missing', options)).toEqual(['Missing']);
  });
});
