/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/unbound-method */
import { RedisSessionRevocationStore } from './redis-session-revocation-store';
import { SessionRevocationStoreUnavailableError } from '../../domain/ports/session-revocation-store';
import type { AuthEnv } from '../config/env';
import type { RedisService } from './redis.service';

describe('RedisSessionRevocationStore', () => {
  const env = { ACCESS_TTL: 900 } as AuthEnv;

  it('sets and reads revoked:sid keys', async () => {
    const storeData = new Map<string, string>();
    const redis = {
      client: {
        set: jest.fn(async (key: string, value: string) => {
          storeData.set(key, value);
          return 'OK';
        }),
        get: jest.fn(async (key: string) => storeData.get(key) ?? null),
      },
    } as unknown as RedisService;
    const store = new RedisSessionRevocationStore(redis, env);

    await store.revoke('sid-1');
    expect(redis.client.set).toHaveBeenCalledWith('revoked:sid:sid-1', '1', 'EX', 900);
    await expect(store.isRevoked('sid-1')).resolves.toBe(true);
    await expect(store.isRevoked('sid-2')).resolves.toBe(false);
  });

  it('throws when Redis fails', async () => {
    const redis = {
      client: {
        set: jest.fn(async () => {
          throw new Error('down');
        }),
        get: jest.fn(async () => {
          throw new Error('down');
        }),
      },
    } as unknown as RedisService;
    const store = new RedisSessionRevocationStore(redis, env);
    await expect(store.revoke('sid')).rejects.toBeInstanceOf(SessionRevocationStoreUnavailableError);
    await expect(store.isRevoked('sid')).rejects.toBeInstanceOf(
      SessionRevocationStoreUnavailableError,
    );
  });

  it('maps non-Error Redis failures to a default message', async () => {
    const redis = {
      client: {
        set: jest.fn(async () => {
          // Simulate a non-Error rejection from the Redis client.
          // eslint-disable-next-line @typescript-eslint/only-throw-error
          throw 'down';
        }),
        get: jest.fn(async () => {
          // eslint-disable-next-line @typescript-eslint/only-throw-error
          throw 'down';
        }),
      },
    } as unknown as RedisService;
    const store = new RedisSessionRevocationStore(redis, env);
    await expect(store.revoke('sid')).rejects.toMatchObject({ message: 'Redis unavailable' });
    await expect(store.isRevoked('sid')).rejects.toMatchObject({ message: 'Redis unavailable' });
  });
});
