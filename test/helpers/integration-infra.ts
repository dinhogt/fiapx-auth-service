import {
  CreateQueueCommand,
  GetQueueAttributesCommand,
  SQSClient,
  SetQueueAttributesCommand,
} from '@aws-sdk/client-sqs';
import {
  CreateTopicCommand,
  SNSClient,
  SetSubscriptionAttributesCommand,
  SubscribeCommand,
} from '@aws-sdk/client-sns';
import { LocalstackContainer, type StartedLocalStackContainer } from '@testcontainers/localstack';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

export type IntegrationInfra = {
  databaseUrl: string;
  redisUrl: string;
  awsEndpoint: string;
  userEventsTopicArn: string;
  userContactsQueueUrl: string;
};

type Started = {
  postgres: StartedPostgreSqlContainer;
  redis: StartedRedisContainer;
  localstack: StartedLocalStackContainer;
  urls: IntegrationInfra;
};

const RUNTIME_FILE = join(__dirname, '.integration-runtime.json');

let started: Started | undefined;
let starting: Promise<IntegrationInfra> | undefined;

function readRuntimeFile(): IntegrationInfra | undefined {
  if (!existsSync(RUNTIME_FILE)) {
    return undefined;
  }
  return JSON.parse(readFileSync(RUNTIME_FILE, 'utf8')) as IntegrationInfra;
}

function writeRuntimeFile(urls: IntegrationInfra): void {
  writeFileSync(RUNTIME_FILE, JSON.stringify(urls), 'utf8');
}

const LOCAL_DATABASE_URL =
  'postgresql://auth_svc:change-me@localhost:5432/fiapx?schema=auth&connection_limit=5&sslmode=disable';
const LOCAL_REDIS_URL = 'redis://localhost:6379';
const LOCAL_AWS_ENDPOINT = 'http://localhost:4566';
const LOCAL_TOPIC_ARN = 'arn:aws:sns:us-east-1:000000000000:fiapx-local-user-events';
const LOCAL_QUEUE_URL = `${LOCAL_AWS_ENDPOINT}/000000000000/fiapx-local-user-contacts`;

function preferLocalCompose(): boolean {
  if (process.env.CI === 'true' || process.env.USE_TESTCONTAINERS === 'true') {
    return false;
  }
  if (process.env.DATABASE_URL || process.env.REDIS_URL || process.env.AWS_ENDPOINT) {
    return true;
  }
  return true;
}

async function canReachPostgres(url: string): Promise<boolean> {
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 1_500 });
  try {
    await client.connect();
    await client.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function bootstrapPostgres(postgres: StartedPostgreSqlContainer): Promise<string> {
  const baseUrl = postgres.getConnectionUri();
  const client = new Client({ connectionString: baseUrl });
  await client.connect();
  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS citext');
    await client.query('CREATE SCHEMA IF NOT EXISTS auth');
  } finally {
    await client.end();
  }

  const databaseUrl = `${baseUrl}?schema=auth&connection_limit=5&sslmode=disable`;
  execFileSync('yarn', ['prisma', 'migrate', 'deploy'], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  });
  return databaseUrl;
}

async function bootstrapLocalstack(endpoint: string): Promise<{
  topicArn: string;
  queueUrl: string;
}> {
  const credentials = { accessKeyId: 'test', secretAccessKey: 'test' };
  const region = 'us-east-1';
  const sqs = new SQSClient({ region, endpoint, credentials });
  const sns = new SNSClient({ region, endpoint, credentials });

  const dlq = await sqs.send(
    new CreateQueueCommand({
      QueueName: 'fiapx-local-user-contacts-dlq',
      Attributes: {
        VisibilityTimeout: '30',
        MessageRetentionPeriod: '1209600',
      },
    }),
  );
  const dlqUrl = dlq.QueueUrl!;
  const dlqAttrs = await sqs.send(
    new GetQueueAttributesCommand({
      QueueUrl: dlqUrl,
      AttributeNames: ['QueueArn'],
    }),
  );
  const dlqArn = dlqAttrs.Attributes!.QueueArn!;

  const queue = await sqs.send(
    new CreateQueueCommand({
      QueueName: 'fiapx-local-user-contacts',
      Attributes: {
        VisibilityTimeout: '30',
        MessageRetentionPeriod: '345600',
        ReceiveMessageWaitTimeSeconds: '20',
        RedrivePolicy: JSON.stringify({
          deadLetterTargetArn: dlqArn,
          maxReceiveCount: 5,
        }),
      },
    }),
  );
  const queueUrl = queue.QueueUrl!;
  const queueAttrs = await sqs.send(
    new GetQueueAttributesCommand({
      QueueUrl: queueUrl,
      AttributeNames: ['QueueArn'],
    }),
  );
  const queueArn = queueAttrs.Attributes!.QueueArn!;

  const topic = await sns.send(new CreateTopicCommand({ Name: 'fiapx-local-user-events' }));
  const topicArn = topic.TopicArn!;

  await sqs.send(
    new SetQueueAttributesCommand({
      QueueUrl: queueUrl,
      Attributes: {
        Policy: JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Principal: '*',
              Action: 'sqs:SendMessage',
              Resource: queueArn,
              Condition: { ArnEquals: { 'aws:SourceArn': topicArn } },
            },
          ],
        }),
      },
    }),
  );

  const sub = await sns.send(
    new SubscribeCommand({
      TopicArn: topicArn,
      Protocol: 'sqs',
      Endpoint: queueArn,
      Attributes: { RawMessageDelivery: 'true' },
    }),
  );
  await sns.send(
    new SetSubscriptionAttributesCommand({
      SubscriptionArn: sub.SubscriptionArn!,
      AttributeName: 'FilterPolicyScope',
      AttributeValue: 'MessageBody',
    }),
  );
  await sns.send(
    new SetSubscriptionAttributesCommand({
      SubscriptionArn: sub.SubscriptionArn!,
      AttributeName: 'FilterPolicy',
      AttributeValue: JSON.stringify({ type: ['user.registered'] }),
    }),
  );

  return { topicArn, queueUrl };
}

async function startTestcontainers(): Promise<IntegrationInfra> {
  const [postgres, redis, localstack] = await Promise.all([
    new PostgreSqlContainer('postgres:16-alpine').withDatabase('fiapx').start(),
    new RedisContainer('redis:7-alpine').start(),
    new LocalstackContainer('localstack/localstack:4')
      .withEnvironment({ SERVICES: 'sns,sqs' })
      .start(),
  ]);

  const databaseUrl = await bootstrapPostgres(postgres);
  const redisUrl = redis.getConnectionUrl();
  const awsEndpoint = localstack.getConnectionUri();
  const { topicArn, queueUrl } = await bootstrapLocalstack(awsEndpoint);

  const urls: IntegrationInfra = {
    databaseUrl,
    redisUrl,
    awsEndpoint,
    userEventsTopicArn: topicArn,
    userContactsQueueUrl: queueUrl,
  };
  started = { postgres, redis, localstack, urls };
  writeRuntimeFile(urls);
  return urls;
}

/**
 * Ensures Postgres + Redis (+ LocalStack when needed) for *.int-spec.ts.
 * Prefer local compose when reachable; otherwise start Testcontainers (CI).
 * Runtime file survives Jest module resets so suites reuse one container set.
 */
export async function ensureIntegrationInfra(): Promise<IntegrationInfra> {
  if (started) {
    return started.urls;
  }
  const fromFile = readRuntimeFile();
  if (fromFile) {
    return fromFile;
  }
  if (starting) {
    return starting;
  }

  starting = (async () => {
    const existing = readRuntimeFile();
    if (existing) {
      return existing;
    }
    if (preferLocalCompose()) {
      const databaseUrl = process.env.DATABASE_URL ?? LOCAL_DATABASE_URL;
      const redisUrl = process.env.REDIS_URL ?? LOCAL_REDIS_URL;
      const awsEndpoint = process.env.AWS_ENDPOINT ?? LOCAL_AWS_ENDPOINT;
      if (await canReachPostgres(databaseUrl)) {
        return {
          databaseUrl,
          redisUrl,
          awsEndpoint,
          userEventsTopicArn: process.env.USER_EVENTS_TOPIC_ARN ?? LOCAL_TOPIC_ARN,
          userContactsQueueUrl: process.env.USER_CONTACTS_QUEUE_URL ?? LOCAL_QUEUE_URL,
        };
      }
    }
    return startTestcontainers();
  })();

  try {
    return await starting;
  } finally {
    starting = undefined;
  }
}

export async function applyIntegrationEnv(
  overrides: Record<string, string> = {},
): Promise<IntegrationInfra> {
  const infra = await ensureIntegrationInfra();
  Object.assign(process.env, {
    DATABASE_URL: infra.databaseUrl,
    REDIS_URL: infra.redisUrl,
    AWS_ENDPOINT: infra.awsEndpoint,
    AWS_REGION: 'us-east-1',
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID ?? 'test',
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
    USER_EVENTS_TOPIC_ARN: infra.userEventsTopicArn,
    USER_CONTACTS_QUEUE_URL: infra.userContactsQueueUrl,
    ...overrides,
  });
  return infra;
}

export async function stopIntegrationInfra(): Promise<void> {
  if (!started) {
    return;
  }
  const current = started;
  started = undefined;
  await Promise.allSettled([
    current.postgres.stop(),
    current.redis.stop(),
    current.localstack.stop(),
  ]);
}
