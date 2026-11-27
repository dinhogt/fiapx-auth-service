/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/unbound-method */
import { SessionRevocationRehydratorService } from './session-revocation-rehydrator.service';
import type { SessionRevocationStore } from '../../domain/ports/session-revocation-store';
import type { AuthEnv } from '../config/env';
import type { PrismaService } from '../prisma/prisma.service';

describe('SessionRevocationRehydratorService', () => {
  it('rehydrates recently revoked sids into Redis when lock is acquired', async () => {
    const prisma = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ locked: true }])
        .mockResolvedValueOnce([{ unlocked: true }]),
      session: {
        findMany: jest.fn(async () => [{ id: 'sid-1' }, { id: 'sid-2' }]),
      },
    } as unknown as PrismaService;
    const revocation: SessionRevocationStore = {
      revoke: jest.fn(async () => undefined),
      isRevoked: jest.fn(async () => false),
    };
    const env = { ACCESS_TTL: 900 } as AuthEnv;
    const job = new SessionRevocationRehydratorService(prisma, revocation, env);

    await job.rehydrate();

    expect(revocation.revoke).toHaveBeenCalledWith('sid-1');
    expect(revocation.revoke).toHaveBeenCalledWith('sid-2');
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('skips the cycle when the advisory lock is held elsewhere', async () => {
    const prisma = {
      $queryRaw: jest.fn(async () => [{ locked: false }]),
      session: { findMany: jest.fn() },
    } as unknown as PrismaService;
    const revocation: SessionRevocationStore = {
      revoke: jest.fn(),
      isRevoked: jest.fn(),
    };
    const job = new SessionRevocationRehydratorService(
      prisma,
      revocation,
      { ACCESS_TTL: 900 } as AuthEnv,
    );

    await job.rehydrate();
    expect(prisma.session.findMany).not.toHaveBeenCalled();
    expect(revocation.revoke).not.toHaveBeenCalled();
  });
});
