export type RateLimitDecision = 'allow' | 'block';

export class RateLimitUnavailableError extends Error {
  constructor(message = 'Rate limit store unavailable') {
    super(message);
    this.name = 'RateLimitUnavailableError';
  }
}

export interface LoginRateLimiter {
  /**
   * Increments email + IP counters. Returns `block` if either exceeds the limit.
   * Throws RateLimitUnavailableError when Redis is down (fail-closed).
   */
  consume(email: string, ip: string): Promise<RateLimitDecision>;
}
