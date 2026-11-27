/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/unbound-method */
import { RefreshTokenUseCase } from './refresh-token.use-case';
import type { AccessTokenSigner } from '../domain/ports/access-token-signer';
import type { RefreshRateLimiter } from '../domain/ports/refresh-rate-limiter';
import { RateLimitUnavailableError } from '../domain/ports/refresh-rate-limiter';
import type { SecurityEventRecorder } from '../domain/ports/security-event-recorder';
import type { SessionRepository } from '../domain/ports/session-repository';
import type { SessionRevocationStore } from '../domain/ports/session-revocation-store';
import { SessionRevocationStoreUnavailableError } from '../domain/ports/session-revocation-store';
import { RefreshToken } from '../domain/refresh-token';
import { Session } from '../domain/session';

function makeSession(overrides: Partial<{ idleExpiresAt: Date; absoluteExpiresAt: Date }> = {}) {
  const now = new Date();
  return Session.rehydrate({
    id: '33333333-3333-4333-8333-333333333333',
    userId: '11111111-1111-4111-8111-111111111111',
    createdAt: now,
    lastUsedAt: now,
    idleExpiresAt: overrides.idleExpiresAt ?? new Date(now.getTime() + 60 * 60 * 1000),
    absoluteExpiresAt: overrides.absoluteExpiresAt ?? new Date(now.getTime() + 8 * 60 * 60 * 1000),
    revokedAt: null,
    revokedReason: null,
  });
}

function makeDeps(
  overrides: {
    sessions?: Partial<SessionRepository>;
    rateLimiter?: Partial<RefreshRateLimiter>;
    revocation?: Partial<SessionRevocationStore>;
    signer?: Partial<AccessTokenSigner>;
    security?: Partial<SecurityEventRecorder>;
  } = {},
) {
  const issued = RefreshToken.issue('33333333-3333-4333-8333-333333333333');
  const sessions: SessionRepository = {
    createWithRefresh: jest.fn(),
    findById: jest.fn(async () => makeSession()),
    findRefreshWithSessionByHash: jest.fn(async () => ({
      refresh: issued,
      session: makeSession(),
    })),
    rotateRefresh: jest.fn(async () => undefined),
    revokeSession: jest.fn(async () => undefined),
    ...overrides.sessions,
  };
  const rateLimiter: RefreshRateLimiter = {
    consume: jest.fn(async () => 'allow' as const),
    ...overrides.rateLimiter,
  };
  const revocation: SessionRevocationStore = {
    revoke: jest.fn(async () => undefined),
    isRevoked: jest.fn(async () => false),
    ...overrides.revocation,
  };
  const signer: AccessTokenSigner = {
    sign: jest.fn(async () => ({ accessToken: 'jwt.new', expiresIn: 900 })),
    ...overrides.signer,
  };
  const security: SecurityEventRecorder = {
    record: jest.fn(),
    ...overrides.security,
  };
  return {
    useCase: new RefreshTokenUseCase(sessions, rateLimiter, revocation, signer, security, 3600),
    sessions,
    rateLimiter,
    revocation,
    signer,
    security,
    issued,
  };
}

describe('RefreshTokenUseCase', () => {
  it('rotates a valid refresh token (AC-14)', async () => {
    const { useCase, sessions, issued } = makeDeps();
    const result = await useCase.execute({
      refreshToken: issued.plainToken!,
      clientIp: '127.0.0.1',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.accessToken).toBe('jwt.new');
    expect(result.value.refreshToken).not.toBe(issued.plainToken);
    expect(sessions.rotateRefresh).toHaveBeenCalled();
  });

  it('revokes the session on reuse and records a security event (AC-15)', async () => {
    const session = makeSession();
    const first = RefreshToken.issue(session.id);
    const rotated = first.rotate();
    expect(rotated.ok).toBe(true);

    const { useCase, sessions, revocation, security } = makeDeps({
      sessions: {
        findRefreshWithSessionByHash: jest.fn(async () => ({
          refresh: first,
          session,
        })),
      },
    });

    const result = await useCase.execute({
      refreshToken: 'any-plain-already-hashed-lookup',
      clientIp: '127.0.0.1',
    });
    expect(result).toEqual({ ok: false, code: 'REFRESH_REUSE' });
    expect(sessions.revokeSession).toHaveBeenCalledWith(
      session.id,
      'REFRESH_REUSE',
      expect.any(Date),
    );
    expect(revocation.revoke).toHaveBeenCalledWith(session.id);
    expect(security.record).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'security.refresh_reuse', sid: session.id }),
    );
  });

  it('rejects idle-expired sessions (AC-16)', async () => {
    const past = new Date('2020-01-01T00:00:00.000Z');
    const issued = RefreshToken.issue('33333333-3333-4333-8333-333333333333');
    const { useCase } = makeDeps({
      sessions: {
        findRefreshWithSessionByHash: jest.fn(async () => ({
          refresh: issued,
          session: makeSession({ idleExpiresAt: past }),
        })),
      },
    });
    await expect(
      useCase.execute({ refreshToken: issued.plainToken!, clientIp: '1.1.1.1' }),
    ).resolves.toEqual({ ok: false, code: 'SESSION_IDLE_EXPIRED' });
  });

  it('returns RATE_LIMIT_UNAVAILABLE when Redis rate limit is down', async () => {
    const { useCase } = makeDeps({
      rateLimiter: {
        consume: jest.fn(async () => {
          throw new RateLimitUnavailableError();
        }),
      },
    });
    await expect(useCase.execute({ refreshToken: 'token', clientIp: '1.1.1.1' })).resolves.toEqual({
      ok: false,
      code: 'RATE_LIMIT_UNAVAILABLE',
    });
  });

  it('rejects absolute-expired sessions (AC-16)', async () => {
    const past = new Date('2020-01-01T00:00:00.000Z');
    const issued = RefreshToken.issue('33333333-3333-4333-8333-333333333333');
    const { useCase } = makeDeps({
      sessions: {
        findRefreshWithSessionByHash: jest.fn(async () => ({
          refresh: issued,
          session: makeSession({ absoluteExpiresAt: past }),
        })),
      },
    });
    await expect(
      useCase.execute({ refreshToken: issued.plainToken!, clientIp: '1.1.1.1' }),
    ).resolves.toEqual({ ok: false, code: 'SESSION_ABSOLUTE_EXPIRED' });
  });

  it('rejects unknown refresh tokens', async () => {
    const { useCase } = makeDeps({
      sessions: {
        findRefreshWithSessionByHash: jest.fn(async () => null),
      },
    });
    await expect(
      useCase.execute({ refreshToken: 'missing', clientIp: '1.1.1.1' }),
    ).resolves.toEqual({ ok: false, code: 'INVALID_REFRESH_TOKEN' });
  });

  it('returns RATE_LIMITED when the limiter blocks', async () => {
    const { useCase } = makeDeps({
      rateLimiter: { consume: jest.fn(async () => 'block' as const) },
    });
    await expect(useCase.execute({ refreshToken: 'token', clientIp: '1.1.1.1' })).resolves.toEqual({
      ok: false,
      code: 'RATE_LIMITED',
    });
  });

  it('rejects empty refresh tokens and revoked sessions', async () => {
    const { useCase: emptyCase } = makeDeps();
    await expect(emptyCase.execute({ refreshToken: '   ', clientIp: '1.1.1.1' })).resolves.toEqual({
      ok: false,
      code: 'INVALID_REFRESH_TOKEN',
    });

    const session = makeSession();
    session.revoke('LOGOUT');
    const issued = RefreshToken.issue(session.id);
    const { useCase } = makeDeps({
      sessions: {
        findRefreshWithSessionByHash: jest.fn(async () => ({ refresh: issued, session })),
      },
    });
    await expect(
      useCase.execute({ refreshToken: issued.plainToken!, clientIp: '1.1.1.1' }),
    ).resolves.toEqual({ ok: false, code: 'INVALID_REFRESH_TOKEN' });
  });

  it('rejects expired refresh tokens', async () => {
    const session = makeSession();
    const issued = RefreshToken.issue(session.id, new Date('2020-01-01T00:00:00.000Z'));
    const { useCase } = makeDeps({
      sessions: {
        findRefreshWithSessionByHash: jest.fn(async () => ({ refresh: issued, session })),
      },
    });
    await expect(useCase.execute({ refreshToken: 'x', clientIp: '1.1.1.1' })).resolves.toEqual({
      ok: false,
      code: 'REFRESH_EXPIRED',
    });
  });

  it('rethrows unexpected rate-limit errors', async () => {
    const { useCase } = makeDeps({
      rateLimiter: {
        consume: jest.fn(async () => {
          throw new Error('boom');
        }),
      },
    });
    await expect(useCase.execute({ refreshToken: 'token', clientIp: '1.1.1.1' })).rejects.toThrow(
      'boom',
    );
  });

  it('swallows revocation-store outages during reuse handling', async () => {
    const session = makeSession();
    const first = RefreshToken.issue(session.id);
    first.rotate();
    const { useCase, security } = makeDeps({
      sessions: {
        findRefreshWithSessionByHash: jest.fn(async () => ({ refresh: first, session })),
      },
      revocation: {
        revoke: jest.fn(async () => {
          throw new SessionRevocationStoreUnavailableError();
        }),
      },
    });
    await expect(useCase.execute({ refreshToken: 'x', clientIp: '1.1.1.1' })).resolves.toEqual({
      ok: false,
      code: 'REFRESH_REUSE',
    });
    expect(security.record).toHaveBeenCalled();
  });

  it('rethrows unexpected revocation-store errors during reuse handling', async () => {
    const session = makeSession();
    const first = RefreshToken.issue(session.id);
    first.rotate();
    const { useCase } = makeDeps({
      sessions: {
        findRefreshWithSessionByHash: jest.fn(async () => ({ refresh: first, session })),
      },
      revocation: {
        revoke: jest.fn(async () => {
          throw new Error('redis-crash');
        }),
      },
    });
    await expect(useCase.execute({ refreshToken: 'x', clientIp: '1.1.1.1' })).rejects.toThrow(
      'redis-crash',
    );
  });

  it('handles defensive rotate failures and missing plain tokens', async () => {
    const session = makeSession();
    const issued = RefreshToken.issue(session.id);
    const rotateSpy = jest
      .spyOn(RefreshToken.prototype, 'rotate')
      .mockReturnValueOnce({ ok: false, code: 'REFRESH_REUSE' })
      .mockReturnValueOnce({
        ok: true,
        value: {
          current: issued,
          next: RefreshToken.rehydrate({
            id: '44444444-4444-4444-8444-444444444444',
            sessionId: session.id,
            tokenHash: 'abc',
            issuedAt: new Date(),
            expiresAt: new Date(Date.now() + 60_000),
            usedAt: null,
            replacedById: null,
          }),
        },
      });

    const reuseCase = makeDeps({
      sessions: {
        findRefreshWithSessionByHash: jest.fn(async () => ({ refresh: issued, session })),
      },
    });
    await expect(
      reuseCase.useCase.execute({ refreshToken: issued.plainToken!, clientIp: '1.1.1.1' }),
    ).resolves.toEqual({ ok: false, code: 'REFRESH_REUSE' });

    const missingPlain = makeDeps({
      sessions: {
        findRefreshWithSessionByHash: jest.fn(async () => ({
          refresh: RefreshToken.issue(session.id),
          session: makeSession(),
        })),
      },
    });
    await expect(
      missingPlain.useCase.execute({ refreshToken: 'plain', clientIp: '1.1.1.1' }),
    ).rejects.toThrow('Refresh token plain value missing after rotation');

    rotateSpy.mockRestore();
  });
});
