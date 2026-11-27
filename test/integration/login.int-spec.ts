import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '@prisma/client';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { loadEnv } from '../../src/infrastructure/config/env';
import { ProblemDetailsFilter } from '../../src/interfaces/http/problem-details.filter';
import { createTestRsaPem } from '../helpers/rsa-pem';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://auth_svc:change-me@localhost:5432/fiapx?schema=auth&connection_limit=5&sslmode=disable';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

async function bootApp(overrides: Record<string, string> = {}): Promise<{
  app: NestExpressApplication;
  baseUrl: string;
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
    ...overrides,
  });

  const env = loadEnv();
  const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
  await prisma.$connect();

  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(env), {
    logger: false,
  });
  app.useGlobalFilters(new ProblemDetailsFilter());
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind HTTP server');
  }
  return { app, baseUrl: `http://127.0.0.1:${address.port}`, prisma };
}

describe('POST /auth/login (AC-12, F2.5)', () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let prisma: PrismaClient;

  beforeAll(async () => {
    ({ app, baseUrl, prisma } = await bootApp());
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
  }, 30_000);

  it('AC-12: wrong password returns 401; 6th attempt returns 429', async () => {
    const email = `login-${randomUUID()}@example.com`;
    const password = 'Str0ng-Passw0rd!';
    const clientIp = `login-ac12-${randomUUID()}`;

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ name: 'Ana', email, password })
      .expect(201);

    for (let i = 0; i < 5; i += 1) {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .set('x-client-ip', clientIp)
        .send({ email, password: 'wrong-password!!' })
        .expect(401);
      const problem = response.body as { status: number; detail: string };
      expect(problem.status).toBe(401);
      expect(problem.detail).toMatch(/credenciais/i);
      expect(problem.detail.toLowerCase()).not.toMatch(/senha|email|usuário|usuario/);
    }

    const limited = await request(app.getHttpServer())
      .post('/auth/login')
      .set('x-client-ip', clientIp)
      .send({ email, password: 'wrong-password!!' })
      .expect(429);
    expect((limited.body as { status: number }).status).toBe(429);
  }, 60_000);

  it('returns TokenPair with a JWKS-verifiable access token on success', async () => {
    const email = `ok-${randomUUID()}@example.com`;
    const password = 'Str0ng-Passw0rd!';
    const clientIp = `login-ok-${randomUUID()}`;

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ name: 'Ana', email, password })
      .expect(201);

    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .set('x-client-ip', clientIp)
      .send({ email, password })
      .expect(200);

    const body = response.body as {
      accessToken: string;
      tokenType: string;
      expiresIn: number;
      refreshToken: string;
      refreshExpiresIn: number;
    };
    expect(body.tokenType).toBe('Bearer');
    expect(body.expiresIn).toBe(900);
    expect(body.refreshExpiresIn).toBe(3600);
    expect(body.refreshToken.length).toBeGreaterThan(20);

    const JWKS = createRemoteJWKSet(new URL(`${baseUrl}/.well-known/jwks.json`));
    const { payload, protectedHeader } = await jwtVerify(body.accessToken, JWKS, {
      issuer: 'http://127.0.0.1:3999',
      audience: 'fiapx-api',
    });
    expect(protectedHeader.alg).toBe('RS256');
    expect(protectedHeader.kid).toBeTruthy();
    expect(payload.sub).toBeTruthy();
    expect(payload.sid).toBeTruthy();

    const sessions = await prisma.session.findMany({ where: { userId: String(payload.sub) } });
    expect(sessions).toHaveLength(1);
  }, 60_000);

  it('returns 503 when Redis is unavailable (fail-closed)', async () => {
    const down = await bootApp({ REDIS_URL: 'redis://127.0.0.1:1' });
    try {
      const email = `redis-down-${randomUUID()}@example.com`;
      await request(down.app.getHttpServer())
        .post('/auth/register')
        .send({ name: 'Ana', email, password: 'Str0ng-Passw0rd!' })
        .expect(201);

      const response = await request(down.app.getHttpServer())
        .post('/auth/login')
        .set('x-client-ip', '203.0.113.250')
        .send({ email, password: 'Str0ng-Passw0rd!' })
        .expect(503);
      expect((response.body as { status: number }).status).toBe(503);
    } finally {
      await down.app.close();
      await down.prisma.$disconnect();
    }
  }, 60_000);
});
