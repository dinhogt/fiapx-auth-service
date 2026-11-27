/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/unbound-method */
import { OutboxRelayService } from './outbox-relay.service';
import type { MessagePublisher } from '../../domain/ports/message-publisher';
import type { PrismaService } from '../prisma/prisma.service';

describe('OutboxRelayService', () => {
  it('publishes pending rows and marks them published', async () => {
    const row = {
      id: '11111111-1111-4111-8111-111111111111',
      type: 'user.registered',
      destination: 'arn:aws:sns:us-east-1:000000000000:fiapx-local-user-events',
      payload: { type: 'user.registered' },
    };
    const update = jest.fn(async () => undefined);
    const prisma = {
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<void>) =>
        fn({
          $queryRaw: jest.fn(async () => [row]),
          outbox: { update },
        }),
      ),
    } as unknown as PrismaService;
    const publisher: MessagePublisher = {
      publish: jest.fn(async () => undefined),
    };
    const relay = new OutboxRelayService(prisma, publisher, {
      APP_ENV: 'test',
      NODE_ENV: 'test',
    } as never);

    await relay.drain();

    expect(publisher.publish).toHaveBeenCalledWith({
      destination: row.destination,
      type: row.type,
      body: row.payload,
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: row.id },
      data: {
        publishedAt: expect.any(Date) as Date,
        lastError: null,
      },
    });
  });

  it('increments attempts when publish fails', async () => {
    const row = {
      id: '11111111-1111-4111-8111-111111111111',
      type: 'user.registered',
      destination: 'arn:topic',
      payload: {},
    };
    const update = jest.fn(async () => undefined);
    const prisma = {
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<void>) =>
        fn({
          $queryRaw: jest.fn(async () => [row]),
          outbox: { update },
        }),
      ),
    } as unknown as PrismaService;
    const publisher: MessagePublisher = {
      publish: jest.fn(async () => {
        throw new Error('sns down');
      }),
    };
    const relay = new OutboxRelayService(prisma, publisher, {
      APP_ENV: 'test',
      NODE_ENV: 'test',
    } as never);
    await relay.drain();
    expect(update).toHaveBeenCalledWith({
      where: { id: row.id },
      data: { attempts: { increment: 1 }, lastError: 'sns down' },
    });
  });
});
