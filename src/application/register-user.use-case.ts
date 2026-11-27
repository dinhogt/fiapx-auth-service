import { buildEnvelope, MessageSource } from '@dinhogt/fiapx-contracts';
import { randomUUID } from 'node:crypto';
import { Email } from '../domain/email';
import { Password } from '../domain/password';
import type { OutboxRelay } from '../domain/ports/outbox-relay';
import type { PasswordHasher } from '../domain/ports/password-hasher';
import type { UserRepository } from '../domain/ports/user-repository';
import { failure, type Result, success } from '../domain/result';
import { UserName } from '../domain/user-name';

export type RegisterUserCommand = {
  name: string;
  email: string;
  password: string;
  correlationId: string;
  traceparent: string;
  userEventsTopicArn: string;
};

export type RegisteredUser = {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
};

export class RegisterUserUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly passwordHasher: PasswordHasher,
    private readonly outboxRelay?: OutboxRelay,
  ) {}

  async execute(command: RegisterUserCommand): Promise<Result<RegisteredUser>> {
    const name = UserName.create(command.name);
    if (!name.ok) {
      return name;
    }
    const email = Email.create(command.email);
    if (!email.ok) {
      return email;
    }
    const password = Password.create(command.password);
    if (!password.ok) {
      return password;
    }

    const existing = await this.users.findByEmail(email.value.value);
    if (existing) {
      return failure('EMAIL_IN_USE');
    }

    const id = randomUUID();
    const passwordHash = await this.passwordHasher.hash(password.value.plain);
    const registeredAt = new Date();

    const envelope = buildEnvelope({
      type: 'user.registered',
      source: MessageSource.AUTH_SERVICE,
      correlationId: command.correlationId,
      traceparent: command.traceparent,
      payload: {
        userId: id,
        email: email.value.value,
        name: name.value.value,
        registeredAt: registeredAt.toISOString(),
      },
    });

    try {
      const user = await this.users.createWithOutbox(
        {
          id,
          name: name.value.value,
          email: email.value.value,
          passwordHash,
        },
        {
          aggregateId: id,
          type: envelope.type,
          destination: command.userEventsTopicArn,
          payload: envelope,
        },
      );

      this.outboxRelay?.kick();

      return success({
        id: user.id,
        name: user.name,
        email: user.email,
        createdAt: user.createdAt,
      });
    } catch (error: unknown) {
      if (isUniqueViolation(error)) {
        return failure('EMAIL_IN_USE');
      }
      throw error;
    }
  }
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }
  return error.code === 'P2002';
}
