import type { RefreshToken } from '../refresh-token';
import type { Session } from '../session';

export interface SessionRepository {
  createWithRefresh(session: Session, refresh: RefreshToken): Promise<void>;
}
