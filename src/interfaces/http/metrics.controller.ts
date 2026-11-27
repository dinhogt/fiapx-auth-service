import { Controller, Get, Header } from '@nestjs/common';
import { collectDefaultMetrics, Registry } from 'prom-client';
import { Public } from './public.decorator';

const registry = new Registry();
collectDefaultMetrics({ register: registry });

@Controller()
export class MetricsController {
  @Public()
  @Get('metrics')
  @Header('Content-Type', registry.contentType)
  async metrics(): Promise<string> {
    return registry.metrics();
  }
}
