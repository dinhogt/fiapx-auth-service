import { Email } from '../domain/email';
import type { AccessTokenSigner } from '../domain/ports/access-token-signer';
import type { LoginRateLimiter } from '../domain/ports/login-rate-limiter';
import { RateLimitUnavailableError } from '../domain/ports/login-rate-limiter';
import type { PasswordHasher } from '../domain/ports/password-hasher';
import type { SessionRepository } from '../domain/ports/session-repository';
import type { UserRepository } from '../domain/ports/user-repository';
import { RefreshToken } from '../domain/refresh-token';
import { failure, type Result, success } from '../domain/result';
import { Session } from '../domain/session';

/** Dummy argon2id hash to keep verify timing similar when the user is missing. */
const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

export type LoginUserCommand = {
  email: string;
  password: string;
  clientIp: string;
};

export type TokenPair = {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  refreshToken: string;
  refreshExpiresIn: number;
};

export class LoginUserUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
    private readonly passwordHasher: PasswordHasher,
    private readonly rateLimiter: LoginRateLimiter,
    private readonly accessTokenSigner: AccessTokenSigner,
    private readonly refreshIdleTtlSeconds: number,
  ) {}

  async execute(command: LoginUserCommand): Promise<Result<TokenPair>> {
    const email = Email.create(command.email);
    if (!email.ok) {
      return failure('INVALID_EMAIL');
    }
    if (command.password.length === 0) {
      return failure('INVALID_PASSWORD');
    }

    let decision: 'allow' | 'block';
    try {
      decision = await this.rateLimiter.consume(email.value.value, command.clientIp);
    } catch (error: unknown) {
      if (error instanceof RateLimitUnavailableError) {
        return failure('RATE_LIMIT_UNAVAILABLE');
      }
      throw error;
    }
    if (decision === 'block') {
      return failure('RATE_LIMITED');
    }

    const user = await this.users.findByEmail(email.value.value);
    const hash = user?.passwordHash ?? DUMMY_PASSWORD_HASH;
    const passwordOk = await this.passwordHasher.verify(hash, command.password);
    if (!user || !passwordOk) {
      return failure('INVALID_CREDENTIALS');
    }

    const now = new Date();
    const session = Session.start(user.id, now);
    const refresh = RefreshToken.issue(session.id, now);
    await this.sessions.createWithRefresh(session, refresh);

    const access = await this.accessTokenSigner.sign({
      sub: user.id,
      sid: session.id,
    });

    if (!refresh.plainToken) {
      throw new Error('Refresh token plain value missing after issue');
    }

    return success({
      accessToken: access.accessToken,
      tokenType: 'Bearer',
      expiresIn: access.expiresIn,
      refreshToken: refresh.plainToken,
      refreshExpiresIn: this.refreshIdleTtlSeconds,
    });
  }
}
