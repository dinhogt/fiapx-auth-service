import { generateKeyPair, exportPKCS8 } from 'jose';

/** Ephemeral RSA PKCS8 PEM for tests (fictional key, never for production). */
export async function createTestRsaPem(): Promise<{ pem: string; kid: string }> {
  const { privateKey } = await generateKeyPair('RS256', { extractable: true });
  const pem = await exportPKCS8(privateKey);
  return { pem, kid: 'test-kid-1' };
}
