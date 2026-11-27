import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import type {
  AccessTokenClaims,
  AccessTokenSigner,
  SignedAccessToken,
} from '../../domain/ports/access-token-signer';
import type { AuthEnv } from '../config/env';
import { APP_ENV_CONFIG } from '../config/tokens';
import { JwtKeyService } from './jwt-key.service';

@Injectable()
export class JoseAccessTokenSigner implements AccessTokenSigner {
  constructor(
    @Inject(APP_ENV_CONFIG) private readonly env: AuthEnv,
    private readonly keys: JwtKeyService,
  ) {}

  async sign(claims: AccessTokenClaims): Promise<SignedAccessToken> {
    const expiresIn = this.env.ACCESS_TTL;
    const accessToken = await new SignJWT({ sid: claims.sid })
      .setProtectedHeader({ alg: 'RS256', kid: this.keys.getKid() })
      .setIssuer(this.env.JWT_ISSUER)
      .setAudience(this.env.JWT_AUDIENCE)
      .setSubject(claims.sub)
      .setJti(randomUUID())
      .setIssuedAt()
      .setExpirationTime(`${expiresIn}s`)
      .sign(this.keys.getPrivateKey());

    return { accessToken, expiresIn };
  }
}
