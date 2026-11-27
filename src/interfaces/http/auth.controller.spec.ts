import {
  ConflictException,
  BadRequestException,
  HttpException,
  HttpStatus,
  UnauthorizedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AuthController } from './auth.controller';
import { LoginUserUseCase } from '../../application/login-user.use-case';
import { RefreshTokenUseCase } from '../../application/refresh-token.use-case';
import { RegisterUserUseCase } from '../../application/register-user.use-case';
import type { AuthEnv } from '../../infrastructure/config/env';
import { CORRELATION_HEADER } from './correlation.middleware';
import type { Request } from 'express';

describe('AuthController', () => {
  const env = {
    USER_EVENTS_TOPIC_ARN: 'arn:aws:sns:us-east-1:000000000000:fiapx-local-user-events',
    TRUST_GATEWAY_IP: false,
  } as AuthEnv;

  const refreshUser = { execute: jest.fn() } as unknown as RefreshTokenUseCase;

  function makeReq(headers: Record<string, string> = {}): Request {
    return {
      header: (name: string) => headers[name.toLowerCase()],
      headers: { ...headers },
      socket: { remoteAddress: '127.0.0.1' },
    } as unknown as Request;
  }

  describe('register', () => {
    it('returns 201 payload on success', async () => {
      const registerUser = {
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
      const loginUser = { execute: jest.fn() } as unknown as LoginUserUseCase;
      const controller = new AuthController(registerUser, loginUser, refreshUser, env);

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
      const registerUser = {
        execute: jest.fn(() => Promise.resolve({ ok: false as const, code: 'EMAIL_IN_USE' })),
      } as unknown as RegisterUserUseCase;
      const controller = new AuthController(
        registerUser,
        { execute: jest.fn() } as unknown as LoginUserUseCase,
        refreshUser,
        env,
      );

      await expect(
        controller.register(
          { name: 'Ana', email: 'ana@example.com', password: 'Str0ng-Passw0rd!' },
          makeReq(),
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects a non-object body with BadRequestException', async () => {
      const controller = new AuthController(
        { execute: jest.fn() } as unknown as RegisterUserUseCase,
        { execute: jest.fn() } as unknown as LoginUserUseCase,
        refreshUser,
        env,
      );
      await expect(controller.register('nope', makeReq())).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('maps register domain validation failures', async () => {
      const codes = [
        'INVALID_NAME_LENGTH',
        'INVALID_EMAIL',
        'INVALID_PASSWORD_LENGTH',
        'COMMON_PASSWORD',
        'UNKNOWN_CODE',
      ] as const;
      for (const code of codes) {
        const controller = new AuthController(
          {
            execute: jest.fn(() => Promise.resolve({ ok: false as const, code })),
          } as unknown as RegisterUserUseCase,
          { execute: jest.fn() } as unknown as LoginUserUseCase,
          refreshUser,
          env,
        );
        await expect(
          controller.register(
            { name: 'Ana', email: 'ana@example.com', password: 'Str0ng-Passw0rd!' },
            makeReq(),
          ),
        ).rejects.toBeInstanceOf(BadRequestException);
      }
    });
  });

  describe('login', () => {
    it('returns TokenPair on success', async () => {
      const loginUser = {
        execute: jest.fn(() =>
          Promise.resolve({
            ok: true as const,
            value: {
              accessToken: 'jwt',
              tokenType: 'Bearer' as const,
              expiresIn: 900,
              refreshToken: 'refresh',
              refreshExpiresIn: 3600,
            },
          }),
        ),
      } as unknown as LoginUserUseCase;
      const controller = new AuthController(
        { execute: jest.fn() } as unknown as RegisterUserUseCase,
        loginUser,
        refreshUser,
        env,
      );

      await expect(
        controller.login({ email: 'ana@example.com', password: 'Str0ng-Passw0rd!' }, makeReq()),
      ).resolves.toEqual({
        accessToken: 'jwt',
        tokenType: 'Bearer',
        expiresIn: 900,
        refreshToken: 'refresh',
        refreshExpiresIn: 3600,
      });
    });

    it('maps INVALID_CREDENTIALS to 401', async () => {
      const loginUser = {
        execute: jest.fn(() =>
          Promise.resolve({ ok: false as const, code: 'INVALID_CREDENTIALS' }),
        ),
      } as unknown as LoginUserUseCase;
      const controller = new AuthController(
        { execute: jest.fn() } as unknown as RegisterUserUseCase,
        loginUser,
        refreshUser,
        env,
      );
      await expect(
        controller.login({ email: 'ana@example.com', password: 'wrong' }, makeReq()),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('maps RATE_LIMITED to 429 and RATE_LIMIT_UNAVAILABLE to 503', async () => {
      const loginUser = {
        execute: jest
          .fn()
          .mockResolvedValueOnce({ ok: false as const, code: 'RATE_LIMITED' })
          .mockResolvedValueOnce({ ok: false as const, code: 'RATE_LIMIT_UNAVAILABLE' }),
      } as unknown as LoginUserUseCase;
      const controller = new AuthController(
        { execute: jest.fn() } as unknown as RegisterUserUseCase,
        loginUser,
        refreshUser,
        env,
      );
      try {
        await controller.login({ email: 'ana@example.com', password: 'x' }, makeReq());
        fail('expected 429');
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(HttpException);
        expect((error as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      }
      await expect(
        controller.login({ email: 'ana@example.com', password: 'x' }, makeReq()),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('rejects invalid login body and maps validation/default failures', async () => {
      const loginUser = {
        execute: jest
          .fn()
          .mockResolvedValueOnce({ ok: false as const, code: 'INVALID_EMAIL' })
          .mockResolvedValueOnce({ ok: false as const, code: 'INVALID_PASSWORD' })
          .mockResolvedValueOnce({ ok: false as const, code: 'UNKNOWN' }),
      } as unknown as LoginUserUseCase;
      const controller = new AuthController(
        { execute: jest.fn() } as unknown as RegisterUserUseCase,
        loginUser,
        refreshUser,
        env,
      );
      await expect(controller.login({}, makeReq())).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        controller.login({ email: 'ana@example.com', password: 'x' }, makeReq()),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        controller.login({ email: 'ana@example.com', password: 'x' }, makeReq()),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        controller.login({ email: 'ana@example.com', password: 'x' }, makeReq()),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('refresh', () => {
    it('returns a new TokenPair on success', async () => {
      const refresh = {
        execute: jest.fn(() =>
          Promise.resolve({
            ok: true as const,
            value: {
              accessToken: 'jwt2',
              tokenType: 'Bearer' as const,
              expiresIn: 900,
              refreshToken: 'refresh2',
              refreshExpiresIn: 3600,
            },
          }),
        ),
      } as unknown as RefreshTokenUseCase;
      const controller = new AuthController(
        { execute: jest.fn() } as unknown as RegisterUserUseCase,
        { execute: jest.fn() } as unknown as LoginUserUseCase,
        refresh,
        env,
      );
      await expect(
        controller.refresh({ refreshToken: 'old' }, makeReq()),
      ).resolves.toMatchObject({ refreshToken: 'refresh2' });
    });

    it('maps REFRESH_REUSE to 401', async () => {
      const refresh = {
        execute: jest.fn(() => Promise.resolve({ ok: false as const, code: 'REFRESH_REUSE' })),
      } as unknown as RefreshTokenUseCase;
      const controller = new AuthController(
        { execute: jest.fn() } as unknown as RegisterUserUseCase,
        { execute: jest.fn() } as unknown as LoginUserUseCase,
        refresh,
        env,
      );
      await expect(controller.refresh({ refreshToken: 'old' }, makeReq())).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('maps refresh rate-limit failures', async () => {
      const refresh = {
        execute: jest
          .fn()
          .mockResolvedValueOnce({ ok: false as const, code: 'RATE_LIMITED' })
          .mockResolvedValueOnce({ ok: false as const, code: 'RATE_LIMIT_UNAVAILABLE' }),
      } as unknown as RefreshTokenUseCase;
      const controller = new AuthController(
        { execute: jest.fn() } as unknown as RegisterUserUseCase,
        { execute: jest.fn() } as unknown as LoginUserUseCase,
        refresh,
        env,
      );
      try {
        await controller.refresh({ refreshToken: 'old' }, makeReq());
        fail('expected 429');
      } catch (error: unknown) {
        expect((error as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      }
      await expect(controller.refresh({ refreshToken: 'old' }, makeReq())).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });

    it('rejects invalid refresh body', async () => {
      const controller = new AuthController(
        { execute: jest.fn() } as unknown as RegisterUserUseCase,
        { execute: jest.fn() } as unknown as LoginUserUseCase,
        refreshUser,
        env,
      );
      await expect(controller.refresh({}, makeReq())).rejects.toBeInstanceOf(BadRequestException);
    });

    it('maps remaining refresh failure codes to 401', async () => {
      const codes = [
        'INVALID_REFRESH_TOKEN',
        'REFRESH_EXPIRED',
        'SESSION_IDLE_EXPIRED',
        'SESSION_ABSOLUTE_EXPIRED',
        'SESSION_REVOKED',
        'UNKNOWN',
      ] as const;
      for (const code of codes) {
        const refresh = {
          execute: jest.fn(() => Promise.resolve({ ok: false as const, code })),
        } as unknown as RefreshTokenUseCase;
        const controller = new AuthController(
          { execute: jest.fn() } as unknown as RegisterUserUseCase,
          { execute: jest.fn() } as unknown as LoginUserUseCase,
          refresh,
          env,
        );
        await expect(
          controller.refresh({ refreshToken: 'old' }, makeReq()),
        ).rejects.toBeInstanceOf(UnauthorizedException);
      }
    });
  });
});
