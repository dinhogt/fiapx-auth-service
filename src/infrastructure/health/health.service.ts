import { Inject, Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import type { AuthEnv } from '../config/env';
import { APP_ENV_CONFIG } from '../config/tokens';

export type DependencyCheck = {
  name: string;
  ok: boolean;
  detail?: string;
};

export type ReadyResult = {
  status: 'ok' | 'degraded';
  ready: boolean;
  checks: DependencyCheck[];
};

const CHECK_TIMEOUT_MS = 1500;

@Injectable()
export class HealthService {
  constructor(@Inject(APP_ENV_CONFIG) private readonly env: AuthEnv) {}

  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  async ready(): Promise<ReadyResult> {
    const checks = await Promise.all([this.checkPostgres(), this.checkRedis()]);
    const ready = checks.every((check) => check.ok);
    return {
      status: ready ? 'ok' : 'degraded',
      ready,
      checks,
    };
  }

  private async checkPostgres(): Promise<DependencyCheck> {
    const prisma = new PrismaClient({
      datasources: { db: { url: this.env.DATABASE_URL } },
    });
    try {
      await withTimeout(prisma.$queryRaw`SELECT 1`, CHECK_TIMEOUT_MS);
      return { name: 'postgres', ok: true };
    } catch (error) {
      return {
        name: 'postgres',
        ok: false,
        detail: error instanceof Error ? error.message : 'unavailable',
      };
    } finally {
      await prisma.$disconnect().catch(() => undefined);
    }
  }

  private async checkRedis(): Promise<DependencyCheck> {
    const redis = new Redis(this.env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: CHECK_TIMEOUT_MS,
      enableOfflineQueue: false,
    });
    try {
      await withTimeout(redis.connect(), CHECK_TIMEOUT_MS);
      await withTimeout(redis.ping(), CHECK_TIMEOUT_MS);
      return { name: 'redis', ok: true };
    } catch (error) {
      return {
        name: 'redis',
        ok: false,
        detail: error instanceof Error ? error.message : 'unavailable',
      };
    } finally {
      redis.disconnect();
    }
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
    timer.unref();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
