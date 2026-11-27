import { randomUUID } from 'node:crypto';
import { failure, type Result, success } from './result';

export const SESSION_IDLE_MS = 60 * 60 * 1000;
export const SESSION_ABSOLUTE_MS = 8 * 60 * 60 * 1000;

export type SessionRevokedReason = 'LOGOUT' | 'REFRESH_REUSE';

export class Session {
  private constructor(
    readonly id: string,
    readonly userId: string,
    readonly createdAt: Date,
    private _lastUsedAt: Date,
    private _idleExpiresAt: Date,
    readonly absoluteExpiresAt: Date,
    private _revokedAt: Date | null,
    private _revokedReason: SessionRevokedReason | null,
  ) {}

  get lastUsedAt(): Date {
    return this._lastUsedAt;
  }

  get idleExpiresAt(): Date {
    return this._idleExpiresAt;
  }

  get revokedAt(): Date | null {
    return this._revokedAt;
  }

  get revokedReason(): SessionRevokedReason | null {
    return this._revokedReason;
  }

  static start(userId: string, now: Date = new Date()): Session {
    return new Session(
      randomUUID(),
      userId,
      now,
      now,
      new Date(now.getTime() + SESSION_IDLE_MS),
      new Date(now.getTime() + SESSION_ABSOLUTE_MS),
      null,
      null,
    );
  }

  static rehydrate(props: {
    id: string;
    userId: string;
    createdAt: Date;
    lastUsedAt: Date;
    idleExpiresAt: Date;
    absoluteExpiresAt: Date;
    revokedAt: Date | null;
    revokedReason: SessionRevokedReason | null;
  }): Session {
    return new Session(
      props.id,
      props.userId,
      props.createdAt,
      props.lastUsedAt,
      props.idleExpiresAt,
      props.absoluteExpiresAt,
      props.revokedAt,
      props.revokedReason,
    );
  }

  isRevoked(): boolean {
    return this._revokedAt !== null;
  }

  isAbsoluteExpired(now: Date = new Date()): boolean {
    return now.getTime() >= this.absoluteExpiresAt.getTime();
  }

  isIdleExpired(now: Date = new Date()): boolean {
    return now.getTime() >= this._idleExpiresAt.getTime();
  }

  isActive(now: Date = new Date()): boolean {
    return !this.isRevoked() && !this.isAbsoluteExpired(now) && !this.isIdleExpired(now);
  }

  touch(now: Date = new Date()): Result<Session> {
    if (this.isRevoked()) {
      return failure('SESSION_REVOKED');
    }
    if (this.isAbsoluteExpired(now)) {
      return failure('SESSION_ABSOLUTE_EXPIRED');
    }
    if (this.isIdleExpired(now)) {
      return failure('SESSION_IDLE_EXPIRED');
    }
    const nextIdle = new Date(
      Math.min(now.getTime() + SESSION_IDLE_MS, this.absoluteExpiresAt.getTime()),
    );
    this._lastUsedAt = now;
    this._idleExpiresAt = nextIdle;
    return success(this);
  }

  revoke(reason: SessionRevokedReason, now: Date = new Date()): Result<Session> {
    if (this.isRevoked()) {
      return failure('SESSION_ALREADY_REVOKED');
    }
    this._revokedAt = now;
    this._revokedReason = reason;
    return success(this);
  }
}
