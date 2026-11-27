import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { loadEnv } from '../../src/infrastructure/config/env';
import { ProblemDetailsFilter } from '../../src/interfaces/http/problem-details.filter';
import { AUTH_PROTECTED_ROUTES, AUTH_PUBLIC_ROUTES } from '../../src/interfaces/http/public-routes';
import { applyIntegrationEnv } from '../helpers/integration-infra';
import { createTestRsaPem } from '../helpers/rsa-pem';

type TokenPair = {
  accessToken: string;
  refreshToken: string;
};

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

async function registerAndLogin(
  app: NestExpressApplication,
  clientIp: string,
): Promise<{ tokens: TokenPair; email: string; password: string }> {
  const email = `logout-${randomUUID()}@example.com`;
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
  return { tokens: login.body as TokenPair, email, password };
}

describe('POST /auth/logout + GET /auth/me (AC-17, V4.2)', () => {
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

  it('AC-17: after logout the access token is rejected on protected routes', async () => {
    const clientIp = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
    const { tokens } = await registerAndLogin(app, clientIp);

    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .expect(200)
      .expect((res) => {
        expect(res.body).toEqual(
          expect.objectContaining({
            name: 'Ana',
            email: expect.stringContaining('@') as string,
          }),
        );
      });

    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .expect(204);

    const session = await prisma.session.findFirstOrThrow();
    expect(session.revokedAt).not.toBeNull();
    expect(session.revokedReason).toBe('LOGOUT');
    expect(await redis.get(`revoked:sid:${session.id}`)).toBe('1');

    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .expect(401);
  }, 180_000);

  it('V4.2: only documented public routes accept unauthenticated calls', async () => {
    for (const route of AUTH_PROTECTED_ROUTES) {
      const [method, path] = route.split(' ') as ['GET' | 'POST', string];
      const req =
        method === 'GET'
          ? request(app.getHttpServer()).get(path)
          : request(app.getHttpServer()).post(path);
      await req.expect(401);
    }

    for (const route of AUTH_PUBLIC_ROUTES) {
      const [method, path] = route.split(' ') as ['GET' | 'POST', string];
      const req =
        method === 'GET'
          ? request(app.getHttpServer()).get(path)
          : request(app.getHttpServer()).post(path).send({});
      const response = await req;
      expect(response.status).not.toBe(401);
    }
  }, 180_000);
});
