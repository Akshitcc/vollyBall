/**
 * 1.4.19 Help Center contact links. NO contact details are built in: set EXPO_PUBLIC_SUPPORT_EMAIL and / or
 * EXPO_PUBLIC_SUPPORT_WHATSAPP (digits with country code, e.g. 91XXXXXXXXXX) at build time; a link whose value is
 * missing or malformed is hidden.
 */
/**
 * 1.5.8 (Tester F157u-1): the support website is config-driven – EXPO_PUBLIC_SUPPORT_URL (pending Akshit). Unset,
 * not https, or a known placeholder (the old built-in www.contact.com, example.*) = no link: the Help Center then
 * shows only the in-app Contact us / Feedback routes. The placeholder is never shipped.
 */
const PLACEHOLDER_HOSTS = /^(www\.)?(contact\.com|example\.(com|org|net)|localhost)$/i;
export function supportUrlFrom(v: string | null | undefined): string | null {
  const s = (v ?? '').trim();
  const m = /^https:\/\/([a-z0-9.-]+\.[a-z]{2,})(\/[^\s<>"]*)?$/i.exec(s);
  if (!m || PLACEHOLDER_HOSTS.test(m[1])) return null;
  return s;
}

export interface SupportContact { email: string | null; whatsapp: string | null; url?: string | null }

export function supportContactFrom(env: { email?: string | null; whatsapp?: string | null; url?: string | null }): SupportContact {
  const email = (env.email ?? '').trim();
  const wa = (env.whatsapp ?? '').replace(/[\s+()-]/g, '');
  return {
    email: /^[^\s@<>"]+@[^\s@<>"]+\.[A-Za-z]{2,}$/.test(email) ? email : null,
    whatsapp: /^[1-9]\d{9,14}$/.test(wa) ? wa : null,
    url: supportUrlFrom(env.url),
  };
}
// (literal process.env reads so Expo inlines them)
export const supportContact = (): SupportContact =>
  supportContactFrom({ email: process.env.EXPO_PUBLIC_SUPPORT_EMAIL, whatsapp: process.env.EXPO_PUBLIC_SUPPORT_WHATSAPP, url: process.env.EXPO_PUBLIC_SUPPORT_URL });
export const mailtoUrl = (email: string, subject: string) => `mailto:${email}?subject=${encodeURIComponent(subject)}`;
export const whatsappUrl = (digits: string) => `https://wa.me/${digits}`;
