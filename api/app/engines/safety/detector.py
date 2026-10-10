"""Deterministic safety-context rules for English, Hindi, and Hinglish.

This module deliberately reports possible indicators instead of deciding that
abuse or a crime occurred. It is local-only and has no network or model calls.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from .models import SafetyAssessment, SafetyCategory, SafetyIndicator, SafetyUrgency


@dataclass(frozen=True)
class _Rule:
    category: str
    pattern: re.Pattern[str]
    confidence: str = "medium"


_FLAGS = re.IGNORECASE

# Rules favor concrete conduct and phrases. Broad legal terms such as
# "complaint", "notice", "court", "payment", or "dispute" are not indicators.
_RULES: tuple[_Rule, ...] = (
    _Rule(
        "immediate_danger",
        re.compile(
            r"\b(?:i am in immediate danger|in danger right now|unsafe right now|"
            r"help me now|he is outside with (?:a )?(?:knife|gun|weapon)|"
            r"has (?:a )?(?:knife|gun|weapon) and is here|locked in and cannot leave|"
            r"locked in and can.t leave)\b"
            r"|अभी जान को खतरा|अभी खतरे में|अभी मुझे मारने|मेरे सामने हथियार|"
            r"अभी घर के बाहर.*(?:हथियार|मारने)|अभी बाहर.*(?:चाकू|बंदूक|हथियार)"
            r"|\b(?:abhi jaan ko khatra|abhi khatre mein|abhi mujhe maarne|"
            r"abhi ghar ke bahar.*(?:hathiyar|maarne)|mere saamne (?:chaku|bandook|hathiyar))\b",
            _FLAGS,
        ),
        "high",
    ),
    _Rule(
        "threat",
        re.compile(
            r"\b(?:threat(?:en(?:ed|ing)?|s?)|kill you|hurt you|harm you|beat you|"
            r"make you pay|you(?:'ll| will) regret it|watch your back)\b"
            r"|धमकी|धमका(?:या|ते| रहा| रही)?|जान से मार(?:ने| दूंगा| दूँगा)|"
            r"मार डाल(?:ने|ूंगा|ूँगा)"
            r"|\b(?:dhamki|dhamkiyan|dhamkaya|jaan se maar(?:ne| dunga| dungi)|"
            r"maar dunga|maar dungi)\b"
            r"|(?:अगर|यदि|agar|yadi).{0,60}(?:पैसे|पैसा|रुपये|paise|paisa|money).{0,40}"
            r"(?:नहीं दिए|नहीं दिये|nahi diye|nahin diye|not pay|don't pay|do not pay).{0,60}"
            r"(?:देख लेना|देख लेना फिर|dekh lena|dekh lena phir|you will see|you'll see)",
            _FLAGS,
        ),
    ),
    _Rule(
        "stalking",
        re.compile(
            r"\b(?:keeps? following me|following me everywhere|following me home|"
            r"wait(?:s|ed|ing)? outside my (?:home|house|work)|tracking my location|"
            r"track(?:s|ed|ing)? my phone|show(?:s|ed)? up wherever i go|stalking me)\b"
            r"|बार बार पीछा|लगातार पीछा|मेरा पीछा करता|मेरा पीछा कर रहा|"
            r"घर के बाहर इंतजार|मेरी लोकेशन ट्रैक"
            r"|\b(?:baar baar peecha|mera peecha karta|mera peecha kar raha|"
            r"ghar ke bahar intezar|meri location track|location track karta)\b",
            _FLAGS,
        ),
    ),
    _Rule(
        "harassment",
        re.compile(
            r"\b(?:repeatedly (?:unwanted )?(?:text|message|call)s?|"
            r"won.t stop (?:texting|messaging|calling|contacting) me|"
            r"unwanted (?:messages?|calls?) every day|sexual harassment|harassing me)\b"
            r"|बार बार (?:फोन|कॉल|मैसेज|संदेश)|लगातार (?:फोन|कॉल|मैसेज|संदेश)|"
            r"रोज(?:़)? (?:फोन|कॉल|मैसेज)|परेशान कर(?: रहा| रही|ते)?"
            r"|\b(?:baar baar (?:phone|call|message|messages)|roz (?:phone|call|message)|"
            r"pareshan kar(?: raha| rahi|te)?)\b",
            _FLAGS,
        ),
    ),
    _Rule(
        "domestic_violence",
        re.compile(
            r"\b(?:my (?:partner|husband|wife|spouse|boyfriend|girlfriend)"
            r".{0,45}(?:hit|hits|beats?|chokes?|strangles?|physically hurts?) me|"
            r"(?:hit|hits|beats?|chokes?|strangles?) me (?:my )?(?:partner|husband|wife|spouse)|"
            r"domestic violence|my partner is violent)\b"
            r"|(?:पति|पत्नी|साथी|पति ने|पत्नी ने).{0,35}(?:मारता|मारती|मारा|पीटा|गला दबाया)|"
            r"(?:मारता|मारती|पीटता|पीटती).{0,25}(?:पति|पत्नी|साथी)"
            r"|\b(?:mera pati|meri patni|partner|husband|wife).{0,35}(?:marta|maarta|maarti|"
            r"peetta|gala dabata).{0,15}(?:hai|hain|he|hai)\b",
            _FLAGS,
        ),
    ),
    _Rule(
        "sexual_violence",
        re.compile(
            r"\b(?:sexual assault|rape(?:d)?|molest(?:ed|ation)?|forced me to have sex|"
            r"made me have sex|without my consent|against my will.{0,20}sex|"
            r"non[- ]consensual sex)\b"
            r"|बलात्कार|मेरी मर्जी के बिना.{0,30}(?:यौन|सेक्स|संबंध)|"
            r"बिना सहमति.{0,30}(?:यौन|सेक्स|संबंध)|जबरदस्ती.{0,30}(?:सेक्स|संबंध)|"
            r"यौन हिंसा|यौन शोषण"
            r"|\b(?:meri marzi ke bina.{0,30}(?:sex|sambandh)|bina sahmati.{0,30}"
            r"(?:sex|sambandh)|zabardasti.{0,30}(?:sex|sambandh)|rape kiya|molest kiya)\b",
            _FLAGS,
        ),
    ),
    _Rule(
        "blackmail",
        re.compile(
            r"\b(?:blackmail(?:ed|ing)?|threaten(?:ed|ing)? to (?:leak|share|publish)"
            r".{0,35}(?:private|intimate|personal) (?:photo|picture|video)s?|"
            r"unless you pay.{0,40}(?:photo|secret|video)|extort(?:ed|ion) me)\b"
            r"|ब्लैकमेल|फोटो (?:लीक|वायरल) करने की धमकी|वीडियो (?:लीक|वायरल) करने की धमकी|"
            r"पैसे नहीं दिए तो.*(?:फोटो|वीडियो).*(?:लीक|वायरल)"
            r"|\b(?:blackmail|photo viral karne ki dhamki|photo leak karne ki dhamki|"
            r"paise nahi diye to.*(?:photo|video).*(?:leak|viral))\b",
            _FLAGS,
        ),
    ),
    _Rule(
        "intimate_image_abuse",
        re.compile(
            r"\b(?:shared|posted|uploaded|published|circulated|sent)\b.{0,45}"
            r"\b(?:my |private |intimate |nude |sexual )?(?:photo|photos|image|images|picture|pictures|video|videos)\b"
            r".{0,35}\b(?:without (?:my )?(?:consent|permission)|without consent|non[- ]consensual)\b|"
            r"\b(?:threatened|threatening|blackmail(?:ed|ing)?)\b.{0,45}"
            r"\b(?:leak|share|post|publish|circulate)\b.{0,35}"
            r"\b(?:my |private |intimate |nude |sexual )?(?:photo|photos|image|images|picture|pictures|video|videos)\b|"
            r"\bblackmail(?:ed|ing)? me with.{0,30}\b(?:my )?(?:private|intimate|nude|sexual)\b.{0,15}"
            r"\b(?:photos?|images?|pictures?|videos?)\b|"
            r"बिना (?:मेरी )?सहमति.{0,35}(?:निजी|अंतरंग|नग्न|अश्लील)? ?(?:फोटो|तस्वीर|वीडियो).{0,20}(?:शेयर|पोस्ट|वायरल|लीक)|"
            r"(?:निजी|अंतरंग|नग्न|अश्लील) (?:फोटो|तस्वीर|वीडियो).{0,30}(?:बिना सहमति|लीक|वायरल|शेयर करने की धमकी)|"
            r"ब्लैकमेल.{0,30}(?:निजी|अंतरंग|फोटो|तस्वीर|वीडियो)|"
            r"(?:निजी|अंतरंग|फोटो|तस्वीर|वीडियो).{0,30}ब्लैकमेल|"
            r"\b(?:meri |private |intimate |nude )?(?:photo|photos|image|video)\b.{0,35}"
            r"\b(?:bina (?:meri )?sahmati|bina ijazat|leak karne ki dhamki|viral karne ki dhamki)\b",
            _FLAGS,
        ),
        "high",
    ),
    _Rule(
        "dowry_related_abuse",
        re.compile(
            r"\b(?:dowry|dahej)\b.{0,70}\b(?:abuse|abused|harass(?:ment|ed|ing)?|"
            r"threat(?:en(?:ed|ing)?)?|beat(?:en|ing)?|violence|coerc(?:ed|ion))\b|"
            r"\b(?:abuse|abused|harass(?:ment|ed|ing)?|threat(?:en(?:ed|ing)?)?|"
            r"beat(?:en|ing)?|violence|coerc(?:ed|ion))\b.{0,70}\b(?:dowry|dahej)\b|"
            r"दहेज.{0,45}(?:प्रताड़ित|धमकी|मारपीट|हिंसा|जबरदस्ती|उत्पीड़न)|"
            r"(?:प्रताड़ित|धमकी|मारपीट|हिंसा|उत्पीड़न).{0,45}दहेज|"
            r"\b(?:dahej|dowry)\b.{0,45}\b(?:pareshan|dhamki|maar|maarpeet|hinsa|utpidan)\w*",
            _FLAGS,
        ),
        "medium",
    ),
    _Rule(
        "coercion",
        re.compile(
            r"\b(?:forced me to (?:sign|marry|work|give|hand over|do)|"
            r"made me (?:sign|marry|work|give|hand over) against my will|"
            r"pressur(?:e|ed|ing) me to (?:sign|marry|have sex|give)|"
            r"coerc(?:e|ed|ion))\b"
            r"|जबरदस्ती (?:शादी|हस्ताक्षर|काम|पैसे|पैसा)|मजबूर (?:कर|किया|किया जा रहा)|"
            r"दबाव डालकर (?:हस्ताक्षर|शादी|पैसे|काम)"
            r"|\b(?:zabardasti (?:shaadi|sign|kaam|paise)|majboor (?:kar|kiya)|"
            r"dabav daal(?:kar| ke) (?:sign|shaadi|paise|kaam))\b",
            _FLAGS,
        ),
    ),
    _Rule(
        "intimidation",
        re.compile(
            r"\b(?:intimidat(?:e|ed|ing|ion)|scare me into|trying to scare me|"
            r"threatening presence|menacing me)\b"
            r"|डरा धमकाकर|डरा रहा|डरा रही|धौंस जमा(?:ता|ते|ना)"
            r"|\b(?:dara dhamka(?:kar| ke)|dara raha|dara rahi|dhamka kar)\b",
            _FLAGS,
        ),
    ),
    _Rule(
        "forced_isolation",
        re.compile(
            r"\b(?:won.t let me (?:see|meet|talk to|speak to) my (?:family|friends)|"
            r"stops? me from (?:seeing|meeting|talking to) my (?:family|friends)|"
            r"isolat(?:e|ed|ing) me from (?:my )?(?:family|friends)|"
            r"won.t let me leave the house)\b"
            r"|(?:परिवार|दोस्तों|घरवालों) से (?:मिलने|बात करने) नहीं देता|"
            r"(?:मिलने|बात करने) नहीं देती|अलग थलग कर(?:ता|ती|ना)|बाहर नहीं जाने देता"
            r"|\b(?:ghar walon se milne nahi deta|doston se baat nahi karne deta|"
            r"family se milne nahi deta|bahar nahi jaane deta|alag thalag kar(?:ta|ti))\b",
            _FLAGS,
        ),
    ),
    _Rule(
        "financial_control",
        re.compile(
            r"\b(?:controls? all (?:my )?money|won.t let me access (?:my )?(?:money|bank account)|"
            r"takes? my (?:entire )?(?:salary|paycheck|wages?) and won.t let me|"
            r"keeps? my (?:bank card|atm card|passport)|forces? me to hand over my (?:salary|wages|money)|"
            r"won.t let me work.{0,25}(?:money|financially)|financial control)\b"
            r"|मेरी (?:पूरी )?(?:तनख्वाह|वेतन|कमाई) ले लेता|मेरी कमाई पर नियंत्रण|"
            r"पैसे खर्च नहीं करने देता|बैंक कार्ड अपने पास रखता|काम नहीं करने देता"
            r"|\b(?:meri (?:puri )?(?:salary|tankhwa|kamai) le leta|meri kamai par control|"
            r"paise kharch nahi karne deta|bank card apne paas rakhta|kaam nahi karne deta)\b",
            _FLAGS,
        ),
    ),
    _Rule(
        "exploitation",
        re.compile(
            r"\b(?:forced labor|human trafficking|trafficked me|forced me to work"
            r".{0,35}(?:without pay|for no pay|against my will)|exploiting me|"
            r"made me work without pay under threat)\b"
            r"|जबरन मजदूरी|जबरदस्ती काम कराया|बिना पैसे दिए काम करने को मजबूर|"
            r"धमकी देकर काम कराया|मानव तस्करी"
            r"|\b(?:jabran majdoori|zabardasti kaam karaya|bina paise kaam karne ko majboor|"
            r"dhamki dekar kaam karaya|human trafficking)\b",
            _FLAGS,
        ),
    ),
)

_SENSITIVE_RULE = re.compile(
    r"\b(?:i feel unsafe|i don.t feel safe|afraid to go home|scared to go home|"
    r"this is hard to talk about|i feel uncomfortable sharing)\b"
    r"|असुरक्षित महसूस|घर जाने से डर|डर लग रहा है|यह बात बताना मुश्किल"
    r"|\b(?:unsafe feel hota|ghar jaane se dar|dar lag raha hai|batana mushkil hai)\b",
    _FLAGS,
)

# These exclusions keep common legal-process language and explicit denials from
# being mistaken for reported safety concerns.
_LEGAL_ACTION_THREAT = re.compile(
    r"\bthreaten(?:ed|ing)?\s+(?:(?:to\s+)?(?:sue|take legal action|file (?:a )?(?:lawsuit|case)|go to court)|legal action)\b",
    _FLAGS,
)
_NEGATED_THREAT = re.compile(
    r"\b(?:not|never|did not|didn't|was not|wasn't|am not|is not|isn't)\s+"
    r"(?:being\s+)?threaten(?:ed|ing)?\b|"
    r"मुझे धमकी नहीं (?:मिली|दी|दी गई)|\b(?:mujhe dhamki nahi mili|mujhe dhamki nahi di)\b",
    _FLAGS,
)
_NEGATED_IMMEDIATE_DANGER = re.compile(
    r"\b(?:not|never|no longer)\b[^,;:!?।]{0,30}\b(?:in immediate danger|"
    r"in danger right now|unsafe right now)\b|"
    r"(?:अभी खतरे में|अभी जान को खतरा).{0,12}नहीं|"
    r"\b(?:abhi khatre mein|abhi jaan ko khatra).{0,12}(?:nahi|nahin)\b",
    _FLAGS,
)

_SENTENCE_SPLIT = re.compile(r"(?<=[.!?।؟])\s+|[\r\n]+")


def _sentences(text: str) -> list[str]:
    """Split narrative while preserving the original sentence text."""
    return [part.strip() for part in _SENTENCE_SPLIT.split(text) if part.strip()]


def detect_safety_context(text: str) -> SafetyAssessment:
    """Return a deterministic, source-traceable safety-context assessment.

    The detector accepts one narrative string and performs no network access,
    model inference, persistence, or side effects. A blank narrative is rejected
    so callers cannot mistake missing input for a positive "none" assessment.
    """
    if not isinstance(text, str):
        raise TypeError("text must be a string")
    if not text.strip():
        raise ValueError("text must not be empty")

    indicators: list[SafetyIndicator] = []
    seen: set[tuple[str, str, str]] = set()
    has_sensitive_context = False

    for sentence in _sentences(text):
        if _SENSITIVE_RULE.search(sentence):
            has_sensitive_context = True

        for rule in _RULES:
            for match in rule.pattern.finditer(sentence):
                if rule.category == "threat":
                    exclusions = (_LEGAL_ACTION_THREAT, _NEGATED_THREAT)
                    if any(
                        (excluded := pattern.search(sentence))
                        and match.start() < excluded.end()
                        and excluded.start() < match.end()
                        for pattern in exclusions
                    ):
                        continue
                if rule.category == "immediate_danger":
                    excluded = _NEGATED_IMMEDIATE_DANGER.search(sentence)
                    if excluded and match.start() < excluded.end() and excluded.start() < match.end():
                        continue
                key = (rule.category, sentence, match.group(0).casefold())
                if key in seen:
                    continue
                seen.add(key)
                indicators.append(
                    SafetyIndicator(
                        category=rule.category,
                        confidence=rule.confidence,
                        matched_text=match.group(0),
                        source_text=sentence,
                    )
                )

    urgent = any(item.category == "immediate_danger" for item in indicators)
    if urgent:
        context = SafetyCategory.URGENT_SAFETY_CONTEXT
        urgency = SafetyUrgency.URGENT
        prompt = (
            "Are you safe right now? If it is safer not to reply, you can stop here. "
            "If you can do so safely, consider moving to a safer place or contacting someone you trust."
        )
    elif indicators:
        context = SafetyCategory.POTENTIALLY_UNSAFE
        urgency = SafetyUrgency.ELEVATED
        prompt = (
            "Some of what you described may indicate a potentially unsafe situation. "
            "Are you in immediate danger right now, "
            "and is it safe for you to continue discussing this here?"
        )
    elif has_sensitive_context:
        context = SafetyCategory.SENSITIVE
        urgency = SafetyUrgency.NONE
        prompt = "Share only what feels comfortable; you can skip any details you do not want to discuss."
    else:
        context = SafetyCategory.NONE
        urgency = SafetyUrgency.NONE
        prompt = None

    confidence = max(
        (item.confidence for item in indicators),
        key={"low": 0, "medium": 1, "high": 2}.__getitem__,
        default="low",
    )
    return SafetyAssessment(
        context=context,
        confidence=confidence,
        indicators=tuple(indicators),
        source_text=text,
        urgency=urgency,
        recommended_safety_prompt=prompt,
    )
