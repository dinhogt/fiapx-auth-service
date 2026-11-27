import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { loadEnv } from '../../src/infrastructure/config/env';
import { ProblemDetailsFilter } from '../../src/interfaces/http/problem-details.filter';
import { applyIntegrationEnv } from '../helpers/integration-infra';
import { createTestRsaPem } from '../helpers/rsa-pem';

describe('POST /auth/register (AC-10, AC-11)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { pem, kid } = await createTestRsaPem();
    const infra = await applyIntegrationEnv({
      NODE_ENV: 'test',
      APP_ENV: 'test',
      PORT: '3001',
      LOG_LEVEL: 'silent',
      OTEL_SERVICE_NAME: 'auth-service',
      JWT_ISSUER: 'http://localhost:3001',
      JWT_AUDIENCE: 'fiapx-api',
      JWKS_URL: 'http://localhost:3001/.well-known/jwks.json',
      TRUST_GATEWAY_IP: 'false',
      JWT_PRIVATE_KEY_PEM: pem,
      JWT_KID: kid,
    });

    const env = loadEnv();
    prisma = new PrismaClient({ datasources: { db: { url: infra.databaseUrl } } });
    await prisma.$connect();
    app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(env), {
      logger: false,
    });
    app.useGlobalFilters(new ProblemDetailsFilter());
    await app.init();
  }, 120_000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    if (prisma) {
      await prisma.$disconnect();
    }
  });

  afterEach(async () => {
    if (!prisma) {
      return;
    }
    await prisma.outbox.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
  });

  it('AC-10: creates user with argon2id hash and outbox user.registered', async () => {
    const email = `ac10-${randomUUID()}@example.com`;
    const password = 'Str0ng-Passw0rd!';

    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ name: 'Ana Silva', email, password })
      .expect(201);

    const body = response.body as {
      id: string;
      name: string;
      email: string;
      createdAt: string;
      password?: unknown;
      passwordHash?: unknown;
    };
    expect(typeof body.id).toBe('string');
    expect(body.name).toBe('Ana Silva');
    expect(body.email).toBe(email.toLowerCase());
    expect(typeof body.createdAt).toBe('string');
    expect(body.password).toBeUndefined();
    expect(body.passwordHash).toBeUndefined();

    const user = await prisma.user.findUniqueOrThrow({ where: { email: email.toLowerCase() } });
    expect(user.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(user.passwordHash).toMatch(/m=19456/);
    await expect(argon2.verify(user.passwordHash, password)).resolves.toBe(true);

    const outbox = await prisma.outbox.findMany({ where: { aggregateId: user.id } });
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.type).toBe('user.registered');
    expect(outbox[0]?.destination).toBe(process.env.USER_EVENTS_TOPIC_ARN);
    expect(outbox[0]?.publishedAt).toBeNull();
    const payload = outbox[0]?.payload as {
      type: string;
      payload: { userId: string; email: string; name: string };
    };
    expect(payload.type).toBe('user.registered');
    expect(payload.payload).toEqual(
      expect.objectContaining({
        userId: user.id,
        email: email.toLowerCase(),
        name: 'Ana Silva',
      }),
    );
  }, 120_000);

  it('AC-11: returns 409 when email is already registered', async () => {
    const email = `ac11-${randomUUID()}@example.com`;
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ name: 'Ana', email, password: 'Str0ng-Passw0rd!' })
      .expect(201);

    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ name: 'Ana Outra', email, password: 'Another-Str0ng!' })
      .expect(409);

    const problem = response.body as { status: number; detail: string };
    expect(response.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(problem.status).toBe(409);
    expect(problem.detail).toMatch(/e-mail/i);

    const users = await prisma.user.findMany({ where: { email: email.toLowerCase() } });
    expect(users).toHaveLength(1);
    const outbox = await prisma.outbox.findMany({ where: { aggregateId: users[0]?.id } });
    expect(outbox).toHaveLength(1);
  }, 120_000);
});
