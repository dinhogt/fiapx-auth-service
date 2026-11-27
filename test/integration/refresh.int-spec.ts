import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { SECURITY_EVENT_RECORDER } from '../../src/infrastructure/config/tokens';
import type { SecurityEventRecorder } from '../../src/domain/ports/security-event-recorder';
import { loadEnv } from '../../src/infrastructure/config/env';
import { ProblemDetailsFilter } from '../../src/interfaces/http/problem-details.filter';
import { createTestRsaPem } from '../helpers/rsa-pem';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://auth_svc:change-me@localhost:5432/fiapx?schema=auth&connection_limit=5&sslmode=disable';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

type TokenPair = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresIn: number;
  tokenType: string;
};

async function bootApp(): Promise<{
  app: NestExpressApplication;
  prisma: PrismaClient;
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
    OTEL_SERVICE_NAME: 'auth-service',
    JWT_ISSUER: 'http://127.0.0.1:3999',
    JWT_AUDIENCE: 'fiapx-api',
    JWKS_URL: 'http://127.0.0.1:3999/.well-known/jwks.json',
    TRUST_GATEWAY_IP: 'true',
    USER_EVENTS_TOPIC_ARN: 'arn:aws:sns:us-east-1:000000000000:fiapx-local-user-events',
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
  return { app, prisma };
}

async function registerAndLogin(app: NestExpressApplication, clientIp: string): Promise<TokenPair> {
  const email = `refresh-${randomUUID()}@example.com`;
  const password = 'Str0ng-Passw0rd!';
  await request(app.getHttpServer())
    .post('/auth/register')
    .send({ name: 'Ana', email, password })
    .expect(201);
  const login = await request(app.getHttpServer())
    .post('/auth/login')
    .set('x-client-ip', clientIp)
    .send({ email, password })
    .expect(200);
  return login.body as TokenPair;
}

describe('POST /auth/refresh (AC-14, AC-15, AC-16)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let redis: Redis;

  beforeAll(async () => {
    ({ app, prisma } = await bootApp());
    redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: true });
    await redis.connect();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
    await redis?.quit().catch(() => undefined);
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

  it('AC-14: rotates refresh token and invalidates the previous one', async () => {
    const clientIp = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
    const tokens = await registerAndLogin(app, clientIp);

    const refreshed = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('x-client-ip', clientIp)
      .send({ refreshToken: tokens.refreshToken })
      .expect(200);

    const next = refreshed.body as TokenPair;
    expect(next.refreshToken).not.toBe(tokens.refreshToken);
    expect(next.accessToken).not.toBe(tokens.accessToken);

    const { createHash } = await import('node:crypto');
    const oldHash = createHash('sha256').update(tokens.refreshToken, 'utf8').digest('hex');
    const oldRow = await prisma.refreshToken.findUniqueOrThrow({ where: { tokenHash: oldHash } });
    expect(oldRow.usedAt).not.toBeNull();
    expect(oldRow.replacedById).not.toBeNull();

    // New refresh still works (do not re-present the old token here — that is AC-15 reuse).
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('x-client-ip', clientIp)
      .send({ refreshToken: next.refreshToken })
      .expect(200);
  }, 60_000);

  it('AC-15: reuse revokes sid, sets revoked:sid and records security event', async () => {
    const clientIp = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
    const tokens = await registerAndLogin(app, clientIp);

    const firstRefresh = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('x-client-ip', clientIp)
      .send({ refreshToken: tokens.refreshToken })
      .expect(200);
    const next = firstRefresh.body as TokenPair;

    const security = app.get<SecurityEventRecorder>(SECURITY_EVENT_RECORDER);
    const spy = jest.spyOn(security, 'record');

    await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('x-client-ip', clientIp)
      .send({ refreshToken: tokens.refreshToken })
      .expect(401);

    const session = await prisma.session.findFirstOrThrow();
    expect(session.revokedAt).not.toBeNull();
    expect(session.revokedReason).toBe('REFRESH_REUSE');

    const redisFlag = await redis.get(`revoked:sid:${session.id}`);
    expect(redisFlag).toBe('1');

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'security.refresh_reuse',
        sid: session.id,
      }),
    );

    await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('x-client-ip', clientIp)
      .send({ refreshToken: next.refreshToken })
      .expect(401);

    spy.mockRestore();
  }, 60_000);

  it('AC-16: idle or absolute expired session returns 401', async () => {
    const clientIpIdle = `192.0.2.${Math.floor(Math.random() * 200) + 1}`;
    const tokensIdle = await registerAndLogin(app, clientIpIdle);
    const sessionIdle = await prisma.session.findFirstOrThrow({
      orderBy: { createdAt: 'desc' },
    });

    await prisma.session.update({
      where: { id: sessionIdle.id },
      data: { idleExpiresAt: new Date('2020-01-01T00:00:00.000Z') },
    });

    await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('x-client-ip', clientIpIdle)
      .send({ refreshToken: tokensIdle.refreshToken })
      .expect(401);

    const clientIpAbs = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
    const tokensAbs = await registerAndLogin(app, clientIpAbs);
    const sessionAbs = await prisma.session.findFirstOrThrow({
      orderBy: { createdAt: 'desc' },
    });
    await prisma.session.update({
      where: { id: sessionAbs.id },
      data: { absoluteExpiresAt: new Date('2020-01-01T00:00:00.000Z') },
    });

    await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('x-client-ip', clientIpAbs)
      .send({ refreshToken: tokensAbs.refreshToken })
      .expect(401);
  }, 60_000);
});
