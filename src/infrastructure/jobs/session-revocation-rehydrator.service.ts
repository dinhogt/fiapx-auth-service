import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { SessionRevocationStore } from '../../domain/ports/session-revocation-store';
import { SessionRevocationStoreUnavailableError } from '../../domain/ports/session-revocation-store';
import type { AuthEnv } from '../config/env';
import { APP_ENV_CONFIG, SESSION_REVOCATION_STORE } from '../config/tokens';
import { PrismaService } from '../prisma/prisma.service';
import { ADVISORY_LOCK_KEYS, advisoryUnlock, tryAdvisoryLock } from './advisory-lock';

const REHYDRATE_INTERVAL_MS = 60_000;

@Injectable()
export class SessionRevocationRehydratorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SessionRevocationRehydratorService.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(SESSION_REVOCATION_STORE) private readonly revocation: SessionRevocationStore,
    @Inject(APP_ENV_CONFIG) private readonly env: AuthEnv,
  ) {}

  onModuleInit(): void {
    // Integration suites call rehydrate() explicitly to avoid cross-suite timer races.
    if (this.env.APP_ENV === 'test' || this.env.NODE_ENV === 'test') {
      return;
    }
    void this.rehydrate();
    this.timer = setInterval(() => {
      void this.rehydrate();
    }, REHYDRATE_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async rehydrate(): Promise<void> {
    if (this.stopped) {
      return;
    }

    const locked = await tryAdvisoryLock(
      this.prisma,
      ADVISORY_LOCK_KEYS.SESSION_REVOCATION_REHYDRATE,
    );
    if (!locked) {
      return;
    }

    try {
      const since = new Date(Date.now() - this.env.ACCESS_TTL * 1000);
      const sessions = await this.prisma.session.findMany({
        where: {
          revokedAt: { gte: since },
        },
        select: { id: true },
      });

      for (const session of sessions) {
        try {
          await this.revocation.revoke(session.id);
        } catch (error: unknown) {
          if (error instanceof SessionRevocationStoreUnavailableError) {
            this.logger.warn('Revocation rehydrate skipped: Redis unavailable');
            return;
          }
          throw error;
        }
      }
    } finally {
      try {
        await advisoryUnlock(this.prisma, ADVISORY_LOCK_KEYS.SESSION_REVOCATION_REHYDRATE);
      } catch {
        // Best-effort unlock during shutdown/teardown.
      }
    }
  }
}
