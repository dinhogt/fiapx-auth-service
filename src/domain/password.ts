import { isCommonPassword } from './common-passwords';
import { failure, type Result, success } from './result';

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export class Password {
  private constructor(readonly plain: string) {}

  static create(plain: string): Result<Password> {
    if (plain.length < PASSWORD_MIN_LENGTH || plain.length > PASSWORD_MAX_LENGTH) {
      return failure('INVALID_PASSWORD_LENGTH');
    }
    if (isCommonPassword(plain)) {
      return failure('COMMON_PASSWORD');
    }
    return success(new Password(plain));
  }
}
