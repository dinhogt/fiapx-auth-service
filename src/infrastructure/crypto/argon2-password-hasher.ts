import { Injectable } from '@nestjs/common';
import { hash, verify } from 'argon2';
import type { PasswordHasher } from '../../domain/ports/password-hasher';

/** ADR-006 / B9: argon2id m=19 MiB, t=2, p=1. argon2id enum value = 2. */
const ARGON2ID = 2 as const;

@Injectable()
export class Argon2PasswordHasher implements PasswordHasher {
  hash(plain: string): Promise<string> {
    return hash(plain, {
      type: ARGON2ID,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });
  }

  verify(encoded: string, plain: string): Promise<boolean> {
    return verify(encoded, plain);
  }
}
