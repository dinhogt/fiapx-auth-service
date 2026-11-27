import { Controller, Get, Header, Inject } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthEnv } from '../../infrastructure/config/env';
import { APP_ENV_CONFIG } from '../../infrastructure/config/tokens';
import { JwtKeyService } from '../../infrastructure/auth/jwt-key.service';
import { Public } from './public.decorator';

@ApiTags('well-known')
@Controller('.well-known')
export class WellKnownController {
  constructor(
    @Inject(APP_ENV_CONFIG) private readonly env: AuthEnv,
    private readonly jwtKeys: JwtKeyService,
  ) {}

  @Public()
  @Get('openid-configuration')
  @Header('Cache-Control', 'public, max-age=60')
  @ApiOperation({ summary: 'OIDC discovery (issuer + jwks_uri)' })
  @ApiOkResponse({ description: 'Documento de discovery' })
  openidConfiguration(): { issuer: string; jwks_uri: string } {
    return {
      issuer: this.env.JWT_ISSUER,
      jwks_uri: this.env.JWKS_URL,
    };
  }

  @Public()
  @Get('jwks.json')
  @Header('Cache-Control', 'public, max-age=60')
  @ApiOperation({ summary: 'JWKS público RS256' })
  @ApiOkResponse({ description: 'Conjunto de chaves públicas' })
  jwks(): ReturnType<JwtKeyService['getJwks']> {
    return this.jwtKeys.getJwks();
  }
}
