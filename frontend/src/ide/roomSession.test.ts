import { describe, expect, it } from 'vitest';
import { buildWakeUrl, isValidRoomCode, normalizeRoomCode } from './roomSession';

describe('room session helpers', () => {
  it('normalizes shared room links consistently', () => {
    expect(normalizeRoomCode(' abc-123 ')).toBe('ABC123');
    expect(isValidRoomCode('ABC123')).toBe(true);
    expect(isValidRoomCode('ABC12')).toBe(false);
  });

  it('replaces an existing health path when building a wake URL', () => {
    expect(buildWakeUrl('https://api.example.test/healthz', '/healthz')).toBe('https://api.example.test/healthz');
    expect(buildWakeUrl('https://api.example.test/base', '/healthz')).toBe('https://api.example.test/base/healthz');
  });
});
