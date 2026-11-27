/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/unbound-method */
import { LogoutUserUseCase } from './logout-user.use-case';
import type { SessionRepository } from '../domain/ports/session-repository';
import type { SessionRevocationStore } from '../domain/ports/session-revocation-store';
import { SessionRevocationStoreUnavailableError } from '../domain/ports/session-revocation-store';
import { Session } from '../domain/session';

function makeSession(userId = '11111111-1111-4111-8111-111111111111') {
  return Session.start(userId);
}

describe('LogoutUserUseCase', () => {
  it('revokes the session in Postgres and Redis', async () => {
    const session = makeSession();
    const sessions: SessionRepository = {
      createWithRefresh: jest.fn(),
      findById: jest.fn(async () => session),
      findRefreshWithSessionByHash: jest.fn(),
      rotateRefresh: jest.fn(),
      revokeSession: jest.fn(async () => undefined),
    };
    const revocation: SessionRevocationStore = {
      revoke: jest.fn(async () => undefined),
      isRevoked: jest.fn(async () => false),
    };
    const useCase = new LogoutUserUseCase(sessions, revocation);

    await expect(
      useCase.execute({ sid: session.id, userId: session.userId }),
    ).resolves.toEqual({ ok: true, value: undefined });
    expect(sessions.revokeSession).toHaveBeenCalledWith(
      session.id,
      'LOGOUT',
      expect.any(Date),
    );
    expect(revocation.revoke).toHaveBeenCalledWith(session.id);
  });

  it('rejects unknown or mismatched sessions', async () => {
    const sessions: SessionRepository = {
      createWithRefresh: jest.fn(),
      findById: jest.fn(async () => null),
      findRefreshWithSessionByHash: jest.fn(),
      rotateRefresh: jest.fn(),
      revokeSession: jest.fn(),
    };
    const revocation: SessionRevocationStore = {
      revoke: jest.fn(),
      isRevoked: jest.fn(),
    };
    const useCase = new LogoutUserUseCase(sessions, revocation);
    await expect(
      useCase.execute({ sid: 'missing', userId: 'u1' }),
    ).resolves.toEqual({ ok: false, code: 'INVALID_SESSION' });
  });

  it('is idempotent when the session is already revoked and swallows Redis outages', async () => {
    const session = makeSession();
    session.revoke('REFRESH_REUSE');
    const sessions: SessionRepository = {
      createWithRefresh: jest.fn(),
      findById: jest.fn(async () => session),
      findRefreshWithSessionByHash: jest.fn(),
      rotateRefresh: jest.fn(),
      revokeSession: jest.fn(),
    };
    const revocation: SessionRevocationStore = {
      revoke: jest.fn(async () => {
        throw new SessionRevocationStoreUnavailableError();
      }),
      isRevoked: jest.fn(),
    };
    const useCase = new LogoutUserUseCase(sessions, revocation);
    await expect(
      useCase.execute({ sid: session.id, userId: session.userId }),
    ).resolves.toEqual({ ok: true, value: undefined });
    expect(sessions.revokeSession).not.toHaveBeenCalled();
  });
});
