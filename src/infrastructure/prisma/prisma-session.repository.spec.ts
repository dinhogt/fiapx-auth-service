/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/unbound-method */
import { PrismaSessionRepository } from './prisma-session.repository';
import type { PrismaService } from './prisma.service';
import { RefreshToken } from '../../domain/refresh-token';
import { Session } from '../../domain/session';

describe('PrismaSessionRepository', () => {
  it('returns null when refresh hash is unknown', async () => {
    const prisma = {
      refreshToken: {
        findUnique: jest.fn(async () => null),
      },
    } as unknown as PrismaService;
    const repo = new PrismaSessionRepository(prisma);
    await expect(repo.findRefreshWithSessionByHash('missing')).resolves.toBeNull();
  });

  it('rehydrates refresh+session rows', async () => {
    const now = new Date();
    const prisma = {
      refreshToken: {
        findUnique: jest.fn(async () => ({
          id: 'r1',
          sessionId: 's1',
          tokenHash: 'hash',
          issuedAt: now,
          expiresAt: now,
          usedAt: null,
          replacedById: null,
          session: {
            id: 's1',
            userId: 'u1',
            createdAt: now,
            lastUsedAt: now,
            idleExpiresAt: now,
            absoluteExpiresAt: now,
            revokedAt: null,
            revokedReason: null,
          },
        })),
      },
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<void>) =>
        fn({
          session: {
            create: jest.fn(async () => undefined),
            update: jest.fn(async () => undefined),
          },
          refreshToken: {
            create: jest.fn(async () => undefined),
            update: jest.fn(async () => undefined),
          },
        }),
      ),
      session: {
        update: jest.fn(async () => undefined),
      },
    } as unknown as PrismaService;
    const repo = new PrismaSessionRepository(prisma);
    const found = await repo.findRefreshWithSessionByHash('hash');
    expect(found?.session.id).toBe('s1');
    expect(found?.refresh.tokenHash).toBe('hash');

    const session = Session.start('u1', now);
    const refresh = RefreshToken.issue(session.id, now);
    await repo.createWithRefresh(session, refresh);
    const rotated = refresh.rotate(now);
    expect(rotated.ok).toBe(true);
    if (rotated.ok) {
      await repo.rotateRefresh({
        session,
        current: rotated.value.current,
        next: rotated.value.next,
      });
    }
    await repo.revokeSession(session.id, 'LOGOUT', now);
    expect(prisma.session.update).toHaveBeenCalled();
  });
});
