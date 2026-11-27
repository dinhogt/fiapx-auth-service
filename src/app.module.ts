import { DynamicModule, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import type { IncomingMessage } from 'node:http';
import { GetMeUseCase } from './application/get-me.use-case';
import { LoginUserUseCase } from './application/login-user.use-case';
import { LogoutUserUseCase } from './application/logout-user.use-case';
import { RefreshTokenUseCase } from './application/refresh-token.use-case';
import { RegisterUserUseCase } from './application/register-user.use-case';
import type { AccessTokenSigner } from './domain/ports/access-token-signer';
import type { LoginRateLimiter } from './domain/ports/login-rate-limiter';
import type { PasswordHasher } from './domain/ports/password-hasher';
import type { RefreshRateLimiter } from './domain/ports/refresh-rate-limiter';
import type { SecurityEventRecorder } from './domain/ports/security-event-recorder';
import type { SessionRepository } from './domain/ports/session-repository';
import type { SessionRevocationStore } from './domain/ports/session-revocation-store';
import type { UserRepository } from './domain/ports/user-repository';
import { JoseAccessTokenSigner } from './infrastructure/auth/jose-access-token-signer';
import { JoseAccessTokenVerifier } from './infrastructure/auth/jose-access-token-verifier';
import { JwtKeyService } from './infrastructure/auth/jwt-key.service';
import { RedisLoginRateLimiter } from './infrastructure/cache/redis-login-rate-limiter';
import { RedisRefreshRateLimiter } from './infrastructure/cache/redis-refresh-rate-limiter';
import { RedisService } from './infrastructure/cache/redis.service';
import { RedisSessionRevocationStore } from './infrastructure/cache/redis-session-revocation-store';
import type { AuthEnv } from './infrastructure/config/env';
import {
  ACCESS_TOKEN_SIGNER,
  ACCESS_TOKEN_VERIFIER,
  APP_ENV_CONFIG,
  LOGIN_RATE_LIMITER,
  PASSWORD_HASHER,
  REFRESH_RATE_LIMITER,
  SECURITY_EVENT_RECORDER,
  SESSION_REPOSITORY,
  SESSION_REVOCATION_STORE,
  USER_REPOSITORY,
} from './infrastructure/config/tokens';
import { Argon2PasswordHasher } from './infrastructure/crypto/argon2-password-hasher';
import { HealthService } from './infrastructure/health/health.service';
import { PinoSecurityEventRecorder } from './infrastructure/observability/pino-security-event-recorder';
import { pinoRedactPaths } from './infrastructure/observability/redact';
import { PrismaSessionRepository } from './infrastructure/prisma/prisma-session.repository';
import { PrismaUserRepository } from './infrastructure/prisma/prisma-user.repository';
import { PrismaService } from './infrastructure/prisma/prisma.service';
import { AuthController } from './interfaces/http/auth.controller';
import {
  CORRELATION_HEADER,
  CorrelationMiddleware,
} from './interfaces/http/correlation.middleware';
import { HealthController } from './interfaces/http/health.controller';
import { JwtAuthGuard } from './interfaces/http/jwt-auth.guard';
import { MetricsController } from './interfaces/http/metrics.controller';
import { WellKnownController } from './interfaces/http/well-known.controller';

@Module({})
export class AppModule implements NestModule {
  static forRoot(env: AuthEnv): DynamicModule {
    return {
      module: AppModule,
      imports: [
        LoggerModule.forRoot({
          pinoHttp: {
            level: env.LOG_LEVEL,
            redact: {
              paths: pinoRedactPaths,
              censor: '[Redacted]',
            },
            customProps: (req: IncomingMessage) => ({
              correlationId: req.headers[CORRELATION_HEADER],
              service: env.OTEL_SERVICE_NAME,
              env: env.APP_ENV,
            }),
          },
        }),
      ],
      controllers: [HealthController, MetricsController, AuthController, WellKnownController],
      providers: [
        { provide: APP_ENV_CONFIG, useValue: env },
        HealthService,
        JwtKeyService,
        PrismaService,
        RedisService,
        { provide: PASSWORD_HASHER, useClass: Argon2PasswordHasher },
        { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
        { provide: SESSION_REPOSITORY, useClass: PrismaSessionRepository },
        { provide: LOGIN_RATE_LIMITER, useClass: RedisLoginRateLimiter },
        { provide: REFRESH_RATE_LIMITER, useClass: RedisRefreshRateLimiter },
        { provide: ACCESS_TOKEN_SIGNER, useClass: JoseAccessTokenSigner },
        { provide: ACCESS_TOKEN_VERIFIER, useClass: JoseAccessTokenVerifier },
        { provide: SESSION_REVOCATION_STORE, useClass: RedisSessionRevocationStore },
        { provide: SECURITY_EVENT_RECORDER, useClass: PinoSecurityEventRecorder },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        {
          provide: RegisterUserUseCase,
          useFactory: (users: UserRepository, hasher: PasswordHasher) =>
            new RegisterUserUseCase(users, hasher),
          inject: [USER_REPOSITORY, PASSWORD_HASHER],
        },
        {
          provide: LoginUserUseCase,
          useFactory: (
            users: UserRepository,
            sessions: SessionRepository,
            hasher: PasswordHasher,
            rateLimiter: LoginRateLimiter,
            signer: AccessTokenSigner,
            appEnv: AuthEnv,
          ) =>
            new LoginUserUseCase(
              users,
              sessions,
              hasher,
              rateLimiter,
              signer,
              appEnv.REFRESH_IDLE_TTL,
            ),
          inject: [
            USER_REPOSITORY,
            SESSION_REPOSITORY,
            PASSWORD_HASHER,
            LOGIN_RATE_LIMITER,
            ACCESS_TOKEN_SIGNER,
            APP_ENV_CONFIG,
          ],
        },
        {
          provide: RefreshTokenUseCase,
          useFactory: (
            sessions: SessionRepository,
            rateLimiter: RefreshRateLimiter,
            revocation: SessionRevocationStore,
            signer: AccessTokenSigner,
            security: SecurityEventRecorder,
            appEnv: AuthEnv,
          ) =>
            new RefreshTokenUseCase(
              sessions,
              rateLimiter,
              revocation,
              signer,
              security,
              appEnv.REFRESH_IDLE_TTL,
            ),
          inject: [
            SESSION_REPOSITORY,
            REFRESH_RATE_LIMITER,
            SESSION_REVOCATION_STORE,
            ACCESS_TOKEN_SIGNER,
            SECURITY_EVENT_RECORDER,
            APP_ENV_CONFIG,
          ],
        },
        {
          provide: LogoutUserUseCase,
          useFactory: (sessions: SessionRepository, revocation: SessionRevocationStore) =>
            new LogoutUserUseCase(sessions, revocation),
          inject: [SESSION_REPOSITORY, SESSION_REVOCATION_STORE],
        },
        {
          provide: GetMeUseCase,
          useFactory: (users: UserRepository) => new GetMeUseCase(users),
          inject: [USER_REPOSITORY],
        },
      ],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}
