import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { HealthController } from './health.controller';
import { MetricsController } from './metrics.controller';
import { WellKnownController } from './well-known.controller';
import { IS_PUBLIC_KEY } from './public.decorator';
import { AUTH_PROTECTED_ROUTES, AUTH_PUBLIC_ROUTES } from './public-routes';

const METHOD_NAME: Record<number, string> = {
  [RequestMethod.GET]: 'GET',
  [RequestMethod.POST]: 'POST',
  [RequestMethod.PUT]: 'PUT',
  [RequestMethod.DELETE]: 'DELETE',
  [RequestMethod.PATCH]: 'PATCH',
  [RequestMethod.OPTIONS]: 'OPTIONS',
  [RequestMethod.HEAD]: 'HEAD',
  [RequestMethod.ALL]: 'ALL',
};

function joinPath(controllerPath: string | string[], methodPath: string | string[]): string {
  const base = Array.isArray(controllerPath) ? controllerPath[0] : controllerPath;
  const leaf = Array.isArray(methodPath) ? methodPath[0] : methodPath;
  const left = (base ?? '').replace(/^\//, '').replace(/\/$/, '');
  const right = (leaf ?? '').replace(/^\//, '');
  if (!left && !right) {
    return '/';
  }
  if (!left) {
    return `/${right}`;
  }
  if (!right) {
    return `/${left}`;
  }
  return `/${left}/${right}`;
}

function collectControllerRoutes(
  ControllerClass: new (...args: never[]) => object,
): Array<{ key: string; isPublic: boolean }> {
  const controllerPath = Reflect.getMetadata(PATH_METADATA, ControllerClass) as
    | string
    | string[]
    | undefined;
  const proto = ControllerClass.prototype as Record<string, unknown>;
  const routes: Array<{ key: string; isPublic: boolean }> = [];

  for (const propertyName of Object.getOwnPropertyNames(proto)) {
    if (propertyName === 'constructor') {
      continue;
    }
    const handler = proto[propertyName];
    if (typeof handler !== 'function') {
      continue;
    }
    const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
    if (method === undefined) {
      continue;
    }
    const methodPath = Reflect.getMetadata(PATH_METADATA, handler) as string | string[] | undefined;
    const isPublic = Boolean(Reflect.getMetadata(IS_PUBLIC_KEY, handler));
    const verb = METHOD_NAME[method] ?? String(method);
    const path = joinPath(controllerPath ?? '', methodPath ?? '');
    routes.push({ key: `${verb} ${path}`, isPublic });
  }
  return routes;
}

describe('public routes inventory (V4.2)', () => {
  it('marks exactly the documented public routes with @Public()', () => {
    const discovered = [
      ...collectControllerRoutes(AuthController),
      ...collectControllerRoutes(HealthController),
      ...collectControllerRoutes(MetricsController),
      ...collectControllerRoutes(WellKnownController),
    ];

    const publicKeys = discovered.filter((r) => r.isPublic).map((r) => r.key).sort();
    const protectedKeys = discovered.filter((r) => !r.isPublic).map((r) => r.key).sort();

    expect(publicKeys).toEqual([...AUTH_PUBLIC_ROUTES].sort());
    expect(protectedKeys).toEqual([...AUTH_PROTECTED_ROUTES].sort());
  });
});
