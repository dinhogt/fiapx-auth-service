export type SecurityEvent = {
  type: 'security.refresh_reuse';
  sid: string;
  userId: string;
  at: string;
};

export interface SecurityEventRecorder {
  record(event: SecurityEvent): void;
}
