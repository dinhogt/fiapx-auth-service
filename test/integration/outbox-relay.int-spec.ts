import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DeleteMessageCommand, ReceiveMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { loadEnv } from '../../src/infrastructure/config/env';
import { OutboxRelayService } from '../../src/infrastructure/messaging/outbox-relay.service';
import { ProblemDetailsFilter } from '../../src/interfaces/http/problem-details.filter';
import { createTestRsaPem } from '../helpers/rsa-pem';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://auth_svc:change-me@localhost:5432/fiapx?schema=auth&connection_limit=5&sslmode=disable';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const AWS_ENDPOINT = process.env.AWS_ENDPOINT ?? 'http://localhost:4566';
const USER_CONTACTS_QUEUE_URL =
  process.env.USER_CONTACTS_QUEUE_URL ?? `${AWS_ENDPOINT}/000000000000/fiapx-local-user-contacts`;
const TOPIC_ARN =
  process.env.USER_EVENTS_TOPIC_ARN ?? 'arn:aws:sns:us-east-1:000000000000:fiapx-local-user-events';

async function bootApp(): Promise<{
  app: NestExpressApplication;
  prisma: PrismaClient;
  sqs: SQSClient;
}> {
  const { pem, kid } = await createTestRsaPem();
  Object.assign(process.env, {
    NODE_ENV: 'test',
    APP_ENV: 'test',
    PORT: '3001',
    LOG_LEVEL: 'silent',
    DATABASE_URL,
    REDIS_URL,
    AWS_REGION: 'us-east-1',
    AWS_ENDPOINT,
    AWS_ACCESS_KEY_ID: 'test',
    AWS_SECRET_ACCESS_KEY: 'test',
    OTEL_SERVICE_NAME: 'auth-service',
    JWT_ISSUER: 'http://127.0.0.1:3999',
    JWT_AUDIENCE: 'fiapx-api',
    JWKS_URL: 'http://127.0.0.1:3999/.well-known/jwks.json',
    TRUST_GATEWAY_IP: 'false',
    USER_EVENTS_TOPIC_ARN: TOPIC_ARN,
    JWT_PRIVATE_KEY_PEM: pem,
    JWT_KID: kid,
    ACCESS_TTL: '900',
    REFRESH_IDLE_TTL: '3600',
    SESSION_ABSOLUTE_TTL: '28800',
  });

  const env = loadEnv();
  const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
  await prisma.$connect();

  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(env), {
    logger: false,
  });
  app.useGlobalFilters(new ProblemDetailsFilter());
  await app.init();

  const sqs = new SQSClient({
    region: 'us-east-1',
    endpoint: AWS_ENDPOINT,
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  });

  return { app, prisma, sqs };
}

async function drainQueue(sqs: SQSClient): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    const received = await sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: USER_CONTACTS_QUEUE_URL,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 0,
      }),
    );
    const messages = received.Messages ?? [];
    if (messages.length === 0) {
      return;
    }
    for (const message of messages) {
      if (message.ReceiptHandle) {
        await sqs.send(
          new DeleteMessageCommand({
            QueueUrl: USER_CONTACTS_QUEUE_URL,
            ReceiptHandle: message.ReceiptHandle,
          }),
        );
      }
    }
  }
}

async function waitForUserRegistered(
  sqs: SQSClient,
  userId: string,
  timeoutMs = 10_000,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const received = await sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: USER_CONTACTS_QUEUE_URL,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 1,
      }),
    );
    for (const message of received.Messages ?? []) {
      const body = JSON.parse(message.Body ?? '{}') as {
        type?: string;
        payload?: { userId?: string };
      };
      if (message.ReceiptHandle) {
        await sqs.send(
          new DeleteMessageCommand({
            QueueUrl: USER_CONTACTS_QUEUE_URL,
            ReceiptHandle: message.ReceiptHandle,
          }),
        );
      }
      if (body.type === 'user.registered' && body.payload?.userId === userId) {
        return body;
      }
    }
  }
  throw new Error(`Timed out waiting for user.registered for ${userId}`);
}

describe('Outbox relay → SNS → user-contacts (F2.8)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let sqs: SQSClient;

  beforeAll(async () => {
    ({ app, prisma, sqs } = await bootApp());
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  afterEach(async () => {
    if (!prisma) {
      return;
    }
    await prisma.refreshToken.deleteMany();
    await prisma.session.deleteMany();
    await prisma.outbox.deleteMany();
    await prisma.user.deleteMany();
  });

  it('publishes user.registered from outbox into the user-contacts queue', async () => {
    await drainQueue(sqs);

    const email = `relay-${randomUUID()}@example.com`;
    const created = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ name: 'Ana', email, password: 'Str0ng-Passw0rd!' })
      .expect(201);

    const body = created.body as { id: string };
    const userId = body.id;
    await app.get(OutboxRelayService).drain();

    const envelope = await waitForUserRegistered(sqs, userId);
    expect(envelope).toMatchObject({
      type: 'user.registered',
      source: 'auth-service',
      payload: {
        userId,
        email,
        name: 'Ana',
      },
    });

    const outbox = await prisma.outbox.findFirstOrThrow({ where: { aggregateId: userId } });
    expect(outbox.publishedAt).not.toBeNull();
    expect(outbox.attempts).toBe(0);
  }, 60_000);
});
