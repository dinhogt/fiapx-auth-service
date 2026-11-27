/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-assignment */
import { RegisterUserUseCase } from './register-user.use-case';
import type { PasswordHasher } from '../domain/ports/password-hasher';
import type { PersistedUser, UserRepository } from '../domain/ports/user-repository';

const topicArn = 'arn:aws:sns:us-east-1:000000000000:fiapx-local-user-events';
const correlationId = '11111111-1111-4111-8111-111111111111';
const traceparent = '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01';

function makeHasher(): PasswordHasher {
  return {
    hash: jest.fn(async (plain: string) => `$argon2id$v=19$m=19456,t=2,p=1$${plain}`),
    verify: jest.fn(async () => true),
  };
}

function makeRepo(overrides: Partial<UserRepository> = {}): UserRepository {
  return {
    findById: jest.fn(async () => null),
    findByEmail: jest.fn(async () => null),
    createWithOutbox: jest.fn(async (user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      passwordHash: user.passwordHash,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    })),
    ...overrides,
  };
}

describe('RegisterUserUseCase', () => {
  it('registers a user and writes user.registered to the outbox', async () => {
    const users = makeRepo();
    const hasher = makeHasher();
    const useCase = new RegisterUserUseCase(users, hasher);

    const result = await useCase.execute({
      name: 'Ana Silva',
      email: 'ana@example.com',
      password: 'Str0ng-Passw0rd!',
      correlationId,
      traceparent,
      userEventsTopicArn: topicArn,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.email).toBe('ana@example.com');
    expect(result.value.name).toBe('Ana Silva');
    expect(hasher.hash).toHaveBeenCalledWith('Str0ng-Passw0rd!');
    expect(users.createWithOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'ana@example.com',
        name: 'Ana Silva',
        passwordHash: expect.stringContaining('$argon2id$'),
      }),
      expect.objectContaining({
        type: 'user.registered',
        destination: topicArn,
        payload: expect.objectContaining({
          type: 'user.registered',
          source: 'auth-service',
          correlationId,
          payload: expect.objectContaining({
            email: 'ana@example.com',
            name: 'Ana Silva',
          }),
        }),
      }),
    );
  });

  it('returns EMAIL_IN_USE when the email already exists', async () => {
    const existing: PersistedUser = {
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Existing',
      email: 'ana@example.com',
      passwordHash: 'hash',
      createdAt: new Date(),
    };
    const useCase = new RegisterUserUseCase(
      makeRepo({ findByEmail: jest.fn(async () => existing) }),
      makeHasher(),
    );

    const result = await useCase.execute({
      name: 'Ana',
      email: 'ana@example.com',
      password: 'Str0ng-Passw0rd!',
      correlationId,
      traceparent,
      userEventsTopicArn: topicArn,
    });

    expect(result).toEqual({ ok: false, code: 'EMAIL_IN_USE' });
  });

  it('returns domain validation failures', async () => {
    const useCase = new RegisterUserUseCase(makeRepo(), makeHasher());

    await expect(
      useCase.execute({
        name: 'A',
        email: 'ana@example.com',
        password: 'Str0ng-Passw0rd!',
        correlationId,
        traceparent,
        userEventsTopicArn: topicArn,
      }),
    ).resolves.toEqual({ ok: false, code: 'INVALID_NAME_LENGTH' });

    await expect(
      useCase.execute({
        name: 'Ana',
        email: 'bad',
        password: 'Str0ng-Passw0rd!',
        correlationId,
        traceparent,
        userEventsTopicArn: topicArn,
      }),
    ).resolves.toEqual({ ok: false, code: 'INVALID_EMAIL' });

    await expect(
      useCase.execute({
        name: 'Ana',
        email: 'ana@example.com',
        password: 'short',
        correlationId,
        traceparent,
        userEventsTopicArn: topicArn,
      }),
    ).resolves.toEqual({ ok: false, code: 'INVALID_PASSWORD_LENGTH' });
  });

  it('maps Prisma unique violations to EMAIL_IN_USE', async () => {
    const useCase = new RegisterUserUseCase(
      makeRepo({
        createWithOutbox: jest.fn(async () => {
          throw Object.assign(new Error('unique'), { code: 'P2002' });
        }),
      }),
      makeHasher(),
    );

    const result = await useCase.execute({
      name: 'Ana',
      email: 'ana@example.com',
      password: 'Str0ng-Passw0rd!',
      correlationId,
      traceparent,
      userEventsTopicArn: topicArn,
    });

    expect(result).toEqual({ ok: false, code: 'EMAIL_IN_USE' });
  });
});
