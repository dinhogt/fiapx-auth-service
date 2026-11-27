import {
  isCommonPassword,
  loadCommonPasswords,
  resetCommonPasswordsCache,
} from './common-passwords';

describe('common-passwords', () => {
  beforeEach(() => {
    resetCommonPasswordsCache();
  });

  it('loads about 10k entries and memoizes', () => {
    const first = loadCommonPasswords();
    const second = loadCommonPasswords();
    expect(first.size).toBe(10000);
    expect(second).toBe(first);
  });

  it('detects known common passwords', () => {
    expect(isCommonPassword('password')).toBe(true);
    expect(isCommonPassword('not-in-the-common-list-xyz')).toBe(false);
  });
});
