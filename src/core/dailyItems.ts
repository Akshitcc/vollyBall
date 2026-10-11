/**
 * 1.3.7 "Fact of the day" (Home card): one item per IST calendar day, picked deterministically; tap
 * for the next one. Items come from the backend (admins manage them) with this bundled list as the
 * offline / demo fallback.
 *
 * Content policy: facts must be checkable (FIVB Official Volleyball Rules, FIVB / Olympic history).
 * Quotes ONLY with a solid, verified attribution and a source URL – none made the cut for 1.3.7, so the
 * bundled list is facts only. HI translations: reviewed by QA in 1.3.7 (20 rewrites applied in 1.3.8).
 */
import { HIDDEN_RE } from './text';
import { todayIST } from './registration';
import { CodedError } from './codedError';

export type DailyItemType = 'fact' | 'quote';
export interface DailyItem {
  id: string;
  type: DailyItemType;
  textEn: string;
  textHi: string;
  attribution?: string | null;
  sourceUrl?: string | null;
  active: boolean;
  /** 1.3.9 (V138-7): when an admin added it (server time, ms). Bundled items have none (= always in the rotation). */
  createdAt?: number | null;
}

const RULES = 'FIVB Official Volleyball Rules';
const f = (id: number, textEn: string, textHi: string, attribution = RULES): DailyItem => ({ id: `b${String(id).padStart(2, '0')}`, type: 'fact', textEn, textHi, attribution, sourceUrl: null, active: true });
const HIST = 'Volleyball history (FIVB / Olympics)';
const BEACH = 'FIVB Official Beach Volleyball Rules';

/** 1.3.9 (V138-14): Hindi names of the bundled sources (shown as "स्रोत: …"); other attributions are shown as written. */
export const ATTRIBUTION_HI: Readonly<Record<string, string>> = Object.freeze({
  [RULES]: 'एफआईवीबी के आधिकारिक वॉलीबॉल नियम',
  [BEACH]: 'एफआईवीबी के आधिकारिक बीच वॉलीबॉल नियम',
  [HIST]: 'वॉलीबॉल का इतिहास (एफआईवीबी / ओलंपिक)',
  'World ParaVolley rules': 'वर्ल्ड पैरावॉली के नियम',
  'Volleyball terminology': 'वॉलीबॉल की शब्दावली',
});
export function dailyAttribution(item: Pick<DailyItem, 'attribution'>, lang: string): string | null {
  const a = item.attribution ?? null;
  if (!a) return null;
  return lang.startsWith('hi') ? ATTRIBUTION_HI[a] ?? a : a;
}

/** Bundled facts (offline + demo). HI: QA-reviewed (1.3.8). */
export const BUNDLED_DAILY_ITEMS: readonly DailyItem[] = Object.freeze([
  f(1, 'Volleyball was invented in 1895 by William G. Morgan in Holyoke, Massachusetts, USA.', 'वॉलीबॉल का आविष्कार 1895 में अमेरिका के होलियोक, मैसाचुसेट्स में विलियम जी. मॉर्गन ने किया था।', HIST),
  f(2, 'Morgan first called his new game “Mintonette”.', 'मॉर्गन ने अपने नए खेल को पहले “मिंटोनेट” नाम दिया था।', HIST),
  f(3, 'William G. Morgan was a YMCA physical education director when he created the game.', 'खेल बनाते समय विलियम जी. मॉर्गन YMCA में शारीरिक शिक्षा निदेशक थे।', HIST),
  f(4, 'The name “volley ball” came after a demonstration in 1896, because players volley the ball back and forth over the net.', '“वॉली बॉल” नाम 1896 के एक प्रदर्शन के बाद आया, क्योंकि खिलाड़ी गेंद को नेट के ऊपर से एक-दूसरे की ओर वॉली करते हैं।', HIST),
  f(5, 'An indoor volleyball team has 6 players on court.', 'इनडोर वॉलीबॉल में एक टीम के 6 खिलाड़ी कोर्ट पर होते हैं।'),
  f(6, 'Beach volleyball is played with 2 players per team.', 'बीच वॉलीबॉल में हर टीम में 2 खिलाड़ी होते हैं।', BEACH),
  f(7, 'A set is won by the first team to reach 25 points with a lead of at least 2 points.', 'सेट वह टीम जीतती है जो पहले 25 अंक तक पहुँचे और कम से कम 2 अंक आगे हो।'),
  f(8, 'The deciding fifth set is played to 15 points, still with a 2-point lead.', 'निर्णायक पाँचवाँ सेट 15 अंकों तक खेला जाता है, इसमें भी 2 अंक की बढ़त ज़रूरी है।'),
  f(9, 'A match is won by the team that wins three sets (best of five).', 'मैच वह टीम जीतती है जो पाँच में से तीन सेट जीते।'),
  f(10, 'There is no point cap in a set: at 24–24 play goes on until one team leads by 2.', 'सेट में अंकों की कोई सीमा नहीं: 24–24 पर खेल तब तक चलता है जब तक कोई टीम 2 अंक आगे न हो जाए।'),
  f(11, 'With rally point scoring, every rally wins a point – whichever team served.', 'रैली पॉइंट स्कोरिंग में हर रैली से एक अंक मिलता है – सर्व चाहे किसी भी टीम ने किया हो।'),
  f(12, 'Under the old side-out scoring, only the serving team could win a point.', 'पुराने साइड-आउट स्कोरिंग में सिर्फ़ सर्व करने वाली टीम ही अंक जीत सकती थी।', HIST),
  f(13, 'A team may touch the ball up to three times before sending it over the net.', 'नेट के पार भेजने से पहले एक टीम गेंद को ज़्यादा से ज़्यादा तीन बार छू सकती है।'),
  f(14, 'A block touch does not count as one of the team’s three hits.', 'ब्लॉक पर लगा स्पर्श टीम के तीन स्पर्शों में नहीं गिना जाता।'),
  f(15, 'A player may not hit the ball twice in a row – but after a block touch, the blocker may play it again.', 'कोई खिलाड़ी लगातार दो बार गेंद नहीं छू सकता – लेकिन ब्लॉक के बाद ब्लॉकर फिर से गेंद खेल सकता है।'),
  f(16, 'The libero wears a jersey of a different colour from the rest of the team.', 'लिबेरो बाकी टीम से अलग रंग की जर्सी पहनता है।'),
  f(17, 'Under FIVB rules the libero may not serve, block or attempt to block.', 'FIVB नियमों के तहत लिबेरो सर्व, ब्लॉक या ब्लॉक की कोशिश नहीं कर सकता।'),
  f(18, 'The libero can only replace back-row players.', 'लिबेरो सिर्फ़ पिछली पंक्ति के खिलाड़ियों की जगह ले सकता है।'),
  f(19, 'Libero replacements are not counted as regular substitutions.', 'लिबेरो की अदला-बदली सामान्य सब्स्टिट्यूशन में नहीं गिनी जाती।'),
  f(20, 'The libero position was introduced by the FIVB in 1998.', 'लिबेरो की पोज़िशन FIVB ने 1998 में शुरू की थी।', HIST),
  f(21, 'When a team wins back the right to serve, its players rotate one position clockwise.', 'जब कोई टीम सर्व का अधिकार वापस जीतती है, तो उसके खिलाड़ी घड़ी की दिशा में एक पोज़िशन घूमते हैं।'),
  f(22, 'At the moment of the serve, both teams must be in their correct rotational order – otherwise it is a fault.', 'सर्व के समय दोनों टीमों के खिलाड़ियों का सही रोटेशन क्रम में होना ज़रूरी है, वरना फ़ॉल्ट होता है।'),
  f(23, 'An indoor court measures 18 m × 9 m.', 'इनडोर कोर्ट 18 मी × 9 मी का होता है।'),
  f(24, 'The attack line is 3 m from the centre line on each side.', 'अटैक लाइन हर तरफ़ सेंटर लाइन से 3 मी दूर होती है।'),
  f(25, 'The net is 2.43 m high for men and 2.24 m for women.', 'नेट की ऊँचाई पुरुषों के लिए 2.43 मी और महिलाओं के लिए 2.24 मी होती है।'),
  f(26, 'A beach volleyball court measures 16 m × 8 m.', 'बीच वॉलीबॉल कोर्ट 16 मी × 8 मी का होता है।', BEACH),
  f(27, 'A ball that lands on the boundary line is in.', 'सीमा रेखा पर गिरी गेंद अंदर मानी जाती है।'),
  f(28, 'The ball must cross the net between the two antennae.', 'गेंद को दोनों एंटीना के बीच से ही नेट पार करना चाहिए।'),
  f(29, 'A serve that touches the net but still crosses into the opponents’ court stays in play.', 'जो सर्व नेट को छूकर भी विरोधी कोर्ट में चला जाए, वह खेल में रहता है।'),
  f(30, 'The server has 8 seconds after the first referee’s whistle to serve.', 'पहले रेफ़री की सीटी के बाद सर्वर के पास सर्व करने के लिए 8 सेकंड होते हैं।'),
  f(31, 'The serve is made from the service zone behind the end line.', 'सर्व एंड लाइन के पीछे सर्विस ज़ोन से किया जाता है।'),
  f(32, 'An indoor ball has a circumference of 65–67 cm.', 'इनडोर गेंद की परिधि 65–67 सेमी होती है।'),
  f(33, 'An indoor ball weighs 260–280 g.', 'इनडोर गेंद का वज़न 260–280 ग्राम होता है।'),
  f(34, 'Each team may make up to 6 substitutions per set.', 'हर टीम एक सेट में ज़्यादा से ज़्यादा 6 सब्स्टिट्यूशन कर सकती है।'),
  f(35, 'Each team may request up to 2 timeouts per set.', 'हर टीम एक सेट में ज़्यादा से ज़्यादा 2 टाइमआउट ले सकती है।'),
  f(36, 'Teams change ends after every set; in the deciding set they switch when the leading team reaches 8 points.', 'हर सेट के बाद टीमें पाला बदलती हैं; निर्णायक सेट में आगे चल रही टीम के 8 अंक होते ही पाले बदले जाते हैं।'),
  f(37, 'Back-row players may not attack the ball above net height from in front of the attack line.', 'पिछली पंक्ति के खिलाड़ी अटैक लाइन के आगे से नेट की ऊँचाई से ऊपर की गेंद पर अटैक नहीं कर सकते।'),
  f(38, 'Back-row players may not complete a block.', 'पिछली पंक्ति के खिलाड़ी ब्लॉक में हिस्सा नहीं ले सकते (पूरा ब्लॉक नहीं कर सकते)।'),
  f(39, 'Touching the net between the antennae while playing the ball is a fault.', 'गेंद खेलते समय एंटीना के बीच नेट छूना फ़ॉल्ट है।'),
  f(40, 'Volleyball made its Olympic debut at the Tokyo 1964 Games.', 'वॉलीबॉल पहली बार टोक्यो 1964 ओलंपिक में खेला गया।', HIST),
  f(41, 'Japan’s women won the first Olympic women’s volleyball gold, in Tokyo 1964.', 'जापान की महिला टीम ने टोक्यो 1964 में पहला ओलंपिक महिला वॉलीबॉल स्वर्ण पदक जीता।', HIST),
  f(42, 'The Soviet Union won the first Olympic men’s volleyball gold, in 1964.', 'सोवियत संघ ने 1964 में पहला ओलंपिक पुरुष वॉलीबॉल स्वर्ण पदक जीता।', HIST),
  f(43, 'Beach volleyball became an official Olympic sport at Atlanta 1996.', 'बीच वॉलीबॉल अटलांटा 1996 में आधिकारिक ओलंपिक खेल बना।', HIST),
  f(44, 'The FIVB, volleyball’s world governing body, was founded in Paris in 1947.', 'वॉलीबॉल की विश्व शासी संस्था FIVB की स्थापना 1947 में पेरिस में हुई थी।', HIST),
  f(45, 'The FIVB has its headquarters in Lausanne, Switzerland.', 'FIVB का मुख्यालय स्विट्ज़रलैंड के लोज़ान में है।', HIST),
  f(46, 'The first men’s World Championship was held in Prague in 1949.', 'पहली पुरुष विश्व चैंपियनशिप 1949 में प्राग में हुई थी।', HIST),
  f(47, 'The first women’s World Championship was held in Moscow in 1952.', 'पहली महिला विश्व चैंपियनशिप 1952 में मॉस्को में हुई थी।', HIST),
  f(48, 'The Volleyball Nations League began in 2018.', 'वॉलीबॉल नेशंस लीग 2018 में शुरू हुई।', HIST),
  f(49, 'Sitting volleyball has been a Paralympic sport for men since 1980 and for women since 2004.', 'सिटिंग वॉलीबॉल पुरुषों के लिए 1980 से और महिलाओं के लिए 2004 से पैरालंपिक खेल है।', HIST),
  f(50, 'In sitting volleyball the net is 1.15 m high for men and 1.05 m for women.', 'सिटिंग वॉलीबॉल में नेट पुरुषों के लिए 1.15 मी और महिलाओं के लिए 1.05 मी ऊँचा होता है।', 'World ParaVolley rules'),
  f(51, 'Beach volleyball sets are played to 21 points, and a deciding third set to 15.', 'बीच वॉलीबॉल के सेट 21 अंकों तक खेले जाते हैं, और निर्णायक तीसरा सेट 15 अंकों तक।', BEACH),
  f(52, 'In beach volleyball teams switch sides every 7 points (every 5 in the third set).', 'बीच वॉलीबॉल में टीमें हर 7 अंक पर पाला बदलती हैं (तीसरे सेट में हर 5 अंक पर)।', BEACH),
  f(53, 'Beach volleyball has no substitutions.', 'बीच वॉलीबॉल में कोई सब्स्टिट्यूशन नहीं होता।', BEACH),
  f(54, 'An “ace” is a serve that wins the point directly.', '“ऐस” वह सर्व है जिससे सीधे अंक मिल जाए।', 'Volleyball terminology'),
  f(55, 'A “kill” is an attack that wins the point directly.', '“किल” वह अटैक है जिससे सीधे अंक मिल जाए।', 'Volleyball terminology'),
  f(56, 'A “dig” is passing a hard-driven attack to keep the rally alive.', '“डिग” का मतलब है तेज़ अटैक को उठाकर रैली जारी रखना।', 'Volleyball terminology'),
  f(57, 'The setter usually takes the team’s second touch and sets up the attack.', 'सेटर आमतौर पर टीम का दूसरा स्पर्श लेता है और अटैक तैयार करता है।', 'Volleyball terminology'),
  f(58, 'A “pancake” is a dig made with the hand flat on the floor so the ball bounces off the back of the hand.', '“पैनकेक” वह डिग है जिसमें हथेली ज़मीन पर सपाट रखी जाती है और गेंद हाथ के पिछले हिस्से से उछलती है।', 'Volleyball terminology'),
  f(59, 'The first referee works from a stand at one end of the net; the second referee stands on the opposite side.', 'पहला रेफ़री नेट के एक सिरे पर स्टैंड से काम करता है; दूसरा रेफ़री सामने वाली तरफ़ नेट पोस्ट के पास खड़ा होता है।'),
  f(60, 'The Volleyball Federation of India was founded in 1951.', 'भारतीय वॉलीबॉल महासंघ (VFI) की स्थापना 1951 में हुई थी।', HIST),
]);

/** Days since 1970-01-01 of the IST calendar date (DST-free, so every IST day is one index). */
export function istDayNumber(now = Date.now()): number {
  return Math.floor(Date.parse(`${todayIST(now)}T00:00:00Z`) / 86_400_000);
}

/** ms of today's IST midnight. */
export function istDayStart(now = Date.now()): number {
  return Date.parse(`${todayIST(now)}T00:00:00+05:30`);
}

/**
 * Today's item (+offset for "next").
 *
 * 1.3.9 (QA V138-7) – stable daily selection:
 *  - the rotation is the active items ORDERED BY ID, and the rotation index is the IST day number
 *    (`list[day % n]`), so every item comes round once in any n consecutive days;
 *  - an item an admin adds today (createdAt ≥ today's IST midnight) joins the rotation from TOMORROW, so
 *    adding a fact never changes today's fact for anyone, and the new fact is shown within the next cycle
 *    (at most n days, n = number of items in the rotation);
 *  - deactivating or deleting an item takes effect at once (an admin hiding a fact expects it gone), which
 *    can change today's fact – documented in KNOWN-GAPS;
 *  - bundled items have no createdAt and are always in the rotation; an item with no createdAt from a backend
 *    (pre-1.3.9 Firebase docs) is treated the same.
 */
export function pickDaily(items: readonly DailyItem[], now = Date.now(), offset = 0): DailyItem | null {
  const today = istDayStart(now);
  const list = items
    .filter((i) => i.active && !(typeof i.createdAt === 'number' && i.createdAt >= today))
    .slice()
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (!list.length) return null;
  const n = list.length;
  return list[(((istDayNumber(now) + offset) % n) + n) % n];
}

/**
 * 1.3.8 (QA V137-3): items an admin adds are shown TOGETHER with the bundled facts (not instead of them).
 * Same id: the backend's copy wins (an inactive copy hides that bundled fact).
 */
export function mergeDailyItems(fromBackend: readonly DailyItem[], bundled: readonly DailyItem[] = BUNDLED_DAILY_ITEMS): DailyItem[] {
  const byId = new Map<string, DailyItem>(bundled.map((i) => [i.id, i]));
  for (const i of fromBackend) byId.set(i.id, i);
  return [...byId.values()];
}

/** 1.3.8 (V137-3): ms until the next IST midnight (when the card moves to the next day's item). */
export function msUntilNextIstDay(now = Date.now()): number {
  const DAY = 86_400_000;
  const ist = now + 330 * 60_000;
  return DAY - (((ist % DAY) + DAY) % DAY);
}

export const DAILY_LIMITS = Object.freeze({ text: 400, attribution: 120, url: 500 });
// 1.3.9 (V138-4): the shared hidden-character set (core/text.ts; firestore.rules dailyItems uses hidden())
const CTRL = HIDDEN_RE;
const bad = (field: string, code = 'daily_invalid') => Object.assign(new CodedError(code, `Invalid ${field}`), { field });
/** Admin add/edit (app, demo, API server). Quotes need an attribution and an https source URL. */
export function checkDailyItem(x: Partial<DailyItem>): Omit<DailyItem, 'id'> {
  const type = x.type;
  if (type !== 'fact' && type !== 'quote') throw bad('type');
  const txt = (v: unknown, field: string, max: number, required: boolean) => {
    const s = String(v ?? '').trim();
    if (!s) {
      if (required) throw bad(field);
      return null;
    }
    if ([...s].length > max || CTRL.test(s)) throw bad(field);
    return s;
  };
  const textEn = txt(x.textEn, 'textEn', DAILY_LIMITS.text, true)!;
  const textHi = txt(x.textHi, 'textHi', DAILY_LIMITS.text, true)!;
  const attribution = txt(x.attribution, 'attribution', DAILY_LIMITS.attribution, type === 'quote');
  const sourceUrl = txt(x.sourceUrl, 'sourceUrl', DAILY_LIMITS.url, type === 'quote');
  if (sourceUrl && !/^https:\/\/[^\s]+$/.test(sourceUrl)) throw bad('sourceUrl');
  return { type, textEn, textHi, attribution, sourceUrl, active: x.active !== false };
}
