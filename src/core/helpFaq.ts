/**
 * 1.4.19 Help Center: the FAQs as structured data (id, category, question + answer in EN and HI, tags) in ONE module,
 * so a later "Ask VolleyLive" assistant can use the same source. No AI / retrieval here – plain text search only.
 * Keep the answers true to the app: the numbers come from src/core (roster, antifraud, ranking, reviewPrompt,
 * abandonPolicy, support) and the tests check the ones quoted below against those constants.
 * HI text: NEEDS REVIEW by a native speaker before publishing (like the other HI strings).
 */
import { ABANDON_POLICY } from './abandonPolicy';

export const FAQ_CATEGORIES = ['registration', 'teams', 'newMatch', 'scoring', 'potm', 'wallet', 'confirm', 'abandon', 'tournaments', 'feedback', 'privacy'] as const;
export type FaqCategory = (typeof FAQ_CATEGORIES)[number];
export interface FaqText { q: string; a: string }
export interface Faq { id: string; category: FaqCategory; en: FaqText; hi: FaqText; tags: string[] }

export const FAQS: readonly Faq[] = [
  // ---- registration ----
  { id: 'reg-signin', category: 'registration', tags: ['login', 'otp', 'sms', 'mobile', 'phone', 'sign in', 'लॉगिन', 'ओटीपी'],
    en: { q: 'How do I sign in?', a: 'Enter your Indian mobile number and the one-time code we send by SMS. There is no password.' },
    hi: { q: 'मैं साइन इन कैसे करूँ?', a: 'अपना भारतीय मोबाइल नंबर डालें और SMS से आया एक बार का कोड डालें। कोई पासवर्ड नहीं है।' } },
  { id: 'reg-profile', category: 'registration', tags: ['profile', 'name', 'date of birth', 'dob', 'pincode', 'age', 'terms', 'प्रोफ़ाइल', 'पिनकोड', 'जन्मतिथि'],
    en: { q: 'What do I need to fill in to register?', a: 'Your first and last name, date of birth and pincode, and you accept the Terms. VolleyLive is for players aged 10 and over. Email, position, city and photo are optional. You need a complete profile to create a match.' },
    hi: { q: 'रजिस्टर करने के लिए क्या भरना होगा?', a: 'अपना पहला और अंतिम नाम, जन्मतिथि और पिनकोड, और शर्तें स्वीकार करनी होंगी। VolleyLive 10 साल और उससे बड़े खिलाड़ियों के लिए है। ईमेल, पोज़िशन, शहर और फ़ोटो वैकल्पिक हैं। मैच बनाने के लिए प्रोफ़ाइल पूरी होनी चाहिए।' } },
  // ---- teams ----
  { id: 'team-create', category: 'teams', tags: ['team', 'captain', 'invite', 'players', 'टीम', 'कप्तान', 'निमंत्रण'],
    en: { q: 'How do I make a team and add players?', a: 'Profile > My teams > New team. You become the captain. Add players by their mobile number – only people already registered on VolleyLive can be added, and they get an in-app invite to accept.' },
    hi: { q: 'टीम कैसे बनाएँ और खिलाड़ी कैसे जोड़ें?', a: 'प्रोफ़ाइल > मेरी टीमें > नई टीम। आप कप्तान बन जाते हैं। खिलाड़ियों को उनके मोबाइल नंबर से जोड़ें – सिर्फ़ VolleyLive पर रजिस्टर्ड लोग जोड़े जा सकते हैं, और उन्हें ऐप में निमंत्रण मिलता है जिसे वे स्वीकार करते हैं।' } },
  { id: 'team-size', category: 'teams', tags: ['size', 'minimum', 'subs', 'substitutes', '6', '12', 'खिलाड़ी'],
    en: { q: 'How many players can a team have?', a: 'At least 6 players to play, and up to 12 on a side in a match (6 on court plus 6 substitutes).' },
    hi: { q: 'एक टीम में कितने खिलाड़ी हो सकते हैं?', a: 'खेलने के लिए कम से कम 6 खिलाड़ी, और एक मैच में एक तरफ़ ज़्यादा से ज़्यादा 12 (6 कोर्ट पर और 6 सब्स्टिट्यूट)।' } },
  // ---- new match ----
  { id: 'match-new', category: 'newMatch', tags: ['new match', 'create', 'schedule', 'start', 'rules', 'नया मैच'],
    en: { q: 'How do I start a new match?', a: 'Tap New match. Pick two registered teams, or build the sides by adding registered players by mobile number. Name a captain for each side, choose the rules (sets, points per set), and start now or schedule it with a time and place.' },
    hi: { q: 'नया मैच कैसे शुरू करें?', a: 'नया मैच टैप करें। दो रजिस्टर्ड टीमें चुनें, या मोबाइल नंबर से रजिस्टर्ड खिलाड़ी जोड़कर टीमें बनाएँ। हर टीम का कप्तान चुनें, नियम चुनें (सेट, हर सेट के पॉइंट), और अभी शुरू करें या समय और जगह के साथ शेड्यूल करें।' } },
  { id: 'match-edit', category: 'newMatch', tags: ['edit', 'change teams', 'setup', 'delete match', 'बदलें'],
    en: { q: 'Can I change the teams or rules after creating a match?', a: 'Yes, until the first rally is scored. After that the set-up is locked. A match that never had a rally can still be deleted by its creator.' },
    hi: { q: 'मैच बनाने के बाद क्या टीमें या नियम बदल सकते हैं?', a: 'हाँ, पहली रैली स्कोर होने तक। उसके बाद सेटअप लॉक हो जाता है। जिस मैच में कभी रैली नहीं हुई, उसे बनाने वाला अब भी हटा सकता है।' } },
  // ---- scoring ----
  { id: 'score-how', category: 'scoring', tags: ['score', 'scorer', 'rally', 'undo', 'point', 'स्कोर', 'स्कोरर'],
    en: { q: 'Who keeps the score and how?', a: 'Only the scorer adds rallies: tap the side that won the rally, and optionally the player and shot. Undo removes the last rally. The match finishes automatically on the winning rally.' },
    hi: { q: 'स्कोर कौन और कैसे रखता है?', a: 'सिर्फ़ स्कोरर रैली जोड़ता है: रैली जीतने वाली टीम टैप करें, चाहें तो खिलाड़ी और शॉट भी। Undo आख़िरी रैली हटाता है। जीतने वाली रैली पर मैच अपने आप ख़त्म हो जाता है।' } },
  { id: 'score-handover', category: 'scoring', tags: ['hand over', 'handover', 'change scorer', 'स्कोरिंग सौंपें'],
    en: { q: 'Can someone else take over scoring?', a: 'Yes, the scorer can hand over scoring on the match page. Before the first rally it can go to anyone except the opposing captain and their team; after it, only to a player on the scorer’s own side.' },
    hi: { q: 'क्या कोई और स्कोरिंग संभाल सकता है?', a: 'हाँ, स्कोरर मैच पेज पर स्कोरिंग सौंप सकता है। पहली रैली से पहले विरोधी कप्तान और उसकी टीम को छोड़कर किसी को भी; उसके बाद सिर्फ़ स्कोरर की अपनी टीम के खिलाड़ी को।' } },
  // ---- POTM ----
  { id: 'potm', category: 'potm', tags: ['player of the match', 'potm', 'award', 'प्लेयर ऑफ़ द मैच'],
    en: { q: 'What is Player of the Match?', a: 'When a match is won, the scorer picks one Player of the Match, once. A match is complete only after the pick, and only then can the opposing captain confirm it. POTM adds 25 ranking points.' },
    hi: { q: 'प्लेयर ऑफ़ द मैच क्या है?', a: 'मैच जीतने पर स्कोरर एक बार एक प्लेयर ऑफ़ द मैच चुनता है। चुनने के बाद ही मैच पूरा होता है, और तभी विरोधी कप्तान उसकी पुष्टि कर सकता है। POTM से 25 रैंकिंग पॉइंट मिलते हैं।' } },
  // ---- wallet ----
  { id: 'wallet-points', category: 'wallet', tags: ['wallet', 'points', 'balance', 'bonus', 'money', 'ranking', 'वॉलेट', 'पॉइंट'],
    en: { q: 'How do points and the wallet work?', a: 'Points are in-app only and have no money value. You get points for the rallies credited to you in counted matches, +10 ranking points per counted win, +25 per Player of the Match, and a +100 bonus for every 5 counted wins. Matches waiting for confirmation or review don’t count yet.' },
    hi: { q: 'पॉइंट और वॉलेट कैसे काम करते हैं?', a: 'पॉइंट सिर्फ़ ऐप के अंदर हैं, इनकी कोई पैसे की क़ीमत नहीं है। गिने गए मैचों में आपके नाम की रैलियों के पॉइंट, हर गिनी गई जीत पर +10 रैंकिंग पॉइंट, हर प्लेयर ऑफ़ द मैच पर +25, और हर 5 गिनी गई जीत पर +100 बोनस मिलता है। पुष्टि या समीक्षा का इंतज़ार कर रहे मैच अभी नहीं गिने जाते।' } },
  { id: 'wallet-caps', category: 'wallet', tags: ['limit', 'cap', 'per day', 'per week', 'not counted', 'सीमा'],
    en: { q: 'Why didn’t a match count?', a: 'A player gets at most 3 counted matches per day (India time), and the same two teams at most 2 per week. Matches shorter than 10 minutes, disputed, abandoned or voided don’t count.' },
    hi: { q: 'कोई मैच क्यों नहीं गिना गया?', a: 'एक खिलाड़ी के लिए दिन में (भारतीय समय) ज़्यादा से ज़्यादा 3 मैच गिने जाते हैं, और वही दो टीमें हफ़्ते में ज़्यादा से ज़्यादा 2। 10 मिनट से छोटे, विवादित, छोड़े गए या रद्द किए गए मैच नहीं गिने जाते।' } },
  // ---- confirm / flagged ----
  { id: 'confirm', category: 'confirm', tags: ['confirm', 'captain', 'verify', 'reject', 'dispute', 'पुष्टि', 'कप्तान'],
    en: { q: 'Why does the other captain have to confirm?', a: 'For fair play, a completed match counts only after the opposing captain confirms the result. They can also reject it with a reason; a rejected match goes to admin review.' },
    hi: { q: 'दूसरे कप्तान को पुष्टि क्यों करनी होती है?', a: 'निष्पक्ष खेल के लिए, पूरा हुआ मैच तभी गिना जाता है जब विरोधी कप्तान नतीजे की पुष्टि करे। वे कारण बताकर उसे अस्वीकार भी कर सकते हैं; अस्वीकार किया गया मैच एडमिन समीक्षा में जाता है।' } },
  { id: 'flagged', category: 'confirm', tags: ['flagged', 'review', 'admin', 'too short', 'approve', 'void', 'फ़्लैग', 'समीक्षा'],
    en: { q: 'What does “Flagged for review” mean?', a: 'The app flags matches that look unusual – for example shorter than 10 minutes, missing times, or disputed. A flagged match doesn’t count until an admin reviews it; the admin can approve it (it still needs the captain’s confirmation) or void it.' },
    hi: { q: '“समीक्षा के लिए फ़्लैग” का क्या मतलब है?', a: 'ऐप असामान्य दिखने वाले मैचों को फ़्लैग करता है – जैसे 10 मिनट से छोटे, समय ग़ायब, या विवादित। फ़्लैग किया गया मैच एडमिन की समीक्षा तक नहीं गिना जाता; एडमिन उसे मंज़ूर कर सकता है (कप्तान की पुष्टि फिर भी चाहिए) या रद्द कर सकता है।' } },
  // ---- abandon (interim 'review') ----
  { id: 'abandon', category: 'abandon', tags: ['abandon', 'stop', 'cancel', 'review', 'reinstate', 'छोड़ें', 'रद्द'],
    en: { q: 'What happens if a match is abandoned?', a: 'Before the first rally the scorer can abandon it straight away. After rallies have been played (current interim rule), the abandon goes to admin review: who abandoned it and the score are recorded, and an admin either confirms the abandon or reinstates the match. A match that is or was won can’t be abandoned by the scorer, and once the score could have produced a winner only an admin decides.' },
    hi: { q: 'मैच छोड़ने (abandon) पर क्या होता है?', a: 'पहली रैली से पहले स्कोरर उसे तुरंत छोड़ सकता है। रैलियाँ खेले जाने के बाद (अभी का अंतरिम नियम) यह एडमिन समीक्षा में जाता है: किसने छोड़ा और स्कोर दर्ज होता है, और एडमिन या तो छोड़ने की पुष्टि करता है या मैच फिर से शुरू करता है। जो मैच जीता जा चुका है उसे स्कोरर नहीं छोड़ सकता, और जब स्कोर से विजेता बन सकता था तब सिर्फ़ एडमिन फ़ैसला करता है।' } },
  { id: 'abandon-report', category: 'abandon', tags: ['report', 'abandoned', 'captain', 'रिपोर्ट'],
    en: { q: 'I think a match was abandoned unfairly. What can I do?', a: 'The opposing captain can tap Report on the abandoned match to send it to admin review.' },
    hi: { q: 'मुझे लगता है कि मैच ग़लत तरीक़े से छोड़ा गया। मैं क्या करूँ?', a: 'विरोधी कप्तान छोड़े गए मैच पर रिपोर्ट टैप करके उसे एडमिन समीक्षा में भेज सकता है।' } },
  // ---- tournaments ----
  { id: 'tour-owner', category: 'tournaments', tags: ['tournament', 'owner', 'organiser', 'edit', 'delete', 'view only', 'टूर्नामेंट', 'आयोजक'],
    en: { q: 'Who can edit or delete a tournament?', a: 'Only the person who created it (the organiser). They can change teams, fixtures, rules, dates and venue, start fixtures and delete the tournament. Everyone else sees it as “View only” – standings, fixtures, results and teams, without edit controls. App admins can’t edit tournaments either.' },
    hi: { q: 'टूर्नामेंट कौन बदल या हटा सकता है?', a: 'सिर्फ़ वह व्यक्ति जिसने उसे बनाया (आयोजक)। वे टीमें, फ़िक्स्चर, नियम, तारीख़ें और जगह बदल सकते हैं, फ़िक्स्चर शुरू कर सकते हैं और टूर्नामेंट हटा सकते हैं। बाकी सब उसे “केवल देखने के लिए” देखते हैं – तालिका, फ़िक्स्चर, नतीजे और टीमें, बिना बदलाव के बटन के। ऐप एडमिन भी टूर्नामेंट नहीं बदल सकते।' } },
  { id: 'tour-matches', category: 'tournaments', tags: ['fixture', 'standings', 'bracket', 'scorer', 'फ़िक्स्चर', 'तालिका'],
    en: { q: 'How are tournament matches played and counted?', a: 'The organiser taps a ready fixture to start it and becomes its scorer (they can hand scoring over on the match page). Scoring and the captain’s confirmation work exactly like any other match. Only matches started from the tournament’s fixtures count in its standings.' },
    hi: { q: 'टूर्नामेंट के मैच कैसे खेले और गिने जाते हैं?', a: 'आयोजक तैयार फ़िक्स्चर को टैप करके शुरू करता है और उसका स्कोरर बनता है (मैच पेज पर स्कोरिंग सौंप सकता है)। स्कोरिंग और कप्तान की पुष्टि बिल्कुल बाकी मैचों जैसी है। तालिका में सिर्फ़ टूर्नामेंट के फ़िक्स्चर से शुरू हुए मैच गिने जाते हैं।' } },
  // ---- rating / feedback ----
  { id: 'feedback', category: 'feedback', tags: ['feedback', 'rating', 'stars', 'review', 'contact', 'support', 'फ़ीडबैक', 'रेटिंग', 'संपर्क'],
    en: { q: 'How do I rate the app, send feedback or contact support?', a: 'Profile > Send feedback lets you give 1–5 stars and a comment. The app may also ask for a rating after a good moment (a win or Player of the Match), at most once every 60 days and only after 3 completed matches. For a problem, use Help Center > Contact us: pick a topic, describe it, and optionally attach a screenshot. Feedback and tickets never earn points.' },
    hi: { q: 'ऐप को रेटिंग, फ़ीडबैक या सपोर्ट से संपर्क कैसे करूँ?', a: 'प्रोफ़ाइल > फ़ीडबैक भेजें में 1–5 स्टार और टिप्पणी दे सकते हैं। किसी अच्छे पल (जीत या प्लेयर ऑफ़ द मैच) के बाद ऐप रेटिंग माँग सकता है, 60 दिन में ज़्यादा से ज़्यादा एक बार और सिर्फ़ 3 पूरे मैचों के बाद। किसी समस्या के लिए सहायता केंद्र > संपर्क करें: विषय चुनें, समस्या लिखें, और चाहें तो स्क्रीनशॉट जोड़ें। फ़ीडबैक और टिकट से कभी पॉइंट नहीं मिलते।' } },
  // ---- privacy ----
  { id: 'privacy', category: 'privacy', tags: ['privacy', 'data', 'private', 'delete account', 'dob', 'gopniyata', 'गोपनीयता', 'डेटा'],
    en: { q: 'What do you do with my data?', a: 'We use your mobile number to sign you in and your profile and matches to run the app. Others see your public profile (name, photo, position, city) and matches you play. Your date of birth, pincode, district/state and email are private – only you see them in the app. We don’t sell data, never ask for ID numbers or payment details, and points have no money value. See Profile > About > Privacy Policy (draft).' },
    hi: { q: 'आप मेरे डेटा का क्या करते हैं?', a: 'आपका मोबाइल नंबर साइन इन के लिए और प्रोफ़ाइल व मैच ऐप चलाने के लिए इस्तेमाल होते हैं। दूसरे लोग आपकी सार्वजनिक प्रोफ़ाइल (नाम, फ़ोटो, पोज़िशन, शहर) और आपके मैच देखते हैं। आपकी जन्मतिथि, पिनकोड, ज़िला/राज्य और ईमेल निजी हैं – ऐप में सिर्फ़ आप देखते हैं। हम डेटा नहीं बेचते, कभी ID नंबर या भुगतान की जानकारी नहीं माँगते, और पॉइंट की कोई पैसे की क़ीमत नहीं है। प्रोफ़ाइल > जानकारी > गोपनीयता नीति (ड्राफ़्ट) देखें।' } },
];

/** The abandon answer above describes 'review'; a test fails if the policy switch changes without updating it. */
export const FAQ_ABANDON_POLICY = 'review' as const;
export const faqAbandonPolicyCurrent = () => ABANDON_POLICY === FAQ_ABANDON_POLICY;

const norm = (s: string) => s.toLocaleLowerCase().normalize('NFC').replace(/[^\p{L}\p{N}\p{M}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

/** Plain search: every word of the query must appear in the question, answer or tags (either language). */
export function searchFaqs(query: string, lang: 'en' | 'hi' = 'en', list: readonly Faq[] = FAQS): Faq[] {
  const words = norm(query).split(' ').filter(Boolean);
  if (!words.length) return [...list];
  const score = (f: Faq) => {
    const own = norm(`${f[lang].q} ${f[lang].a} ${f.tags.join(' ')}`);
    const other = norm(`${f[lang === 'en' ? 'hi' : 'en'].q} ${f[lang === 'en' ? 'hi' : 'en'].a}`);
    if (!words.every((w) => own.includes(w) || other.includes(w))) return 0;
    return words.reduce((n, w) => n + (norm(f[lang].q).includes(w) ? 3 : 0) + (f.tags.some((t) => norm(t).includes(w)) ? 2 : 0) + 1, 0);
  };
  return list.map((f) => [f, score(f)] as const).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).map(([f]) => f);
}
