import { SESSION_ABSOLUTE_MS, SESSION_IDLE_MS, Session } from './session';

describe('Session', () => {
  const userId = '11111111-1111-1111-1111-111111111111';
  const t0 = new Date('2026-01-01T00:00:00.000Z');

  it('starts with idle 60m and absolute 8h windows', () => {
    const session = Session.start(userId, t0);
    expect(session.userId).toBe(userId);
    expect(session.idleExpiresAt.getTime()).toBe(t0.getTime() + SESSION_IDLE_MS);
    expect(session.absoluteExpiresAt.getTime()).toBe(t0.getTime() + SESSION_ABSOLUTE_MS);
    expect(session.isActive(t0)).toBe(true);
    expect(session.isIdleExpired(t0)).toBe(false);
    expect(session.isAbsoluteExpired(t0)).toBe(false);
  });

  it('slides idle on touch without crossing absolute', () => {
    const session = Session.start(userId, t0);
    const later = new Date(t0.getTime() + 30 * 60 * 1000);
    const touched = session.touch(later);
    expect(touched.ok).toBe(true);
    expect(session.lastUsedAt).toEqual(later);
    expect(session.idleExpiresAt.getTime()).toBe(later.getTime() + SESSION_IDLE_MS);
  });

  it('caps slid idle at absolute expiry', () => {
    const absoluteExpiresAt = new Date(t0.getTime() + 20 * 60 * 1000);
    const session = Session.rehydrate({
      id: '33333333-3333-3333-3333-333333333333',
      userId,
      createdAt: t0,
      lastUsedAt: t0,
      idleExpiresAt: new Date(t0.getTime() + SESSION_IDLE_MS),
      absoluteExpiresAt,
      revokedAt: null,
      revokedReason: null,
    });
    const nearAbsolute = new Date(absoluteExpiresAt.getTime() - 5 * 60 * 1000);
    expect(session.touch(nearAbsolute).ok).toBe(true);
    expect(session.idleExpiresAt.getTime()).toBe(absoluteExpiresAt.getTime());
  });

  it('rejects touch when idle, absolute, or revoked', () => {
    const idle = Session.start(userId, t0);
    expect(idle.touch(new Date(t0.getTime() + SESSION_IDLE_MS)).ok).toBe(false);
    expect(idle.isIdleExpired(new Date(t0.getTime() + SESSION_IDLE_MS))).toBe(true);

    const absolute = Session.start(userId, t0);
    expect(absolute.touch(new Date(t0.getTime() + SESSION_ABSOLUTE_MS)).ok).toBe(false);
    expect(absolute.isAbsoluteExpired(new Date(t0.getTime() + SESSION_ABSOLUTE_MS))).toBe(true);

    const revoked = Session.start(userId, t0);
    expect(revoked.revoke('LOGOUT', t0).ok).toBe(true);
    expect(revoked.touch(t0).ok).toBe(false);
    expect(revoked.isActive(t0)).toBe(false);
    expect(revoked.isRevoked()).toBe(true);
  });

  it('revokes once and records reason', () => {
    const session = Session.start(userId, t0);
    expect(session.revoke('REFRESH_REUSE', t0).ok).toBe(true);
    expect(session.revokedAt).toEqual(t0);
    expect(session.revokedReason).toBe('REFRESH_REUSE');
    expect(session.revoke('LOGOUT', t0).ok).toBe(false);
  });

  it('rehydrates persisted state', () => {
    const original = Session.start(userId, t0);
    original.revoke('LOGOUT', t0);
    const copy = Session.rehydrate({
      id: original.id,
      userId: original.userId,
      createdAt: original.createdAt,
      lastUsedAt: original.lastUsedAt,
      idleExpiresAt: original.idleExpiresAt,
      absoluteExpiresAt: original.absoluteExpiresAt,
      revokedAt: original.revokedAt,
      revokedReason: original.revokedReason,
    });
    expect(copy.isRevoked()).toBe(true);
    expect(copy.revokedReason).toBe('LOGOUT');
  });

  it('uses current time by default for activity checks', () => {
    const session = Session.start(userId);
    expect(session.isActive()).toBe(true);
    expect(session.isAbsoluteExpired()).toBe(false);
    expect(session.isIdleExpired()).toBe(false);
    expect(session.touch().ok).toBe(true);
    expect(session.revoke('LOGOUT').ok).toBe(true);
    expect(session.revokedAt).toBeInstanceOf(Date);
  });
});
