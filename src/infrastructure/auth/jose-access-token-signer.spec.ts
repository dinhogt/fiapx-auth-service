import { decodeJwt } from 'jose';
import { JoseAccessTokenSigner } from './jose-access-token-signer';
import { JwtKeyService } from './jwt-key.service';
import type { AuthEnv } from '../config/env';
import { createTestRsaPem } from '../../../test/helpers/rsa-pem';

describe('JoseAccessTokenSigner', () => {
  it('signs an RS256 access token with sid and standard claims', async () => {
    const { pem, kid } = await createTestRsaPem();
    const env = {
      JWT_PRIVATE_KEY_PEM: pem,
      JWT_KID: kid,
      JWT_ISSUER: 'http://localhost:3001',
      JWT_AUDIENCE: 'fiapx-api',
      ACCESS_TTL: 900,
    } as AuthEnv;
    const keys = new JwtKeyService(env);
    await keys.onModuleInit();
    const signer = new JoseAccessTokenSigner(env, keys);

    const signed = await signer.sign({
      sub: '11111111-1111-4111-8111-111111111111',
      sid: '22222222-2222-4222-8222-222222222222',
    });

    expect(signed.expiresIn).toBe(900);
    const payload = decodeJwt(signed.accessToken);
    expect(payload.iss).toBe('http://localhost:3001');
    expect(payload.aud).toBe('fiapx-api');
    expect(payload.sub).toBe('11111111-1111-4111-8111-111111111111');
    expect(payload.sid).toBe('22222222-2222-4222-8222-222222222222');
    expect(payload.jti).toBeTruthy();
  });
});
