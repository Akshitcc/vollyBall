/**
 * Identity verification is injectable so tests (and local development) do not
 * need Firebase. Production uses Firebase Auth ID tokens from the phone-OTP
 * sign-in: firebase-admin checks the signature against Google's public keys,
 * the audience/issuer (= FIREBASE_PROJECT_ID) and expiry. No service-account
 * key is needed just to verify ID tokens.
 */
export interface Identity {
  uid: string;
  /** E.164 phone number from the token (phone sign-in), or null. */
  phone: string | null;
}

export interface TokenVerifier {
  verify(token: string): Promise<Identity>;
}

export class InvalidTokenError extends Error {}

export class FirebaseTokenVerifier implements TokenVerifier {
  private auth: { verifyIdToken(t: string): Promise<{ uid: string; phone_number?: string }> } | null = null;
  constructor(private readonly projectId: string) {}

  private async getAuth() {
    if (!this.auth) {
      const { initializeApp, getApps } = await import('firebase-admin/app');
      const { getAuth } = await import('firebase-admin/auth');
      const app = getApps().find((a) => a.name === 'volleylive-verifier') ?? initializeApp({ projectId: this.projectId }, 'volleylive-verifier');
      this.auth = getAuth(app);
    }
    return this.auth;
  }

  async verify(token: string): Promise<Identity> {
    try {
      const decoded = await (await this.getAuth()).verifyIdToken(token);
      return { uid: decoded.uid, phone: decoded.phone_number ?? null };
    } catch {
      throw new InvalidTokenError('Invalid or expired ID token');
    }
  }
}

/**
 * LOCAL TESTING ONLY (AUTH_MODE=dev, refused in production). Accepts tokens of
 * the form `dev:<E.164 phone>`; the uid is the registered user with that phone,
 * or `dev_<digits>` for a new user. Lets the app talk to a local API without a
 * Firebase project (the app's matching switch is EXPO_PUBLIC_API_DEV_AUTH=1).
 */
export class DevTokenVerifier implements TokenVerifier {
  constructor(private readonly uidForPhone: (phone: string) => Promise<string | null>) {}
  async verify(token: string): Promise<Identity> {
    const m = /^dev:(\+[1-9]\d{6,14})$/.exec(token);
    if (!m) throw new InvalidTokenError('Invalid dev token');
    const phone = m[1];
    const uid = (await this.uidForPhone(phone)) ?? `dev_${phone.slice(1)}`;
    return { uid, phone };
  }
}

/** Test helper: tokens are looked up in a fixed table. */
export class StaticTokenVerifier implements TokenVerifier {
  constructor(private readonly tokens: Record<string, Identity>) {}
  async verify(token: string): Promise<Identity> {
    const id = this.tokens[token];
    if (!id) throw new InvalidTokenError('Unknown test token');
    return id;
  }
}
