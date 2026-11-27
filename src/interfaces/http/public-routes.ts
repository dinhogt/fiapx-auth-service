/**
 * Canonical public surface of auth-service (V4.2).
 * Every HTTP handler must either appear here (and carry `@Public()`)
 * or require a valid Bearer access token.
 */
export const AUTH_PUBLIC_ROUTES = [
  'POST /auth/register',
  'POST /auth/login',
  'POST /auth/refresh',
  'GET /.well-known/openid-configuration',
  'GET /.well-known/jwks.json',
  'GET /health/live',
  'GET /health/ready',
  'GET /metrics',
] as const;

export type AuthPublicRoute = (typeof AUTH_PUBLIC_ROUTES)[number];

export const AUTH_PROTECTED_ROUTES = ['POST /auth/logout', 'GET /auth/me'] as const;
