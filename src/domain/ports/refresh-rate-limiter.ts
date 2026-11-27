import { RateLimitUnavailableError, type RateLimitDecision } from './login-rate-limiter';

export { RateLimitUnavailableError, type RateLimitDecision };

export interface RefreshRateLimiter {
  /** Increments IP counter. Throws RateLimitUnavailableError when Redis is down. */
  consume(ip: string): Promise<RateLimitDecision>;
}
