import type { AccessTokenSigner } from '../domain/ports/access-token-signer';
import type { RefreshRateLimiter } from '../domain/ports/refresh-rate-limiter';
import { RateLimitUnavailableError } from '../domain/ports/refresh-rate-limiter';
import type { SecurityEventRecorder } from '../domain/ports/security-event-recorder';
import type { SessionRepository } from '../domain/ports/session-repository';
import type { SessionRevocationStore } from '../domain/ports/session-revocation-store';
import { SessionRevocationStoreUnavailableError } from '../domain/ports/session-revocation-store';
import { RefreshToken } from '../domain/refresh-token';
import { failure, type Result, success } from '../domain/result';
import type { TokenPair } from './login-user.use-case';

export type RefreshTokenCommand = {
  refreshToken: string;
  clientIp: string;
};

export class RefreshTokenUseCase {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly rateLimiter: RefreshRateLimiter,
    private readonly revocationStore: SessionRevocationStore,
    private readonly accessTokenSigner: AccessTokenSigner,
    private readonly securityEvents: SecurityEventRecorder,
    private readonly refreshIdleTtlSeconds: number,
  ) {}

  async execute(command: RefreshTokenCommand): Promise<Result<TokenPair>> {
    if (command.refreshToken.trim().length === 0) {
      return failure('INVALID_REFRESH_TOKEN');
    }

    let decision: 'allow' | 'block';
    try {
      decision = await this.rateLimiter.consume(command.clientIp);
    } catch (error: unknown) {
      if (error instanceof RateLimitUnavailableError) {
        return failure('RATE_LIMIT_UNAVAILABLE');
      }
      throw error;
    }
    if (decision === 'block') {
      return failure('RATE_LIMITED');
    }

    const found = await this.sessions.findRefreshWithSessionByHash(
      RefreshToken.hash(command.refreshToken),
    );
    if (!found) {
      return failure('INVALID_REFRESH_TOKEN');
    }

    const { refresh, session } = found;
    const now = new Date();

    if (session.isRevoked()) {
      return failure('INVALID_REFRESH_TOKEN');
    }

    if (refresh.isUsed()) {
      await this.handleReuse(session.id, session.userId, now);
      return failure('REFRESH_REUSE');
    }

    if (refresh.isExpired(now)) {
      return failure('REFRESH_EXPIRED');
    }

    if (session.isAbsoluteExpired(now)) {
      return failure('SESSION_ABSOLUTE_EXPIRED');
    }

    if (session.isIdleExpired(now)) {
      return failure('SESSION_IDLE_EXPIRED');
    }

    const touched = session.touch(now);
    if (!touched.ok) {
      return failure(touched.code);
    }

    const rotated = refresh.rotate(now);
    if (!rotated.ok) {
      if (rotated.code === 'REFRESH_REUSE') {
        await this.handleReuse(session.id, session.userId, now);
      }
      return failure(rotated.code);
    }

    await this.sessions.rotateRefresh({
      session,
      current: rotated.value.current,
      next: rotated.value.next,
    });

    const access = await this.accessTokenSigner.sign({
      sub: session.userId,
      sid: session.id,
    });

    if (!rotated.value.next.plainToken) {
      throw new Error('Refresh token plain value missing after rotation');
    }

    return success({
      accessToken: access.accessToken,
      tokenType: 'Bearer',
      expiresIn: access.expiresIn,
      refreshToken: rotated.value.next.plainToken,
      refreshExpiresIn: this.refreshIdleTtlSeconds,
    });
  }

  private async handleReuse(sid: string, userId: string, now: Date): Promise<void> {
    await this.sessions.revokeSession(sid, 'REFRESH_REUSE', now);
    try {
      await this.revocationStore.revoke(sid);
    } catch (error: unknown) {
      if (!(error instanceof SessionRevocationStoreUnavailableError)) {
        throw error;
      }
      // Session is already revoked in Postgres (source of truth). Redis miss is recovered by rehydration (F2.8).
    }
    this.securityEvents.record({
      type: 'security.refresh_reuse',
      sid,
      userId,
      at: now.toISOString(),
    });
  }
}
