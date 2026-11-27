import { SignJWT } from 'jose';
import { JoseAccessTokenVerifier } from './jose-access-token-verifier';
import { JwtKeyService } from './jwt-key.service';
import { AccessTokenVerificationError } from '../../domain/ports/access-token-verifier';
import type { AuthEnv } from '../config/env';
import { createTestRsaPem } from '../../../test/helpers/rsa-pem';

describe('JoseAccessTokenVerifier', () => {
  it('verifies a locally signed access token', async () => {
    const { pem, kid } = await createTestRsaPem();
    const env = {
      JWT_ISSUER: 'http://issuer.test',
      JWT_AUDIENCE: 'fiapx-api',
      JWT_PRIVATE_KEY_PEM: pem,
      JWT_KID: kid,
    } as AuthEnv;
    const keys = new JwtKeyService(env);
    await keys.onModuleInit();
    const verifier = new JoseAccessTokenVerifier(env, keys);

    const token = await new SignJWT({ sid: '33333333-3333-4333-8333-333333333333' })
      .setProtectedHeader({ alg: 'RS256', kid })
      .setIssuer(env.JWT_ISSUER)
      .setAudience(env.JWT_AUDIENCE)
      .setSubject('11111111-1111-4111-8111-111111111111')
      .setExpirationTime('15m')
      .sign(keys.getPrivateKey());

    await expect(verifier.verify(token)).resolves.toEqual({
      sub: '11111111-1111-4111-8111-111111111111',
      sid: '33333333-3333-4333-8333-333333333333',
    });
  });

  it('rejects forged tokens', async () => {
    const { pem, kid } = await createTestRsaPem();
    const env = {
      JWT_ISSUER: 'http://issuer.test',
      JWT_AUDIENCE: 'fiapx-api',
      JWT_PRIVATE_KEY_PEM: pem,
      JWT_KID: kid,
    } as AuthEnv;
    const keys = new JwtKeyService(env);
    await keys.onModuleInit();
    const verifier = new JoseAccessTokenVerifier(env, keys);

    await expect(verifier.verify('not.a.jwt')).rejects.toBeInstanceOf(AccessTokenVerificationError);
  });
});
