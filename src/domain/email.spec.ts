import { Email } from './email';

describe('Email', () => {
  it('normalizes and accepts a valid address', () => {
    const result = Email.create('  User@Example.COM ');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.value).toBe('user@example.com');
      expect(result.value.toString()).toBe('user@example.com');
    }
  });

  it('rejects empty, oversized, and malformed addresses', () => {
    expect(Email.create('').ok).toBe(false);
    expect(Email.create('   ').ok).toBe(false);
    expect(Email.create('no-at-sign').ok).toBe(false);
    expect(Email.create('a@b').ok).toBe(false);
    expect(Email.create(`${'a'.repeat(250)}@x.com`).ok).toBe(false);
  });

  it('compares by normalized value', () => {
    const a = Email.create('a@b.co');
    const b = Email.create('A@B.CO');
    const c = Email.create('other@b.co');
    expect(a.ok && b.ok && a.value.equals(b.value)).toBe(true);
    expect(a.ok && c.ok && a.value.equals(c.value)).toBe(false);
  });
});
