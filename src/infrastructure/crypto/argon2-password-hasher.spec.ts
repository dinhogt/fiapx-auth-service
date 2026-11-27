import { Argon2PasswordHasher } from './argon2-password-hasher';

describe('Argon2PasswordHasher', () => {
  const hasher = new Argon2PasswordHasher();

  it('hashes with argon2id and verifies the plaintext', async () => {
    const hash = await hasher.hash('Str0ng-Passw0rd!');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(hash).toMatch(/m=19456/);
    expect(hash).toMatch(/t=2/);
    expect(hash).toMatch(/p=1/);
    await expect(hasher.verify(hash, 'Str0ng-Passw0rd!')).resolves.toBe(true);
    await expect(hasher.verify(hash, 'wrong-password')).resolves.toBe(false);
  }, 15_000);
});
