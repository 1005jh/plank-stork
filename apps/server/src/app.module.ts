import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { ControlGateway } from './control.gateway';

@Module({
  controllers: [HealthController],
  providers: [ControlGateway],
})
export class AppModule {}
