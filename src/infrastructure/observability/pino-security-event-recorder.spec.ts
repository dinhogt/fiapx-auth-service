import { PinoSecurityEventRecorder } from './pino-security-event-recorder';

describe('PinoSecurityEventRecorder', () => {
  it('records a security.refresh_reuse event without throwing', () => {
    const recorder = new PinoSecurityEventRecorder();
    expect(() =>
      recorder.record({
        type: 'security.refresh_reuse',
        sid: '33333333-3333-4333-8333-333333333333',
        userId: '11111111-1111-4111-8111-111111111111',
        at: new Date().toISOString(),
      }),
    ).not.toThrow();
  });
});
