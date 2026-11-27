import type { Request } from 'express';

const CLIENT_IP_HEADER = 'x-client-ip';

/**
 * S-01: use `x-client-ip` only when TRUST_GATEWAY_IP=true (gateway overwrite).
 * Never trust X-Forwarded-For from the client.
 */
export function resolveClientIp(req: Request, trustGatewayIp: boolean): string {
  if (trustGatewayIp) {
    const header = req.header(CLIENT_IP_HEADER);
    if (header && header.trim().length > 0) {
      return header.trim();
    }
  }
  const remote = req.socket.remoteAddress;
  if (remote && remote.length > 0) {
    return remote;
  }
  return '0.0.0.0';
}
