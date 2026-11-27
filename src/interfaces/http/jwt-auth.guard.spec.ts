/* eslint-disable @typescript-eslint/require-await */
import { Reflector } from '@nestjs/core';
import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AccessTokenVerificationError } from '../../domain/ports/access-token-verifier';
import { SessionRevocationStoreUnavailableError } from '../../domain/ports/session-revocation-store';
import { IS_PUBLIC_KEY } from './public.decorator';

function makeContext(headers: Record<string, string> = {}, isPublic = false) {
  const req = { headers, user: undefined as undefined | { sub: string; sid: string } };
  const reflector = {
    getAllAndOverride: jest.fn((key: string) => (key === IS_PUBLIC_KEY ? isPublic : false)),
  } as unknown as Reflector;
  return {
    req,
    reflector,
    context: {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => req }),
    },
  };
}

describe('JwtAuthGuard', () => {
  it('allows public routes without a token', async () => {
    const { reflector, context } = makeContext({}, true);
    const guard = new JwtAuthGuard(
      reflector,
      { verify: jest.fn() },
      { revoke: jest.fn(), isRevoked: jest.fn() },
    );
    await expect(guard.canActivate(context as never)).resolves.toBe(true);
  });

  it('rejects missing Bearer tokens', async () => {
    const { reflector, context } = makeContext({});
    const guard = new JwtAuthGuard(
      reflector,
      { verify: jest.fn() },
      { revoke: jest.fn(), isRevoked: jest.fn() },
    );
    await expect(guard.canActivate(context as never)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects invalid tokens and revoked sessions', async () => {
    const { reflector, context: invalidCtx } = makeContext({ authorization: 'Bearer bad' });
    const invalidGuard = new JwtAuthGuard(
      reflector,
      {
        verify: jest.fn(async () => {
          throw new AccessTokenVerificationError();
        }),
      },
      { revoke: jest.fn(), isRevoked: jest.fn() },
    );
    await expect(invalidGuard.canActivate(invalidCtx as never)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    const { reflector: r2, context: revokedCtx, req } = makeContext({
      authorization: 'Bearer good',
    });
    const revokedGuard = new JwtAuthGuard(
      r2,
      { verify: jest.fn(async () => ({ sub: 'u1', sid: 's1' })) },
      { revoke: jest.fn(), isRevoked: jest.fn(async () => true) },
    );
    await expect(revokedGuard.canActivate(revokedCtx as never)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(req.user).toBeUndefined();
  });

  it('returns 503 when Redis revocation lookup fails', async () => {
    const { reflector, context } = makeContext({ authorization: 'Bearer good' });
    const guard = new JwtAuthGuard(
      reflector,
      { verify: jest.fn(async () => ({ sub: 'u1', sid: 's1' })) },
      {
        revoke: jest.fn(),
        isRevoked: jest.fn(async () => {
          throw new SessionRevocationStoreUnavailableError();
        }),
      },
    );
    await expect(guard.canActivate(context as never)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('attaches verified claims on success', async () => {
    const { reflector, context, req } = makeContext({ authorization: 'Bearer good' });
    const guard = new JwtAuthGuard(
      reflector,
      { verify: jest.fn(async () => ({ sub: 'u1', sid: 's1' })) },
      { revoke: jest.fn(), isRevoked: jest.fn(async () => false) },
    );
    await expect(guard.canActivate(context as never)).resolves.toBe(true);
    expect(req.user).toEqual({ sub: 'u1', sid: 's1' });
  });
});
