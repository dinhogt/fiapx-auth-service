/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
import { SwaggerModule } from '@nestjs/swagger';
import type { OpenAPIObject } from '@nestjs/swagger';
import { buildOpenApiDocument, setupSwaggerUi } from './swagger';

const sampleDocument: OpenAPIObject = {
  openapi: '3.0.0',
  info: { title: 't', version: '0.1.0' },
  paths: {},
};

describe('swagger helpers', () => {
  it('builds an OpenAPI document via SwaggerModule', () => {
    const spy = jest.spyOn(SwaggerModule, 'createDocument').mockReturnValue(sampleDocument);
    expect(buildOpenApiDocument({} as never)).toEqual(sampleDocument);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('skips Swagger UI in homolog and enables it otherwise', () => {
    const setup = jest.spyOn(SwaggerModule, 'setup').mockReturnValue(undefined as never);
    const create = jest.spyOn(SwaggerModule, 'createDocument').mockReturnValue(sampleDocument);

    setupSwaggerUi({} as never, 'homolog');
    expect(setup).not.toHaveBeenCalled();

    setupSwaggerUi({} as never, 'local');
    expect(setup).toHaveBeenCalledWith('docs', expect.anything(), expect.any(Object), {
      jsonDocumentUrl: 'docs-json',
    });

    setup.mockRestore();
    create.mockRestore();
  });
});
