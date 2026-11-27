import { Inject, Injectable } from '@nestjs/common';
import { createLocalJWKSet, jwtVerify } from 'jose';
import {
  AccessTokenVerificationError,
  type AccessTokenVerifier,
  type VerifiedAccessToken,
} from '../../domain/ports/access-token-verifier';
import type { AuthEnv } from '../config/env';
import { APP_ENV_CONFIG } from '../config/tokens';
import { JwtKeyService } from './jwt-key.service';

@Injectable()
export class JoseAccessTokenVerifier implements AccessTokenVerifier {
  constructor(
    @Inject(APP_ENV_CONFIG) private readonly env: AuthEnv,
    private readonly keys: JwtKeyService,
  ) {}

  async verify(accessToken: string): Promise<VerifiedAccessToken> {
    try {
      const { payload } = await jwtVerify(accessToken, createLocalJWKSet(this.keys.getJwks()), {
        issuer: this.env.JWT_ISSUER,
        audience: this.env.JWT_AUDIENCE,
        algorithms: ['RS256'],
        clockTolerance: 30,
      });

      if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
        throw new AccessTokenVerificationError('Missing sub claim');
      }
      if (typeof payload.sid !== 'string' || payload.sid.length === 0) {
        throw new AccessTokenVerificationError('Missing sid claim');
      }

      return { sub: payload.sub, sid: payload.sid };
    } catch (error: unknown) {
      if (error instanceof AccessTokenVerificationError) {
        throw error;
      }
      throw new AccessTokenVerificationError(
        error instanceof Error ? error.message : 'Access token verification failed',
      );
    }
  }
}
