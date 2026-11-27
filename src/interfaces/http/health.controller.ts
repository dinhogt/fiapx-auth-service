import { Controller, Get, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { HealthService } from '../../infrastructure/health/health.service';
import { Public } from './public.decorator';

@ApiTags('health')
@Controller()
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Public()
  @Get('health/live')
  @ApiOperation({ summary: 'Liveness probe' })
  @ApiOkResponse({ description: 'Processo vivo' })
  live(): { status: 'ok' } {
    return this.health.live();
  }

  @Public()
  @Get('health/ready')
  @ApiOperation({ summary: 'Readiness probe (Postgres + Redis)' })
  @ApiOkResponse({ description: 'Dependências ok ou degradado' })
  async ready(@Res({ passthrough: true }) res: Response) {
    const result = await this.health.ready();
    if (!result.ready) {
      res.status(503);
    }
    return result;
  }
}
