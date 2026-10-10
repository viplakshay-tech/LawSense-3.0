"""Localized, side-effect-free safety support built above the safety detector."""

from __future__ import annotations

import re
from collections.abc import Iterable, Sequence

from app.engines.safety import SafetyCategory as DetectorContext
from app.engines.safety import detect_safety_context
from app.engines.safety.models import SafetyIndicator
from app.schemas.case_state import CaseState

from .models import (
    AssessmentContext,
    ImmediateDangerAnswer,
    OfficialResource,
    ResourceCategory,
    ResourceAvailability,
    ResourceAvailabilityStatus,
    ResourceEligibility,
    ResourceVerificationStatus,
    SafetyLanguage,
    SafetySituation,
    SafetySupportAssessment,
    SafetySupportTrack,
    SafetyUrgency,
    TriggerEvidence,
    WorkflowDisposition,
)
from .resources import IndiaOfficialResourceRegistry, OfficialResourceRegistry
from .women_safety import build_women_safety_context


_SENTENCE_SPLIT = re.compile(r"(?<=[.!?।؟])\s+|[\r\n]+")
_DEVANAGARI = re.compile(r"[\u0900-\u097f]")
_HINGLISH_HINTS = re.compile(
    r"\b(?:hai|hain|mujhe|nahi|nahin|woh|wo|mera|meri|usne|paise|dhamki|"
    r"maarne|kar raha|kar rahi|karne|peetta|pati|patni|gharwal[eo]n?)\b",
    re.I,
)
_WORKPLACE = re.compile(
    r"\b(?:workplace|work|office|job|manager|supervisor|boss|coworker|colleague|hr)\b"
    r"|कार्यस्थल|दफ्तर|ऑफिस|काम की जगह|मैनेजर|बॉस|सहकर्मी"
    r"|\b(?:kaam ki jagah|daftar|office|manager|boss|sahakarmi)\b",
    re.I,
)
_WORKPLACE_HARASSMENT_CUE = re.compile(
    r"\b(?:repeatedly|again and again|every day|unwanted|inappropriate|sexual|"
    r"harass(?:ment|ed|es|ing)?|bully|threaten(?:ed|ing)?|unwelcome)\b"
    r".{0,65}\b(?:message|text|comment|touch|advance|request|conduct|harass|bully|threat)\w*\b|"
    r"\b(?:message|text|comment|touch|advance|request|conduct)\w*\b.{0,65}"
    r"\b(?:unwanted|inappropriate|sexual|harass(?:ment|ed|es|ing)?|bully|unwelcome)\b"
    r"|बार बार.{0,45}(?:परेशान|मैसेज|संदेश|टिप्पणी|छूना|यौन|धमकी)|"
    r"(?:अनचाहे|यौन|अश्लील).{0,45}(?:मैसेज|संदेश|टिप्पणी|व्यवहार|स्पर्श|उत्पीड़न)|"
    r"\b(?:baar baar|unwanted|sexual|harass|pareshan).{0,55}(?:message|messages|comment|touch|threat)\w*\b",
    re.I,
)
_CHILD = re.compile(
    r"\b(?:child|children|minor|kid|son|daughter)\b|बच्चा|बच्ची|बच्चे|नाबालिग"
    r"|\b(?:bachcha|bachchi|bachche|nabalig)\b",
    re.I,
)
_CHILD_CONCERN = re.compile(
    r"\b(?:abuse|abused|neglect|neglected|exploitation|exploited|unsafe|hurt|harmed|"
    r"forced|concern|suspect(?:ed)?|afraid|threaten(?:ed|ing)?)\b"
    r"|शोषण|दुर्व्यवहार|मारता|मारती|चोट|असुरक्षित|डर|जबरदस्ती|संदेह|आशंका|उपेक्षा"
    r"|\b(?:shoshan|maar(?:ta|ti)|chot|darr|zabardasti|sandeh|upeक्षा)\b",
    re.I,
)
_ELDER = re.compile(
    r"\b(?:elderly|older adult|old age|senior citizen|elder|grandmother|grandfather|"
    r"grandparent)\b|बुज़ुर्ग|बुजुर्ग|वृद्ध|वरिष्ठ नागरिक|दादा|दादी|नाना|नानी"
    r"|\b(?:buzurg|vriddh|senior citizen|dada|dadi|nana|nani)\b",
    re.I,
)
_ELDER_CONCERN = re.compile(
    r"\b(?:abuse|abused|neglect|neglected|hit|beats?|takes? (?:their|his|her) money|"
    r"steals? (?:their|his|her) (?:pension|money)|den(?:y|ies|ied) (?:medicine|medication)|"
    r"withholds? (?:food|medicine|medication)|locked in|exploitation|threaten(?:ed|ing)?)\b"
    r"|दुर्व्यवहार|मारता|मारती|पेंशन छीन|पैसे छीन|दवा नहीं देता|दवा नहीं देती|"
    r"खाना नहीं देता|बंद करके|शोषण|धमकी"
    r"|\b(?:pension chheen|paise chheen|dawa nahi deta|dawa nahi deti|khana nahi deta)\b",
    re.I,
)
_ONLINE = re.compile(
    r"\b(?:online|internet|social media|whatsapp|instagram|facebook|snapchat|telegram|"
    r"text|texts|message|messages|dm|email|account|cyber|website|phone|calls?)\b"
    r"|ऑनलाइन|इंटरनेट|सोशल मीडिया|व्हाट्सऐप|इंस्टाग्राम|मैसेज|संदेश|फोन|कॉल"
    r"|\b(?:online|internet|social media|whatsapp|instagram|message|messages|phone|calls?)\b",
    re.I,
)
_SEXUAL = re.compile(
    r"\b(?:sexual|sexually|sex|rape|molest|intimate|non[- ]consensual)\b"
    r"|यौन|सेक्स|बलात्कार|छेड़छाड़|बिना सहमति|जबरदस्ती"
    r"|\b(?:yaun|sex|rape|molest|bina sahmati|zabardasti)\b",
    re.I,
)
_RELATIONSHIP_OR_CONTROL = re.compile(
    r"\b(?:partner|husband|wife|spouse|boyfriend|girlfriend|family|coercive control|"
    r"controls? (?:who|where|when|everything)|control(?:s|ling)? me)\b"
    r"|पति|पत्नी|साथी|परिवार|नियंत्रण|कंट्रोल|जबरदस्ती"
    r"|\b(?:pati|patni|saathi|parivar|control karta|control karti|zabardasti)\b",
    re.I,
)
_COERCIVE_CONTROL_CUE = re.compile(
    r"\b(?:coercive control|controls? who (?:i|we) (?:see|meet|talk to)|"
    r"controls? (?:where|when) i go|controls? every(?:thing| move)|"
    r"won.t let me (?:see|meet|talk to) my (?:family|friends)|isolat(?:e|ed|ing) me)\b"
    r"|मुझे (?:परिवार|दोस्तों) से (?:मिलने|बात करने) नहीं देता|"
    r"मुझे (?:परिवार|दोस्तों) से (?:मिलने|बात करने) नहीं देती|"
    r"(?:मेरी|मेरा) हर चीज़ पर नियंत्रण|मेरी हर बात नियंत्रित|"
    r"\b(?:control(?:s|ling)? who i (?:meet|see)|control karta hai|control karti hai|"
    r"doston se milne nahi deta|family se milne nahi deta)\b",
    re.I,
)

_INDICATOR_SITUATIONS: dict[str, tuple[SafetySituation, ...]] = {
    "domestic_violence": (SafetySituation.DOMESTIC_VIOLENCE,),
    "threat": (SafetySituation.THREATS,),
    "stalking": (SafetySituation.STALKING,),
    "sexual_violence": (SafetySituation.SEXUAL_HARASSMENT_VIOLENCE,),
    "blackmail": (SafetySituation.BLACKMAIL,),
    "intimate_image_abuse": (SafetySituation.INTIMATE_IMAGE_ABUSE,),
    "dowry_related_abuse": (SafetySituation.DOWRY_RELATED_ABUSE,),
    "forced_isolation": (SafetySituation.FORCED_ISOLATION,),
    "financial_control": (SafetySituation.FINANCIAL_CONTROL,),
    "exploitation": (SafetySituation.EXPLOITATION,),
    "immediate_danger": (SafetySituation.THREATS,),
}

_SITUATION_RESOURCES: dict[SafetySituation, tuple[ResourceCategory, ...]] = {
    SafetySituation.DOMESTIC_VIOLENCE: (
        ResourceCategory.DOMESTIC_VIOLENCE,
        ResourceCategory.WOMEN_CHILD_PROTECTION,
        ResourceCategory.LEGAL_AID,
    ),
    SafetySituation.THREATS: (
        ResourceCategory.EMERGENCY,
        ResourceCategory.POLICE_OFFICIAL,
        ResourceCategory.CRISIS_SUPPORT,
    ),
    SafetySituation.STALKING: (
        ResourceCategory.STALKING_HARASSMENT,
        ResourceCategory.POLICE_OFFICIAL,
    ),
    SafetySituation.SEXUAL_HARASSMENT_VIOLENCE: (
        ResourceCategory.SEXUAL_VIOLENCE,
        ResourceCategory.WOMEN_CHILD_PROTECTION,
        ResourceCategory.LEGAL_AID,
    ),
    SafetySituation.BLACKMAIL: (
        ResourceCategory.CYBERCRIME,
        ResourceCategory.CYBER_SAFETY,
        ResourceCategory.LEGAL_AID,
    ),
    SafetySituation.INTIMATE_IMAGE_ABUSE: (
        ResourceCategory.CYBERCRIME,
        ResourceCategory.CYBER_SAFETY,
        ResourceCategory.LEGAL_AID,
    ),
    SafetySituation.DOWRY_RELATED_ABUSE: (
        ResourceCategory.DOMESTIC_VIOLENCE,
        ResourceCategory.WOMEN_CHILD_PROTECTION,
        ResourceCategory.LEGAL_AID,
    ),
    SafetySituation.COERCIVE_CONTROL: (
        ResourceCategory.DOMESTIC_VIOLENCE,
        ResourceCategory.WOMEN_CHILD_PROTECTION,
        ResourceCategory.LEGAL_AID,
    ),
    SafetySituation.FORCED_ISOLATION: (
        ResourceCategory.DOMESTIC_VIOLENCE,
        ResourceCategory.WOMEN_CHILD_PROTECTION,
    ),
    SafetySituation.FINANCIAL_CONTROL: (
        ResourceCategory.DOMESTIC_VIOLENCE,
        ResourceCategory.WOMEN_CHILD_PROTECTION,
        ResourceCategory.LEGAL_AID,
    ),
    SafetySituation.WORKPLACE_HARASSMENT: (
        ResourceCategory.WORKPLACE_SAFEGUARDING,
        ResourceCategory.WORKPLACE_HARASSMENT,
        ResourceCategory.LEGAL_AID,
    ),
    SafetySituation.CHILD_SAFETY: (
        ResourceCategory.CHILD_PROTECTION,
        ResourceCategory.WOMEN_CHILD_PROTECTION,
    ),
    SafetySituation.ELDER_ABUSE: (ResourceCategory.ELDER_PROTECTION, ResourceCategory.LEGAL_AID),
    SafetySituation.EXPLOITATION: (ResourceCategory.EXPLOITATION_TRAFFICKING, ResourceCategory.LEGAL_AID),
    SafetySituation.CYBER_HARASSMENT: (
        ResourceCategory.CYBERCRIME,
        ResourceCategory.CYBER_SAFETY,
    ),
}


_TEXT: dict[SafetyLanguage, dict[str, object]] = {
    SafetyLanguage.ENGLISH: {
        "uncertainty": (
        "This is a limited screening signal; it is not a diagnosis and does not determine guilt.",
            "Indicators may be incomplete or wrong; no indicator does not confirm that a situation is safe.",
        ),
        "prompt": (
            "Are you in immediate danger right now? You can answer YES, NO, or NOT_SURE. "
            "If replying or using this device is unsafe, stop here. You choose whether to contact support; "
            "nothing will be contacted automatically."
        ),
        "sensitive_prompt": (
            "Share only what feels comfortable; you can skip details. If you have a safety concern, "
            "you may answer YES, NO, or NOT_SURE to whether you are in immediate danger."
        ),
        "preserve": (
            "Only if it is safe, keep original messages, emails, dates, and other records without editing them.",
            "Store anything you choose to keep somewhere the other person cannot access, if that is safe.",
            "You do not need to collect evidence before asking for support; do not put yourself at risk to do so.",
        ),
        "escalation_urgent": (
            "If you choose and it is safe, contact local emergency services using an official resource, if one is listed below.",
            "You may contact a trusted person or a specialist support service; you decide whether and when.",
        ),
        "escalation_other": (
            "You may choose a trusted person, advocate, or specialist service that fits your situation.",
            "For workplace, child, elder, or online concerns, a relevant safeguarding or support service may be an option.",
        ),
        "urgent_steps": (
            "Pause the ordinary legal workflow. Your immediate safety comes first.",
            "If it does not increase risk, move toward a safer place or a person you trust.",
            "If you choose and it is safe, use an official local emergency or crisis resource if one is listed here.",
            "Continue with legal questions only when you feel safe enough; you can stop or skip any step.",
        ),
        "uncertain_steps": (
            "Pause the ordinary legal workflow while you decide whether you may be in immediate danger.",
            "If this device or conversation may be monitored, stop if that feels safer.",
            "Choose a trusted person or an official local support resource if you want help checking options.",
            "Continue with legal questions only when you feel safe enough.",
        ),
        "context_steps": (
            "Check whether it is safe to continue this conversation or use this device.",
            "If you want, choose a trusted person or a relevant support service from the official resources, if any are listed here.",
            "Keep records only if it is safe; you can ask for support without collecting evidence first.",
            "Once you feel safe enough, continue with the legal questions you choose to discuss.",
        ),
        "ordinary_steps": (
            "No matching safety signal was identified by this screening layer.",
            "If you have a concern that was missed, you can describe it, choose NOT_SURE, or skip this step.",
            "Continue with the ordinary legal workflow if that is what you want.",
        ),
        "sensitive_steps": (
            "Share only what feels comfortable; you can skip or pause at any time.",
            "If you have a safety concern, choose whether you want to check support options.",
            "Continue with the ordinary legal workflow only if that is what you want.",
        ),
    },
    SafetyLanguage.HINDI: {
        "uncertainty": (
            "यह सीमित संकेत-आधारित जाँच है; यह निदान या किसी के दोषी होने का निष्कर्ष नहीं है।",
            "संकेत अधूरे या गलत हो सकते हैं; कोई संकेत न मिलना सुरक्षित होने की पुष्टि नहीं करता।",
        ),
        "prompt": (
            "क्या आप अभी तत्काल खतरे में हैं? आप YES, NO या NOT_SURE में जवाब दे सकते हैं। "
            "अगर जवाब देना या इस डिवाइस का उपयोग करना असुरक्षित लगे, तो यहीं रुक जाएँ। सहायता से संपर्क करना आपका निर्णय है; "
            "आपकी ओर से किसी से अपने-आप संपर्क नहीं किया जाएगा।"
        ),
        "sensitive_prompt": (
            "जितना सहज लगे उतना ही साझा करें; आप विवरण छोड़ सकते हैं। यदि सुरक्षा को लेकर चिंता हो, "
            "तो तत्काल खतरे के बारे में YES, NO या NOT_SURE कह सकते हैं।"
        ),
        "preserve": (
            "केवल सुरक्षित होने पर मूल संदेश, ईमेल, तारीखें और अन्य रिकॉर्ड बिना बदलाव के रखें।",
            "जो रिकॉर्ड रखना चाहें, उन्हें ऐसी जगह रखें जहाँ दूसरा व्यक्ति पहुँच न सके—यदि यह सुरक्षित हो।",
            "सहायता माँगने से पहले सबूत इकट्ठा करना ज़रूरी नहीं है; इसके लिए खुद को जोखिम में न डालें।",
        ),
        "escalation_urgent": (
            "यदि आप चाहें और सुरक्षित हो, तो नीचे कोई आधिकारिक संसाधन सूचीबद्ध हो तो उसके माध्यम से स्थानीय आपातकालीन सेवा से संपर्क करने पर विचार करें।",
            "आप किसी भरोसेमंद व्यक्ति या विशेषज्ञ सहायता सेवा से संपर्क करने का निर्णय ले सकते हैं।",
        ),
        "escalation_other": (
            "आप अपनी स्थिति के अनुसार किसी भरोसेमंद व्यक्ति, सहयोगी या विशेषज्ञ सेवा को चुन सकते हैं।",
            "कार्यस्थल, बच्चे, बुज़ुर्ग या ऑनलाइन चिंता के लिए संबंधित सुरक्षा या सहायता सेवा एक विकल्प हो सकती है।",
        ),
        "urgent_steps": (
            "सामान्य कानूनी प्रक्रिया रोकें; पहले आपकी तत्काल सुरक्षा है।",
            "यदि इससे जोखिम न बढ़े, तो किसी सुरक्षित जगह या भरोसेमंद व्यक्ति के पास जाएँ।",
            "यदि आप चाहें और सुरक्षित हो, तो यहाँ कोई आधिकारिक स्थानीय आपातकालीन या संकट संसाधन सूचीबद्ध हो तो उसे देखने पर विचार करें।",
            "कानूनी सवालों पर तभी आगे बढ़ें जब आप पर्याप्त सुरक्षित महसूस करें; किसी भी चरण को छोड़ सकते हैं।",
        ),
        "uncertain_steps": (
            "तत्काल खतरे की स्थिति तय करने तक सामान्य कानूनी प्रक्रिया रोकें।",
            "यदि इस डिवाइस या बातचीत पर नज़र रखी जा सकती है, तो सुरक्षित लगे तो रुक जाएँ।",
            "विकल्प समझने के लिए चाहें तो किसी भरोसेमंद व्यक्ति या आधिकारिक स्थानीय सहायता संसाधन को चुनें।",
            "कानूनी सवालों पर तभी आगे बढ़ें जब आप पर्याप्त सुरक्षित महसूस करें।",
        ),
        "context_steps": (
            "देखें कि क्या इस बातचीत को जारी रखना या इस डिवाइस का उपयोग करना सुरक्षित है।",
            "चाहें तो किसी भरोसेमंद व्यक्ति या यहाँ दिए गए आधिकारिक संसाधनों में से संबंधित सहायता सेवा चुनें।",
            "रिकॉर्ड केवल सुरक्षित होने पर रखें; सहायता माँगने से पहले सबूत इकट्ठा करना ज़रूरी नहीं है।",
            "पर्याप्त सुरक्षित महसूस होने पर उन्हीं कानूनी सवालों पर आगे बढ़ें जिन्हें आप साझा करना चाहें।",
        ),
        "ordinary_steps": (
            "इस जाँच में कोई मेल खाता सुरक्षा संकेत नहीं मिला।",
            "अगर कोई चिंता छूट गई हो, तो बता सकते हैं, NOT_SURE चुन सकते हैं या यह चरण छोड़ सकते हैं।",
            "यदि आप चाहें तो सामान्य कानूनी प्रक्रिया जारी रखें।",
        ),
        "sensitive_steps": (
            "जितना सहज लगे उतना ही साझा करें; आप कभी भी कोई बात छोड़ या रुक सकते हैं।",
            "यदि सुरक्षा को लेकर चिंता हो, तो सहायता के विकल्प देखने का निर्णय आप कर सकते हैं।",
            "सामान्य कानूनी प्रक्रिया तभी जारी रखें जब आप चाहें।",
        ),
    },
    SafetyLanguage.HINGLISH: {
        "uncertainty": (
            "Yeh limited screening signal hai; diagnosis ya kisi ko doshi kehne ka nateeja nahi.",
            "Signals adhure ya galat ho sakte hain; koi signal na milna safety confirm nahi karta.",
        ),
        "prompt": (
            "Kya aap abhi immediate danger mein hain? Aap YES, NO ya NOT_SURE keh sakte hain. "
            "Agar reply karna ya yeh device use karna unsafe lage, yahin ruk jaiye. Support se contact karna aapka decision hai; "
            "aapki taraf se kisi ko automatically contact nahi kiya jayega."
        ),
        "sensitive_prompt": (
            "Jitna comfortable ho utna hi share karein; details skip kar sakte hain. Agar safety concern ho, "
            "to immediate danger ke baare mein YES, NO ya NOT_SURE keh sakte hain."
        ),
        "preserve": (
            "Sirf safe ho to original messages, emails, dates aur doosre records bina badle sambhal kar rakhein.",
            "Jo records rakhna chahein, unhe aisi jagah rakhein jahan doosra person access na kar sake—agar yeh safe ho.",
            "Support maangne se pehle evidence jama karna zaroori nahi; iske liye khud ko risk mein na daalein.",
        ),
        "escalation_urgent": (
            "Agar aap chahein aur safe ho, neeche koi official resource listed ho to uske zariye local emergency services se contact karne par vichar karein.",
            "Aap kisi trusted person ya specialist support service ko kab contact karna hai, khud chun sakte hain.",
        ),
        "escalation_other": (
            "Aap apni situation ke hisaab se trusted person, advocate ya specialist service chun sakte hain.",
            "Workplace, child, elder ya online concern ke liye relevant safeguarding/support service ek option ho sakti hai.",
        ),
        "urgent_steps": (
            "Ordinary legal workflow pause karein; pehle aapki immediate safety hai.",
            "Agar isse risk na badhe, kisi safer jagah ya trusted person ke paas jaayein.",
            "Agar aap chahein aur safe ho, yahan koi official local emergency ya crisis resource listed ho to use dekh sakte hain.",
            "Legal questions par tabhi aage badhein jab aap safe feel karein; koi bhi step skip kar sakte hain.",
        ),
        "uncertain_steps": (
            "Jab tak aap decide karein ki immediate danger ho sakta hai, ordinary legal workflow pause karein.",
            "Agar device ya conversation monitor ho sakti hai, safe lage to yahin ruk jaiye.",
            "Options samajhne ke liye chahein to trusted person ya official local support resource chun sakte hain.",
            "Legal questions par tabhi aage badhein jab aap safe feel karein.",
        ),
        "context_steps": (
            "Check karein ki kya yeh conversation continue karna ya device use karna safe hai.",
            "Chahein to trusted person ya yahan listed official resources mein se relevant support service chun sakte hain.",
            "Records sirf safe ho to rakhein; support ke liye pehle evidence jama karna zaroori nahi.",
            "Safe feel hone par un legal questions par aage badhein jinhe aap discuss karna chahein.",
        ),
        "ordinary_steps": (
            "Is screening layer ko koi matching safety signal nahi mila.",
            "Agar koi concern miss hua ho, bata sakte hain, NOT_SURE keh sakte hain ya yeh step skip kar sakte hain.",
            "Agar aap chahen to ordinary legal workflow continue karein.",
        ),
        "sensitive_steps": (
            "Jitna comfortable ho utna share karein; kabhi bhi skip ya pause kar sakte hain.",
            "Agar safety concern ho, support options dekhna hai ya nahi yeh aap chun sakte hain.",
            "Ordinary legal workflow tabhi continue karein jab aap chahein.",
        ),
    },
}


def _split_sentences(text: str) -> list[str]:
    return [part.strip() for part in _SENTENCE_SPLIT.split(text) if part.strip()]


def _language_for(text: str, requested: SafetyLanguage | str | None) -> SafetyLanguage:
    if requested is not None:
        try:
            return requested if isinstance(requested, SafetyLanguage) else SafetyLanguage(requested.casefold())
        except (ValueError, AttributeError) as exc:
            raise ValueError("language must be 'en', 'hi', or 'hinglish'") from exc
    if _DEVANAGARI.search(text):
        return SafetyLanguage.HINDI
    if _HINGLISH_HINTS.search(text):
        return SafetyLanguage.HINGLISH
    return SafetyLanguage.ENGLISH


def _indicator_situations(indicator: SafetyIndicator) -> list[SafetySituation]:
    category = indicator.category
    source = indicator.source_text
    result = list(_INDICATOR_SITUATIONS.get(category, ()))

    if category == "harassment" and _SEXUAL.search(source):
        result.append(SafetySituation.SEXUAL_HARASSMENT_VIOLENCE)
    if category in {"coercion", "forced_isolation", "financial_control", "intimidation"}:
        if _RELATIONSHIP_OR_CONTROL.search(source):
            result.append(SafetySituation.COERCIVE_CONTROL)
    return list(dict.fromkeys(result))


def _append_context_evidence(
    evidence: list[TriggerEvidence],
    *,
    category: str,
    sentence: str,
    situations: tuple[SafetySituation, ...],
    matched_text: str | None = None,
) -> None:
    value = matched_text or sentence
    key = (category, sentence.casefold(), value.casefold())
    if any((item.category, item.source_text.casefold(), item.matched_text.casefold()) == key for item in evidence):
        return
    evidence.append(TriggerEvidence(category, value, sentence, situations))


def _situation_resource_categories(
    situations: Iterable[SafetySituation],
    urgency: SafetyUrgency,
    evidence: Sequence[TriggerEvidence],
) -> tuple[ResourceCategory, ...]:
    categories: list[ResourceCategory] = []
    if urgency is SafetyUrgency.URGENT:
        categories.extend((
            ResourceCategory.EMERGENCY,
            ResourceCategory.POLICE_OFFICIAL,
            ResourceCategory.CRISIS_SUPPORT,
        ))
    elif urgency is SafetyUrgency.ELEVATED:
        categories.append(ResourceCategory.CRISIS_SUPPORT)
    workplace_sexual_context = any(
        item.category == "workplace_sexual_harassment_concern"
        or (
            item.category == "workplace_harassment_context"
            and re.search(r"\b(?:sexual|sexually|unwanted sexual)\b|यौन|अश्लील", item.source_text, re.I)
        )
        for item in evidence
    )
    for situation in situations:
        if situation is SafetySituation.WORKPLACE_HARASSMENT:
            categories.extend((ResourceCategory.WORKPLACE_HARASSMENT, ResourceCategory.LEGAL_AID))
            if workplace_sexual_context:
                categories.append(ResourceCategory.WORKPLACE_SAFEGUARDING)
            continue
        categories.extend(_SITUATION_RESOURCES[situation])
    return tuple(dict.fromkeys(categories))


def _resource_location_issue(
    resource: OfficialResource,
    *,
    jurisdiction: str | None,
    state: str | None,
) -> ResourceAvailabilityStatus | None:
    """Return why a catalog candidate does not apply, or None if it does."""
    resource_jurisdiction = resource.jurisdiction.casefold()
    if resource_jurisdiction != "global":
        if jurisdiction is None:
            return ResourceAvailabilityStatus.JURISDICTION_UNSPECIFIED
        if resource_jurisdiction != jurisdiction.casefold():
            return ResourceAvailabilityStatus.JURISDICTION_MISMATCH

    if resource.jurisdiction_scope == "state_listed" or resource.excluded_states:
        if state is None:
            return ResourceAvailabilityStatus.JURISDICTION_UNSPECIFIED
        state_key = state.casefold()
        if any(value.casefold() == state_key for value in resource.excluded_states):
            return ResourceAvailabilityStatus.STATE_NOT_APPLICABLE
        if resource.jurisdiction_scope == "state_listed" and not any(
            value.casefold() == state_key for value in resource.applicable_states
        ):
            return ResourceAvailabilityStatus.STATE_NOT_APPLICABLE
    return None


def _resource_availability(
    categories: tuple[ResourceCategory, ...],
    candidates: Sequence[OfficialResource],
    *,
    jurisdiction: str | None,
    state: str | None,
) -> tuple[ResourceAvailability, ...]:
    availability: list[ResourceAvailability] = []
    for category in categories:
        category_candidates = [item for item in candidates if category in item.categories]
        applicable = [
            item for item in category_candidates
            if _resource_location_issue(item, jurisdiction=jurisdiction, state=state) is None
        ]
        if any(
            item.official
            and item.verification_status is ResourceVerificationStatus.VERIFIED_OFFICIAL
            for item in applicable
        ):
            status = ResourceAvailabilityStatus.VERIFIED_OFFICIAL
        elif any(
            item.verification_status is ResourceVerificationStatus.UNVERIFIED
            for item in applicable
        ):
            status = ResourceAvailabilityStatus.UNVERIFIED
        elif applicable:
            status = ResourceAvailabilityStatus.UNAVAILABLE
        elif not category_candidates:
            status = ResourceAvailabilityStatus.UNAVAILABLE
        else:
            issues = {
                _resource_location_issue(item, jurisdiction=jurisdiction, state=state)
                for item in category_candidates
            }
            if ResourceAvailabilityStatus.JURISDICTION_MISMATCH in issues:
                status = ResourceAvailabilityStatus.JURISDICTION_MISMATCH
            elif ResourceAvailabilityStatus.STATE_NOT_APPLICABLE in issues:
                status = ResourceAvailabilityStatus.STATE_NOT_APPLICABLE
            else:
                status = ResourceAvailabilityStatus.JURISDICTION_UNSPECIFIED
        availability.append(ResourceAvailability(category, status, jurisdiction, state))
    return tuple(availability)


def _resource_eligibility(
    categories: tuple[ResourceCategory, ...],
    candidates: Sequence[OfficialResource],
    *,
    jurisdiction: str | None,
    state: str | None,
) -> tuple[ResourceEligibility, ...]:
    """Expose official source links for candidates withheld by location checks.

    Contact numbers and destination URLs stay out of this list so the UI can
    explain a restriction without presenting the service as available.
    """
    result: list[ResourceEligibility] = []
    seen: set[str] = set()
    for resource in candidates:
        if (
            not resource.official
            or resource.verification_status is not ResourceVerificationStatus.VERIFIED_OFFICIAL
        ):
            continue
        matching = [category for category in categories if category in resource.categories]
        if not matching:
            continue
        status = _resource_location_issue(resource, jurisdiction=jurisdiction, state=state)
        if status is None:
            continue
        resource_id = resource.resource_id
        if not resource_id or resource_id in seen:
            continue
        serialized = resource.as_dict()
        result.append(ResourceEligibility(
            resource_id=resource_id,
            name=resource.name,
            category=matching[0],
            status=status,
            jurisdiction=resource.jurisdiction,
            state=state,
            source_url=serialized.get("source_url"),
            verified_on=resource.verified_on,
            availability_note=resource.availability_note,
        ))
        seen.add(resource_id)
    return tuple(result)


def _requested_categories(
    values: Sequence[ResourceCategory | str],
) -> tuple[ResourceCategory, ...]:
    categories: list[ResourceCategory] = []
    for value in values:
        try:
            category = value if isinstance(value, ResourceCategory) else ResourceCategory(value.casefold())
        except (ValueError, AttributeError) as exc:
            allowed = ", ".join(item.value for item in ResourceCategory)
            raise ValueError(f"requested resource categories must be one of: {allowed}") from exc
        if category not in categories:
            categories.append(category)
    return tuple(categories)


class SafetySupportOrchestrator:
    """Turn local detector output into cautious, actionable safety support.

    This class makes no contact, stores no narrative, and never makes a legal
    or factual finding. Contact details come only from verified, applicable
    registry records. The default catalog contains checked India resources;
    no locale is assumed when jurisdiction is omitted.
    """

    def __init__(self, resource_registry: OfficialResourceRegistry | None = None) -> None:
        self._resource_registry = (
            resource_registry if resource_registry is not None else IndiaOfficialResourceRegistry()
        )

    def assess(
        self,
        narrative: str,
        *,
        language: SafetyLanguage | str | None = None,
        immediate_danger: ImmediateDangerAnswer | str | None = None,
        jurisdiction: str | None = None,
        state: str | None = None,
        requested_resource_categories: Sequence[ResourceCategory | str] = (),
        case_state: CaseState | None = None,
    ) -> SafetySupportAssessment:
        if not isinstance(narrative, str):
            raise TypeError("narrative must be a string")
        if not narrative.strip():
            raise ValueError("narrative must not be empty")
        if jurisdiction is not None and not isinstance(jurisdiction, str):
            raise TypeError("jurisdiction must be a string or None")
        if state is not None and not isinstance(state, str):
            raise TypeError("state must be a string or None")
        if jurisdiction is not None:
            jurisdiction = jurisdiction.strip() or None
        if state is not None:
            state = state.strip() or None
        requested_categories = _requested_categories(requested_resource_categories)
        if immediate_danger is not None:
            try:
                immediate_danger = (
                    immediate_danger
                    if isinstance(immediate_danger, ImmediateDangerAnswer)
                    else ImmediateDangerAnswer(immediate_danger.casefold())
                )
            except (ValueError, AttributeError) as exc:
                raise ValueError("immediate_danger must be 'yes', 'no', or 'not_sure'") from exc
        if case_state is not None:
            if not isinstance(case_state, CaseState):
                raise TypeError("case_state must be a CaseState")
            if case_state.initialStatement != narrative:
                raise ValueError("case_state.initialStatement must match narrative")

        selected_language = _language_for(narrative, language)
        baseline = detect_safety_context(narrative)
        evidence: list[TriggerEvidence] = []
        situations: list[SafetySituation] = []

        for indicator in baseline.indicators:
            mapped = _indicator_situations(indicator)
            situations.extend(mapped)
            evidence.append(TriggerEvidence(
                category=indicator.category,
                matched_text=indicator.matched_text,
                source_text=indicator.source_text,
                situations=tuple(mapped),
            ))

        if immediate_danger in {ImmediateDangerAnswer.YES, ImmediateDangerAnswer.NOT_SURE}:
            evidence.append(TriggerEvidence(
                category="immediate_danger_self_report",
                matched_text=immediate_danger.value,
                source_text="immediate_danger",
                origin="user_response",
            ))

        # Use the existing case-aware layer when a canonical case is available.
        # It contributes only its additional contextual indicators.
        if case_state is not None:
            from app.engines.safety import detect_case_safety_context

            case_assessment = detect_case_safety_context(case_state)
            base_keys = {
                (item.category, item.source_text.casefold(), item.matched_text.casefold())
                for item in evidence
            }
            for indicator in case_assessment.indicators:
                key = (indicator.category, indicator.source_text.casefold(), indicator.matched_text.casefold())
                if key in base_keys:
                    continue
                context_situations: tuple[SafetySituation, ...] = ()
                if indicator.category == "workplace_sexual_harassment_concern":
                    context_situations = (SafetySituation.WORKPLACE_HARASSMENT, SafetySituation.SEXUAL_HARASSMENT_VIOLENCE)
                elif indicator.category == "child_safety_concern":
                    context_situations = (SafetySituation.CHILD_SAFETY,)
                elif indicator.category == "dowry_related_threat_concern":
                    context_situations = (SafetySituation.DOMESTIC_VIOLENCE, SafetySituation.THREATS)
                elif indicator.category == "dowry_related_abuse":
                    context_situations = (SafetySituation.DOWRY_RELATED_ABUSE,)
                evidence.append(TriggerEvidence(
                    category=indicator.category,
                    matched_text=indicator.matched_text,
                    source_text=indicator.source_text,
                    situations=context_situations,
                ))
                situations.extend(context_situations)

        # The detector captures conduct; these conservative co-occurrence checks
        # add the setting when it appears in the same sentence as relevant cues.
        for sentence in _split_sentences(narrative):
            sentence_indicators = [item for item in evidence if item.source_text == sentence]
            categories = {item.category for item in sentence_indicators}

            if _WORKPLACE.search(sentence) and (
                categories.intersection({"harassment", "sexual_violence", "threat", "stalking", "coercion"})
                or _WORKPLACE_HARASSMENT_CUE.search(sentence)
            ):
                workplace_situations = [SafetySituation.WORKPLACE_HARASSMENT]
                if _SEXUAL.search(sentence) and (
                    categories.intersection({"harassment", "sexual_violence"})
                    or _WORKPLACE_HARASSMENT_CUE.search(sentence)
                ):
                    workplace_situations.append(SafetySituation.SEXUAL_HARASSMENT_VIOLENCE)
                situations.extend(workplace_situations)
                _append_context_evidence(
                    evidence, category="workplace_harassment_context", sentence=sentence,
                    situations=tuple(workplace_situations),
                )

            if _CHILD.search(sentence) and _CHILD_CONCERN.search(sentence):
                situations.append(SafetySituation.CHILD_SAFETY)
                _append_context_evidence(
                    evidence, category="child_safety_context", sentence=sentence,
                    situations=(SafetySituation.CHILD_SAFETY,),
                )

            if _ELDER.search(sentence) and _ELDER_CONCERN.search(sentence):
                situations.append(SafetySituation.ELDER_ABUSE)
                _append_context_evidence(
                    evidence, category="elder_abuse_context", sentence=sentence,
                    situations=(SafetySituation.ELDER_ABUSE,),
                )

            if _COERCIVE_CONTROL_CUE.search(sentence):
                situations.append(SafetySituation.COERCIVE_CONTROL)
                _append_context_evidence(
                    evidence, category="coercive_control_context", sentence=sentence,
                    situations=(SafetySituation.COERCIVE_CONTROL,),
                )

            if _ONLINE.search(sentence) and categories.intersection(
                {
                    "harassment", "sexual_violence", "threat", "stalking", "blackmail",
                    "intimidation", "intimate_image_abuse",
                }
            ):
                situations.append(SafetySituation.CYBER_HARASSMENT)
                _append_context_evidence(
                    evidence, category="cyber_harassment_context", sentence=sentence,
                    situations=(SafetySituation.CYBER_HARASSMENT,),
                )

        # Domain-specific detector indicators carry their context even when the
        # sentence does not explicitly name a relationship or venue.
        situations = list(dict.fromkeys(situations))
        has_urgent_indicator = any(item.category == "immediate_danger" for item in baseline.indicators)
        danger_yes = immediate_danger is ImmediateDangerAnswer.YES
        danger_unsure = immediate_danger is ImmediateDangerAnswer.NOT_SURE

        if has_urgent_indicator or danger_yes:
            urgency = SafetyUrgency.URGENT
            context = AssessmentContext.URGENT_SAFETY_CONTEXT
            workflow = WorkflowDisposition.SAFETY_FIRST
            legal_workflow_allowed = False
        elif danger_unsure:
            urgency = SafetyUrgency.ELEVATED
            context = AssessmentContext.UNCERTAIN
            workflow = WorkflowDisposition.SAFETY_FIRST
            legal_workflow_allowed = False
        elif situations or baseline.context is DetectorContext.POTENTIALLY_UNSAFE:
            urgency = SafetyUrgency.ELEVATED
            context = AssessmentContext.POTENTIALLY_UNSAFE
            workflow = WorkflowDisposition.SAFETY_CHECK_THEN_LEGAL
            legal_workflow_allowed = True
        elif baseline.context is DetectorContext.SENSITIVE:
            urgency = SafetyUrgency.NONE
            context = AssessmentContext.SENSITIVE
            workflow = WorkflowDisposition.SAFETY_CHECK_THEN_LEGAL
            legal_workflow_allowed = True
        else:
            urgency = SafetyUrgency.NONE
            context = AssessmentContext.NONE
            workflow = WorkflowDisposition.ORDINARY_LEGAL
            legal_workflow_allowed = True

        text = _TEXT[selected_language]
        if (
            situations
            or baseline.context is DetectorContext.POTENTIALLY_UNSAFE
            or danger_yes
            or danger_unsure
            or has_urgent_indicator
        ):
            prompt = text["prompt"]
        elif context is AssessmentContext.SENSITIVE:
            prompt = text["sensitive_prompt"]
        else:
            prompt = None

        if urgency is SafetyUrgency.URGENT:
            steps = text["urgent_steps"]
            escalation = text["escalation_urgent"]
        elif danger_unsure:
            steps = text["uncertain_steps"]
            escalation = text["escalation_urgent"]
        elif situations or baseline.context is DetectorContext.POTENTIALLY_UNSAFE:
            steps = text["context_steps"]
            escalation = text["escalation_other"]
        elif context is AssessmentContext.SENSITIVE:
            steps = text["sensitive_steps"]
            escalation = ()
        else:
            steps = text["ordinary_steps"]
            escalation = text["escalation_other"] if context is AssessmentContext.SENSITIVE else ()

        preservation = text["preserve"] if evidence or danger_unsure or danger_yes else ()
        resource_categories = _situation_resource_categories(situations, urgency, evidence)
        if danger_unsure:
            resource_categories = tuple(dict.fromkeys((
                *resource_categories,
                ResourceCategory.EMERGENCY,
                ResourceCategory.POLICE_OFFICIAL,
                ResourceCategory.CRISIS_SUPPORT,
            )))
        resource_categories = tuple(dict.fromkeys((*resource_categories, *requested_categories)))
        candidates = tuple(
            self._resource_registry.lookup(
                jurisdiction=jurisdiction,
                state=state,
                categories=resource_categories,
            )
        ) if resource_categories else ()
        resources = tuple(
            resource
            for resource in candidates
            if resource.official
            and resource.verification_status is ResourceVerificationStatus.VERIFIED_OFFICIAL
            and set(resource.categories).intersection(resource_categories)
            and _resource_location_issue(resource, jurisdiction=jurisdiction, state=state) is None
        )
        resource_availability = _resource_availability(
            resource_categories,
            candidates,
            jurisdiction=jurisdiction,
            state=state,
        )
        resource_eligibility = _resource_eligibility(
            resource_categories,
            candidates,
            jurisdiction=jurisdiction,
            state=state,
        )
        support_tracks = (
            (SafetySupportTrack.IMMEDIATE_DANGER,)
            if urgency is SafetyUrgency.URGENT or danger_unsure
            else ()
        )
        women_safety_context = build_women_safety_context(
            trigger_evidence=evidence,
            situations=situations,
            shared_urgency=urgency,
            language=selected_language,
            immediate_danger=immediate_danger,
            evidence_guidance_available=bool(preservation),
            resources=resources,
            case_state=case_state,
            jurisdiction=jurisdiction,
            state=state,
        )
        preservation = tuple(dict.fromkeys((
            *preservation,
            *women_safety_context.evidence_preservation_guidance,
        )))

        return SafetySupportAssessment(
            context=context,
            situations=tuple(situations),
            urgency=urgency,
            trigger_evidence=tuple(evidence),
            uncertainty=tuple(text["uncertainty"]),
            user_facing_safety_prompt=prompt,
            evidence_preservation_guidance=tuple(preservation),
            escalation_options=tuple(escalation),
            resource_categories=resource_categories,
            resources=resources,
            safe_next_step_sequence=tuple(steps),
            language=selected_language,
            workflow_disposition=workflow,
            legal_workflow_allowed=legal_workflow_allowed,
            contacted_anyone=False,
            support_tracks=support_tracks,
            resource_availability=resource_availability,
            resource_eligibility=resource_eligibility,
            women_safety_context=women_safety_context,
        )


def orchestrate_safety_support(
    narrative: str,
    *,
    language: SafetyLanguage | str | None = None,
    immediate_danger: ImmediateDangerAnswer | str | None = None,
    jurisdiction: str | None = None,
    state: str | None = None,
    requested_resource_categories: Sequence[ResourceCategory | str] = (),
    case_state: CaseState | None = None,
    resource_registry: OfficialResourceRegistry | None = None,
) -> SafetySupportAssessment:
    """Convenience function for one screening request."""
    return SafetySupportOrchestrator(resource_registry).assess(
        narrative,
        language=language,
        immediate_danger=immediate_danger,
        jurisdiction=jurisdiction,
        state=state,
        requested_resource_categories=requested_resource_categories,
        case_state=case_state,
    )
