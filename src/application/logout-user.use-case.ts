import type { SessionRepository } from '../domain/ports/session-repository';
import type { SessionRevocationStore } from '../domain/ports/session-revocation-store';
import { SessionRevocationStoreUnavailableError } from '../domain/ports/session-revocation-store';
import { failure, type Result, success } from '../domain/result';

export type LogoutUserCommand = {
  sid: string;
  userId: string;
};

export class LogoutUserUseCase {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly revocationStore: SessionRevocationStore,
  ) {}

  async execute(command: LogoutUserCommand): Promise<Result<void>> {
    const session = await this.sessions.findById(command.sid);
    if (!session || session.userId !== command.userId) {
      return failure('INVALID_SESSION');
    }

    const now = new Date();
    if (!session.isRevoked()) {
      const revoked = session.revoke('LOGOUT', now);
      if (!revoked.ok) {
        return failure(revoked.code);
      }
      await this.sessions.revokeSession(session.id, 'LOGOUT', now);
    }

    try {
      await this.revocationStore.revoke(session.id);
    } catch (error: unknown) {
      if (!(error instanceof SessionRevocationStoreUnavailableError)) {
        throw error;
      }
      // Postgres is the source of truth; Redis is recovered by rehydration (F2.8).
    }

    return success(undefined);
  }
}
