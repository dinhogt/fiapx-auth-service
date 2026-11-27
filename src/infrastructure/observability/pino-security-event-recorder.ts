import { Injectable, Logger } from '@nestjs/common';
import type {
  SecurityEvent,
  SecurityEventRecorder,
} from '../../domain/ports/security-event-recorder';

@Injectable()
export class PinoSecurityEventRecorder implements SecurityEventRecorder {
  private readonly logger = new Logger('SecurityEvent');

  record(event: SecurityEvent): void {
    this.logger.warn(event);
  }
}
