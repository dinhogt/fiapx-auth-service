import { failure, type Result, success } from './result';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_LENGTH = 254;

export class Email {
  private constructor(readonly value: string) {}

  static create(raw: string): Result<Email> {
    const normalized = raw.trim().toLowerCase();
    if (normalized.length === 0 || normalized.length > MAX_LENGTH) {
      return failure('INVALID_EMAIL');
    }
    if (!EMAIL_RE.test(normalized)) {
      return failure('INVALID_EMAIL');
    }
    return success(new Email(normalized));
  }

  equals(other: Email): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
