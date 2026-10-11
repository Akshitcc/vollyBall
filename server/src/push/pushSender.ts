/**
 * Push notifications are sent by the server (they used to be Cloud Functions).
 * Delivery goes through the Expo Push API, which uses FCM on Android and APNs
 * on iOS, to the Expo push tokens stored in `device_tokens`.
 */
export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, string>;
}

export interface PushResult {
  /** Tokens Expo reported as no longer valid (removed from device_tokens). */
  invalidTokens: string[];
}

export interface PushSender {
  send(messages: PushMessage[]): Promise<PushResult>;
}

export class ExpoPushSender implements PushSender {
  constructor(
    private readonly accessToken = '',
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}
  async send(messages: PushMessage[]): Promise<PushResult> {
    const invalidTokens: string[] = [];
    for (let i = 0; i < messages.length; i += 100) {
      const batch = messages.slice(i, i + 100);
      const res = await this.fetchImpl('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}),
        },
        body: JSON.stringify(batch.map((m) => ({ ...m, sound: 'default', channelId: 'default' }))),
      });
      if (!res.ok) {
        console.warn('[push] Expo push failed', res.status);
        continue;
      }
      const json = (await res.json()) as { data?: { status: string; details?: { error?: string } }[] };
      json.data?.forEach((t, j) => {
        if (t.status === 'error' && t.details?.error === 'DeviceNotRegistered') invalidTokens.push(batch[j].to);
      });
    }
    return { invalidTokens };
  }
}

/** Collects messages in memory (tests, or PUSH_ENABLED=0). */
export class MemoryPushSender implements PushSender {
  readonly sent: PushMessage[] = [];
  async send(messages: PushMessage[]): Promise<PushResult> {
    this.sent.push(...messages);
    return { invalidTokens: [] };
  }
}
