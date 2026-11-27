import { Inject, Injectable } from '@nestjs/common';
import {
  type SessionRevocationStore,
  SessionRevocationStoreUnavailableError,
} from '../../domain/ports/session-revocation-store';
import type { AuthEnv } from '../config/env';
import { APP_ENV_CONFIG } from '../config/tokens';
import { RedisService } from './redis.service';

@Injectable()
export class RedisSessionRevocationStore implements SessionRevocationStore {
  constructor(
    private readonly redis: RedisService,
    @Inject(APP_ENV_CONFIG) private readonly env: AuthEnv,
  ) {}

  async revoke(sid: string): Promise<void> {
    try {
      await this.redis.client.set(`revoked:sid:${sid}`, '1', 'EX', this.env.ACCESS_TTL);
    } catch (error: unknown) {
      throw new SessionRevocationStoreUnavailableError(
        error instanceof Error ? error.message : 'Redis unavailable',
      );
    }
  }

  async isRevoked(sid: string): Promise<boolean> {
    try {
      const value = await this.redis.client.get(`revoked:sid:${sid}`);
      return value !== null;
    } catch (error: unknown) {
      throw new SessionRevocationStoreUnavailableError(
        error instanceof Error ? error.message : 'Redis unavailable',
      );
    }
  }
}
