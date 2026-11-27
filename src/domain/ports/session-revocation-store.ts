export class SessionRevocationStoreUnavailableError extends Error {
  constructor(message = 'Session revocation store unavailable') {
    super(message);
    this.name = 'SessionRevocationStoreUnavailableError';
  }
}

export interface SessionRevocationStore {
  /** Marks sid as revoked in the fast path (TTL = access token lifetime). */
  revoke(sid: string): Promise<void>;
  isRevoked(sid: string): Promise<boolean>;
}
