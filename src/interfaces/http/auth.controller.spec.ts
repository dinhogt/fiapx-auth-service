import { ConflictException, BadRequestException } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { RegisterUserUseCase } from '../../application/register-user.use-case';
import type { AuthEnv } from '../../infrastructure/config/env';
import { CORRELATION_HEADER } from './correlation.middleware';
import type { Request } from 'express';

describe('AuthController.register', () => {
  const env = {
    USER_EVENTS_TOPIC_ARN: 'arn:aws:sns:us-east-1:000000000000:fiapx-local-user-events',
  } as AuthEnv;

  function makeReq(headers: Record<string, string> = {}): Request {
    return {
      header: (name: string) => headers[name.toLowerCase()],
      headers: { ...headers },
    } as unknown as Request;
  }

  it('returns 201 payload on success', async () => {
    const useCase = {
      execute: jest.fn(() =>
        Promise.resolve({
          ok: true as const,
          value: {
            id: '11111111-1111-4111-8111-111111111111',
            name: 'Ana',
            email: 'ana@example.com',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
          },
        }),
      ),
    } as unknown as RegisterUserUseCase;
    const controller = new AuthController(useCase, env);

    const body = await controller.register(
      { name: 'Ana', email: 'ana@example.com', password: 'Str0ng-Passw0rd!' },
      makeReq({ [CORRELATION_HEADER]: '11111111-1111-4111-8111-111111111111' }),
    );

    expect(body).toEqual({
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Ana',
      email: 'ana@example.com',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('maps EMAIL_IN_USE to ConflictException', async () => {
    const useCase = {
      execute: jest.fn(() => Promise.resolve({ ok: false as const, code: 'EMAIL_IN_USE' })),
    } as unknown as RegisterUserUseCase;
    const controller = new AuthController(useCase, env);

    await expect(
      controller.register(
        { name: 'Ana', email: 'ana@example.com', password: 'Str0ng-Passw0rd!' },
        makeReq(),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a non-object body with BadRequestException', async () => {
    const useCase = { execute: jest.fn() } as unknown as RegisterUserUseCase;
    const controller = new AuthController(useCase, env);

    await expect(controller.register('nope', makeReq())).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
