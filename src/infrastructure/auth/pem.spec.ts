import { normalizePem } from './pem';

describe('normalizePem', () => {
  it('expands escaped newlines', () => {
    const raw = '-----BEGIN TEST KEY-----\\nABC\\n-----END TEST KEY-----\\n';
    expect(normalizePem(raw)).toBe('-----BEGIN TEST KEY-----\nABC\n-----END TEST KEY-----\n');
  });

  it('keeps literal multiline PEM', () => {
    const raw = '-----BEGIN TEST KEY-----\nABC\n-----END TEST KEY-----';
    expect(normalizePem(raw)).toBe('-----BEGIN TEST KEY-----\nABC\n-----END TEST KEY-----\n');
  });
});
