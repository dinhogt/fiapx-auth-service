export type PersistedUser = {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
};

export type CreateUserInput = {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
};

export type OutboxInsert = {
  aggregateId: string;
  type: string;
  destination: string;
  payload: unknown;
};

export interface UserRepository {
  findByEmail(email: string): Promise<PersistedUser | null>;
  createWithOutbox(user: CreateUserInput, outbox: OutboxInsert): Promise<PersistedUser>;
}
