import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('FIAP X Auth Service')
    .setDescription(
      'Autenticação FIAP X: cadastro, login, refresh rotativo, logout, JWKS/OIDC e sessão revogável.',
    )
    .setVersion('0.1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Access token RS256' },
      'bearer',
    )
    .addTag('auth')
    .addTag('well-known')
    .addTag('health')
    .addTag('metrics')
    .build();

  return SwaggerModule.createDocument(app, config, {
    operationIdFactory: (_controllerKey: string, methodKey: string) => methodKey,
  });
}

/** Swagger UI is enabled only outside homolog (B1). */
export function setupSwaggerUi(app: INestApplication, appEnv: string): void {
  if (appEnv === 'homolog') {
    return;
  }
  const document = buildOpenApiDocument(app);
  SwaggerModule.setup('docs', app, document, {
    jsonDocumentUrl: 'docs-json',
  });
}
