import type { RefreshToken } from '../refresh-token';
import type { Session, SessionRevokedReason } from '../session';

export type RefreshWithSession = {
  refresh: RefreshToken;
  session: Session;
};

export interface SessionRepository {
  createWithRefresh(session: Session, refresh: RefreshToken): Promise<void>;
  findById(sessionId: string): Promise<Session | null>;
  findRefreshWithSessionByHash(tokenHash: string): Promise<RefreshWithSession | null>;
  rotateRefresh(params: {
    session: Session;
    current: RefreshToken;
    next: RefreshToken;
  }): Promise<void>;
  revokeSession(sessionId: string, reason: SessionRevokedReason, at: Date): Promise<void>;
}
