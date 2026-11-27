# fiapx-auth-service

Serviço de autenticação do **FIAP X Video Processor**: cadastro, login, refresh rotativo com detecção de reuso, logout, JWKS/OIDC e sessão revogável (`sid` no Redis).

Documentação canônica do hackathon: [`dinhogt/fiapx-video-service/docs`](https://github.com/dinhogt/fiapx-video-service/tree/develop/docs).

## O que faz

- `POST /auth/register` — argon2id + outbox `user.registered`
- `POST /auth/login` / `POST /auth/refresh` — `TokenPair` (access JWT RS256 15 min + refresh opaco)
- `POST /auth/logout` / `GET /auth/me` — Bearer obrigatório; logout grava `revoked:sid`
- `GET /.well-known/openid-configuration` e `GET /.well-known/jwks.json`
- Outbox relay (1 s, `SKIP LOCKED`) → SNS `user-events`
- Reidratação de revogação (boot + 60 s, advisory lock)

OpenAPI versionado: [`docs/api/openapi-auth.json`](docs/api/openapi-auth.json). UI Swagger em `/docs` (fora de `APP_ENV=homolog`).

## Pré-requisitos

- Node 22 + corepack (yarn 4)
- Docker Compose do `fiapx-video-service` (Postgres, Redis, LocalStack)
- `NPM_TOKEN` com `read:packages` para `@dinhogt/fiapx-contracts` (GitHub Packages)

## Como rodar (local)

```bash
# 1) Subir a infra (a partir do video-service)
cd ../fiapx-video-service && make up

# 2) Configurar este repo
cp .env.example .env
# Gere a chave RS256 e cole em JWT_PRIVATE_KEY_PEM (PKCS8, \n escapado):
#   openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048

corepack enable
yarn install
yarn prisma:migrate:deploy
yarn start
# API em http://localhost:3001  |  Swagger em http://localhost:3001/docs
```

Compose multi-repo (profile `apps`) também sobe este serviço via build do irmão `../fiapx-auth-service`.

## Variáveis principais

| Variável                                                   | Descrição                                     |
| ---------------------------------------------------------- | --------------------------------------------- |
| `DATABASE_URL`                                             | Postgres (`?schema=auth`)                     |
| `REDIS_URL`                                                | Cache de revogação e rate limit (fail-closed) |
| `JWT_PRIVATE_KEY_PEM` / `JWT_KID`                          | Assinatura RS256                              |
| `JWT_ISSUER` / `JWT_AUDIENCE` / `JWKS_URL`                 | Claims e discovery                            |
| `USER_EVENTS_TOPIC_ARN`                                    | Destino SNS da outbox                         |
| `ACCESS_TTL` / `REFRESH_IDLE_TTL` / `SESSION_ABSOLUTE_TTL` | 900 / 3600 / 28800                            |
| `TRUST_GATEWAY_IP`                                         | Se `true`, usa `x-client-ip` (S-01)           |
| `NPM_TOKEN`                                                | Leitura do GitHub Packages                    |

Valores fictícios de exemplo: [`.env.example`](.env.example).

## Testes e qualidade

```bash
yarn lint
yarn depcruise
yarn test          # unit
yarn test:int      # integration (compose necessário)
yarn test:cov      # unit + int, gate ≥ 80%
yarn openapi:export
yarn build
```

## Links

- Playbook: `docs/execucao/playbook.md` (fase F2) no repo canônico
- ADR-006 (sessão/JWT), ADR-004 (outbox), ADR-008 (Redis)
- Contrato HTTP: `docs/05-especificacao-tecnica.md` § B1
