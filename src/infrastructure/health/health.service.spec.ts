import { HealthService } from './health.service';
import type { AuthEnv } from '../config/env';

const env: AuthEnv = {
  NODE_ENV: 'test',
  APP_ENV: 'test',
  PORT: 3001,
  LOG_LEVEL: 'info',
  DATABASE_URL: 'postgresql://auth_svc:change-me@127.0.0.1:1/fiapx?schema=auth',
  REDIS_URL: 'redis://127.0.0.1:1',
  AWS_REGION: 'us-east-1',
  OTEL_SERVICE_NAME: 'auth-service',
  JWT_ISSUER: 'http://localhost:3001',
  JWT_AUDIENCE: 'fiapx-api',
  JWKS_URL: 'http://localhost:3001/.well-known/jwks.json',
  JWT_PRIVATE_KEY_PEM: 'placeholder-not-a-pem',
  JWT_KID: 'test-kid',
  ACCESS_TTL: 900,
  REFRESH_IDLE_TTL: 3600,
  SESSION_ABSOLUTE_TTL: 28_800,
  TRUST_GATEWAY_IP: false,
  USER_EVENTS_TOPIC_ARN: 'arn:aws:sns:us-east-1:000000000000:fiapx-local-user-events',
};

describe('HealthService', () => {
  it('reports live status without dependencies', () => {
    const service = new HealthService(env);
    expect(service.live()).toEqual({ status: 'ok' });
  });

  it('marks ready as false when postgres and redis are unreachable', async () => {
    const service = new HealthService(env);
    const result = await service.ready();
    expect(result.ready).toBe(false);
    expect(result.status).toBe('degraded');
    expect(result.checks.map((check) => check.name).sort()).toEqual(['postgres', 'redis']);
  });
});
