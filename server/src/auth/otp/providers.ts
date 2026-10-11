/**
 * Launch prep: SMS OTP providers, picked by OTP_PROVIDER.
 *  - msg91:    the server makes the code, stores only its hash and asks MSG91 to send it (Flow API,
 *              DLT-approved template with an OTP variable). Keys from env only.
 *  - firebase: Firebase Phone Auth sends and checks the code on the device; the server only verifies the
 *              resulting Firebase ID token (same as AUTH_MODE=firebase) and then issues its own session.
 *  - dev:      local testing: nothing is sent, the code is the demo code 123456. Refused in production.
 * Tests use fake fetch functions / verifiers; no real SMS or network calls.
 */
import type { TokenVerifier } from '../verifier';

export type OtpProviderName = 'msg91' | 'firebase' | 'dev';

export interface OtpProvider {
  readonly name: OtpProviderName;
  /** 'server': the server makes, sends and checks codes; 'device': the SDK does (verifyIdToken). */
  readonly mode: 'server' | 'device';
  /** Server mode: deliver `code` to `phone` (E.164). Must not log either. */
  send?(phone: string, code: string, ttlSeconds: number): Promise<void>;
  /** Server mode: a fixed code for this provider (dev only), else undefined = random. */
  fixedCode?(): string | undefined;
  /** Device mode: verifies the provider's proof and returns the verified identity. */
  verifyIdToken?(idToken: string): Promise<{ uid: string; phone: string | null }>;
}

export class OtpSendError extends Error {
  constructor(readonly provider: string, readonly status?: number) {
    super(`OTP provider ${provider} could not send the code${status ? ` (HTTP ${status})` : ''}`);
  }
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface Msg91Config {
  authKey: string;
  /** DLT-approved Flow template id (the template's text contains the OTP variable). */
  templateId: string;
  /** Name of the template variable that holds the code (default "otp"). */
  otpVar?: string;
  /** Override for tests / a regional endpoint. */
  endpoint?: string;
}

export class Msg91Provider implements OtpProvider {
  readonly name = 'msg91' as const;
  readonly mode = 'server' as const;
  constructor(
    private readonly cfg: Msg91Config,
    private readonly fetchFn: FetchLike = fetch as unknown as FetchLike,
  ) {
    if (!cfg.authKey || !cfg.templateId) throw new Error('OTP_PROVIDER=msg91 needs MSG91_AUTH_KEY and MSG91_TEMPLATE_ID');
  }
  async send(phone: string, code: string) {
    const mobiles = phone.replace(/^\+/, ''); // MSG91 wants country code + number, no "+"
    const r = await this.fetchFn(this.cfg.endpoint ?? 'https://control.msg91.com/api/v5/flow', {
      method: 'POST',
      headers: { authkey: this.cfg.authKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ template_id: this.cfg.templateId, short_url: '0', recipients: [{ mobiles, [this.cfg.otpVar || 'otp']: code }] }),
    }).catch(() => null);
    if (!r || !r.ok) throw new OtpSendError('msg91', r?.status);
    const body = await r.text().catch(() => '');
    if (/"type"\s*:\s*"error"/.test(body)) throw new OtpSendError('msg91', r.status);
  }
}

/** Firebase Phone Auth: the device does the SMS; we verify its ID token (firebase-admin, no service key needed). */
export class FirebasePhoneProvider implements OtpProvider {
  readonly name = 'firebase' as const;
  readonly mode = 'device' as const;
  constructor(private readonly verifier: TokenVerifier) {}
  async verifyIdToken(idToken: string) {
    const id = await this.verifier.verify(idToken);
    return { uid: id.uid, phone: id.phone };
  }
}

export const DEV_OTP = '123456';

export class DevOtpProvider implements OtpProvider {
  readonly name = 'dev' as const;
  readonly mode = 'server' as const;
  /** Tests can see that a send happened (never the real world). */
  readonly sent: string[] = [];
  async send(phone: string) {
    this.sent.push(phone);
  }
  fixedCode() {
    return DEV_OTP;
  }
}
