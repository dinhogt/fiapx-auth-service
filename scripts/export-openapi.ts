/**
 * Exports the Nest OpenAPI document to docs/api/openapi-auth.json (B1 / F2.10).
 * Requires local Postgres + Redis (same as integration tests) and a throwaway JWT PEM.
 */
import { NestFactory } from '@nestjs/core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { loadEnv } from '../src/infrastructure/config/env';
import { buildOpenApiDocument } from '../src/infrastructure/http/swagger';

async function main(): Promise<void> {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });

  Object.assign(process.env, {
    NODE_ENV: process.env.NODE_ENV ?? 'test',
    APP_ENV: process.env.APP_ENV ?? 'test',
    PORT: process.env.PORT ?? '3001',
    LOG_LEVEL: process.env.LOG_LEVEL ?? 'silent',
    DATABASE_URL:
      process.env.DATABASE_URL ??
      'postgresql://auth_svc:change-me@localhost:5432/fiapx?schema=auth&connection_limit=5&sslmode=disable',
    REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
    AWS_REGION: process.env.AWS_REGION ?? 'us-east-1',
    AWS_ENDPOINT: process.env.AWS_ENDPOINT ?? 'http://localhost:4566',
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID ?? 'test',
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
    OTEL_SERVICE_NAME: process.env.OTEL_SERVICE_NAME ?? 'auth-service',
    JWT_ISSUER: process.env.JWT_ISSUER ?? 'http://localhost:3001',
    JWT_AUDIENCE: process.env.JWT_AUDIENCE ?? 'fiapx-api',
    JWKS_URL: process.env.JWKS_URL ?? 'http://localhost:3001/.well-known/jwks.json',
    TRUST_GATEWAY_IP: process.env.TRUST_GATEWAY_IP ?? 'false',
    USER_EVENTS_TOPIC_ARN:
      process.env.USER_EVENTS_TOPIC_ARN ??
      'arn:aws:sns:us-east-1:000000000000:fiapx-local-user-events',
    JWT_PRIVATE_KEY_PEM: privateKey.replace(/\n/g, '\\n'),
    JWT_KID: process.env.JWT_KID ?? 'openapi-export',
    ACCESS_TTL: process.env.ACCESS_TTL ?? '900',
    REFRESH_IDLE_TTL: process.env.REFRESH_IDLE_TTL ?? '3600',
    SESSION_ABSOLUTE_TTL: process.env.SESSION_ABSOLUTE_TTL ?? '28800',
  });

  const env = loadEnv();
  const app = await NestFactory.create(AppModule.forRoot(env), { logger: false });
  await app.init();

  const document = buildOpenApiDocument(app);
  const outPath = join(__dirname, '..', 'docs', 'api', 'openapi-auth.json');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${outPath}`);

  await app.close();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
