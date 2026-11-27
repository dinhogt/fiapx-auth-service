import { Password } from './password';

describe('Password', () => {
  it('accepts a strong password within 12–128 chars', () => {
    const result = Password.create('Str0ng-Passw0rd!');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.plain).toBe('Str0ng-Passw0rd!');
    }
  });

  it('rejects short and long passwords', () => {
    expect(Password.create('short').ok).toBe(false);
    expect(Password.create('x'.repeat(11)).ok).toBe(false);
    expect(Password.create('x'.repeat(129)).ok).toBe(false);
    expect(Password.create('x'.repeat(12)).ok).toBe(true);
    expect(Password.create('x'.repeat(128)).ok).toBe(true);
  });

  it('rejects passwords from the top-10k common list', () => {
    const result = Password.create('unbelievable');
    expect(result).toEqual({ ok: false, code: 'COMMON_PASSWORD' });
  });
});
