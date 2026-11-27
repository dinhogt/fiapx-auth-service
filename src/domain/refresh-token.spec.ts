import { REFRESH_IDLE_MS, REFRESH_TOKEN_BYTES, RefreshToken } from './refresh-token';

describe('RefreshToken', () => {
  const sessionId = '22222222-2222-2222-2222-222222222222';
  const t0 = new Date('2026-01-01T00:00:00.000Z');

  it('issues an opaque 256-bit token stored only as sha256 hex', () => {
    const token = RefreshToken.issue(sessionId, t0);
    expect(token.plainToken).toBeDefined();
    expect(Buffer.from(token.plainToken!, 'base64url').length).toBe(REFRESH_TOKEN_BYTES);
    expect(token.tokenHash).toBe(RefreshToken.hash(token.plainToken!));
    expect(token.tokenHash).toHaveLength(64);
    expect(token.expiresAt.getTime()).toBe(t0.getTime() + REFRESH_IDLE_MS);
    expect(token.isUsed()).toBe(false);
  });

  it('rotates once and links replacement', () => {
    const current = RefreshToken.issue(sessionId, t0);
    const rotated = current.rotate(t0);
    expect(rotated.ok).toBe(true);
    if (rotated.ok) {
      expect(rotated.value.current.isUsed()).toBe(true);
      expect(rotated.value.current.replacedById).toBe(rotated.value.next.id);
      expect(rotated.value.next.sessionId).toBe(sessionId);
      expect(rotated.value.next.plainToken).toBeDefined();
    }
  });

  it('detects reuse when rotating an already used token', () => {
    const token = RefreshToken.issue(sessionId, t0);
    expect(token.rotate(t0).ok).toBe(true);
    expect(token.rotate(t0)).toEqual({ ok: false, code: 'REFRESH_REUSE' });
    expect(token.detectReuse()).toEqual({ ok: false, code: 'REFRESH_REUSE' });
  });

  it('rejects rotation of expired tokens', () => {
    const token = RefreshToken.issue(sessionId, t0);
    const expiredAt = new Date(t0.getTime() + REFRESH_IDLE_MS + 1);
    expect(token.rotate(expiredAt)).toEqual({ ok: false, code: 'REFRESH_EXPIRED' });
  });

  it('rehydrates without exposing the plain token', () => {
    const issued = RefreshToken.issue(sessionId, t0);
    const copy = RefreshToken.rehydrate({
      id: issued.id,
      sessionId: issued.sessionId,
      tokenHash: issued.tokenHash,
      issuedAt: issued.issuedAt,
      expiresAt: issued.expiresAt,
      usedAt: null,
      replacedById: null,
    });
    expect(copy.plainToken).toBeUndefined();
    expect(copy.detectReuse().ok).toBe(true);
    expect(copy.isExpired(t0)).toBe(false);
  });

  it('uses current time by default when issuing and checking expiry', () => {
    const token = RefreshToken.issue(sessionId);
    expect(token.isExpired()).toBe(false);
    expect(token.usedAt).toBeNull();
    expect(token.replacedById).toBeNull();
    expect(token.expiresAt).toBeInstanceOf(Date);
    expect(token.rotate().ok).toBe(true);
    expect(token.usedAt).toBeInstanceOf(Date);
    expect(token.replacedById).toEqual(expect.any(String));
  });
});
