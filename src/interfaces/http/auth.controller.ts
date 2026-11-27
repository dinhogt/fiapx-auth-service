import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  HttpCode,
  Inject,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { RegisterUserUseCase } from '../../application/register-user.use-case';
import type { AuthEnv } from '../../infrastructure/config/env';
import { APP_ENV_CONFIG } from '../../infrastructure/config/tokens';
import { CORRELATION_HEADER, readCorrelationId } from './correlation.middleware';
import { buildTraceparent } from './traceparent';

const registerBodySchema = z.object({
  name: z.string(),
  email: z.string(),
  password: z.string(),
});

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Controller('auth')
export class AuthController {
  constructor(
    private readonly registerUser: RegisterUserUseCase,
    @Inject(APP_ENV_CONFIG) private readonly env: AuthEnv,
  ) {}

  @Post('register')
  @HttpCode(201)
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

function ensureUuidCorrelation(value: string): string {
  if (UUID_RE.test(value)) {
    return value;
  }
  return randomUUID();
}
