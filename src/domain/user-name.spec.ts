import { UserName } from './user-name';

describe('UserName', () => {
  it('accepts names between 2 and 120 characters', () => {
    expect(UserName.create('Ab').ok).toBe(true);
    expect(UserName.create('A'.repeat(120)).ok).toBe(true);
  });

  it('trims whitespace', () => {
    const result = UserName.create('  Ana  ');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.value).toBe('Ana');
    }
  });

  it('rejects empty, short and long names', () => {
    expect(UserName.create('')).toEqual({ ok: false, code: 'INVALID_NAME_LENGTH' });
    expect(UserName.create('A')).toEqual({ ok: false, code: 'INVALID_NAME_LENGTH' });
    expect(UserName.create('A'.repeat(121))).toEqual({ ok: false, code: 'INVALID_NAME_LENGTH' });
  });
});
