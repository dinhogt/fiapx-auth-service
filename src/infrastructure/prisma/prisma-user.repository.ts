import { Injectable } from '@nestjs/common';
import type {
  CreateUserInput,
  OutboxInsert,
  PersistedUser,
  UserRepository,
} from '../../domain/ports/user-repository';
import { PrismaService } from './prisma.service';

@Injectable()
export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByEmail(email: string): Promise<PersistedUser | null> {
    const row = await this.prisma.user.findUnique({ where: { email } });
    return row ? toPersisted(row) : null;
  }

  async createWithOutbox(user: CreateUserInput, outbox: OutboxInsert): Promise<PersistedUser> {
    const created = await this.prisma.$transaction(async (tx) => {
      const persisted = await tx.user.create({
        data: {
          id: user.id,
          name: user.name,
          email: user.email,
          passwordHash: user.passwordHash,
        },
      });
      await tx.outbox.create({
        data: {
          aggregateId: outbox.aggregateId,
          type: outbox.type,
          destination: outbox.destination,
          payload: outbox.payload as object,
        },
      });
      return persisted;
    });
    return toPersisted(created);
  }
}

function toPersisted(row: {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
}): PersistedUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    passwordHash: row.passwordHash,
    createdAt: row.createdAt,
  };
}
