import {
  SessionRevocationStoreUnavailableError,
  type SessionRevocationChecker,
} from '../../shared/jwt-auth/session-revocation';

export { SessionRevocationStoreUnavailableError };

export interface SessionRevocationStore extends SessionRevocationChecker {
  /** Marks sid as revoked in the fast path (TTL = access token lifetime). */
  revoke(sid: string): Promise<void>;
}
