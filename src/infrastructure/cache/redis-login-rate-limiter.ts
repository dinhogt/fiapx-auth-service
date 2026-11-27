import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  type LoginRateLimiter,
  type RateLimitDecision,
  RateLimitUnavailableError,
} from '../../domain/ports/login-rate-limiter';
import { RedisService } from './redis.service';

export const LOGIN_RATE_LIMIT = 5;
export const LOGIN_RATE_WINDOW_SECONDS = 60;

@Injectable()
export class RedisLoginRateLimiter implements LoginRateLimiter {
  constructor(private readonly redis: RedisService) {}

  async consume(email: string, ip: string): Promise<RateLimitDecision> {
    const emailKey = `rl:login:email:${sha256(email)}`;
    const ipKey = `rl:login:ip:${ip}`;

    try {
      const [emailCount, ipCount] = await Promise.all([this.hit(emailKey), this.hit(ipKey)]);
      if (emailCount > LOGIN_RATE_LIMIT || ipCount > LOGIN_RATE_LIMIT) {
        return 'block';
      }
      return 'allow';
    } catch (error: unknown) {
      throw new RateLimitUnavailableError(
        error instanceof Error ? error.message : 'Redis unavailable',
      );
    }
  }

  private async hit(key: string): Promise<number> {
    const count = await this.redis.client.incr(key);
    if (count === 1) {
      await this.redis.client.expire(key, LOGIN_RATE_WINDOW_SECONDS);
    }
    return count;
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
