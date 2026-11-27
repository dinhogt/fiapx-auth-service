/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/unbound-method */
import { LoginUserUseCase } from './login-user.use-case';
import type { AccessTokenSigner } from '../domain/ports/access-token-signer';
import type { LoginRateLimiter } from '../domain/ports/login-rate-limiter';
import { RateLimitUnavailableError } from '../domain/ports/login-rate-limiter';
import type { PasswordHasher } from '../domain/ports/password-hasher';
import type { SessionRepository } from '../domain/ports/session-repository';
import type { PersistedUser, UserRepository } from '../domain/ports/user-repository';

const user: PersistedUser = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Ana',
  email: 'ana@example.com',
  passwordHash: '$argon2id$hash',
  createdAt: new Date(),
};

function makeDeps(
  overrides: {
    users?: Partial<UserRepository>;
    sessions?: Partial<SessionRepository>;
    hasher?: Partial<PasswordHasher>;
    rateLimiter?: Partial<LoginRateLimiter>;
    signer?: Partial<AccessTokenSigner>;
  } = {},
) {
  const users: UserRepository = {
    findById: jest.fn(async () => user),
    findByEmail: jest.fn(async () => user),
    createWithOutbox: jest.fn(),
    ...overrides.users,
  };
  const sessions: SessionRepository = {
    createWithRefresh: jest.fn(async () => undefined),
    findById: jest.fn(async () => null),
    findRefreshWithSessionByHash: jest.fn(async () => null),
    rotateRefresh: jest.fn(async () => undefined),
    revokeSession: jest.fn(async () => undefined),
    ...overrides.sessions,
  };
  const hasher: PasswordHasher = {
    hash: jest.fn(),
    verify: jest.fn(async () => true),
    ...overrides.hasher,
  };
  const rateLimiter: LoginRateLimiter = {
    consume: jest.fn(async () => 'allow' as const),
    ...overrides.rateLimiter,
  };
  const signer: AccessTokenSigner = {
    sign: jest.fn(async () => ({ accessToken: 'jwt.token', expiresIn: 900 })),
    ...overrides.signer,
  };
  return {
    useCase: new LoginUserUseCase(users, sessions, hasher, rateLimiter, signer, 3600),
    users,
    sessions,
    hasher,
    rateLimiter,
    signer,
  };
}

describe('LoginUserUseCase', () => {
  it('returns a token pair on valid credentials', async () => {
    const { useCase, sessions, signer } = makeDeps();
    const result = await useCase.execute({
      email: 'ana@example.com',
      password: 'Str0ng-Passw0rd!',
      clientIp: '127.0.0.1',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value).toEqual({
      accessToken: 'jwt.token',
      tokenType: 'Bearer',
      expiresIn: 900,
      refreshToken: expect.any(String),
      refreshExpiresIn: 3600,
    });
    expect(sessions.createWithRefresh).toHaveBeenCalled();
    expect(signer.sign).toHaveBeenCalledWith({
      sub: user.id,
      sid: expect.any(String),
    });
  });

  it('returns INVALID_CREDENTIALS for wrong password', async () => {
    const { useCase } = makeDeps({
      hasher: { verify: jest.fn(async () => false) },
    });
    await expect(
      useCase.execute({
        email: 'ana@example.com',
        password: 'wrong-password',
        clientIp: '127.0.0.1',
      }),
    ).resolves.toEqual({ ok: false, code: 'INVALID_CREDENTIALS' });
  });

  it('returns RATE_LIMITED when the limiter blocks', async () => {
    const { useCase } = makeDeps({
      rateLimiter: { consume: jest.fn(async () => 'block' as const) },
    });
    await expect(
      useCase.execute({
        email: 'ana@example.com',
        password: 'Str0ng-Passw0rd!',
        clientIp: '127.0.0.1',
      }),
    ).resolves.toEqual({ ok: false, code: 'RATE_LIMITED' });
  });

  it('returns RATE_LIMIT_UNAVAILABLE when Redis is down', async () => {
    const { useCase } = makeDeps({
      rateLimiter: {
        consume: jest.fn(async () => {
          throw new RateLimitUnavailableError();
        }),
      },
    });
    await expect(
      useCase.execute({
        email: 'ana@example.com',
        password: 'Str0ng-Passw0rd!',
        clientIp: '127.0.0.1',
      }),
    ).resolves.toEqual({ ok: false, code: 'RATE_LIMIT_UNAVAILABLE' });
  });

  it('rejects invalid email and empty password', async () => {
    const { useCase } = makeDeps();
    await expect(
      useCase.execute({ email: 'not-an-email', password: 'x', clientIp: '1.1.1.1' }),
    ).resolves.toEqual({ ok: false, code: 'INVALID_EMAIL' });
    await expect(
      useCase.execute({ email: 'ana@example.com', password: '', clientIp: '1.1.1.1' }),
    ).resolves.toEqual({ ok: false, code: 'INVALID_PASSWORD' });
  });

  it('rethrows unexpected rate-limit errors', async () => {
    const { useCase } = makeDeps({
      rateLimiter: {
        consume: jest.fn(async () => {
          throw new Error('boom');
        }),
      },
    });
    await expect(
      useCase.execute({
        email: 'ana@example.com',
        password: 'Str0ng-Passw0rd!',
        clientIp: '127.0.0.1',
      }),
    ).rejects.toThrow('boom');
  });
});
