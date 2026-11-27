import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto';
import { exportJWK, importPKCS8, type JWK, type KeyLike } from 'jose';
import type { AuthEnv } from '../config/env';
import { APP_ENV_CONFIG } from '../config/tokens';
import { normalizePem } from './pem';

export type PublicJwk = JWK & {
  kid: string;
  alg: 'RS256';
  use: 'sig';
  kty: 'RSA';
};

export type JwksDocument = { keys: PublicJwk[] };

@Injectable()
export class JwtKeyService implements OnModuleInit {
  private privateKey!: KeyLike;
  private privateKeyObject!: KeyObject;
  private jwks!: JwksDocument;

  constructor(@Inject(APP_ENV_CONFIG) private readonly env: AuthEnv) {}

  async onModuleInit(): Promise<void> {
    const pem = normalizePem(this.env.JWT_PRIVATE_KEY_PEM);
    this.privateKeyObject = createPrivateKey(pem);
    this.privateKey = await importPKCS8(pem, 'RS256');

    const publicKeyObject = createPublicKey(this.privateKeyObject);
    const jwk = await exportJWK(publicKeyObject);
    if (jwk.kty !== 'RSA' || typeof jwk.n !== 'string' || typeof jwk.e !== 'string') {
      throw new Error('JWT private key must be an RSA key');
    }

    const publicJwk: PublicJwk = {
      kty: 'RSA',
      n: jwk.n,
      e: jwk.e,
      kid: this.env.JWT_KID,
      alg: 'RS256',
      use: 'sig',
    };
    this.jwks = { keys: [publicJwk] };
  }

  getKid(): string {
    return this.env.JWT_KID;
  }

  getPrivateKey(): KeyLike {
    return this.privateKey;
  }

  getJwks(): JwksDocument {
    return this.jwks;
  }
}
