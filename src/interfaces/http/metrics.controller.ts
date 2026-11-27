import { Controller, Get, Header } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { collectDefaultMetrics, Registry } from 'prom-client';
import { Public } from './public.decorator';

const registry = new Registry();
collectDefaultMetrics({ register: registry });

@ApiTags('metrics')
@Controller()
export class MetricsController {
  @Public()
  @Get('metrics')
  @Header('Content-Type', registry.contentType)
  @ApiOperation({ summary: 'Prometheus metrics' })
  @ApiOkResponse({ description: 'Text exposition format' })
  async metrics(): Promise<string> {
    return registry.metrics();
  }
}
