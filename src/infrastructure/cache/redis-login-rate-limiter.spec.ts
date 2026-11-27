/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/unbound-method */
import {
  LOGIN_RATE_LIMIT,
  RedisLoginRateLimiter,
} from './redis-login-rate-limiter';
import { RateLimitUnavailableError } from '../../domain/ports/login-rate-limiter';
import type { RedisService } from './redis.service';

describe('RedisLoginRateLimiter', () => {
  it('allows up to the limit and blocks afterwards', async () => {
    const counts = new Map<string, number>();
    const redis = {
      client: {
        incr: jest.fn(async (key: string) => {
          const next = (counts.get(key) ?? 0) + 1;
          counts.set(key, next);
          return next;
        }),
        expire: jest.fn(async () => 1),
      },
    } as unknown as RedisService;
    const limiter = new RedisLoginRateLimiter(redis);

    for (let i = 0; i < LOGIN_RATE_LIMIT; i += 1) {
      await expect(limiter.consume('a@example.com', '1.1.1.1')).resolves.toBe('allow');
    }
    await expect(limiter.consume('a@example.com', '1.1.1.1')).resolves.toBe('block');
    expect(redis.client.expire).toHaveBeenCalled();
  });

  it('throws RateLimitUnavailableError when Redis fails', async () => {
    const redis = {
      client: {
        incr: jest.fn(async () => {
          throw new Error('ECONNREFUSED');
        }),
        expire: jest.fn(),
      },
    } as unknown as RedisService;
    const limiter = new RedisLoginRateLimiter(redis);
    await expect(limiter.consume('a@example.com', '1.1.1.1')).rejects.toBeInstanceOf(
      RateLimitUnavailableError,
    );
  });
});
