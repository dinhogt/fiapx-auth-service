import type { Request } from 'express';
import { resolveClientIp } from './client-ip';

function makeReq(opts: { headers?: Record<string, string>; remoteAddress?: string }): Request {
  return {
    header: (name: string) => opts.headers?.[name.toLowerCase()],
    socket: { remoteAddress: opts.remoteAddress },
  } as unknown as Request;
}

describe('resolveClientIp', () => {
  it('uses x-client-ip when TRUST_GATEWAY_IP is true', () => {
    const ip = resolveClientIp(
      makeReq({ headers: { 'x-client-ip': '203.0.113.10' }, remoteAddress: '10.0.0.1' }),
      true,
    );
    expect(ip).toBe('203.0.113.10');
  });

  it('ignores x-client-ip when TRUST_GATEWAY_IP is false', () => {
    const ip = resolveClientIp(
      makeReq({ headers: { 'x-client-ip': '203.0.113.10' }, remoteAddress: '10.0.0.1' }),
      false,
    );
    expect(ip).toBe('10.0.0.1');
  });

  it('falls back to 0.0.0.0 when no address is available', () => {
    expect(resolveClientIp(makeReq({}), false)).toBe('0.0.0.0');
  });
});
