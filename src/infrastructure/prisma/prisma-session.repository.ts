import { Injectable } from '@nestjs/common';
import type { SessionRepository } from '../../domain/ports/session-repository';
import type { RefreshToken } from '../../domain/refresh-token';
import type { Session } from '../../domain/session';
import { PrismaService } from './prisma.service';

@Injectable()
export class PrismaSessionRepository implements SessionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createWithRefresh(session: Session, refresh: RefreshToken): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.session.create({
        data: {
          id: session.id,
          userId: session.userId,
          createdAt: session.createdAt,
          lastUsedAt: session.lastUsedAt,
          idleExpiresAt: session.idleExpiresAt,
          absoluteExpiresAt: session.absoluteExpiresAt,
        },
      });
      await tx.refreshToken.create({
        data: {
          id: refresh.id,
          sessionId: refresh.sessionId,
          tokenHash: refresh.tokenHash,
          issuedAt: refresh.issuedAt,
          expiresAt: refresh.expiresAt,
        },
      });
    });
  }
}
