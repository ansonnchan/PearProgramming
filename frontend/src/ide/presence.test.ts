import { describe, expect, it } from 'vitest';
import type { Member } from '../types';
import { buildMentionOptions, invalidMentionLabels, messageMentionsUser, reconcilePresenceSnapshot, uniqueMembers } from './presence';

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

  it('replaces local presence with a complete late-joiner snapshot', () => {
    const result = reconcilePresenceSnapshot({
      type: 'presence-snapshot',
      userId: 'server',
      presenceVersion: 4,
      members: [
        { userId: 'creator', displayName: 'Creator', color: '#627d31' },
        { userId: 'joiner', displayName: 'Joiner', color: '#8a6d3b' }
      ]
    }, 0, 'joiner');

    expect(result).toEqual({ members: { creator: member('creator', 'Creator') }, version: 4 });
  });

  it('ignores out-of-order snapshots during concurrent joins and reconnects', () => {
    const stale = reconcilePresenceSnapshot({
      type: 'presence-snapshot', userId: 'server', presenceVersion: 7,
      members: [{ userId: 'one', displayName: 'One', color: '#627d31' }]
    }, 8, 'self');
    expect(stale).toBeNull();
  });

  it('deduplicates two browser tabs because snapshots are keyed by authenticated user', () => {
    const result = reconcilePresenceSnapshot({
      type: 'presence-snapshot', userId: 'server', presenceVersion: 2,
      members: [
        { userId: 'same-user', displayName: 'Pear', color: '#627d31' },
        { userId: 'same-user', displayName: 'Pear', color: '#627d31' }
      ]
    }, 0, 'other-user');
    expect(Object.keys(result?.members ?? {})).toEqual(['same-user']);
  });
});
