import type { SafetyLanguage } from './types';

export const safetyCopy: Record<SafetyLanguage, {
  pageEyebrow: string;
  pageTitle: string;
  pageDescription: string;
  backToCase: string;
  languageLabel: string;
  autoLanguage: string;
  english: string;
  hindi: string;
  hinglish: string;
  contextEyebrow: string;
  contextTitle: string;
  contextDescription: string;
  contextCaveat: string;
  uncertaintyLabel: string;
  noSignal: string;
  possibleTopics: string;
  dangerEyebrow: string;
  dangerTitle: string;
  dangerDescription: string;
  dangerChoicesLabel: string;
  yes: string;
  no: string;
  notSure: string;
  choiceUpdating: string;
  choiceSelected: string;
  choiceSentNotice: string;
  pathwayEyebrow: string;
  pathwayTitle: string;
  pathwayDescription: string;
  noPathway: string;
  evidenceEyebrow: string;
  evidenceTitle: string;
  evidenceDescription: string;
  evidenceCaveat: string;
  evidenceNone: string;
  categoriesEyebrow: string;
  categoriesTitle: string;
  categoriesDescription: string;
  noCategories: string;
  verifiedResources: string;
  noResources: string;
  resourcesUpdating: string;
  nextEyebrow: string;
  nextTitle: string;
  nextDescription: string;
  noNextStep: string;
  safetyFirst: string;
  legalMayContinue: string;
  notContacted: string;
  retry: string;
  loadError: string;
  caseError: string;
  categoryNames: Record<string, string>;
  urgencyLabel: string;
  yesPriority: string;
}> = {
  en: {
    pageEyebrow: 'LawSense · Safety support',
    pageTitle: 'Your safety comes first',
    pageDescription: 'A calm place to check what feels safe right now, at your pace.',
    backToCase: 'Return to case',
    languageLabel: 'Language',
    autoLanguage: 'Auto detect',
    english: 'English',
    hindi: 'हिन्दी',
    hinglish: 'Hinglish',
    contextEyebrow: 'A gentle explanation',
    contextTitle: 'Why this support is being shown',
    contextDescription: 'Some details shared in this case may have raised a safety signal. This limited screening can be incomplete or mistaken.',
    contextCaveat: 'It is not a diagnosis, a legal finding, or a conclusion about anyone’s actions. You can skip anything or stop here.',
    uncertaintyLabel: 'Screening uncertainty',
    noSignal: 'This screening did not return a matching safety signal. That cannot confirm that there is no risk; you can still choose NOT SURE or continue only if you want.',
    possibleTopics: 'Possible themes from the screening',
    dangerEyebrow: 'Pause the usual workflow',
    dangerTitle: 'Are you in immediate danger right now?',
    dangerDescription: 'Choose the answer that feels closest. NOT SURE is a valid answer, and you can change your choice.',
    dangerChoicesLabel: 'Immediate danger choices',
    yes: 'YES',
    no: 'NO',
    notSure: 'NOT SURE',
    choiceUpdating: 'Your choice is selected. The safety guidance is updating.',
    choiceSelected: 'You can change your answer at any time.',
    choiceSentNotice: 'Your selected answer is sent to the Safety Support service to tailor these suggestions. This page does not contact authorities or anyone else.',
    pathwayEyebrow: 'Your options',
    pathwayTitle: 'Possible support options',
    pathwayDescription: 'These options come from the Safety Support service. You decide whether any of them fit.',
    noPathway: 'No additional support options were returned for this screening.',
    evidenceEyebrow: 'Only if safe and useful',
    evidenceTitle: 'Preserving information',
    evidenceDescription: 'The suggestions below come from the Safety Support service. You do not need to collect evidence before seeking support.',
    evidenceCaveat: 'Do not put yourself at risk to save or collect anything. You never need to share or upload intimate images to seek support. This page does not upload or store files.',
    evidenceNone: 'No evidence-preservation guidance was returned for this screening.',
    categoriesEyebrow: 'Support directory',
    categoriesTitle: 'Relevant support categories',
    categoriesDescription: 'Categories are suggested by the service. Listings appear only when the backend returns an official resource.',
    noCategories: 'No support categories were returned for this screening.',
    verifiedResources: 'Official resource listings',
    noResources: 'No verified resource listing was returned for this case. No phone numbers or organizations have been added here.',
    resourcesUpdating: 'Checking for official listings…',
    nextEyebrow: 'One step at a time',
    nextTitle: 'A possible next safe action',
    nextDescription: 'This suggestion comes from the Safety Support service. It is your choice whether to use it.',
    noNextStep: 'No next action was returned. You can pause here or choose what feels right for you.',
    safetyFirst: 'Safety first · ordinary legal steps are paused in this view',
    legalMayContinue: 'You may return to the legal workflow if and when you choose.',
    notContacted: 'No one has been contacted by this page.',
    retry: 'Try again',
    loadError: 'Safety support could not be loaded right now. Your choice has not contacted anyone.',
    caseError: 'This case could not be loaded. Try returning to the case and opening safety support again.',
    categoryNames: {
      emergency: 'Emergency support',
      crisis_support: 'Crisis support',
      domestic_violence: 'Domestic violence support',
      sexual_violence: 'Sexual violence support',
      stalking_harassment: 'Stalking and harassment support',
      workplace_safeguarding: 'Workplace safeguarding',
      child_protection: 'Child protection',
      elder_protection: 'Elder protection',
      exploitation_trafficking: 'Exploitation and trafficking support',
      cyber_safety: 'Cyber safety',
      legal_aid: 'Legal aid',
    },
    urgencyLabel: 'Safety support priority',
    yesPriority: 'If you feel in immediate danger, focus on getting to a safer place if you can. If you want emergency help, use your local emergency service or choose a verified listing below. LawSense will not contact anyone.',
  },
  hi: {
    pageEyebrow: 'LawSense · सुरक्षा सहायता',
    pageTitle: 'आपकी सुरक्षा सबसे पहले',
    pageDescription: 'अभी क्या सुरक्षित लगता है, यह अपनी गति से देखने के लिए एक शांत जगह।',
    backToCase: 'केस पर लौटें',
    languageLabel: 'भाषा',
    autoLanguage: 'अपने आप चुनें',
    english: 'English',
    hindi: 'हिन्दी',
    hinglish: 'Hinglish',
    contextEyebrow: 'एक सरल जानकारी',
    contextTitle: 'यह सहायता क्यों दिखाई जा रही है',
    contextDescription: 'इस केस में साझा की गई कुछ बातों से सुरक्षा का संकेत मिला हो सकता है। यह सीमित जाँच अधूरी या गलत हो सकती है।',
    contextCaveat: 'यह कोई निदान, कानूनी निष्कर्ष या किसी के व्यवहार के बारे में फैसला नहीं है। आप कोई भी बात छोड़ सकते हैं या यहीं रुक सकते हैं।',
    uncertaintyLabel: 'जाँच की अनिश्चितता',
    noSignal: 'इस जाँच में कोई मेल खाता सुरक्षा संकेत नहीं मिला। इससे यह पक्का नहीं होता कि कोई जोखिम नहीं है; आप चाहें तो NOT SURE चुन सकते हैं या आगे बढ़ सकते हैं।',
    possibleTopics: 'जाँच में दिखे संभावित विषय',
    dangerEyebrow: 'सामान्य प्रक्रिया रोकें',
    dangerTitle: 'क्या आप अभी तत्काल खतरे में हैं?',
    dangerDescription: 'जो जवाब सबसे सही लगे, चुनें। NOT SURE भी मान्य जवाब है और आप अपना चुनाव बदल सकते हैं।',
    dangerChoicesLabel: 'तत्काल खतरे का जवाब',
    yes: 'YES · हाँ',
    no: 'NO · नहीं',
    notSure: 'NOT SURE · पता नहीं',
    choiceUpdating: 'आपका जवाब चुना गया है। सुरक्षा संबंधी सुझाव अपडेट हो रहे हैं।',
    choiceSelected: 'आप अपना जवाब कभी भी बदल सकते हैं।',
    choiceSentNotice: 'आपका चुना हुआ जवाब सुझावों को आपके अनुसार बनाने के लिए Safety Support सेवा को भेजा जाता है। यह पेज अधिकारियों या किसी और से संपर्क नहीं करता।',
    pathwayEyebrow: 'आपके विकल्प',
    pathwayTitle: 'सहायता के संभावित विकल्प',
    pathwayDescription: 'ये विकल्प Safety Support सेवा से आए हैं। इनमें से कोई आपके लिए सही है या नहीं, यह आप तय करें।',
    noPathway: 'इस जाँच के लिए कोई अतिरिक्त सहायता विकल्प नहीं मिला।',
    evidenceEyebrow: 'केवल सुरक्षित और उपयोगी लगे तो',
    evidenceTitle: 'जानकारी सुरक्षित रखना',
    evidenceDescription: 'नीचे के सुझाव Safety Support सेवा से आए हैं। सहायता पाने से पहले सबूत इकट्ठा करना ज़रूरी नहीं है।',
    evidenceCaveat: 'कुछ भी सुरक्षित रखने या जुटाने के लिए खुद को जोखिम में न डालें। सहायता पाने के लिए अंतरंग तस्वीरें साझा या अपलोड करना कभी ज़रूरी नहीं है। यह पेज फ़ाइलें अपलोड या सहेजता नहीं है।',
    evidenceNone: 'इस जाँच के लिए जानकारी सुरक्षित रखने का कोई सुझाव नहीं मिला।',
    categoriesEyebrow: 'सहायता सूची',
    categoriesTitle: 'संबंधित सहायता श्रेणियाँ',
    categoriesDescription: 'श्रेणियाँ सेवा सुझाती है। सूची तभी दिखेगी जब backend कोई आधिकारिक संसाधन लौटाएगा।',
    noCategories: 'इस जाँच के लिए कोई सहायता श्रेणी नहीं मिली।',
    verifiedResources: 'आधिकारिक संसाधन',
    noResources: 'इस केस के लिए कोई सत्यापित संसाधन नहीं मिला। यहाँ कोई फ़ोन नंबर या संस्था नहीं जोड़ी गई है।',
    resourcesUpdating: 'आधिकारिक सूची देखी जा रही है…',
    nextEyebrow: 'एक बार में एक कदम',
    nextTitle: 'एक संभावित सुरक्षित अगला कदम',
    nextDescription: 'यह सुझाव Safety Support सेवा से आया है। इसे अपनाना या नहीं, यह आपका चुनाव है।',
    noNextStep: 'कोई अगला कदम नहीं मिला। आप यहीं रुक सकते हैं या अपनी सुविधा के अनुसार चुन सकते हैं।',
    safetyFirst: 'सुरक्षा पहले · इस दृश्य में सामान्य कानूनी कदम रोक दिए गए हैं',
    legalMayContinue: 'आप जब चाहें कानूनी प्रक्रिया पर लौट सकते हैं।',
    notContacted: 'इस पेज ने किसी से संपर्क नहीं किया है।',
    retry: 'फिर कोशिश करें',
    loadError: 'अभी सुरक्षा सहायता लोड नहीं हो सकी। आपके जवाब से किसी से संपर्क नहीं हुआ है।',
    caseError: 'यह केस लोड नहीं हो सका। केस पर लौटकर सुरक्षा सहायता फिर खोलें।',
    categoryNames: {
      emergency: 'आपातकालीन सहायता',
      crisis_support: 'संकट सहायता',
      domestic_violence: 'घरेलू हिंसा सहायता',
      sexual_violence: 'यौन हिंसा सहायता',
      stalking_harassment: 'पीछा करने और उत्पीड़न की सहायता',
      workplace_safeguarding: 'कार्यस्थल सुरक्षा सहायता',
      child_protection: 'बाल सुरक्षा',
      elder_protection: 'बुज़ुर्ग सुरक्षा',
      exploitation_trafficking: 'शोषण और तस्करी सहायता',
      cyber_safety: 'ऑनलाइन सुरक्षा',
      legal_aid: 'कानूनी सहायता',
    },
    urgencyLabel: 'सुरक्षा सहायता प्राथमिकता',
    yesPriority: 'अगर आपको अभी तत्काल खतरा लग रहा है, तो संभव हो तो पहले किसी सुरक्षित जगह जाएँ। आपातकालीन सहायता चाहिए तो अपनी स्थानीय सेवा का उपयोग करें या नीचे दी गई सत्यापित सूची चुनें। LawSense किसी से संपर्क नहीं करेगा।',
  },
  hinglish: {
    pageEyebrow: 'LawSense · Safety support',
    pageTitle: 'Aapki safety sabse pehle',
    pageDescription: 'Abhi kya safe lagta hai, use apni pace par dekhne ke liye ek calm jagah.',
    backToCase: 'Case par wapas jaayein',
    languageLabel: 'Language',
    autoLanguage: 'Auto detect',
    english: 'English',
    hindi: 'हिन्दी',
    hinglish: 'Hinglish',
    contextEyebrow: 'Ek simple explanation',
    contextTitle: 'Yeh support kyun dikh raha hai',
    contextDescription: 'Is case mein share ki gayi kuch baaton se safety signal mila ho sakta hai. Yeh limited screening adhuri ya galat ho sakti hai.',
    contextCaveat: 'Yeh diagnosis, legal finding, ya kisi ke actions par conclusion nahi hai. Aap kuch bhi skip kar sakte hain ya yahin ruk sakte hain.',
    uncertaintyLabel: 'Screening ki uncertainty',
    noSignal: 'Is screening mein matching safety signal nahi mila. Isse yeh confirm nahi hota ki koi risk nahi hai; aap chahein to NOT SURE choose kar sakte hain ya aage badh sakte hain.',
    possibleTopics: 'Screening mein dikhe possible themes',
    dangerEyebrow: 'Usual workflow pause karein',
    dangerTitle: 'Kya aap abhi immediate danger mein hain?',
    dangerDescription: 'Jo answer closest lage use choose karein. NOT SURE valid answer hai, aur aap apna choice badal sakte hain.',
    dangerChoicesLabel: 'Immediate danger choices',
    yes: 'YES',
    no: 'NO',
    notSure: 'NOT SURE',
    choiceUpdating: 'Aapka answer select ho gaya hai. Safety guidance update ho rahi hai.',
    choiceSelected: 'Aap apna answer kabhi bhi change kar sakte hain.',
    choiceSentNotice: 'Aapka selected answer suggestions ko tailor karne ke liye Safety Support service ko bheja jaata hai. Yeh page authorities ya kisi aur ko contact nahi karta.',
    pathwayEyebrow: 'Aapke options',
    pathwayTitle: 'Possible support options',
    pathwayDescription: 'Yeh options Safety Support service se aaye hain. Koi option fit hota hai ya nahi, aap decide karein.',
    noPathway: 'Is screening ke liye koi extra support option return nahi hua.',
    evidenceEyebrow: 'Sirf safe aur useful lage to',
    evidenceTitle: 'Information sambhal kar rakhna',
    evidenceDescription: 'Neeche ke suggestions Safety Support service se aaye hain. Support maangne se pehle evidence collect karna zaroori nahi hai.',
    evidenceCaveat: 'Kuch save ya collect karne ke liye khud ko risk mein na daalein. Support ke liye intimate images share ya upload karna zaroori nahi hai. Yeh page files upload ya store nahi karta.',
    evidenceNone: 'Is screening ke liye information preserve karne ka koi guidance return nahi hua.',
    categoriesEyebrow: 'Support directory',
    categoriesTitle: 'Relevant support categories',
    categoriesDescription: 'Categories service suggest karti hai. Listings sirf tab dikhengi jab backend official resource return karega.',
    noCategories: 'Is screening ke liye koi support category return nahi hui.',
    verifiedResources: 'Official resource listings',
    noResources: 'Is case ke liye koi verified resource listing return nahi hui. Yahan koi phone number ya organization add nahi ki gayi.',
    resourcesUpdating: 'Official listings check ho rahi hain…',
    nextEyebrow: 'Ek waqt mein ek step',
    nextTitle: 'Ek possible safe next action',
    nextDescription: 'Yeh suggestion Safety Support service se aaya hai. Use karna hai ya nahi, yeh aapka choice hai.',
    noNextStep: 'Koi next action return nahi hua. Aap yahin pause kar sakte hain ya apni suvidha se choose karein.',
    safetyFirst: 'Safety first · is view mein usual legal steps pause hain',
    legalMayContinue: 'Aap jab chahein legal workflow par wapas ja sakte hain.',
    notContacted: 'Is page ne kisi ko contact nahi kiya hai.',
    retry: 'Dobara try karein',
    loadError: 'Safety support abhi load nahi ho saka. Aapke choice se kisi ko contact nahi kiya gaya.',
    caseError: 'Yeh case load nahi ho saka. Case par wapas jaakar safety support phir open karein.',
    categoryNames: {
      emergency: 'Emergency support',
      crisis_support: 'Crisis support',
      domestic_violence: 'Domestic violence support',
      sexual_violence: 'Sexual violence support',
      stalking_harassment: 'Stalking and harassment support',
      workplace_safeguarding: 'Workplace safeguarding',
      child_protection: 'Child protection',
      elder_protection: 'Elder protection',
      exploitation_trafficking: 'Exploitation and trafficking support',
      cyber_safety: 'Cyber safety',
      legal_aid: 'Legal aid',
    },
    urgencyLabel: 'Safety support priority',
    yesPriority: 'Agar aapko abhi immediate danger lag raha hai, to mumkin ho to pehle safer jagah jaayein. Emergency help ke liye apni local service use karein ya neeche verified listing choose karein. LawSense kisi ko contact nahi karega.',
  },
};

export const safetyActionCopy: Record<SafetyLanguage, {
  guideStateLabel: string;
  whyLabel: string;
  whyYes: string;
  whyNo: string;
  whyNotSure: string;
  whyUnanswered: string;
  professionalHelp: string;
  professionalHelpDetail: string;
  evidenceAction: string;
  legalWorkflowAction: string;
  pauseAction: string;
  resumeAction: string;
  pausedMessage: string;
  callResource: string;
  callDisclosure: string;
  openWebsite: string;
}> = {
  en: {
    guideStateLabel: 'Guide state',
    whyLabel: 'Why this step is shown',
    whyYes: 'Safety Support returned this step first for the screening with your YES answer. The screening may be incomplete or mistaken; choose only what feels safe.',
    whyNo: 'Safety Support returned this step first for the screening with your NO answer. The screening may be incomplete or mistaken; choose only what feels safe.',
    whyNotSure: 'Your NOT SURE answer is supported. Safety Support returned this step first for the screening; it may be incomplete or mistaken.',
    whyUnanswered: 'Safety Support returned this as the first step for the screening. Detection is limited and is not a diagnosis; choose only what feels safe.',
    professionalHelp: 'Find verified professional support',
    professionalHelpDetail: 'Review official listings returned for this screening. You choose whether to open a website or call.',
    evidenceAction: 'Review evidence guidance',
    legalWorkflowAction: 'Return to the legal workflow',
    pauseAction: "I can't do this right now",
    resumeAction: 'Show my options again',
    pausedMessage: 'This pause stays on your device. No one was contacted. You can return to these options whenever you are ready.',
    callResource: 'Call',
    callDisclosure: "Tapping Call opens your device's phone app. LawSense does not place the call.",
    openWebsite: 'Open official website',
  },
  hi: {
    guideStateLabel: 'Guide की स्थिति',
    whyLabel: 'यह कदम क्यों दिखाया गया है',
    whyYes: 'Safety Support ने YES जवाब और इस screening के लिए यह कदम पहले दिखाया है। Screening अधूरी या गलत हो सकती है; केवल वही चुनें जो सुरक्षित लगे।',
    whyNo: 'Safety Support ने NO जवाब और इस screening के लिए यह कदम पहले दिखाया है। Screening अधूरी या गलत हो सकती है; केवल वही चुनें जो सुरक्षित लगे।',
    whyNotSure: 'NOT SURE भी मान्य जवाब है। Safety Support ने इस screening के लिए यह कदम पहले दिखाया है; screening अधूरी या गलत हो सकती है।',
    whyUnanswered: 'Safety Support ने इस screening के लिए यह पहला कदम लौटाया है। पहचान सीमित है और यह निदान नहीं है; केवल वही चुनें जो सुरक्षित लगे।',
    professionalHelp: 'सत्यापित पेशेवर सहायता देखें',
    professionalHelpDetail: 'इस screening के लिए लौटाई गई आधिकारिक सूची देखें। वेबसाइट खोलना या कॉल करना आपका चुनाव है।',
    evidenceAction: 'सबूत संबंधी सुझाव देखें',
    legalWorkflowAction: 'कानूनी प्रक्रिया पर लौटें',
    pauseAction: 'मैं अभी यह नहीं कर सकता/सकती',
    resumeAction: 'मेरे विकल्प फिर दिखाएँ',
    pausedMessage: 'यह विराम आपके डिवाइस पर ही है। किसी से संपर्क नहीं हुआ। तैयार होने पर आप विकल्पों पर लौट सकते हैं।',
    callResource: 'कॉल करें',
    callDisclosure: 'कॉल चुनने पर आपके डिवाइस का फ़ोन ऐप खुलेगा। LawSense कॉल नहीं करता।',
    openWebsite: 'आधिकारिक वेबसाइट खोलें',
  },
  hinglish: {
    guideStateLabel: 'Guide state',
    whyLabel: 'Yeh step kyun dikh raha hai',
    whyYes: 'Safety Support ne aapke YES answer aur is screening ke liye yeh step pehle return kiya. Screening adhuri ya galat ho sakti hai; sirf wahi choose karein jo safe lage.',
    whyNo: 'Safety Support ne aapke NO answer aur is screening ke liye yeh step pehle return kiya. Screening adhuri ya galat ho sakti hai; sirf wahi choose karein jo safe lage.',
    whyNotSure: 'NOT SURE bhi valid answer hai. Safety Support ne is screening ke liye yeh step pehle return kiya; screening adhuri ya galat ho sakti hai.',
    whyUnanswered: 'Safety Support ne is screening ke liye ise first step return kiya. Detection limited hai aur diagnosis nahi; sirf wahi choose karein jo safe lage.',
    professionalHelp: 'Verified professional support dekhein',
    professionalHelpDetail: 'Is screening ke liye return hui official listings dekhein. Website kholna ya call karna aapka choice hai.',
    evidenceAction: 'Evidence guidance dekhein',
    legalWorkflowAction: 'Legal workflow par wapas jaayein',
    pauseAction: 'Main abhi yeh nahi kar sakta/sakti',
    resumeAction: 'Mere options phir dikhayein',
    pausedMessage: 'Yeh pause sirf aapke device par hai. Kisi ko contact nahi kiya gaya. Ready hone par aap options par wapas aa sakte hain.',
    callResource: 'Call karein',
    callDisclosure: 'Call tap karne par aapke device ka phone app khulega. LawSense call nahi karta.',
    openWebsite: 'Official website kholein',
  },
};

export function safetyCategoryLabel(category: string, language: SafetyLanguage): string {
  return safetyCopy[language].categoryNames[category] ?? category.replace(/_/g, ' ');
}
