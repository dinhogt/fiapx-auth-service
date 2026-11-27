/** Normalizes PEM from env (supports literal newlines or `\n` escapes). */
export function normalizePem(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.includes('-----BEGIN') && trimmed.includes('\n')) {
    return trimmed.endsWith('\n') ? trimmed : `${trimmed}\n`;
  }
  return trimmed.replace(/\\n/g, '\n');
}
