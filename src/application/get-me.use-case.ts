import type { UserRepository } from '../domain/ports/user-repository';
import { failure, type Result, success } from '../domain/result';

export type GetMeCommand = {
  userId: string;
};

export type MeView = {
  id: string;
  name: string;
  email: string;
};

export class GetMeUseCase {
  constructor(private readonly users: UserRepository) {}

  async execute(command: GetMeCommand): Promise<Result<MeView>> {
    const user = await this.users.findById(command.userId);
    if (!user) {
      return failure('USER_NOT_FOUND');
    }
    return success({
      id: user.id,
      name: user.name,
      email: user.email,
    });
  }
}
