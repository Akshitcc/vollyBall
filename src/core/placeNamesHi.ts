/**
 * 1.4.2 (QA V141-10): Hindi names for the district / state India Post returns (it answers in English only).
 * The Hindi profile shows a place name only when it has a Hindi name here – it never mixes an English name
 * into a Hindi line (a district we have no name for is left out; the pincode is always shown).
 * States and union territories: all 36, with India Post's spellings and their older forms.
 * Districts: the demo sample and the largest cities; more can be added without any other change.
 */
const STATES: Readonly<Record<string, string>> = Object.freeze({
  'andaman and nicobar islands': 'अंडमान और निकोबार द्वीपसमूह', 'andhra pradesh': 'आंध्र प्रदेश', 'arunachal pradesh': 'अरुणाचल प्रदेश',
  assam: 'असम', bihar: 'बिहार', chandigarh: 'चंडीगढ़', chhattisgarh: 'छत्तीसगढ़', chattisgarh: 'छत्तीसगढ़',
  'dadra and nagar haveli and daman and diu': 'दादरा और नगर हवेली और दमन और दीव', 'dadra and nagar haveli': 'दादरा और नगर हवेली', 'daman and diu': 'दमन और दीव',
  delhi: 'दिल्ली', 'new delhi': 'नई दिल्ली', goa: 'गोवा', gujarat: 'गुजरात', haryana: 'हरियाणा', 'himachal pradesh': 'हिमाचल प्रदेश',
  'jammu and kashmir': 'जम्मू और कश्मीर', jharkhand: 'झारखंड', karnataka: 'कर्नाटक', kerala: 'केरल', ladakh: 'लद्दाख', lakshadweep: 'लक्षद्वीप',
  'madhya pradesh': 'मध्य प्रदेश', maharashtra: 'महाराष्ट्र', manipur: 'मणिपुर', meghalaya: 'मेघालय', mizoram: 'मिज़ोरम', nagaland: 'नागालैंड',
  odisha: 'ओडिशा', orissa: 'ओडिशा', puducherry: 'पुदुच्चेरी', pondicherry: 'पुदुच्चेरी', punjab: 'पंजाब', rajasthan: 'राजस्थान', sikkim: 'सिक्किम',
  'tamil nadu': 'तमिलनाडु', telangana: 'तेलंगाना', tripura: 'त्रिपुरा', 'uttar pradesh': 'उत्तर प्रदेश', uttarakhand: 'उत्तराखंड', uttaranchal: 'उत्तराखंड',
  'west bengal': 'पश्चिम बंगाल',
});
const DISTRICTS: Readonly<Record<string, string>> = Object.freeze({
  'new delhi': 'नई दिल्ली', 'central delhi': 'मध्य दिल्ली', 'south delhi': 'दक्षिण दिल्ली', 'north delhi': 'उत्तर दिल्ली', 'east delhi': 'पूर्वी दिल्ली', 'west delhi': 'पश्चिमी दिल्ली',
  mumbai: 'मुंबई', 'mumbai suburban': 'मुंबई उपनगर', bengaluru: 'बेंगलुरु', bangalore: 'बेंगलुरु', 'bengaluru urban': 'बेंगलुरु शहरी', 'bangalore urban': 'बेंगलुरु शहरी',
  chennai: 'चेन्नई', kolkata: 'कोलकाता', hyderabad: 'हैदराबाद', lucknow: 'लखनऊ', jaipur: 'जयपुर', pune: 'पुणे', ahmedabad: 'अहमदाबाद',
  surat: 'सूरत', kanpur: 'कानपुर', 'kanpur nagar': 'कानपुर नगर', nagpur: 'नागपुर', indore: 'इंदौर', bhopal: 'भोपाल', patna: 'पटना', agra: 'आगरा',
  varanasi: 'वाराणसी', chandigarh: 'चंडीगढ़', gurgaon: 'गुरुग्राम', gurugram: 'गुरुग्राम', 'gautam buddha nagar': 'गौतम बुद्ध नगर', ghaziabad: 'गाज़ियाबाद',
  noida: 'नोएडा', thane: 'ठाणे', faridabad: 'फ़रीदाबाद', dehradun: 'देहरादून', ranchi: 'रांची', raipur: 'रायपुर', amritsar: 'अमृतसर', ludhiana: 'लुधियाना',
});
const key = (s: string) => s.normalize('NFC').trim().toLowerCase().replace(/\s*&\s*/g, ' and ').replace(/\s+/g, ' ');

/** The place part of the profile's pincode line, in the UI language (Hindi: only names we have in Hindi). */
export function placeParts(district: string | null | undefined, state: string | null | undefined, lang: string): string[] {
  const parts = [district, state].map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean) as string[];
  if (!lang.startsWith('hi')) return parts;
  const d = district ? DISTRICTS[key(district)] : undefined;
  const s = state ? STATES[key(state)] : undefined;
  return [d, s && s !== d ? s : undefined].filter((x): x is string => !!x);
}
