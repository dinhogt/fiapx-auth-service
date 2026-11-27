import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createRemoteJWKSet, jwtVerify, SignJWT } from 'jose';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { JwtKeyService } from '../../src/infrastructure/auth/jwt-key.service';
import { loadEnv } from '../../src/infrastructure/config/env';
import { ProblemDetailsFilter } from '../../src/interfaces/http/problem-details.filter';
import { createTestRsaPem } from '../helpers/rsa-pem';

describe('JWKS / OIDC discovery (F2.4 / D30)', () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let kid: string;

  beforeAll(async () => {
    const { pem, kid: generatedKid } = await createTestRsaPem();
    kid = generatedKid;

    process.env.NODE_ENV = 'test';
    process.env.APP_ENV = 'test';
    process.env.PORT = '3001';
    process.env.LOG_LEVEL = 'silent';
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ??
      'postgresql://auth_svc:change-me@localhost:5432/fiapx?schema=auth&connection_limit=5&sslmode=disable';
    process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
    process.env.AWS_REGION = 'us-east-1';
    process.env.OTEL_SERVICE_NAME = 'auth-service';
    process.env.JWT_ISSUER = 'http://127.0.0.1:0';
    process.env.JWT_AUDIENCE = 'fiapx-api';
    process.env.JWKS_URL = 'http://127.0.0.1:0/.well-known/jwks.json';
    process.env.TRUST_GATEWAY_IP = 'false';
    process.env.USER_EVENTS_TOPIC_ARN =
      'arn:aws:sns:us-east-1:000000000000:fiapx-local-user-events';
    process.env.JWT_PRIVATE_KEY_PEM = pem;
    process.env.JWT_KID = kid;

    // Placeholder issuer/jwks until listen assigns a port; reload after listen.
    const bootstrapEnv = loadEnv({
      ...process.env,
      JWT_ISSUER: 'http://127.0.0.1:3999',
      JWKS_URL: 'http://127.0.0.1:3999/.well-known/jwks.json',
    });

    app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(bootstrapEnv), {
      logger: false,
    });
    app.useGlobalFilters(new ProblemDetailsFilter());
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to bind HTTP server for JWKS integration test');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  }, 30_000);

  afterAll(async () => {
    await app?.close();
  });

  it('serves openid-configuration with issuer and jwks_uri', async () => {
    const response = await request(app.getHttpServer())
      .get('/.well-known/openid-configuration')
      .expect(200);

    const body = response.body as { issuer: string; jwks_uri: string };
    expect(body.issuer).toBeTruthy();
    expect(body.jwks_uri).toMatch(/\/.well-known\/jwks\.json$/);
  });

  it('publishes a JWKS that jose.createRemoteJWKSet can use to verify RS256', async () => {
    const jwksResponse = await request(app.getHttpServer())
      .get('/.well-known/jwks.json')
      .expect(200);

    const jwks = jwksResponse.body as {
      keys: Array<{ kid: string; kty: string; alg: string; use: string; n: string; e: string }>;
    };
    expect(jwks.keys).toHaveLength(1);
    expect(jwks.keys[0]).toEqual(
      expect.objectContaining({
        kid,
        kty: 'RSA',
        alg: 'RS256',
        use: 'sig',
      }),
    );
    expect(jwks.keys[0]?.n).toBeTruthy();
    expect(jwks.keys[0]).not.toHaveProperty('d');

    const JWKS = createRemoteJWKSet(new URL(`${baseUrl}/.well-known/jwks.json`));
    const jwtKeys = app.get(JwtKeyService);
    const issuer = 'http://127.0.0.1:3999';
    const token = await new SignJWT({ sub: '11111111-1111-4111-8111-111111111111', sid: 's1' })
      .setProtectedHeader({ alg: 'RS256', kid })
      .setIssuer(issuer)
      .setAudience('fiapx-api')
      .setJti('22222222-2222-4222-8222-222222222222')
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(jwtKeys.getPrivateKey());

    const { payload, protectedHeader } = await jwtVerify(token, JWKS, {
      issuer,
      audience: 'fiapx-api',
    });

    expect(protectedHeader.kid).toBe(kid);
    expect(protectedHeader.alg).toBe('RS256');
    expect(payload.sub).toBe('11111111-1111-4111-8111-111111111111');
  }, 30_000);
});
