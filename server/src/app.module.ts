import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { join } from 'path';
import { WidgetsModule } from './widgets/widgets.module';
import { GenerateModule } from './generate/generate.module';
import { Widget } from './widgets/entities/widget.entity';
import { WidgetData } from './widgets/entities/widget-data.entity';
import { NovaGoal } from './nova/entities/nova-goal.entity';
import { WebSearchModule } from './web-search/web-search.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { AetherModule } from './aether/aether.module';
import { NovaModule } from './nova/nova.module';

const rootEnvPath = join(__dirname, '..', '..', '.env');

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [rootEnvPath, '.env'],
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'mysql',
        host: config.get('MYSQL_HOST', 'localhost'),
        port: parseInt(config.get('MYSQL_PORT', '3306'), 10),
        username: config.get('MYSQL_USER', 'root'),
        password: config.get('MYSQL_PASSWORD', ''),
        database: config.get('MYSQL_DATABASE', 'aether'),
        entities: [Widget, WidgetData, NovaGoal],
        synchronize: true,
      }),
    }),
    WidgetsModule,
    GenerateModule,
    WebSearchModule,
    IntegrationsModule,
    AetherModule,
    NovaModule,
  ],
})
export class AppModule {}
