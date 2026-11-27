import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { failure, type Result, success } from './result';

export const REFRESH_TOKEN_BYTES = 32;
export const REFRESH_IDLE_MS = 60 * 60 * 1000;

export class RefreshToken {
  private constructor(
    readonly id: string,
    readonly sessionId: string,
    readonly tokenHash: string,
    readonly issuedAt: Date,
    private _expiresAt: Date,
    private _usedAt: Date | null,
    private _replacedById: string | null,
    readonly plainToken?: string,
  ) {}

  get expiresAt(): Date {
    return this._expiresAt;
  }

  get usedAt(): Date | null {
    return this._usedAt;
  }

  get replacedById(): string | null {
    return this._replacedById;
  }

  static hash(plainToken: string): string {
    return createHash('sha256').update(plainToken, 'utf8').digest('hex');
  }

  static issue(sessionId: string, now: Date = new Date()): RefreshToken {
    const plainToken = randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
    return new RefreshToken(
      randomUUID(),
      sessionId,
      RefreshToken.hash(plainToken),
      now,
      new Date(now.getTime() + REFRESH_IDLE_MS),
      null,
      null,
      plainToken,
    );
  }

  static rehydrate(props: {
    id: string;
    sessionId: string;
    tokenHash: string;
    issuedAt: Date;
    expiresAt: Date;
    usedAt: Date | null;
    replacedById: string | null;
  }): RefreshToken {
    return new RefreshToken(
      props.id,
      props.sessionId,
      props.tokenHash,
      props.issuedAt,
      props.expiresAt,
      props.usedAt,
      props.replacedById,
    );
  }

  isExpired(now: Date = new Date()): boolean {
    return now.getTime() >= this._expiresAt.getTime();
  }

  isUsed(): boolean {
    return this._usedAt !== null;
  }

  /**
   * Rotates this token: marks it used and returns a replacement for the same session.
   * Calling rotate on an already-used token is reuse → caller must revoke the session.
   */
  rotate(now: Date = new Date()): Result<{ current: RefreshToken; next: RefreshToken }> {
    if (this.isUsed()) {
      return failure('REFRESH_REUSE');
    }
    if (this.isExpired(now)) {
      return failure('REFRESH_EXPIRED');
    }
    const next = RefreshToken.issue(this.sessionId, now);
    this._usedAt = now;
    this._replacedById = next.id;
    return success({ current: this, next });
  }

  /** Detects presentation of a token that was already rotated/consumed. */
  detectReuse(): Result<void> {
    if (this.isUsed()) {
      return failure('REFRESH_REUSE');
    }
    return success(undefined);
  }
}
