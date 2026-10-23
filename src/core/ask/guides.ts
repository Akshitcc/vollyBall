/**
 * 1.5.0 Ask VolleyLive: short how-to guides, one per screen, written for the assistant's knowledge base (chunk kind
 * 'guide'). Each links to its screen in the app (`screenUrl`). HI: NEEDS REVIEW by a native speaker, like the other
 * HI strings.
 */
export interface Guide { id: string; path: string; tags: string[]; en: { title: string; text: string }; hi: { title: string; text: string } }

/** In-app link to a screen (the Ask screen opens it with the router). */
export const screenUrl = (path: string) => `volleylive://open?path=${encodeURIComponent(path)}`;

export const GUIDES: readonly Guide[] = [
  { id: 'guide-home', path: '/', tags: ['home', 'start', 'quick actions', 'होम'],
    en: { title: 'Using the Home screen', text: 'Home shows live matches near you, your rank card and quick actions: New match, My teams, Rankings, Tournaments, Courts nearby and Memories. Tap a live match to follow its score. Tap the rank card to open Rankings.' },
    hi: { title: 'होम स्क्रीन कैसे इस्तेमाल करें', text: 'होम पर आपके पास चल रहे लाइव मैच, आपका रैंक कार्ड और क्विक एक्शन दिखते हैं: नया मैच, मेरी टीमें, रैंकिंग, टूर्नामेंट, पास के कोर्ट और यादें। लाइव मैच पर टैप करके स्कोर देखें। रैंक कार्ड पर टैप करके रैंकिंग खोलें।' } },
  { id: 'guide-new-match', path: '/match/new', tags: ['new', 'start', 'begin', 'नया', 'शुरू'],
    en: { title: 'How to start a new match', text: 'Tap the big score button in the middle of the tab bar (or New match on Home). Pick the two teams, choose the rules preset (indoor, beach or a custom one), check the players and who serves first, then tap Start. You become the scorer of that match.' },
    hi: { title: 'नया मैच कैसे शुरू करें', text: 'टैब बार के बीच वाले बड़े स्कोर बटन पर टैप करें (या होम पर नया मैच)। दोनों टीमें चुनें, नियम चुनें (इनडोर, बीच या कस्टम), खिलाड़ी और पहली सर्विस जाँचें, फिर शुरू करें दबाएँ। आप उस मैच के स्कोरर बन जाते हैं।' } },
  { id: 'guide-scoring', path: '/score', tags: ['scoring', 'point', 'undo', 'timeout', 'scorer', 'स्कोरिंग', 'पॉइंट', 'अनडू'],
    en: { title: 'How to score a match', text: 'On the scoring screen tap a team side to give it the point. Undo removes the last point. The app tracks serve, sets and the deciding set for you and ends the match when a team has won enough sets. Only the scorer can change the score; everyone else sees it live.' },
    hi: { title: 'मैच का स्कोर कैसे रखें', text: 'स्कोरिंग स्क्रीन पर जिस टीम को पॉइंट मिला उसकी तरफ़ टैप करें। अनडू आख़िरी पॉइंट हटाता है। ऐप सर्विस, सेट और निर्णायक सेट ख़ुद गिनता है और जब कोई टीम ज़रूरी सेट जीत ले तो मैच ख़त्म करता है। स्कोर सिर्फ़ स्कोरर बदल सकता है; बाकी सब लाइव देखते हैं।' } },
  { id: 'guide-match-detail', path: '/', tags: ['details', 'result', 'line-up', 'विवरण', 'नतीजा'],
    en: { title: 'Reading a match page', text: 'A match page shows both teams, the set scores, who won and the line-ups. A live match updates by itself. Finished matches count towards player stats and rankings.' },
    hi: { title: 'मैच पेज कैसे पढ़ें', text: 'मैच पेज पर दोनों टीमें, सेट के स्कोर, विजेता और लाइन-अप दिखते हैं। लाइव मैच अपने आप अपडेट होता है। ख़त्म हुए मैच खिलाड़ियों के आँकड़ों और रैंकिंग में गिने जाते हैं।' } },
  { id: 'guide-teams', path: '/teams', tags: ['team', 'create team', 'my teams', 'captain', 'roster', 'टीम', 'कप्तान'],
    en: { title: 'How to create and manage a team', text: 'Open Profile > My teams > New team (or My teams on Home). Give the team a name and a colour and add players by their mobile number or name. The creator is the captain. The captain can add or remove players and substitutes from the team page.' },
    hi: { title: 'टीम संभालना: खिलाड़ी, सब्स्टिट्यूट और कप्तान', text: 'प्रोफ़ाइल > मेरी टीमें > नई टीम खोलें (या होम पर मेरी टीमें)। टीम का नाम और रंग चुनें और खिलाड़ियों को उनके मोबाइल नंबर या नाम से जोड़ें। बनाने वाला कप्तान होता है। कप्तान टीम पेज से खिलाड़ी और सब्स्टिट्यूट जोड़ या हटा सकता है।' } },
  // 1.5.7 (Tester F156-6): who the captain is and how captains change – the help answer for every captain how-to question
  { id: 'guide-captain', path: '/teams', tags: ['captain', 'captaincy', 'change captain', 'new captain', 'match captain', 'skipper', 'कप्तान', 'कप्तानी'],
    en: { title: 'Team captain and match captains', text: 'The player who creates a team is its captain (shown on the team page). The app has no screen to hand over or change the team captain – to have a different captain, that player creates the team (Profile > My teams > New team). For a single match, the two match captains (they confirm the result and pick the Player of the Match) are picked in New match before the first rally. The team captain adds or removes players and substitutes from the team page.' },
    hi: { title: 'टीम कप्तान और मैच कप्तान', text: 'जो खिलाड़ी टीम बनाता है वही उसका कप्तान होता है (टीम पेज पर दिखता है)। ऐप में टीम का कप्तान बदलने या कप्तानी सौंपने की कोई स्क्रीन नहीं है – दूसरा कप्तान चाहिए तो वह खिलाड़ी टीम बनाए (प्रोफ़ाइल > मेरी टीमें > नई टीम)। एक मैच के लिए दोनों मैच कप्तान (जो नतीजे की पुष्टि करते हैं और प्लेयर ऑफ़ द मैच चुनते हैं) नया मैच में पहली रैली से पहले चुने जाते हैं। टीम कप्तान टीम पेज से खिलाड़ी और सब्स्टिट्यूट जोड़ता या हटाता है।' } },
  { id: 'guide-tournament-create', path: '/tournament/new', tags: ['tournament', 'create tournament', 'knockout', 'league', 'groups', 'टूर्नामेंट', 'नॉकआउट', 'लीग', 'ग्रुप'],
    en: { title: 'How to create a tournament', text: 'Open Tournaments and tap New tournament. Enter the name, dates and venue, add the teams and pick a format: Knockout, League (everyone plays everyone) or Groups + knockout (group tables, then a seeded bracket). Check the preview of fixtures and tap Create. You are the organiser.' },
    hi: { title: 'टूर्नामेंट कैसे बनाएँ', text: 'टूर्नामेंट खोलें और नया टूर्नामेंट दबाएँ। नाम, तारीख़ें और जगह डालें, टीमें जोड़ें और फ़ॉर्मेट चुनें: नॉकआउट, लीग (हर टीम हर टीम से) या ग्रुप + नॉकआउट (ग्रुप टेबल, फिर सीडेड ब्रैकेट)। मुकाबलों का प्रीव्यू देखें और बनाएँ दबाएँ। आप आयोजक हैं।' } },
  { id: 'guide-tournament-view', path: '/tournaments', tags: ['standings', 'table', 'bracket', 'fixtures', 'qualify', 'tiebreak', 'स्टैंडिंग', 'टेबल', 'ब्रैकेट', 'मुकाबले'],
    en: { title: 'Following a tournament', text: 'A tournament page has tabs: Table or Groups (standings), Bracket and Fixtures. Teams are ordered by points, then wins, set ratio, point ratio, then name. In Groups + knockout the top teams of each group (marked Q) fill the bracket. Swipe the bracket sideways for later rounds. Only the organiser can start fixtures or delete the tournament.' },
    hi: { title: 'टूर्नामेंट कैसे देखें', text: 'टूर्नामेंट पेज पर टैब हैं: टेबल या ग्रुप (स्टैंडिंग), ब्रैकेट और मुकाबले। टीमें अंक, फिर जीत, सेट अनुपात, पॉइंट अनुपात और फिर नाम से क्रम में होती हैं। ग्रुप + नॉकआउट में हर ग्रुप की टॉप टीमें (आगे) ब्रैकेट में जाती हैं। आगे के राउंड के लिए ब्रैकेट को बगल में स्वाइप करें। मुकाबले शुरू करना या टूर्नामेंट हटाना सिर्फ़ आयोजक कर सकता है।' } },
  { id: 'guide-rankings', path: '/rankings', tags: ['rankings', 'leaderboard', 'rank', 'points', 'रैंकिंग', 'लीडरबोर्ड'],
    en: { title: 'How rankings work', text: 'Rankings lists players by ranking points earned from finished matches. Open it from Home (Rankings or your rank card). Your own row is highlighted.' },
    hi: { title: 'रैंकिंग कैसे काम करती है', text: 'रैंकिंग में खिलाड़ी ख़त्म हुए मैचों से मिले रैंकिंग अंकों के क्रम में दिखते हैं। इसे होम से खोलें (रैंकिंग या आपका रैंक कार्ड)। आपकी अपनी पंक्ति हाइलाइट रहती है।' } },
  { id: 'guide-challenges', path: '/teams', tags: ['challenge', 'challenge a team', 'चैलेंज', 'मुकाबले की चुनौती'],
    en: { title: 'How to challenge another team', text: 'A captain can challenge another team from that team page (Challenge). Pick your team, a date and a court and send it. The other captain can accept or decline; you can see the status of challenges for your teams.' },
    hi: { title: 'दूसरी टीम को चैलेंज कैसे करें', text: 'कप्तान दूसरी टीम के पेज से चैलेंज कर सकता है। अपनी टीम, तारीख़ और कोर्ट चुनें और भेजें। दूसरी टीम का कप्तान स्वीकार या मना कर सकता है; आप अपनी टीमों के चैलेंज की स्थिति देख सकते हैं।' } },
  { id: 'guide-courts', path: '/map', tags: ['courts', 'map', 'nearby', 'add court', 'कोर्ट', 'नक्शा'],
    en: { title: 'Finding and adding courts', text: 'The Map tab shows courts and live matches near you. Tap a court for details. To add a missing court, open Courts and tap Add court, then place it on the map.' },
    hi: { title: 'कोर्ट ढूँढना और जोड़ना', text: 'मैप टैब पर आपके पास के कोर्ट और लाइव मैच दिखते हैं। विवरण के लिए कोर्ट पर टैप करें। कोई कोर्ट न हो तो कोर्ट खोलकर कोर्ट जोड़ें दबाएँ और उसे नक्शे पर रखें।' } },
  { id: 'guide-profile', path: '/edit-profile', tags: ['profile', 'edit profile', 'name', 'photo', 'privacy', 'phone', 'प्रोफ़ाइल', 'नाम', 'फ़ोटो'],
    en: { title: 'Editing your profile and privacy', text: 'Open Profile and tap your name card to edit your name, photo, position and other details. Your phone number is private: other players only see it if you allow it. Stats on your profile come from finished matches.' },
    hi: { title: 'प्रोफ़ाइल और प्राइवेसी बदलना', text: 'प्रोफ़ाइल खोलें और अपना नाम कार्ड दबाकर नाम, फ़ोटो, पोज़िशन और बाकी जानकारी बदलें। आपका फ़ोन नंबर निजी है: दूसरे खिलाड़ी उसे तभी देखते हैं जब आप अनुमति दें। प्रोफ़ाइल के आँकड़े ख़त्म हुए मैचों से आते हैं।' } },
  { id: 'guide-wallet', path: '/wallet', tags: ['wallet', 'coins', 'balance', 'वॉलेट', 'बैलेंस'],
    en: { title: 'Your wallet', text: 'Profile > Wallet shows your own balance and history. Only you can see your wallet; Ask VolleyLive does not read it.' },
    hi: { title: 'आपका वॉलेट', text: 'प्रोफ़ाइल > वॉलेट में आपका बैलेंस और इतिहास दिखता है। आपका वॉलेट सिर्फ़ आप देख सकते हैं; आस्क वॉलीलाइव उसे नहीं पढ़ता।' } },
  { id: 'guide-appearance', path: '/appearance', tags: ['appearance', 'day', 'night', 'dark mode', 'theme', 'language', 'hindi', 'डार्क', 'थीम', 'भाषा'],
    en: { title: 'Day / Night theme (dark mode) and language', text: 'Profile > Appearance lets you choose Day, Night or Auto (follows the time of day) and turn the theme animation on or off. The app language (English or Hindi) is in the same settings.' },
    hi: { title: 'डे / नाइट थीम और भाषा', text: 'प्रोफ़ाइल > दिखावट में डे, नाइट या ऑटो (दिन के समय के हिसाब से) चुनें और थीम एनिमेशन चालू या बंद करें। ऐप की भाषा (अंग्रेज़ी या हिंदी) भी यहीं है।' } },
  { id: 'guide-help', path: '/help', tags: ['help', 'contact', 'support', 'feedback', 'मदद', 'संपर्क'],
    en: { title: 'Getting help', text: 'Profile > Help Center has the FAQs, Ask VolleyLive and Contact us. Use Feedback to report a bug or suggest an idea.' },
    hi: { title: 'मदद कैसे पाएँ', text: 'प्रोफ़ाइल > हेल्प सेंटर में FAQ, आस्क वॉलीलाइव और संपर्क करें हैं। बग बताने या सुझाव देने के लिए फ़ीडबैक इस्तेमाल करें।' } },
  { id: 'guide-ask', path: '/ask', tags: ['ask', 'assistant', 'chatbot', 'bot', 'आस्क', 'सहायक'],
    en: { title: 'What Ask VolleyLive can do', text: 'Ask VolleyLive answers questions about the app and volleyball rules and can look up your stats, your teams, your matches, live scores, tournament standings and fixtures, challenges and the leaderboard. It only reads data you are allowed to see and never changes anything. Your chat history is kept for your account and you can clear it.' },
    hi: { title: 'आस्क वॉलीलाइव क्या कर सकता है', text: 'आस्क वॉलीलाइव ऐप और वॉलीबॉल नियमों के सवालों के जवाब देता है और आपके आँकड़े, आपकी टीमें, आपके मैच, लाइव स्कोर, टूर्नामेंट स्टैंडिंग और मुकाबले, चैलेंज और लीडरबोर्ड देख सकता है। यह सिर्फ़ वही पढ़ता है जो आप देख सकते हैं और कुछ नहीं बदलता। आपकी चैट हिस्ट्री आपके खाते में रहती है और आप उसे मिटा सकते हैं।' } },
  { id: 'guide-memories', path: '/memories', tags: ['memories', 'photos', 'यादें', 'फ़ोटो'],
    en: { title: 'Match memories', text: 'Memories collects photos from your matches. Open it from Home or Profile; tap a photo to see it full size.' },
    hi: { title: 'मैच की यादें', text: 'यादें में आपके मैचों की फ़ोटो रहती हैं। इसे होम या प्रोफ़ाइल से खोलें; फ़ोटो पर टैप करके बड़ा देखें।' } },
];
