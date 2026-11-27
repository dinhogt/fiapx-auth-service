import { DynamicModule, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import type { IncomingMessage } from 'node:http';
import { RegisterUserUseCase } from './application/register-user.use-case';
import type { AuthEnv } from './infrastructure/config/env';
import {
  APP_ENV_CONFIG,
  PASSWORD_HASHER,
  USER_REPOSITORY,
} from './infrastructure/config/tokens';
import { Argon2PasswordHasher } from './infrastructure/crypto/argon2-password-hasher';
import { HealthService } from './infrastructure/health/health.service';
import { pinoRedactPaths } from './infrastructure/observability/redact';
import { PrismaUserRepository } from './infrastructure/prisma/prisma-user.repository';
import { PrismaService } from './infrastructure/prisma/prisma.service';
import { AuthController } from './interfaces/http/auth.controller';
import {
  CORRELATION_HEADER,
  CorrelationMiddleware,
} from './interfaces/http/correlation.middleware';
import { HealthController } from './interfaces/http/health.controller';
import { MetricsController } from './interfaces/http/metrics.controller';
import type { PasswordHasher } from './domain/ports/password-hasher';
import type { UserRepository } from './domain/ports/user-repository';

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
      controllers: [HealthController, MetricsController, AuthController],
      providers: [
        { provide: APP_ENV_CONFIG, useValue: env },
        HealthService,
        PrismaService,
        { provide: PASSWORD_HASHER, useClass: Argon2PasswordHasher },
        { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
        {
          provide: RegisterUserUseCase,
          useFactory: (users: UserRepository, hasher: PasswordHasher) =>
            new RegisterUserUseCase(users, hasher),
          inject: [USER_REPOSITORY, PASSWORD_HASHER],
        },
      ],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}
