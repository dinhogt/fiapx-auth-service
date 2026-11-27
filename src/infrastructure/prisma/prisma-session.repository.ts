import { Injectable } from '@nestjs/common';
import type {
  RefreshWithSession,
  SessionRepository,
} from '../../domain/ports/session-repository';
import { RefreshToken } from '../../domain/refresh-token';
import { Session, type SessionRevokedReason } from '../../domain/session';
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

  async findById(sessionId: string): Promise<Session | null> {
    const row = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!row) {
      return null;
    }
    return Session.rehydrate({
      id: row.id,
      userId: row.userId,
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt,
      idleExpiresAt: row.idleExpiresAt,
      absoluteExpiresAt: row.absoluteExpiresAt,
      revokedAt: row.revokedAt,
      revokedReason: row.revokedReason,
    });
  }

  async findRefreshWithSessionByHash(tokenHash: string): Promise<RefreshWithSession | null> {
    const row = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { session: true },
    });
    if (!row) {
      return null;
    }
    return {
      refresh: RefreshToken.rehydrate({
        id: row.id,
        sessionId: row.sessionId,
        tokenHash: row.tokenHash,
        issuedAt: row.issuedAt,
        expiresAt: row.expiresAt,
        usedAt: row.usedAt,
        replacedById: row.replacedById,
      }),
      session: Session.rehydrate({
        id: row.session.id,
        userId: row.session.userId,
        createdAt: row.session.createdAt,
        lastUsedAt: row.session.lastUsedAt,
        idleExpiresAt: row.session.idleExpiresAt,
        absoluteExpiresAt: row.session.absoluteExpiresAt,
        revokedAt: row.session.revokedAt,
        revokedReason: row.session.revokedReason,
      }),
    };
  }

  async rotateRefresh(params: {
    session: Session;
    current: RefreshToken;
    next: RefreshToken;
  }): Promise<void> {
    const { session, current, next } = params;
    await this.prisma.$transaction(async (tx) => {
      await tx.session.update({
        where: { id: session.id },
        data: {
          lastUsedAt: session.lastUsedAt,
          idleExpiresAt: session.idleExpiresAt,
        },
      });
      await tx.refreshToken.create({
        data: {
          id: next.id,
          sessionId: next.sessionId,
          tokenHash: next.tokenHash,
          issuedAt: next.issuedAt,
          expiresAt: next.expiresAt,
        },
      });
      await tx.refreshToken.update({
        where: { id: current.id },
        data: {
          usedAt: current.usedAt,
          replacedById: current.replacedById,
        },
      });
    });
  }

  async revokeSession(
    sessionId: string,
    reason: SessionRevokedReason,
    at: Date,
  ): Promise<void> {
    await this.prisma.session.update({
      where: { id: sessionId },
      data: {
        revokedAt: at,
        revokedReason: reason,
      },
    });
  }
}
