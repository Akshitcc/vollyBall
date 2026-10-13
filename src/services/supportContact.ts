/**
 * 1.4.19 Help Center contact links. NO contact details are built in: set EXPO_PUBLIC_SUPPORT_EMAIL and / or
 * EXPO_PUBLIC_SUPPORT_WHATSAPP (digits with country code, e.g. 91XXXXXXXXXX) at build time; a link whose value is
 * missing or malformed is hidden.
 */
/** The ONE support link constant (value given by Akshit, 1.4.19). Shown in the Help Center as a tappable link. */
export const SUPPORT_URL = 'https://www.contact.com';

export interface SupportContact { email: string | null; whatsapp: string | null }

export function supportContactFrom(env: { email?: string | null; whatsapp?: string | null }): SupportContact {
  const email = (env.email ?? '').trim();
  const wa = (env.whatsapp ?? '').replace(/[\s+()-]/g, '');
  return {
    email: /^[^\s@<>"]+@[^\s@<>"]+\.[A-Za-z]{2,}$/.test(email) ? email : null,
    whatsapp: /^[1-9]\d{9,14}$/.test(wa) ? wa : null,
  };
}
// (literal process.env reads so Expo inlines them)
export const supportContact = (): SupportContact =>
  supportContactFrom({ email: process.env.EXPO_PUBLIC_SUPPORT_EMAIL, whatsapp: process.env.EXPO_PUBLIC_SUPPORT_WHATSAPP });
export const mailtoUrl = (email: string, subject: string) => `mailto:${email}?subject=${encodeURIComponent(subject)}`;
export const whatsappUrl = (digits: string) => `https://wa.me/${digits}`;
