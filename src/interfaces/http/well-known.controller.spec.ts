import { WellKnownController } from './well-known.controller';
import type { AuthEnv } from '../../infrastructure/config/env';
import type { JwtKeyService } from '../../infrastructure/auth/jwt-key.service';

describe('WellKnownController', () => {
  const env = {
    JWT_ISSUER: 'http://localhost:3001',
    JWKS_URL: 'http://localhost:3001/.well-known/jwks.json',
  } as AuthEnv;

  const jwtKeys = {
    getJwks: () => ({
      keys: [
        {
          kty: 'RSA' as const,
          n: 'n',
          e: 'AQAB',
          kid: 'local-1',
          alg: 'RS256' as const,
          use: 'sig' as const,
        },
      ],
    }),
  } as unknown as JwtKeyService;

  it('returns OIDC discovery with issuer and jwks_uri', () => {
    const controller = new WellKnownController(env, jwtKeys);
    expect(controller.openidConfiguration()).toEqual({
      issuer: 'http://localhost:3001',
      jwks_uri: 'http://localhost:3001/.well-known/jwks.json',
    });
  });

  it('returns the JWKS document', () => {
    const controller = new WellKnownController(env, jwtKeys);
    expect(controller.jwks().keys[0]?.kid).toBe('local-1');
  });
});
