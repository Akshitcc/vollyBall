/**
 * 1.5.0 Ask VolleyLive: the offline "mock" planner – a small intent parser for English, Hindi (Devanagari) and
 * romanised Hindi that maps a question to read-only tool calls, so the whole agent is testable without a model.
 * It only ever reads the USER's question – never tool output or retrieved content.
 */
import type { AskToolName } from './tools';

export type Intent =
  | { kind: 'tools'; calls: { name: AskToolName; args: Record<string, string | number> }[] }
  | { kind: 'private' }
  | { kind: 'write' }
  | { kind: 'injection' }
  | { kind: 'rag'; topic?: 'captain' };

const n = (s: string) => ` ${s.toLocaleLowerCase().normalize('NFC').replace(/[’`]/g, "'").replace(/'s\b/g, '').replace(/[^\p{L}\p{N}\p{M}'#\s]/gu, ' ').replace(/\s+/g, ' ').trim()} `;

// first person (EN / HI / roman HI)
const ME = /\s(my|mine|i|i'm|im|me|maine|मैंने|mera|meri|mere|mujhe|main|apna|apni|apne|मेरा|मेरी|मेरे|मैं|मुझे|अपना|अपनी|अपने)\s/;
const OTHER_PERSON = /\s(my|mera|meri|mere|मेरे|मेरी|मेरा)\s(teammates?|captain|friends?|partner|coach|साथी|कप्तान|दोस्त|dost|saathi|kaptan)\s|\s(all|every|everyone|everybody|other|others|sab|sabhi|सब|सभी|दूसरे|users|players')\s/;
const PRIVATE = /\s(phone|phones|mobile|number|numbers|contact|email|emails|e mail|wallet|balance|address|dob|birthday|birth|pincode|pin code|फ़ोन|फोन|मोबाइल|नंबर|ईमेल|वॉलेट|बैलेंस|पता|जन्मदिन|janamdin|pata)\s/;
const HOWTO = /^\s(where|can i|could i|is it possible|what do i do|kaise|kaha|kahan|kya main)\s|\s(how do|how does|how to|how can|how should|how is|how are|kaise|कैसे|कहाँ|कहां)\s/;
const HOW_MANY_ME = /\s(how many|kitne|kitna|कितने|कितना)\s/;
const WHERE_LIVE = /\swhere (?:does|do|did) .{1,40}\s(?:live|stay|work)\s|\s(?:kahan|kahaan) (?:rehta|rehti|rahta|rahti|rehte)\s|\sकहाँ (?:रहता|रहती|रहते)\s/;
const WRITE_START = /^\s(please\s|pls\s|can you\s|could you\s|would you\s)?(delete|remove|create|add|accept|decline|reject|cancel|change|update|edit|rename|make|join|leave|send|transfer|kick|give(?! me | mujhe )|give (?:me|mujhe) \d+|record|score (?:a |the |one )?(?:point|\d)|confirm|approve|verify|void|dispute|resolve|abandon|undo|submit|reopen)\s/;
// 1.5.1 (Tester F150-6): a request phrased as a wish / instruction anywhere in the sentence
const WRITE_ASK = /\s(?:i want you to|i need you to|i'd like you to|i would like you to|go ahead and|kindly|you should|you must|please)\s(?:\w+\s)?(?:confirm|approve|verify|accept|decline|reject|delete|remove|cancel|void|record|change|update|abandon|dispute|undo)\s|\smark\s.{0,40}\s(?:as\s)?(?:finished|complete|completed|done|won|lost|over|confirmed|approved)\s/;
// 1.5.2 (Tester F151-5): verbs that are also names / nouns / adjectives ("Mark Fernandes stats", "Pick Pereira stats",
// "Close matches near me?", "Set rules for a deciding set?", "Start time of the final") are an instruction only as an
// imperative with an object: (please / can you / i want you to …) VERB (it | the/my/our/this… [≤2 words] match/result/…)
// – or "VERB … as finished/won/…" (WRITE_ASK) – anywhere a polite or instruction lead-in allows.
const AMBIG_VERB = '(?:mark|pick|choose|close|set|end|finish|start|select)';
const AMBIG_OBJ = "(?:match|matches|result|results|score|scores|game|games|set|sets|winner|toss|challenge|tournament|team|lineup|line up|time|date|venue|captain|player of the match|potm|mvp)";
const AMBIG_LEAD = "(?:please |pls |kindly |can you |could you |would you |will you |i want you to |i need you to |i'd like you to |i would like you to |go ahead and |you should |you must )";
const AMBIG_DOBJ = `(?:it|(?:the|my|our|this|that|these|those|today|their|his|her|a|an|new)\\s(?:\\S+\\s){0,2}${AMBIG_OBJ}|potm|mvp|player of the match)`;
// 1.5.3 (Tester F152-4): "Choose a team colour tips" / "pick a team name ideas" / "set rules tips" ask for advice – an
// ambiguous verb is not a command when the question asks for tips / ideas / advice / suggestions or the object is only a
// modifier ("team colour", "match kit"). Strong verbs (WRITE_START), Hindi commands and explicit asks are unchanged.
const AMBIG_ADVICE = /\s(?:tips?|ideas?|advice|suggestions?|suggest|guide|guidance|recommendations?|options|examples?|inspiration)\s/;
const AMBIG_MODIFIER = new RegExp(`\\s${AMBIG_OBJ}\\s(?:colou?rs?|names?|kits?|jerseys?|logos?|uniforms?|shirts?|songs?|chants?|mottos?|slogans?|themes?|styles?|drills?|strateg(?:y|ies)|formations?|tactics?|warm ?ups?)\\s`);
const WRITE_AMBIG = new RegExp(`^\\s${AMBIG_LEAD}?${AMBIG_VERB}\\s(?:\\S+\\s){1,3}as (?:the |our |my |a |their )?(?:new |team |next |vice |official )*(?:captain|vice captain|potm|mvp|player of the match|winner|winners)\\s|^\\s${AMBIG_LEAD}?${AMBIG_VERB}\\s${AMBIG_DOBJ}\\s|\\s${AMBIG_LEAD}${AMBIG_VERB}\\s${AMBIG_DOBJ}\\s`);
// 1.5.5 (Tester F154-4): naming someone captain is a change, in any wording – "please appoint Meera as captain",
// "make / promote / elect X (the) captain", "Rohan ko team ka captain set karo", "Meera ko captain banao / chuno",
// "मीरा को टीम का कप्तान चुनो / बनाओ". Questions ("who is the captain", "captain kaise chunte hain") are not.
const CAPTAIN_NOUN = '(?:captain|vice captain|vice-captain|skipper|kaptaan|kaptan|kapitan|caption)';
const CAPTAIN_SET = new RegExp(
  `^\\s${AMBIG_LEAD}?(?:appoint|nominate|assign|elect|declare|promote|crown|name|make|pick|choose|select|set)\\s(?:\\S+\\s){1,3}as\\s(?:the |our |my |a |their |new )*(?:new |team |next |vice |official )*${CAPTAIN_NOUN}\\s` +
  `|^\\s${AMBIG_LEAD}?(?:appoint|nominate|elect|promote|crown|make)\\s(?:\\S+\\s){1,3}(?:the |our |my |a |their )?(?:new |team |next |vice |official )*${CAPTAIN_NOUN}\\s` +
  `|\\sko\\s(?:\\S+\\s){0,3}${CAPTAIN_NOUN}\\s(?:\\S+\\s)?(?:set|bana|banao|banado|banaao|banaiye|banaye|chuno|chun|chuniye|chunlo|choose|select|pick|appoint|kar|karo|kardo|kariye|niyukt|naamit)\\s` +
  `|\\sको\\s(?:\\S+\\s){0,3}(?:कप्तान|कैप्टन|उपकप्तान|उप कप्तान)\\s(?:\\S+\\s)?(?:चुनो|चुनें|चुनिए|चुन|बनाओ|बनाएँ|बनाएं|बनाइए|बना|नियुक्त|नामित|सेट|कर|करो|करें)\\s`);
// 1.5.6 (Tester F155-4): intent-based – a captain / captaincy word plus ANY change verb or an assignment pattern is a
// change request ("hand over captaincy to Meera", "switch captain to Rohan", "let Meera be the captain", "Rohan ko
// captaincy de do", "कप्तानी मीरा को सौंप दो", "CAPTAIN = Meera", "set captain: Rohan"). Questions about the captain
// ("who is the captain of X?", "captain kaise chunte hain", "who can promote a player to captain?") are not.
const CAP_WORD = /\s(?:captain|captains|captaincy|captainship|vice captain|skipper|skippers|armband|kaptaan|kaptan|kaptaani|kaptani|caption|कप्तान|कप्तानी|उपकप्तान|कैप्टन|कैप्टनशिप)\s/;
const CAP_CHANGE = /\s(?:hand|hands|handover|handing|hand over|switch|swap|replace|change|changing|transfer|give|pass|assign|appoint|make|set|update|install|let\s(?:\S+\s){1,3}be|should be|must be|has to be|needs to be|from now|de do|dedo|de dijiye|de dena|saunp|saunpo|saunp do|sonp|sonpo|sonp do|bana|banao|bana do|banado|chuno|chun lo|karo|kar do|kardo|badlo|badal do|badal dijiye|सौंप|सौंपो|सौंप दो|सौंपें|दे दो|दीजिए|बनाओ|बना दो|बनाएं|चुनो|बदलो|बदल दो|बदलें|करो|कर दो)\s/;
const CAP_ASSIGN = /(?:captain|captaincy|skipper|कप्तान|कप्तानी)\s*[=:]\s*\S/i;
const CAP_QUESTION = /^\s(?:who|whom|whose|what|how|when|why|which|where|is|are|was|were|does|do|did|has|have|kaun|kya|kaise|kab|kyun|कौन|क्या|कैसे|कब|क्यों)\s|^\s(?:can|could|may|should|would|will)\s(?!you\s|u\s)|\s(?:sakte|sakta|sakti|sakenge|सकते|सकता|सकती|kaise|kaun|kya|कैसे|कौन|क्या)\s/;
const POLITE = /^\s(?:please|pls|kindly|can you|could you|would you|will you|can u)\s/;
// 1.5.7 (Tester F156-6): reverse / arrow assignments ("Meera = captain", "captain -> Rohan", "Rohan → captain");
// suggestion / do-it markers ("do it", "how about you …", "why not …", "when you get a chance", "right now") make even a
// question-shaped sentence a request; how-to words ("steps", "explain", "how", "which screen", "kaise", "tarika") make
// a sentence without such a marker a help question.
const CAP_ASSIGN2 = /\S\s*(?:=|->|→|=>)\s*(?:the\s+)?(?:new\s+)?(?:captain|skipper|कप्तान)\b|(?:captain|captaincy|skipper|कप्तान|कप्तानी)\s*(?:->|→|=>)\s*\S/i;
const CAP_DO = /\s(?:do it|go ahead|how about|what about|why not|when you get a chance|when you can|right now|asap|make it happen|kar do na|abhi kar do)\s/;
const CAP_HOW = /\s(?:steps?|how|explain|explains|guide|process|procedure|tutorial|instructions?|possible|which screen|what screen|where|when|kaise|kaisey|tarika|tareeka|kahan|kahaan|कैसे|तरीका|कहाँ|कहां)\s/;
function captainChange(question: string, q: string): boolean {
  const raw = question.normalize('NFKC');
  if (CAP_ASSIGN.test(raw) || CAP_ASSIGN2.test(raw)) return true;
  if (!CAP_WORD.test(q)) return false;
  if (CAP_DO.test(q) && (CAP_CHANGE.test(q) || /\sdo it\s/.test(q))) return true;
  if (!CAP_CHANGE.test(q)) return false;
  if (POLITE.test(q)) return true;
  return !CAP_QUESTION.test(q) && !CAP_HOW.test(q);
}
/** 1.5.7 (F156-6): a question ABOUT captains (how to change, who is captain) – answered from the captain guide. */
export function captainHelp(question: string): boolean {
  const q = n(question);
  if (!CAP_WORD.test(q) || captainChange(question, q)) return false;
  // about WHO the captain is or HOW captains change / are picked – not every sentence that mentions captains ("how does
  // the scorer desk help captains?" stays a normal knowledge question)
  if (!CAP_CHANGE.test(q) && !CAP_TOPIC.test(q)) return false;
  return CAP_QUESTION.test(q) || CAP_HOW.test(q) || /\?\s*$/.test(question) || CAP_CHANGE.test(q);
}
const CAP_TOPIC = /\s(?:transfer|transferred|handover|hand over|pass|pick|picks|picked|picking|choose|chosen|chunte|chunein|chuna|chunna|chune|select|selected|decide|decides|decided|elect|elected|appoint|appointed|promote|promoted|new|naya|nayi|kaun|who|whos|who's|whose|कौन|चुन\S*|नया|become|banta|bante|banega|banti|two|multiple|more than one|match captains?|vice|badal\S*|badl\S*|बदल\S*|बदले\S*|saunp\S*|सौंप\S*|handover\S*)\s/;
const WRITE_HI = /(डिलीट करो|डिलीट कर दो|रद्द करो|रद्द कर दो|जॉइन करो|हटा दो|हटाओ|बना दो|बनाओ|शुरू कर दो|शुरू करो|मिटा दो|मिटाओ|स्वीकार कर लो|स्वीकार करो|बदल दो|बदलो|कर दो|भेज दो|जोड़ दो|कन्फ़र्म करो|कन्फर्म करो|पुष्टि करो|मंज़ूर करो|मंजूर करो|अप्रूव करो|ख़त्म करो|खत्म करो)\s$|\s(kar do|kardo|bana do|banao|hata do|hatao|delete karo|delete kar do|accept karo|accept kar lo|mita do|badal do|bhej do|jod do|shuru karo|start karo|confirm karo|confirm kar do|approve karo|approve kar do|finish karo|finish kar do|khatam karo|khatam kar do|pura karo|pura kar do|manzoor karo)\s/;
const INJECT = /(ignore|disregard|forget|override)\s.{0,40}(instructions?|rules|prompt|above|previous)|system prompt|you are now|act as|developer mode|jailbreak|pretend|\ssystem\s(?:you|message|override|mode)\s|you may now|new instructions|(निर्देश|नियम).{0,20}(अनदेखा|भूल|नज़रअंदाज़)|अनदेखा कर|पिछले निर्देश|(ignore|bhool|bhul) (karo|jao)|nirdesh/;

const STATS = /\s(stats?|statistics|record|performance|rank|ranking|ranked|points|wins|won|win rate|matches played|आँकड़े|आंकड़े|स्टैट्स|रैंक|रैंकिंग|अंक|जीत|aankde|aankade|ank|jeet|jeete|jeeta|jite|जीते|जीता|doing|performing|form)\s/;
const LEADER = /\s(leaderboard|top\s?\d*\s?(players?|khiladi)|best players?|number one|no 1|#1|ranked first|ranked 1|who is top|sabse (accha|best|upar)|लीडरबोर्ड|टॉप|सबसे अच्छे?|leader board|rankings)\s/;
const TEAMS = /\s(teams?|टीम|टीमें|टीमों)\s/;
const ROSTER = /\s(roster|squad|players|members|line ?up|lineup|who plays|who is in|who are in|plays for|खिलाड़ी|सदस्य|कौन खेलता|कौन कौन|khiladi|kaun khelta|kaun kaun|members kaun)\s/;
const MATCHES = /\s(match|matches|game|games|fixture|play next|playing next|मैच|मुकाबला|मुकाबले|khel)\s/;
// 1.5.1 (Tester F150-7): 'my last results' is a match-list question even without the word match / game
const RESULTS = /\s(results?|scorelines?|outcomes?|नतीजे|नतीजा|नतीजों|परिणाम|रिज़ल्ट|रिजल्ट|natije|nateeje|natija|nateeja|result|rizalt)\s/;
const NEXT = /\s(next|upcoming|coming|future|scheduled|when do i play|when is my|agla|agli|aane wale|अगला|अगली|आने वाले|आगामी)\s/;
const PAST = /\s(last|past|previous|recent|played|result|results|won|lost|pichla|pichhla|pichle|पिछला|पिछले|पिछली|नतीजा|रिज़ल्ट|result kya)\s/;
const LIVE = /\s(live|right now|currently|current score|score now|what's the score|whats the score|score kya|abhi|लाइव|अभी|स्कोर क्या|चल रहा)\s/;
const SCORE = /\s(score|scores|स्कोर)\s/;
const STANDINGS = /\s(standings?|table|points table|leading|qualif\w*|group [a-h]|who won|winner|champion|champions|स्टैंडिंग|तालिका|टेबल|अंक तालिका|पॉइंट्स टेबल|विजेता|चैंपियन|kaun jeeta|kaun aage|jeeta)\s/;
const FIXTURES = /\s(fixtures?|schedule|bracket|semi ?finals?|final|quarter ?finals?|draw|मुकाबले|शेड्यूल|ब्रैकेट|फ़ाइनल|सेमीफ़ाइनल)\s/;
const TOURNAMENT = /\s(tournament|tournaments|cup|league|trophy|टूर्नामेंट|कप|लीग|ट्रॉफी)\s/;
const CHALLENGE = /\s(challenges?|चैलेंज|चुनौती|chalenge)\s/;

/** Words that are never part of a name we look up. */
const FILLER = new Set(`can could have should would will may might must allowed allow maximum minimum max min need needed required up ho sakte sakta sakti sakta chahiye hota hote zyada jyada हो सकते सकता सकती चाहिए होता होते होती ज़्यादा ज्यादा अधिकतम न्यूनतम ज़रूरी doing performing form maine मैंने jeete jeeta jite जीते जीता i i'm im am me mine my mera meri mere mujhe main apna apni apne मेरा मेरी मेरे मैं मुझे अपना अपनी अपने have has had many any there some koi कोई रैंक रैंकिंग स्टैट्स अंक जीत aankde aankade jeet stats rank ranking kitne kitna कितने कितना status स्थिति what whats what's is are was the a an of for in on at to me my show tell give list see find get please pls about who whos who's which how many much does do did and or with from by team teams team's players player squad roster members lineup line up plays play playing stats stat statistics record performance rank ranking points wins score scores live now current right currently standings standing table fixtures fixture schedule bracket final semi semis finals quarter tournament tournaments cup league match matches game games next upcoming last past recent result results won lost leading winner champion champions group qualified qualify it its this that his her their s 's kya hai hain ka ki ke ko me mein se aur batao bata dikhao dikha kaun kab kitne kitna abhi wala wali wale khiladi khilaadi players' का की के को में से है हैं क्या कौन कब बताओ बताइए दिखाओ और खिलाड़ी टीम स्कोर लाइव अभी आँकड़े आंकड़े स्टैंडिंग मुकाबले मैच टेबल`.split(/\s+/));
/** Volleyball / app words: a 'name' made of these is a rules question, not a player. */
const GENERIC = new Set('volleyball beach indoor side sides set sets win winning serve serves serving service rally net rotation deuce point court ball rules rule timeout timeouts libero substitution substitutions sub touch touches block attack height size app game games match matches team sets? सेट सर्विस नेट पॉइंट नियम'.split(' '));
const LIST_TOURN = /\s(?:(?:which|what|list|all|show|any|upcoming|running)(?: the| all| me)? tournaments|tournaments (?:are there|list)|कौन से टूर्नामेंट|कौन कौन से टूर्नामेंट|सभी टूर्नामेंट|kaun se tournament|kaunse tournament|saare tournament)/;
const TOURNAMENT_WORDS = new Set('cup league trophy open championship series tournament कप लीग ट्रॉफी'.split(' '));

/** The part of the question left after removing intent words: the name to look up ('' when none). */
export function entityOf(question: string, drop: RegExp[] = []): string {
  let s = n(question).replace(/'s\s/g, ' ');
  for (const r of drop) s = s.replace(new RegExp(r.source, 'g'), ' ');
  const kept = s.split(' ').filter((w) => w && !FILLER.has(w) && !/^\d+$/.test(w));
  return kept.join(' ').trim().slice(0, 60);
}
// 1.5.4 (Tester F153-5) / 1.5.5 (F154-3): set scores, set / score words, ordinals and HI / Hinglish question fillers are
// never a team name: "what was the score 25-23 set", "set ka score kya tha", "तीसरे सेट का स्कोर क्या था?" → no team;
// "what was the score 25-23 set Holdout Hawks" → team "holdout hawks".
const SET_ORD = /^(?:first|second|third|fourth|fifth|last|final|deciding|current|this|that|1st|2nd|3rd|4th|5th|\d+(?:st|nd|rd|th)?)$/;
const LIVE_NOISE = new Set(('set sets game games score scores scoreline point points rally ' +
  'ka ki ke kya kia tha thi the hai hain ho hua hue raha rahi rahe chal abhi aaj me mein mai par pe wala wali wale kitna kitne kaisa ' +
  'pehla pehle pahla pahle doosra dusra doosre dusre teesra tisra teesre tisre chautha chauthe paanchva panchva paanchvein aakhri akhri antim ' +
  'सेट स्कोर का की के क्या था थी थे है हैं हो हुआ रहा रही रहे चल अभी आज में पर वाला वाली वाले कितना कितने ' +
  'पहला पहले पहली दूसरा दूसरे दूसरी तीसरा तीसरे तीसरी चौथा चौथे चौथी पांचवां पाँचवाँ पांचवें पाँचवें आखिरी आख़िरी अंतिम निर्णायक').split(' '));
// 1.5.6 (Tester F155-3): set-type words are never a team name – "tie-break set score?", "golden set ka score", "final set
// score of Juhu Spikers" (→ team "juhu spikers"). "<type> set" is dropped as a phrase, so "Golden Eagles" stays a name.
const SET_TYPE_PHRASE = /\s(?:tie break(?:er)?|tiebreak(?:er)?|golden|decider|deciding|final|last|super|silver|sudden death|टाई ब्रेक|टाईब्रेक|गोल्डन|फाइनल|फ़ाइनल|निर्णायक|आखिरी|आख़िरी|अंतिम)\s(?:set|sets|सेट)\s/g;
const SET_TYPE_WORDS = new Set('tie break tiebreak tiebreaker breaker golden decider deciding final super silver sudden death टाई ब्रेक टाईब्रेक गोल्डन फाइनल फ़ाइनल डिसाइडर निर्णायक'.split(' '));
function liveTeamOf(question: string): string {
  const e = entityOf(n(question.replace(/\b\d{1,2}\s?[-–:\/]\s?\d{1,2}\b/g, ' ')).replace(SET_TYPE_PHRASE, ' set ').replace(SET_TYPE_PHRASE, ' set '), [LIVE, SCORE]);
  let words = e.split(' ').filter((w) => w && !LIVE_NOISE.has(w) && !SET_ORD.test(w) && !['tie', 'tiebreak', 'tiebreaker', 'टाई', 'टाईब्रेक'].includes(w));
  if (words.every((w) => SET_TYPE_WORDS.has(w) || GENERIC.has(w))) words = [];
  return words.join(' ');
}
/** A tournament-looking name: "<words> cup|league|…" (kept with the keyword) or the remaining words. */
function tournamentName(question: string): string | undefined {
  const raw = n(question).replace(/'s\s/g, ' ').split(' ').filter(Boolean);
  const i = raw.findIndex((w) => TOURNAMENT_WORDS.has(w) && w !== 'tournament');
  if (i >= 0) {
    let j = i;
    while (j > 0 && !FILLER.has(raw[j - 1]) && !/^\d+$/.test(raw[j - 1])) j--;
    const name = raw.slice(j, i + 1).join(' ');
    if (j < i) return name.slice(0, 80);
  }
  const rest = entityOf(question).split(' ').filter((w) => !TOURNAMENT_WORDS.has(w)).join(' ');
  return rest && [...rest].length >= 3 ? rest.slice(0, 80) : undefined;
}
const limitOf = (q: string, def: number) => { const m = /\b(?:top|टॉप)\s*(\d{1,2})\b|\b(\d{1,2})\s*(?:top|best|players|khiladi|खिलाड़ी)/.exec(q); const v = m ? Number(m[1] ?? m[2]) : def; return Math.max(1, Math.min(10, v)); };

export function parseIntent(question: string): Intent {
  const q = n(question);
  if (INJECT.test(q)) return { kind: 'injection' };
  // 'give me X's email' / 'tell me where Y lives' are about X / Y, not the asker
  const firstPerson = ME.test(q.replace(/\s(give|tell|show|send|get|find|bata|batao|dikhao)\s(me|mujhe)\s/g, ' '));
  if (WHERE_LIVE.test(q) && !/\s(i|my|mera|meri|main|मैं|मेरा|मेरी)\s/.test(q)) return { kind: 'private' };
  if (PRIVATE.test(q) && (!firstPerson || OTHER_PERSON.test(q) || /\s(of|for)\s/.test(q.replace(/\s(of|for)\s(my|me)\s/, ' ')))) {
    // someone else's private data – or anyone's in bulk. Own wallet / number questions go to the how-to guides.
    if (!(firstPerson && !OTHER_PERSON.test(q) && /\s(my|mera|meri|mere|मेरा|मेरी|मेरे)\s(phone|number|mobile|wallet|balance|email|फ़ोन|फोन|नंबर|वॉलेट|ईमेल)\s/.test(q))) return { kind: 'private' };
  }
  if (PRIVATE.test(q) && firstPerson) return { kind: 'rag' };
  // 1.5.7 (Tester F156-6): captain changes are refused in any form (before the how-to check: "is it possible to make
  // Meera captain now? do it"); captain questions get the captain guide, or the roster of the named team ("who is the
  // captain of Juhu Spikers") – never the fair-play / verdict FAQ
  if (captainChange(question, q) || CAPTAIN_SET.test(q)) return { kind: 'write' };
  const WHO_CAP = /^\s(?:who is|who's|whos|who are|name the)\s|\s(?:kaun hai|kaun he|kaun hain|कौन है|कौन हैं)\s/;
  if (captainHelp(question) || (WHO_CAP.test(q) && CAP_WORD.test(q))) {
    const team = entityOf(question, [CAP_WORD, /\s(?:name|names|current|team|tell|batao|bataiye|naam|नाम)\s/]);
    if (WHO_CAP.test(q) && team && [...team].length >= 3 && !team.split(' ').every((w) => GENERIC.has(w))) return { kind: 'tools', calls: [{ name: 'team_roster', args: { team: team.slice(0, 40) } }] };
    return { kind: 'rag', topic: 'captain' };
  }
  if (HOWTO.test(q) && !/\show (is|are)\s.+\s(doing|performing)\s/.test(q)) return { kind: 'rag' };
  // 1.5.4 (Tester F153 Info, disputed paraphrases): "If the admin approves my rejected match, will it count?" / "What
  // happens after I reject a result?" ask for the rule, not for my matches → help / FAQ
  if (/^\s(?:if|what happens|what will happen|what would happen|when)\s/.test(q) && /\s(?:reject|rejects|rejected|disputed?|approves?|approved|voids?|voided)\s/.test(q)) return { kind: 'rag' };
  if (WRITE_START.test(q) || (WRITE_AMBIG.test(q) && !AMBIG_ADVICE.test(q) && !(AMBIG_MODIFIER.test(q) && !/\s(?:to|as|into|=)\s/.test(q))) || WRITE_HI.test(q) || WRITE_ASK.test(q) || CAPTAIN_SET.test(q)) return { kind: 'write' };

  const calls: { name: AskToolName; args: Record<string, string | number> }[] = [];
  const add = (name: AskToolName, args: Record<string, string | number> = {}) => { if (!calls.some((c) => c.name === name)) calls.push({ name, args }); };
  // 1.5.6 (F155-3): "final / deciding / tie-break set" is a set, not a tournament final
  const qt = q.replace(SET_TYPE_PHRASE, ' set ').replace(SET_TYPE_PHRASE, ' set ');
  const tourn = TOURNAMENT.test(qt) || STANDINGS.test(qt) || FIXTURES.test(qt);

  if (CHALLENGE.test(q)) add('challenges_status');
  if (LEADER.test(q)) add('leaderboard', { limit: limitOf(q, 5) });
  // 1.5.1 (known miss holdout-05): 'show the ranking' with no name and not about me = the leaderboard
  else if (!firstPerson && /\s(ranking|rankings|रैंकिंग|ranks)\s/.test(q) && !entityOf(question, [STATS, /\s(show|overall|full|current|latest|dikhao)\s/])) add('leaderboard', { limit: limitOf(q, 5) });
  if (LIST_TOURN.test(q) && !STANDINGS.test(q) && !/\s(cup|league|trophy|open|championship|series|कप|लीग|ट्रॉफी)\s/.test(q)) add('tournament_standings', { list: 'yes' });
  else if (tourn && (STANDINGS.test(q) || (TOURNAMENT.test(q) && !FIXTURES.test(q) && !MATCHES.test(q)))) { const t = tournamentName(question); const g = /\s(?:group|ग्रुप)\s([a-h])\s/.exec(q)?.[1]?.toUpperCase(); add('tournament_standings', { ...(t ? { tournament: t } : {}), ...(g ? { group: g } : {}) }); }
  if (tourn && FIXTURES.test(qt) && !STANDINGS.test(qt)) { const t = tournamentName(question); add('tournament_fixtures', t ? { tournament: t } : {}); }
  // 1.5.1 (known miss holdout-06): 'is my match live' = the viewer's own live matches (my_matches live), not every live match
  const myLive = firstPerson && MATCHES.test(q) && LIVE.test(q);
  if (!tourn && !myLive && (LIVE.test(q) || (SCORE.test(q) && !firstPerson))) { const e = liveTeamOf(question); add('live_score', e && [...e].length >= 2 ? { team: e.slice(0, 40) } : {}); }
  if (firstPerson && HOW_MANY_ME.test(q) && (STATS.test(q) || MATCHES.test(q))) add('my_stats');
  else if (myLive && !tourn) add('my_matches', { when: 'live', limit: 5 });
  else if (!tourn && (firstPerson || NEXT.test(q) || PAST.test(q)) && (MATCHES.test(q) || (firstPerson && RESULTS.test(q))) && !calls.some((c) => c.name === 'live_score')) add('my_matches', { when: NEXT.test(q) ? 'upcoming' : PAST.test(q) || RESULTS.test(q) ? 'past' : 'all', limit: 5 });
  else if (firstPerson && NEXT.test(q) && /\s(play|khel|खेल)/.test(q)) add('my_matches', { when: 'upcoming', limit: 5 });
  if (firstPerson && TEAMS.test(q) && !ROSTER.test(q)) add('my_teams');
  if (ROSTER.test(q) && !LEADER.test(q)) { const e = entityOf(question, [ROSTER]); if (e && [...e].length >= 2 && !e.split(' ').every((w) => GENERIC.has(w) || ['on', 'a', 'the', 'in', 'are', 'is', 'there', 'how', 'many'].includes(w))) add('team_roster', { team: e.slice(0, 40) }); else if (firstPerson) add('my_teams'); }
  if (STATS.test(q) && !LEADER.test(q) && !calls.some((c) => c.name.startsWith('tournament') || c.name === 'my_stats')) {
    const e = entityOf(question, [STATS]);
    if (firstPerson && !e) add('my_stats');
    else if (e && [...e].length >= 2 && !calls.some((c) => c.name === 'my_matches') && !HOW_MANY_ME.test(q) && !e.split(' ').some((w) => GENERIC.has(w))) add('player_stats', { name: e });
    else if (firstPerson) add('my_stats');
  }
  return calls.length ? { kind: 'tools', calls: calls.slice(0, 5) } : { kind: 'rag' };
}
