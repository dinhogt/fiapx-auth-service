import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { loadEnv } from '../../src/infrastructure/config/env';
import { SessionRevocationRehydratorService } from '../../src/infrastructure/jobs/session-revocation-rehydrator.service';
import { ProblemDetailsFilter } from '../../src/interfaces/http/problem-details.filter';
import { applyIntegrationEnv } from '../helpers/integration-infra';
import { createTestRsaPem } from '../helpers/rsa-pem';

async function bootApp(): Promise<{
  app: NestExpressApplication;
  prisma: PrismaClient;
}> {
  const { pem, kid } = await createTestRsaPem();
  const infra = await applyIntegrationEnv({
    NODE_ENV: 'test',
    APP_ENV: 'test',
    PORT: '3001',
    LOG_LEVEL: 'silent',
    OTEL_SERVICE_NAME: 'auth-service',
    JWT_ISSUER: 'http://127.0.0.1:3999',
    JWT_AUDIENCE: 'fiapx-api',
    JWKS_URL: 'http://127.0.0.1:3999/.well-known/jwks.json',
    TRUST_GATEWAY_IP: 'true',
    JWT_PRIVATE_KEY_PEM: pem,
    JWT_KID: kid,
    ACCESS_TTL: '900',
    REFRESH_IDLE_TTL: '3600',
    SESSION_ABSOLUTE_TTL: '28800',
  });

  const env = loadEnv();
  const prisma = new PrismaClient({ datasources: { db: { url: infra.databaseUrl } } });
  await prisma.$connect();

  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(env), {
    logger: false,
  });
  app.useGlobalFilters(new ProblemDetailsFilter());
  await app.init();
  return { app, prisma };
}

describe('Session revocation rehydration (F2.8)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let redis: Redis;

  beforeAll(async () => {
    ({ app, prisma } = await bootApp());
    redis = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: 1, lazyConnect: true });
    await redis.connect();
  }, 180_000);

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

  it('rehydrates revoked:sid from Postgres into Redis', async () => {
    const email = `rehydrate-${randomUUID()}@example.com`;
    const password = 'Str0ng-Passw0rd!';
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ name: 'Ana', email, password })
      .expect(201);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .set('x-client-ip', '203.0.113.50')
      .send({ email, password })
      .expect(200);

    const accessToken = (login.body as { accessToken: string }).accessToken;
    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(204);

    const session = await prisma.session.findFirstOrThrow();
    await redis.del(`revoked:sid:${session.id}`);
    await expect(redis.get(`revoked:sid:${session.id}`)).resolves.toBeNull();

    await app.get(SessionRevocationRehydratorService).rehydrate();

    await expect(redis.get(`revoked:sid:${session.id}`)).resolves.toBe('1');
  }, 180_000);
});
