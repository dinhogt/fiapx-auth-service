import { Injectable } from '@nestjs/common';
import {
  type RateLimitDecision,
  RateLimitUnavailableError,
  type RefreshRateLimiter,
} from '../../domain/ports/refresh-rate-limiter';
import { RedisService } from './redis.service';

export const REFRESH_RATE_LIMIT = 20;
export const REFRESH_RATE_WINDOW_SECONDS = 60;

@Injectable()
export class RedisRefreshRateLimiter implements RefreshRateLimiter {
  constructor(private readonly redis: RedisService) {}

  async consume(ip: string): Promise<RateLimitDecision> {
    const key = `rl:refresh:ip:${ip}`;
    try {
      const count = await this.redis.client.incr(key);
      if (count === 1) {
        await this.redis.client.expire(key, REFRESH_RATE_WINDOW_SECONDS);
      }
      return count > REFRESH_RATE_LIMIT ? 'block' : 'allow';
    } catch (error: unknown) {
      throw new RateLimitUnavailableError(
        error instanceof Error ? error.message : 'Redis unavailable',
      );
    }
  }
}
