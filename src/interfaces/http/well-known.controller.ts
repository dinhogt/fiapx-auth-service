import { Controller, Get, Header, Inject } from '@nestjs/common';
import type { AuthEnv } from '../../infrastructure/config/env';
import { APP_ENV_CONFIG } from '../../infrastructure/config/tokens';
import { JwtKeyService } from '../../infrastructure/auth/jwt-key.service';

@Controller('.well-known')
export class WellKnownController {
  constructor(
    @Inject(APP_ENV_CONFIG) private readonly env: AuthEnv,
    private readonly jwtKeys: JwtKeyService,
  ) {}

  @Get('openid-configuration')
  @Header('Cache-Control', 'public, max-age=60')
  openidConfiguration(): { issuer: string; jwks_uri: string } {
    return {
      issuer: this.env.JWT_ISSUER,
      jwks_uri: this.env.JWKS_URL,
    };
  }

  @Get('jwks.json')
  @Header('Cache-Control', 'public, max-age=60')
  jwks(): ReturnType<JwtKeyService['getJwks']> {
    return this.jwtKeys.getJwks();
  }
}
