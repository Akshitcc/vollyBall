/**
 * 1.4.20 Ask VolleyLive: short volleyball rule notes for the assistant, WRITTEN IN OUR OWN WORDS.
 *
 * COPYRIGHT: the FIVB Official Volleyball Rules are © FIVB. Nothing here is copied from them – each note is a plain
 * summary of a well-known rule, with a link to the official page so users read the real text there. Do not paste
 * FIVB wording into this file. Local / casual matches in VolleyLive may use other settings (core/rules.ts presets):
 * the notes say "in standard indoor rules". HI: NEEDS REVIEW by a native speaker, like the other HI strings.
 */
export const FIVB_RULES_URL = 'https://www.fivb.com/volleyball/the-game/official-volleyball-rules/';

/** `faq`: an in-app FAQ that covers this topic – the source then opens it (1.4.21, QA V1420-6). */
export interface RuleNote { id: string; faq?: string; tags: string[]; en: { title: string; text: string }; hi: { title: string; text: string } }

export const RULE_NOTES: readonly RuleNote[] = [
  { id: 'rule-set-points', tags: ['set', 'points', '25', 'win by two', 'deuce', 'सेट', 'पॉइंट'],
    en: { title: 'How many points win a set?', text: 'In standard indoor rules a set goes to the first team with 25 points and a lead of at least two, so it can run past 25 (26–24, 27–25 and so on). VolleyLive lets the match creator choose other targets for casual games.' },
    hi: { title: 'एक सेट कितने पॉइंट पर जीतते हैं?', text: 'स्टैंडर्ड इंडोर नियमों में जो टीम पहले 25 पॉइंट तक पहुँचे और कम से कम दो पॉइंट आगे हो, वह सेट जीतती है, इसलिए सेट 25 से आगे भी जा सकता है (26–24, 27–25 आदि)। VolleyLive में मैच बनाने वाला आम खेल के लिए दूसरे लक्ष्य चुन सकता है।' } },
  { id: 'rule-match-sets', tags: ['match', 'best of', 'five', 'deciding set', '15', 'tie-break', 'मैच', 'निर्णायक'],
    en: { title: 'How many sets are in a match?', text: 'A standard match is best of five sets: the first team to win three sets wins. If it reaches two sets each, the deciding fifth set is shorter – played to 15, still with a two-point lead.' },
    hi: { title: 'एक मैच में कितने सेट होते हैं?', text: 'स्टैंडर्ड मैच पाँच में से सबसे अच्छे तीन सेट का होता है: जो टीम पहले तीन सेट जीते वह मैच जीतती है। दो-दो सेट होने पर निर्णायक पाँचवाँ सेट छोटा होता है – 15 पॉइंट तक, फिर भी दो पॉइंट की बढ़त ज़रूरी।' } },
  { id: 'rule-rally-scoring', tags: ['rally', 'point', 'serve', 'scoring', 'रैली', 'सर्व'],
    en: { title: 'Who gets the point in a rally?', text: 'Every rally scores a point (rally-point scoring). The team that wins the rally gets the point, and if it was receiving, it also wins the right to serve next.' },
    hi: { title: 'रैली का पॉइंट किसे मिलता है?', text: 'हर रैली पर एक पॉइंट मिलता है (रैली-पॉइंट स्कोरिंग)। रैली जीतने वाली टीम को पॉइंट मिलता है, और अगर वह सर्व रिसीव कर रही थी तो अगली सर्व भी उसी की होती है।' } },
  { id: 'rule-rotation', tags: ['rotation', 'rotate', 'clockwise', 'position', 'रोटेशन', 'पोज़िशन'],
    en: { title: 'When do players rotate?', text: 'When a team wins back the serve, its six players move one position clockwise, and the player who moves to the back-right spot serves. Being out of position when the ball is served is a fault.' },
    hi: { title: 'खिलाड़ी कब घूमते (रोटेट) हैं?', text: 'जब कोई टीम सर्व वापस जीतती है, तो उसके छह खिलाड़ी घड़ी की दिशा में एक जगह आगे बढ़ते हैं, और जो खिलाड़ी पीछे-दाएँ आता है वह सर्व करता है। सर्व के समय गलत जगह पर होना फ़ॉल्ट है।' } },
  { id: 'rule-three-hits', tags: ['hits', 'touches', 'three', 'double', 'contact', 'block', 'टच', 'हिट'],
    en: { title: 'How many times can a team touch the ball?', text: 'A team may play the ball up to three times before sending it over. One player may not hit it twice in a row, though touching it during a block does not count as one of the three.' },
    hi: { title: 'एक टीम गेंद को कितनी बार छू सकती है?', text: 'गेंद नेट के पार भेजने से पहले टीम उसे ज़्यादा से ज़्यादा तीन बार खेल सकती है। एक खिलाड़ी लगातार दो बार नहीं मार सकता, पर ब्लॉक के दौरान छूना इन तीन में नहीं गिना जाता।' } },
  // 1.4.22 (QA V1421-1): "net height" had no answer (only the net-touch note). Our own words; heights are the
  // well-known standard indoor values.
  { id: 'rule-net-height', tags: ['net height', 'height', 'high', 'tall', 'metres', 'meters', '2.43', '2.24', 'नेट', 'ऊँचाई', 'ऊंचाई', 'मीटर'],
    en: { title: 'How high is the net?', text: 'In standard indoor rules the net height is 2.43 m for men and 2.24 m for women, measured at the centre of the court. Youth and casual games often use a lower net.' },
    hi: { title: 'नेट की ऊँचाई कितनी होती है?', text: 'स्टैंडर्ड इंडोर नियमों में नेट की ऊँचाई पुरुषों के लिए 2.43 मीटर और महिलाओं के लिए 2.24 मीटर होती है, जो कोर्ट के बीच में नापी जाती है। जूनियर और आम खेलों में अक्सर नेट नीचा रखा जाता है।' } },
  { id: 'rule-net', tags: ['net', 'touch', 'centre line', 'fault', 'नेट', 'फ़ॉल्ट'],
    en: { title: 'Is touching the net a fault?', text: 'A player who touches the net between the antennas while playing the ball, or who interferes with play by doing so, commits a fault. Stepping fully across the centre line into the other court is also a fault.' },
    hi: { title: 'क्या नेट छूना फ़ॉल्ट है?', text: 'गेंद खेलते समय एंटेना के बीच नेट छूना, या ऐसा करके खेल में बाधा डालना फ़ॉल्ट है। सेंटर लाइन पूरी तरह पार करके दूसरे कोर्ट में पैर रखना भी फ़ॉल्ट है।' } },
  { id: 'rule-serve', tags: ['serve', 'service', 'foot fault', 'end line', '8 seconds', 'सर्व', 'सर्विस'],
    en: { title: 'What are the basic serving rules?', text: 'The server stands behind the end line and has a few seconds after the referee’s whistle to serve, hitting the ball with one hand or arm. Stepping on the line or the court while serving, or a serve that does not cross the net between the antennas, loses the rally.' },
    hi: { title: 'सर्व के बुनियादी नियम क्या हैं?', text: 'सर्व करने वाला एंड लाइन के पीछे खड़ा होता है और रेफ़री की सीटी के बाद कुछ सेकंड में एक हाथ या बाँह से गेंद मारता है। सर्व करते समय लाइन या कोर्ट पर पैर रखना, या सर्व का एंटेना के बीच नेट पार न करना, रैली हरवा देता है।' } },
  { id: 'rule-libero', faq: 'team-positions', tags: ['libero', 'defensive', 'back row', 'लिबेरो'],
    en: { title: 'What is a libero?', text: 'The libero is a defensive specialist in a different-coloured shirt who plays only in the back row. The libero can replace a back-row player freely, but may not attack the ball above net height or block.' },
    hi: { title: 'लिबेरो कौन होता है?', text: 'लिबेरो अलग रंग की जर्सी वाला रक्षात्मक खिलाड़ी है जो सिर्फ़ पिछली पंक्ति में खेलता है। वह पिछली पंक्ति के किसी खिलाड़ी की जगह बिना गिनती के आ सकता है, पर नेट से ऊपर अटैक या ब्लॉक नहीं कर सकता।' } },
  { id: 'rule-subs-timeouts', tags: ['substitution', 'substitute', 'timeout', 'time-out', 'सब्स्टिट्यूट', 'टाइम-आउट'],
    en: { title: 'How do substitutions and time-outs work?', text: 'In standard indoor rules each team gets a limited number of substitutions per set (six) and two short time-outs per set. A substituted starter can come back only in the place of the player who replaced them.' },
    hi: { title: 'सब्स्टिट्यूशन और टाइम-आउट कैसे होते हैं?', text: 'स्टैंडर्ड इंडोर नियमों में हर टीम को हर सेट में सीमित सब्स्टिट्यूशन (छह) और दो छोटे टाइम-आउट मिलते हैं। बाहर गया शुरुआती खिलाड़ी सिर्फ़ उसी खिलाड़ी की जगह वापस आ सकता है जिसने उसकी जगह ली थी।' } },
  { id: 'rule-in-out', tags: ['in', 'out', 'line', 'ball in', 'ball out', 'antenna', 'इन', 'आउट'],
    en: { title: 'When is the ball in or out?', text: 'The ball is in when it touches the court, lines included. It is out when it lands fully outside the lines, hits the antenna or anything outside the court, or crosses the net outside the antennas.' },
    hi: { title: 'गेंद कब इन और कब आउट होती है?', text: 'गेंद लाइनों समेत कोर्ट को छुए तो इन है। पूरी तरह लाइनों के बाहर गिरे, एंटेना या कोर्ट के बाहर किसी चीज़ से टकराए, या एंटेना के बाहर से नेट पार करे तो आउट है।' } },
];
