/* eslint-disable @typescript-eslint/require-await */
import { GetMeUseCase } from './get-me.use-case';
import type { UserRepository } from '../domain/ports/user-repository';

describe('GetMeUseCase', () => {
  it('returns the authenticated user profile', async () => {
    const users: UserRepository = {
      findById: jest.fn(async () => ({
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Ana',
        email: 'ana@example.com',
        passwordHash: 'hash',
        createdAt: new Date(),
      })),
      findByEmail: jest.fn(),
      createWithOutbox: jest.fn(),
    };
    const useCase = new GetMeUseCase(users);
    await expect(
      useCase.execute({ userId: '11111111-1111-4111-8111-111111111111' }),
    ).resolves.toEqual({
      ok: true,
      value: {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Ana',
        email: 'ana@example.com',
      },
    });
  });

  it('returns USER_NOT_FOUND when the user is missing', async () => {
    const users: UserRepository = {
      findById: jest.fn(async () => null),
      findByEmail: jest.fn(),
      createWithOutbox: jest.fn(),
    };
    const useCase = new GetMeUseCase(users);
    await expect(useCase.execute({ userId: 'missing' })).resolves.toEqual({
      ok: false,
      code: 'USER_NOT_FOUND',
    });
  });
});
