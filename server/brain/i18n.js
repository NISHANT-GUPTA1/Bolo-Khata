// Spoken reply templates for the shopkeeper, and reminder fallbacks for customers in 10 languages.

export const rupees = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;

// Shopkeeper languages: STT language list and Timbre voice for each.
export const SHOP_LANGUAGES = {
  'hi-en': { label: 'Hinglish', stt: 'hi-IN,en-IN', model: 'timbre-v2.5', voice: 'Poorvi', ttsLang: 'hi-en' },
  'hi-IN': { label: 'हिन्दी', stt: 'hi-IN', model: 'timbre-v2.5', voice: 'Nalini', ttsLang: 'hi-IN' },
  'kn-IN': { label: 'ಕನ್ನಡ', stt: 'kn-IN,en-IN', model: 'timbre-v2.5', voice: 'Saanvi', ttsLang: 'kn-IN' },
  'ta-IN': { label: 'தமிழ் / Tanglish', stt: 'ta-IN,en-IN', model: 'timbre-v2.5', voice: 'Vedika', ttsLang: 'ta-IN' },
  'bn-IN': { label: 'বাংলা / Benglish', stt: 'bn-IN,en-IN', model: 'timbre-v2.5', voice: 'Kirra', ttsLang: 'bn-IN' },
  'en-IN': { label: 'English', stt: 'en-IN,hi-IN', model: 'timbre-v2.5', voice: 'Kaveri', ttsLang: 'en-IN' },
};

const R = {
  'hi-en': {
    credit: (n, a, b) => `${n} ke khaate mein ${rupees(a)} udhaar likh diya. Ab kul baaki ${rupees(b)} hai.`,
    payment: (n, a, b) => (b > 0 ? `${n} se ${rupees(a)} jama ho gaye. Ab baaki ${rupees(b)} hai.` : `${n} se ${rupees(a)} jama ho gaye. Hisaab poora saaf hai!`),
    balance: (n, b) => (b > 0 ? `${n} ka kul baaki ${rupees(b)} hai.` : `${n} ka koi baaki nahi hai.`),
    newCustomer: (n) => `Naya grahak ${n} joda gaya.`,
    summary: (s) => `Aaj ${s.count} entries hui. ${rupees(s.credit)} udhaar gaya aur ${rupees(s.paid)} jama hue. Dukaan ka kul baaki ${rupees(s.total)} hai.${s.top ? ` Sabse zyada baaki ${s.top.name} ka hai, ${rupees(s.top.balance)}.` : ''}`,
    dues: (list) => (list.length ? `Sabse zyada baaki: ${list.map((c) => `${c.name} ${rupees(c.balance)}`).join(', ')}.` : 'Kisi ka koi baaki nahi hai. Badhiya!'),
    remind: (n, lang) => `${n} ke liye ${lang} mein yaad dilaane wala voice message taiyaar hai.`,
    remindNone: (n) => `${n} ka koi baaki nahi hai, reminder ki zarurat nahi.`,
    undo: (n, a) => `Pichhli entry hata di: ${n}, ${rupees(a)}.`,
    undoNone: () => 'Hatane ke liye koi entry nahi mili.',
    unknownCustomer: (n) => `${n} naam ka koi grahak nahi mila.`,
    noAmount: () => 'Kitne rupaye? Raqam bhi boliye.',
    unknown: () => 'Maaf kijiye, samajh nahi aaya. Aise boliye: Ramesh ko do sau udhaar likh do.',
  },
  'hi-IN': {
    credit: (n, a, b) => `${n} के खाते में ${rupees(a)} उधार लिख दिया। अब कुल बाकी ${rupees(b)} है।`,
    payment: (n, a, b) => (b > 0 ? `${n} से ${rupees(a)} जमा हो गए। अब बाकी ${rupees(b)} है।` : `${n} से ${rupees(a)} जमा हो गए। हिसाब पूरा साफ़ है!`),
    balance: (n, b) => (b > 0 ? `${n} का कुल बाकी ${rupees(b)} है।` : `${n} का कोई बाकी नहीं है।`),
    newCustomer: (n) => `नया ग्राहक ${n} जोड़ा गया।`,
    summary: (s) => `आज ${s.count} एंट्री हुईं। ${rupees(s.credit)} उधार गया और ${rupees(s.paid)} जमा हुए। दुकान का कुल बाकी ${rupees(s.total)} है।${s.top ? ` सबसे ज़्यादा बाकी ${s.top.name} का है, ${rupees(s.top.balance)}।` : ''}`,
    dues: (list) => (list.length ? `सबसे ज़्यादा बाकी: ${list.map((c) => `${c.name} ${rupees(c.balance)}`).join(', ')}।` : 'किसी का कोई बाकी नहीं है।'),
    remind: (n, lang) => `${n} के लिए ${lang} में याद दिलाने वाला वॉइस मैसेज तैयार है।`,
    remindNone: (n) => `${n} का कोई बाकी नहीं है।`,
    undo: (n, a) => `पिछली एंट्री हटा दी: ${n}, ${rupees(a)}।`,
    undoNone: () => 'हटाने के लिए कोई एंट्री नहीं मिली।',
    unknownCustomer: (n) => `${n} नाम का कोई ग्राहक नहीं मिला।`,
    noAmount: () => 'कितने रुपये? रकम भी बोलिए।',
    unknown: () => 'माफ़ कीजिए, समझ नहीं आया। ऐसे बोलिए: रमेश को दो सौ उधार लिख दो।',
  },
  'kn-IN': {
    credit: (n, a, b) => `${n} ಅವರ ಖಾತೆಗೆ ${rupees(a)} ಸಾಲ ಬರೆದಿದ್ದೇನೆ. ಈಗ ಒಟ್ಟು ಬಾಕಿ ${rupees(b)}.`,
    payment: (n, a, b) => (b > 0 ? `${n} ಅವರಿಂದ ${rupees(a)} ಜಮಾ ಆಯಿತು. ಈಗ ಬಾಕಿ ${rupees(b)}.` : `${n} ಅವರಿಂದ ${rupees(a)} ಜಮಾ ಆಯಿತು. ಲೆಕ್ಕ ಪೂರ್ತಿ ಚುಕ್ತಾ!`),
    balance: (n, b) => (b > 0 ? `${n} ಅವರ ಒಟ್ಟು ಬಾಕಿ ${rupees(b)}.` : `${n} ಅವರದು ಯಾವುದೇ ಬಾಕಿ ಇಲ್ಲ.`),
    newCustomer: (n) => `ಹೊಸ ಗ್ರಾಹಕ ${n} ಅವರನ್ನು ಸೇರಿಸಲಾಗಿದೆ.`,
    summary: (s) => `ಇಂದು ${s.count} ಎಂಟ್ರಿಗಳು ಆಗಿವೆ. ${rupees(s.credit)} ಸಾಲ ಹೋಗಿದೆ, ${rupees(s.paid)} ಜಮಾ ಆಗಿದೆ. ಅಂಗಡಿಯ ಒಟ್ಟು ಬಾಕಿ ${rupees(s.total)}.${s.top ? ` ಅತಿ ಹೆಚ್ಚು ಬಾಕಿ ${s.top.name} ಅವರದು, ${rupees(s.top.balance)}.` : ''}`,
    dues: (list) => (list.length ? `ಅತಿ ಹೆಚ್ಚು ಬಾಕಿ: ${list.map((c) => `${c.name} ${rupees(c.balance)}`).join(', ')}.` : 'ಯಾರದೂ ಬಾಕಿ ಇಲ್ಲ.'),
    remind: (n, lang) => `${n} ಅವರಿಗೆ ${lang} ನೆನಪಿನ ವಾಯ್ಸ್ ಮೆಸೇಜ್ ಸಿದ್ಧವಾಗಿದೆ.`,
    remindNone: (n) => `${n} ಅವರದು ಯಾವುದೇ ಬಾಕಿ ಇಲ್ಲ.`,
    undo: (n, a) => `ಹಿಂದಿನ ಎಂಟ್ರಿ ತೆಗೆದುಹಾಕಿದೆ: ${n}, ${rupees(a)}.`,
    undoNone: () => 'ತೆಗೆಯಲು ಯಾವುದೇ ಎಂಟ್ರಿ ಇಲ್ಲ.',
    unknownCustomer: (n) => `${n} ಹೆಸರಿನ ಗ್ರಾಹಕರು ಸಿಗಲಿಲ್ಲ.`,
    noAmount: () => 'ಎಷ್ಟು ರೂಪಾಯಿ? ಮೊತ್ತವನ್ನೂ ಹೇಳಿ.',
    unknown: () => 'ಕ್ಷಮಿಸಿ, ಅರ್ಥವಾಗಲಿಲ್ಲ. ಹೀಗೆ ಹೇಳಿ: ರಮೇಶ್ ಗೆ ಇನ್ನೂರು ರೂಪಾಯಿ ಸಾಲ ಬರೆಯಿರಿ.',
  },
  'ta-IN': {
    credit: (n, a, b) => `${n} கணக்கில் ${rupees(a)} கடன் எழுதிவிட்டேன். இப்போது மொத்த பாக்கி ${rupees(b)}.`,
    payment: (n, a, b) => (b > 0 ? `${n} இடமிருந்து ${rupees(a)} வரவு வந்தது. இப்போது பாக்கி ${rupees(b)}.` : `${n} இடமிருந்து ${rupees(a)} வரவு வந்தது. கணக்கு முழுவதும் தீர்ந்தது!`),
    balance: (n, b) => (b > 0 ? `${n} மொத்த பாக்கி ${rupees(b)}.` : `${n} எந்த பாக்கியும் இல்லை.`),
    newCustomer: (n) => `புதிய வாடிக்கையாளர் ${n} சேர்க்கப்பட்டார்.`,
    summary: (s) => `இன்று ${s.count} பதிவுகள். ${rupees(s.credit)} கடன் போனது, ${rupees(s.paid)} வரவு வந்தது. கடையின் மொத்த பாக்கி ${rupees(s.total)}.${s.top ? ` அதிக பாக்கி ${s.top.name}, ${rupees(s.top.balance)}.` : ''}`,
    dues: (list) => (list.length ? `அதிக பாக்கி: ${list.map((c) => `${c.name} ${rupees(c.balance)}`).join(', ')}.` : 'யாருக்கும் பாக்கி இல்லை.'),
    remind: (n, lang) => `${n} க்கு ${lang} நினைவூட்டல் குரல் செய்தி தயார்.`,
    remindNone: (n) => `${n} எந்த பாக்கியும் இல்லை.`,
    undo: (n, a) => `முந்தைய பதிவு நீக்கப்பட்டது: ${n}, ${rupees(a)}.`,
    undoNone: () => 'நீக்க எந்த பதிவும் இல்லை.',
    unknownCustomer: (n) => `${n} என்ற வாடிக்கையாளர் இல்லை.`,
    noAmount: () => 'எவ்வளவு ரூபாய்? தொகையையும் சொல்லுங்கள்.',
    unknown: () => 'மன்னிக்கவும், புரியவில்லை. இப்படி சொல்லுங்கள்: ரமேஷ் கணக்கில் இருநூறு ரூபாய் கடன் எழுது.',
  },
  'bn-IN': {
    credit: (n, a, b) => `${n}-এর খাতায় ${rupees(a)} ধার লিখে দিলাম। এখন মোট বাকি ${rupees(b)}।`,
    payment: (n, a, b) => (b > 0 ? `${n} ${rupees(a)} জমা দিলেন। এখন বাকি ${rupees(b)}।` : `${n} ${rupees(a)} জমা দিলেন। হিসাব পুরো পরিষ্কার!`),
    balance: (n, b) => (b > 0 ? `${n}-এর মোট বাকি ${rupees(b)}।` : `${n}-এর কোনো বাকি নেই।`),
    newCustomer: (n) => `নতুন খদ্দের ${n} যোগ করা হলো।`,
    summary: (s) => `আজ ${s.count}টি এন্ট্রি হয়েছে। ${rupees(s.credit)} ধার গেছে, ${rupees(s.paid)} জমা হয়েছে। দোকানের মোট বাকি ${rupees(s.total)}।${s.top ? ` সবচেয়ে বেশি বাকি ${s.top.name}-এর, ${rupees(s.top.balance)}।` : ''}`,
    dues: (list) => (list.length ? `সবচেয়ে বেশি বাকি: ${list.map((c) => `${c.name} ${rupees(c.balance)}`).join(', ')}।` : 'কারও কোনো বাকি নেই।'),
    remind: (n, lang) => `${n}-এর জন্য ${lang} ভাষায় মনে করানোর ভয়েস মেসেজ তৈরি।`,
    remindNone: (n) => `${n}-এর কোনো বাকি নেই।`,
    undo: (n, a) => `আগের এন্ট্রি মুছে দিলাম: ${n}, ${rupees(a)}।`,
    undoNone: () => 'মোছার মতো কোনো এন্ট্রি নেই।',
    unknownCustomer: (n) => `${n} নামে কোনো খদ্দের পাওয়া যায়নি।`,
    noAmount: () => 'কত টাকা? টাকার অঙ্কটাও বলুন।',
    unknown: () => 'দুঃখিত, বুঝতে পারিনি। এভাবে বলুন: রমেশের খাতায় দুশো টাকা ধার লেখো।',
  },
  'en-IN': {
    credit: (n, a, b) => `Added ${rupees(a)} credit for ${n}. Total due is now ${rupees(b)}.`,
    payment: (n, a, b) => (b > 0 ? `Received ${rupees(a)} from ${n}. ${rupees(b)} still due.` : `Received ${rupees(a)} from ${n}. Account fully settled!`),
    balance: (n, b) => (b > 0 ? `${n} owes ${rupees(b)} in total.` : `${n} has nothing due.`),
    newCustomer: (n) => `New customer ${n} added.`,
    summary: (s) => `Today: ${s.count} entries. ${rupees(s.credit)} given on credit and ${rupees(s.paid)} received. Total shop dues are ${rupees(s.total)}.${s.top ? ` Highest due: ${s.top.name}, ${rupees(s.top.balance)}.` : ''}`,
    dues: (list) => (list.length ? `Highest dues: ${list.map((c) => `${c.name} ${rupees(c.balance)}`).join(', ')}.` : 'Nobody owes anything.'),
    remind: (n, lang) => `A ${lang} voice reminder for ${n} is ready.`,
    remindNone: (n) => `${n} has nothing due.`,
    undo: (n, a) => `Removed the last entry: ${n}, ${rupees(a)}.`,
    undoNone: () => 'No entry to remove.',
    unknownCustomer: (n) => `No customer named ${n}.`,
    noAmount: () => 'How much? Please say the amount too.',
    unknown: () => 'Sorry, I did not get that. Try: add 200 rupees credit for Ramesh.',
  },
};

export const replies = (lang) => R[lang] || R['hi-en'];

// Fallback customer reminders (Evon writes these when it is reachable).
const REMINDERS = {
  'hi-IN': 'नमस्ते {name} जी, {shop} से याद दिला रहे हैं कि आपके खाते में {amt} बाकी हैं। सुविधा अनुसार नकद या UPI से भुगतान कर दीजिए। धन्यवाद!',
  'hi-en': 'Namaste {name} ji, {shop} se yaad dila rahe hain ki aapke khaate mein {amt} baaki hain. Suvidha anusaar cash ya UPI se de dijiye. Dhanyavaad!',
  'en-IN': 'Hello {name}, a gentle reminder from {shop}: {amt} is pending in your account. Please pay by cash or UPI whenever convenient. Thank you!',
  'kn-IN': 'ನಮಸ್ಕಾರ {name} ಅವರೇ, {shop} ಇಂದ ನೆನಪಿಸುತ್ತಿದ್ದೇವೆ. ನಿಮ್ಮ ಖಾತೆಯಲ್ಲಿ {amt} ಬಾಕಿ ಇದೆ. ಅನುಕೂಲವಾದಾಗ ನಗದು ಅಥವಾ UPI ಮೂಲಕ ಪಾವತಿಸಿ. ಧನ್ಯವಾದಗಳು!',
  'ta-IN': 'வணக்கம் {name}, {shop} இலிருந்து ஒரு நினைவூட்டல். உங்கள் கணக்கில் {amt} பாக்கி உள்ளது. வசதியான போது ரொக்கம் அல்லது UPI மூலம் செலுத்துங்கள். நன்றி!',
  'te-IN': 'నమస్కారం {name} గారు, {shop} నుండి గుర్తు చేస్తున్నాము. మీ ఖాతాలో {amt} బాకీ ఉంది. వీలైనప్పుడు నగదు లేదా UPI ద్వారా చెల్లించండి. ధన్యవాదాలు!',
  'bn-IN': 'নমস্কার {name}, {shop} থেকে মনে করিয়ে দিচ্ছি। আপনার খাতায় {amt} বাকি আছে। সুবিধামতো নগদ বা UPI-তে দিয়ে দেবেন। ধন্যবাদ!',
  'mr-IN': 'नमस्कार {name}, {shop} कडून आठवण करून देत आहोत. तुमच्या खात्यात {amt} बाकी आहेत. सोयीनुसार रोख किंवा UPI ने भरणा करा. धन्यवाद!',
  'gu-IN': 'નમસ્તે {name}, {shop} તરફથી યાદ અપાવીએ છીએ. તમારા ખાતામાં {amt} બાકી છે. અનુકૂળતાએ રોકડ કે UPI થી ચૂકવી દેશો. આભાર!',
  'pa-IN': 'ਸਤ ਸ੍ਰੀ ਅਕਾਲ {name} ਜੀ, {shop} ਵੱਲੋਂ ਯਾਦ ਦਿਵਾ ਰਹੇ ਹਾਂ। ਤੁਹਾਡੇ ਖਾਤੇ ਵਿੱਚ {amt} ਬਾਕੀ ਹਨ। ਸਹੂਲਤ ਅਨੁਸਾਰ ਨਕਦ ਜਾਂ UPI ਰਾਹੀਂ ਭੁਗਤਾਨ ਕਰ ਦਿਓ। ਧੰਨਵਾਦ!',
  'ml-IN': 'നമസ്കാരം {name}, {shop} ൽ നിന്നുള്ള ഓർമ്മപ്പെടുത്തൽ. നിങ്ങളുടെ അക്കൗണ്ടിൽ {amt} ബാക്കിയുണ്ട്. സൗകര്യം പോലെ പണമായോ UPI വഴിയോ അടയ്ക്കുക. നന്ദി!',
};

export const reminderTemplate = (lang, { name, shop, amount }) =>
  (REMINDERS[lang] || REMINDERS['hi-IN']).replace('{name}', name).replace('{shop}', shop).replace('{amt}', rupees(amount));

export const CUSTOMER_LANGUAGES = {
  'hi-IN': 'हिन्दी', 'en-IN': 'English', 'kn-IN': 'ಕನ್ನಡ', 'ta-IN': 'தமிழ்', 'te-IN': 'తెలుగు',
  'bn-IN': 'বাংলা', 'mr-IN': 'मराठी', 'gu-IN': 'ગુજરાતી', 'pa-IN': 'ਪੰਜਾਬੀ', 'ml-IN': 'മലയാളം',
};
