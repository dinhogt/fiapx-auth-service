import {
  ConflictException,
  BadRequestException,
  HttpException,
  HttpStatus,
  UnauthorizedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AuthController } from './auth.controller';
import { GetMeUseCase } from '../../application/get-me.use-case';
import { LoginUserUseCase } from '../../application/login-user.use-case';
import { LogoutUserUseCase } from '../../application/logout-user.use-case';
import { RefreshTokenUseCase } from '../../application/refresh-token.use-case';
import { RegisterUserUseCase } from '../../application/register-user.use-case';
import type { AuthEnv } from '../../infrastructure/config/env';
import { CORRELATION_HEADER } from './correlation.middleware';
import type { Request } from 'express';
import type { AuthenticatedRequest } from './jwt-auth.guard';

describe('AuthController', () => {
  const env = {
    USER_EVENTS_TOPIC_ARN: 'arn:aws:sns:us-east-1:000000000000:fiapx-local-user-events',
    TRUST_GATEWAY_IP: false,
  } as AuthEnv;

  const refreshUser = { execute: jest.fn() } as unknown as RefreshTokenUseCase;
  const logoutUser = { execute: jest.fn() } as unknown as LogoutUserUseCase;
  const getMe = { execute: jest.fn() } as unknown as GetMeUseCase;

  function makeReq(headers: Record<string, string> = {}): Request {
    return {
      header: (name: string) => headers[name.toLowerCase()],
      headers: { ...headers },
      socket: { remoteAddress: '127.0.0.1' },
    } as unknown as Request;
  }

  function makeController(
    registerUser: RegisterUserUseCase,
    loginUser: LoginUserUseCase,
    refresh: RefreshTokenUseCase = refreshUser,
    logout: LogoutUserUseCase = logoutUser,
    me: GetMeUseCase = getMe,
  ) {
    return new AuthController(registerUser, loginUser, refresh, logout, me, env);
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
      const controller = makeController(
        registerUser,
        { execute: jest.fn() } as unknown as LoginUserUseCase,
      );

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
      const controller = makeController(
        registerUser,
        { execute: jest.fn() } as unknown as LoginUserUseCase,
      );

      await expect(
        controller.register(
          { name: 'Ana', email: 'ana@example.com', password: 'Str0ng-Passw0rd!' },
          makeReq(),
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects a non-object body with BadRequestException', async () => {
      const controller = makeController(
        { execute: jest.fn() } as unknown as RegisterUserUseCase,
        { execute: jest.fn() } as unknown as LoginUserUseCase,
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
        const controller = makeController(
          {
            execute: jest.fn(() => Promise.resolve({ ok: false as const, code })),
          } as unknown as RegisterUserUseCase,
          { execute: jest.fn() } as unknown as LoginUserUseCase,
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
      const controller = makeController(
        { execute: jest.fn() } as unknown as RegisterUserUseCase,
        loginUser,
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
      const controller = makeController(
        { execute: jest.fn() } as unknown as RegisterUserUseCase,
        loginUser,
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
      const controller = makeController(
        { execute: jest.fn() } as unknown as RegisterUserUseCase,
        loginUser,
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
      const controller = makeController(
        { execute: jest.fn() } as unknown as RegisterUserUseCase,
        loginUser,
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
      const controller = makeController(
        { execute: jest.fn() } as unknown as RegisterUserUseCase,
        { execute: jest.fn() } as unknown as LoginUserUseCase,
        refresh,
      );
      await expect(
        controller.refresh({ refreshToken: 'old' }, makeReq()),
      ).resolves.toMatchObject({ refreshToken: 'refresh2' });
    });

    it('maps REFRESH_REUSE to 401', async () => {
      const refresh = {
        execute: jest.fn(() => Promise.resolve({ ok: false as const, code: 'REFRESH_REUSE' })),
      } as unknown as RefreshTokenUseCase;
      const controller = makeController(
        { execute: jest.fn() } as unknown as RegisterUserUseCase,
        { execute: jest.fn() } as unknown as LoginUserUseCase,
        refresh,
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
      const controller = makeController(
        { execute: jest.fn() } as unknown as RegisterUserUseCase,
        { execute: jest.fn() } as unknown as LoginUserUseCase,
        refresh,
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
      const controller = makeController(
        { execute: jest.fn() } as unknown as RegisterUserUseCase,
        { execute: jest.fn() } as unknown as LoginUserUseCase,
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
        const controller = makeController(
          { execute: jest.fn() } as unknown as RegisterUserUseCase,
          { execute: jest.fn() } as unknown as LoginUserUseCase,
          refresh,
        );
        await expect(
          controller.refresh({ refreshToken: 'old' }, makeReq()),
        ).rejects.toBeInstanceOf(UnauthorizedException);
      }
    });
  });

  describe('logout and me', () => {
    it('returns 204 on logout success', async () => {
      const logout = {
        execute: jest.fn(() => Promise.resolve({ ok: true as const, value: undefined })),
      } as unknown as LogoutUserUseCase;
      const controller = makeController(
        { execute: jest.fn() } as unknown as RegisterUserUseCase,
        { execute: jest.fn() } as unknown as LoginUserUseCase,
        refreshUser,
        logout,
      );
      const req = {
        ...makeReq(),
        user: { sub: 'u1', sid: 's1' },
      } as AuthenticatedRequest;
      await expect(controller.logout(req)).resolves.toBeUndefined();
    });

    it('returns me payload', async () => {
      const me = {
        execute: jest.fn(() =>
          Promise.resolve({
            ok: true as const,
            value: { id: 'u1', name: 'Ana', email: 'ana@example.com' },
          }),
        ),
      } as unknown as GetMeUseCase;
      const controller = makeController(
        { execute: jest.fn() } as unknown as RegisterUserUseCase,
        { execute: jest.fn() } as unknown as LoginUserUseCase,
        refreshUser,
        logoutUser,
        me,
      );
      const req = {
        ...makeReq(),
        user: { sub: 'u1', sid: 's1' },
      } as AuthenticatedRequest;
      await expect(controller.me(req)).resolves.toEqual({
        id: 'u1',
        name: 'Ana',
        email: 'ana@example.com',
      });
    });
  });
});
