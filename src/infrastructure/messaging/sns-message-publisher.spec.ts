import { PublishCommand } from '@aws-sdk/client-sns';
import { SnsMessagePublisher } from './sns-message-publisher';
import type { AuthEnv } from '../config/env';

describe('SnsMessagePublisher', () => {
  it('publishes JSON body with type message attribute', async () => {
    const publisher = new SnsMessagePublisher({
      AWS_REGION: 'us-east-1',
      AWS_ENDPOINT: 'http://localhost:4566',
      AWS_ACCESS_KEY_ID: 'test',
      AWS_SECRET_ACCESS_KEY: 'test',
    } as AuthEnv);

    const client = (
      publisher as unknown as { client: { send: (command: PublishCommand) => Promise<unknown> } }
    ).client;
    const send = jest.spyOn(client, 'send').mockResolvedValue({ MessageId: '1' });

    await publisher.publish({
      destination: 'arn:aws:sns:us-east-1:000000000000:fiapx-local-user-events',
      type: 'user.registered',
      body: { type: 'user.registered', payload: { userId: 'u1' } },
    });

    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(PublishCommand);
    expect(command?.input).toMatchObject({
      TopicArn: 'arn:aws:sns:us-east-1:000000000000:fiapx-local-user-events',
      MessageAttributes: {
        type: { DataType: 'String', StringValue: 'user.registered' },
      },
    });
    expect(JSON.parse(command?.input.Message ?? '{}')).toMatchObject({
      type: 'user.registered',
    });
  });
});
