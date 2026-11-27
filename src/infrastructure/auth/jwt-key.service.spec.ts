import { JwtKeyService } from './jwt-key.service';
import type { AuthEnv } from '../config/env';
import { createTestRsaPem } from '../../../test/helpers/rsa-pem';

describe('JwtKeyService', () => {
  it('loads the PEM and exposes a public JWKS without private fields', async () => {
    const { pem, kid } = await createTestRsaPem();
    const env = {
      JWT_PRIVATE_KEY_PEM: pem,
      JWT_KID: kid,
    } as AuthEnv;
    const service = new JwtKeyService(env);
    await service.onModuleInit();

    expect(service.getKid()).toBe(kid);
    const jwks = service.getJwks();
    expect(jwks.keys).toHaveLength(1);
    expect(jwks.keys[0]).toEqual(
      expect.objectContaining({
        kid,
        kty: 'RSA',
        alg: 'RS256',
        use: 'sig',
      }),
    );
    expect(jwks.keys[0]).not.toHaveProperty('d');
    expect(service.getPrivateKey()).toBeTruthy();
  });
});
