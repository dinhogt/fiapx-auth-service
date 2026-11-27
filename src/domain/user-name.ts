import { failure, type Result, success } from './result';

export const USER_NAME_MIN_LENGTH = 2;
export const USER_NAME_MAX_LENGTH = 120;

export class UserName {
  private constructor(readonly value: string) {}

  static create(raw: string): Result<UserName> {
    const trimmed = raw.trim();
    if (trimmed.length < USER_NAME_MIN_LENGTH || trimmed.length > USER_NAME_MAX_LENGTH) {
      return failure('INVALID_NAME_LENGTH');
    }
    return success(new UserName(trimmed));
  }

  toString(): string {
    return this.value;
  }
}
