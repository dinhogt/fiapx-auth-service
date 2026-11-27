import { Inject, Injectable } from '@nestjs/common';
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import type { MessagePublisher, PublishMessageInput } from '../../domain/ports/message-publisher';
import type { AuthEnv } from '../config/env';
import { APP_ENV_CONFIG } from '../config/tokens';

@Injectable()
export class SnsMessagePublisher implements MessagePublisher {
  private readonly client: SNSClient;

  constructor(@Inject(APP_ENV_CONFIG) env: AuthEnv) {
    this.client = new SNSClient({
      region: env.AWS_REGION,
      endpoint: env.AWS_ENDPOINT,
      credentials:
        env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
          ? {
              accessKeyId: env.AWS_ACCESS_KEY_ID,
              secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
            }
          : undefined,
    });
  }

  async publish(input: PublishMessageInput): Promise<void> {
    await this.client.send(
      new PublishCommand({
        TopicArn: input.destination,
        Message: JSON.stringify(input.body),
        MessageAttributes: {
          type: {
            DataType: 'String',
            StringValue: input.type,
          },
        },
      }),
    );
  }
}
