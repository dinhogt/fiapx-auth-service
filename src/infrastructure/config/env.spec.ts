import { loadEnv } from './env';

const validEnv: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  APP_ENV: 'test',
  PORT: '3001',
  LOG_LEVEL: 'info',
  DATABASE_URL: 'postgresql://auth_svc:change-me@localhost:5432/fiapx?schema=auth',
  REDIS_URL: 'redis://localhost:6379',
  AWS_REGION: 'us-east-1',
  OTEL_SERVICE_NAME: 'auth-service',
  JWT_ISSUER: 'http://localhost:3001',
  JWT_AUDIENCE: 'fiapx-api',
  JWKS_URL: 'http://localhost:3001/.well-known/jwks.json',
  TRUST_GATEWAY_IP: 'false',
};

describe('loadEnv', () => {
  it('parses a valid environment', () => {
    const env = loadEnv(validEnv);
    expect(env.PORT).toBe(3001);
    expect(env.TRUST_GATEWAY_IP).toBe(false);
    expect(env.OTEL_SERVICE_NAME).toBe('auth-service');
  });

  it('fails when required values are missing', () => {
    expect(() => loadEnv({})).toThrow(/Invalid configuration/);
  });

  it('accepts an empty optional OTEL endpoint', () => {
    const env = loadEnv({ ...validEnv, OTEL_EXPORTER_OTLP_ENDPOINT: '' });
    expect(env.OTEL_EXPORTER_OTLP_ENDPOINT).toBe('');
  });

  it('parses TRUST_GATEWAY_IP as boolean true', () => {
    const env = loadEnv({ ...validEnv, TRUST_GATEWAY_IP: 'true' });
    expect(env.TRUST_GATEWAY_IP).toBe(true);
  });

  it('rejects an invalid JWT issuer URL shape for JWKS_URL', () => {
    expect(() => loadEnv({ ...validEnv, JWKS_URL: 'not-a-url' })).toThrow(/Invalid configuration/);
  });
});
