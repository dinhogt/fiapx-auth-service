import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiExtraModels,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { GetMeUseCase } from '../../application/get-me.use-case';
import { LoginUserUseCase } from '../../application/login-user.use-case';
import { LogoutUserUseCase } from '../../application/logout-user.use-case';
import { RefreshTokenUseCase } from '../../application/refresh-token.use-case';
import { RegisterUserUseCase } from '../../application/register-user.use-case';
import type { AuthEnv } from '../../infrastructure/config/env';
import { APP_ENV_CONFIG } from '../../infrastructure/config/tokens';
import { resolveClientIp } from './client-ip';
import { CORRELATION_HEADER, readCorrelationId } from './correlation.middleware';
import {
  LoginBodyDto,
  MeDto,
  ProblemDetailsDto,
  RefreshBodyDto,
  RegisterBodyDto,
  RegisteredUserDto,
  TokenPairDto,
} from './dto/auth.dto';
import type { AuthenticatedRequest } from './jwt-auth.guard';
import { Public } from './public.decorator';
import { buildTraceparent } from './traceparent';

const registerBodySchema = z.object({
  name: z.string(),
  email: z.string(),
  password: z.string(),
});

const loginBodySchema = z.object({
  email: z.string(),
  password: z.string(),
});

const refreshBodySchema = z.object({
  refreshToken: z.string(),
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@ApiTags('auth')
@ApiExtraModels(ProblemDetailsDto)
@Controller('auth')
export class AuthController {
  constructor(
    private readonly registerUser: RegisterUserUseCase,
    private readonly loginUser: LoginUserUseCase,
    private readonly refreshToken: RefreshTokenUseCase,
    private readonly logoutUser: LogoutUserUseCase,
    private readonly getMe: GetMeUseCase,
    @Inject(APP_ENV_CONFIG) private readonly env: AuthEnv,
  ) {}

  @Public()
  @Post('register')
  @HttpCode(201)
  @ApiOperation({ summary: 'Cadastra usuário e grava user.registered na outbox' })
  @ApiBody({ type: RegisterBodyDto })
  @ApiResponse({ status: 201, type: RegisteredUserDto })
  @ApiResponse({ status: 400, type: ProblemDetailsDto })
  @ApiResponse({ status: 409, type: ProblemDetailsDto })
  async register(@Body() body: unknown, @Req() req: Request) {
    const parsed = registerBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        detail: 'Dados de cadastro inválidos.',
        errors: parsed.error.issues.map((issue) => ({
          field: issue.path.join('.') || 'body',
          message: issue.message,
        })),
      });
    }

    const correlationId = ensureUuidCorrelation(readCorrelationId(req));
    req.headers[CORRELATION_HEADER] = correlationId;

    const result = await this.registerUser.execute({
      name: parsed.data.name,
      email: parsed.data.email,
      password: parsed.data.password,
      correlationId,
      traceparent: buildTraceparent(req.header('traceparent')),
      userEventsTopicArn: this.env.USER_EVENTS_TOPIC_ARN,
    });

    if (!result.ok) {
      throw mapRegisterFailure(result.code);
    }

    return {
      id: result.value.id,
      name: result.value.name,
      email: result.value.email,
      createdAt: result.value.createdAt.toISOString(),
    };
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Autentica e emite TokenPair (access + refresh)' })
  @ApiBody({ type: LoginBodyDto })
  @ApiResponse({ status: 200, type: TokenPairDto })
  @ApiResponse({ status: 401, type: ProblemDetailsDto })
  @ApiResponse({ status: 429, type: ProblemDetailsDto })
  @ApiResponse({ status: 503, type: ProblemDetailsDto })
  async login(@Body() body: unknown, @Req() req: Request) {
    const parsed = loginBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        detail: 'Dados de login inválidos.',
        errors: parsed.error.issues.map((issue) => ({
          field: issue.path.join('.') || 'body',
          message: issue.message,
        })),
      });
    }

    const result = await this.loginUser.execute({
      email: parsed.data.email,
      password: parsed.data.password,
      clientIp: resolveClientIp(req, this.env.TRUST_GATEWAY_IP),
    });

    if (!result.ok) {
      throw mapLoginFailure(result.code);
    }

    return result.value;
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rotaciona refresh token e emite novo TokenPair' })
  @ApiBody({ type: RefreshBodyDto })
  @ApiResponse({ status: 200, type: TokenPairDto })
  @ApiResponse({ status: 401, type: ProblemDetailsDto })
  @ApiResponse({ status: 429, type: ProblemDetailsDto })
  async refresh(@Body() body: unknown, @Req() req: Request) {
    const parsed = refreshBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        detail: 'Dados de refresh inválidos.',
        errors: parsed.error.issues.map((issue) => ({
          field: issue.path.join('.') || 'body',
          message: issue.message,
        })),
      });
    }

    const result = await this.refreshToken.execute({
      refreshToken: parsed.data.refreshToken,
      clientIp: resolveClientIp(req, this.env.TRUST_GATEWAY_IP),
    });

    if (!result.ok) {
      throw mapRefreshFailure(result.code);
    }

    return result.value;
  }

  @Post('logout')
  @HttpCode(204)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Revoga a sessão (sid) no Postgres e no Redis' })
  @ApiResponse({ status: 204, description: 'Sessão revogada' })
  @ApiResponse({ status: 401, type: ProblemDetailsDto })
  async logout(@Req() req: AuthenticatedRequest): Promise<void> {
    const user = req.user;
    if (!user) {
      throw new UnauthorizedException('Token ausente ou inválido.');
    }

    const result = await this.logoutUser.execute({
      sid: user.sid,
      userId: user.sub,
    });
    if (!result.ok) {
      throw new UnauthorizedException('Sessão inválida.');
    }
  }

  @Get('me')
  @HttpCode(200)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Retorna o perfil do usuário autenticado' })
  @ApiResponse({ status: 200, type: MeDto })
  @ApiResponse({ status: 401, type: ProblemDetailsDto })
  async me(@Req() req: AuthenticatedRequest) {
    const user = req.user;
    if (!user) {
      throw new UnauthorizedException('Token ausente ou inválido.');
    }

    const result = await this.getMe.execute({ userId: user.sub });
    if (!result.ok) {
      throw new UnauthorizedException('Sessão inválida.');
    }
    return result.value;
  }
}

function mapRegisterFailure(code: string): Error {
  switch (code) {
    case 'EMAIL_IN_USE':
      return new ConflictException('E-mail já cadastrado.');
    case 'INVALID_NAME_LENGTH':
      return new BadRequestException({
        detail: 'Nome inválido.',
        errors: [{ field: 'name', message: 'Informe um nome entre 2 e 120 caracteres.' }],
      });
    case 'INVALID_EMAIL':
      return new BadRequestException({
        detail: 'E-mail inválido.',
        errors: [{ field: 'email', message: 'Informe um e-mail válido.' }],
      });
    case 'INVALID_PASSWORD_LENGTH':
      return new BadRequestException({
        detail: 'Senha inválida.',
        errors: [{ field: 'password', message: 'A senha deve ter entre 12 e 128 caracteres.' }],
      });
    case 'COMMON_PASSWORD':
      return new BadRequestException({
        detail: 'Senha inválida.',
        errors: [{ field: 'password', message: 'Escolha uma senha menos comum.' }],
      });
    default:
      return new BadRequestException('Dados de cadastro inválidos.');
  }
}

function mapLoginFailure(code: string): Error {
  switch (code) {
    case 'INVALID_EMAIL':
    case 'INVALID_PASSWORD':
      return new BadRequestException({
        detail: 'Dados de login inválidos.',
        errors: [
          { field: code === 'INVALID_EMAIL' ? 'email' : 'password', message: 'Valor inválido.' },
        ],
      });
    case 'INVALID_CREDENTIALS':
      return new UnauthorizedException('Credenciais inválidas.');
    case 'RATE_LIMITED':
      return new HttpException(
        'Muitas tentativas. Tente novamente em breve.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    case 'RATE_LIMIT_UNAVAILABLE':
      return new ServiceUnavailableException(
        'Serviço de autenticação temporariamente indisponível.',
      );
    default:
      return new UnauthorizedException('Credenciais inválidas.');
  }
}

function mapRefreshFailure(code: string): Error {
  switch (code) {
    case 'RATE_LIMITED':
      return new HttpException(
        'Muitas tentativas. Tente novamente em breve.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    case 'RATE_LIMIT_UNAVAILABLE':
      return new ServiceUnavailableException(
        'Serviço de autenticação temporariamente indisponível.',
      );
    case 'INVALID_REFRESH_TOKEN':
    case 'REFRESH_REUSE':
    case 'REFRESH_EXPIRED':
    case 'SESSION_IDLE_EXPIRED':
    case 'SESSION_ABSOLUTE_EXPIRED':
    case 'SESSION_REVOKED':
      return new UnauthorizedException('Sessão inválida.');
    default:
      return new UnauthorizedException('Sessão inválida.');
  }
}

function ensureUuidCorrelation(value: string): string {
  if (UUID_RE.test(value)) {
    return value;
  }
  return randomUUID();
}
