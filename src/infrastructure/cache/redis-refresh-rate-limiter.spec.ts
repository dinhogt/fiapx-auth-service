/* eslint-disable @typescript-eslint/require-await */
import { REFRESH_RATE_LIMIT, RedisRefreshRateLimiter } from './redis-refresh-rate-limiter';
import { RateLimitUnavailableError } from '../../domain/ports/refresh-rate-limiter';
import type { RedisService } from './redis.service';

describe('RedisRefreshRateLimiter', () => {
  it('allows up to the limit and blocks afterwards', async () => {
    let count = 0;
    const redis = {
      client: {
        incr: jest.fn(async () => {
          count += 1;
          return count;
        }),
        expire: jest.fn(async () => 1),
      },
    } as unknown as RedisService;
    const limiter = new RedisRefreshRateLimiter(redis);

    for (let i = 0; i < REFRESH_RATE_LIMIT; i += 1) {
      await expect(limiter.consume('1.1.1.1')).resolves.toBe('allow');
    }
    await expect(limiter.consume('1.1.1.1')).resolves.toBe('block');
  });

  it('throws when Redis fails', async () => {
    const redis = {
      client: {
        incr: jest.fn(async () => {
          throw new Error('down');
        }),
        expire: jest.fn(),
      },
    } as unknown as RedisService;
    await expect(new RedisRefreshRateLimiter(redis).consume('1.1.1.1')).rejects.toBeInstanceOf(
      RateLimitUnavailableError,
    );
  });
});
