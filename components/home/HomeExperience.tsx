'use client';

import {
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  AudioLines,
  FileCheck2,
  FileText,
  LoaderCircle,
  Mic2,
  Paperclip,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { createCase, getCase, previewVoiceTranscript, uploadEvidence, type CaseState, type VoiceTranscriptResponse } from '@/lib/api';
import VoiceCapture, { type RecognitionLanguage } from '@/components/voice/VoiceCapture';
import { TrustNotice } from '@/components/TrustNotice';
import { GuidePresence } from '@/components/guide-presence';
import { SessionCaseChooser } from '@/components/case-continuity/SessionCaseChooser';
import { CaseIntakeReview } from './CaseIntakeReview';
import { rememberSessionCase } from '@/lib/case-continuity';
import './HomeExperience.css';

type EntryMode = 'text' | 'voice' | 'upload';
type SubmissionStage = 'idle' | 'reviewing_transcript' | 'creating_case' | 'uploading_document' | 'preparing_review';

const pathway = [
  {
    name: 'Understand',
    short: 'Your account',
    detail: 'Start with the events as you remember them. Everyday language is enough.',
  },
  {
    name: 'Evidence',
    short: 'What supports it',
    detail: 'Keep documents and other supporting material alongside the facts they relate to.',
  },
  {
    name: 'Law',
    short: 'Relevant context',
    detail: 'See legal context and available source links, with gaps and uncertainty made visible.',
  },
  {
    name: 'Options',
    short: 'Possible paths',
    detail: 'Review practical routes to consider, including what may need more checking.',
  },
  {
    name: 'Next step',
    short: 'A place to begin',
    detail: 'Leave with a clearer action to explore at your own pace.',
  },
] as const;

const examples = [
  {
    category: 'HOUSING',
    title: 'A deposit still not returned',
    statement: 'My landlord has kept my security deposit since I moved out. I have the agreement and messages.',
    icon: '01',
  },
  {
    category: 'WORK',
    title: 'Pay left unresolved',
    statement: 'My final salary is still unpaid after leaving my job, and I would like to understand what to check.',
    icon: '02',
  },
  {
    category: 'A DOCUMENT',
    title: 'A notice I do not understand',
    statement: 'I received a notice and want to understand what it says before I decide how to respond.',
    icon: '03',
  },
] as const;

const entryModes: Array<{ id: EntryMode; title: string; description: string }> = [
  { id: 'text', title: 'Type', description: 'Write it in your own words' },
  { id: 'voice', title: 'Speak', description: 'Talk it through, then review' },
  { id: 'upload', title: 'Upload', description: 'Add a document for context' },
];

const stageDetails = [
  { x: 56, y: 198, label: '01', node: 'Understand' },
  { x: 164, y: 112, label: '02', node: 'Evidence' },
  { x: 282, y: 207, label: '03', node: 'Law' },
  { x: 402, y: 116, label: '04', node: 'Options' },
  { x: 497, y: 202, label: '05', node: 'Next step' },
] as const;

function BrandMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 36 36" className={'brandMark'} fill="none">
      <path d="M7 25.5 17.8 10l11.2 15.5M11 19.8h14M14.3 25.5h7.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="18" cy="8" r="2.2" fill="currentColor" />
      <circle cx="6.7" cy="27.2" r="2.2" fill="currentColor" />
      <circle cx="29.3" cy="27.2" r="2.2" fill="currentColor" />
    </svg>
  );
}

function NetworkArtwork() {
  return (
    <figure className={'networkFigure'} aria-label="A visual metaphor for the LawSense case journey">
      <div className={'networkHalo'} />
      <svg className={'networkSvg'} viewBox="0 0 560 330" aria-hidden="true">
        <defs>
          <linearGradient id="networkLine" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#d9bd8c" stopOpacity=".12" />
            <stop offset=".48" stopColor="#d9bd8c" stopOpacity=".72" />
            <stop offset="1" stopColor="#80aaa5" stopOpacity=".24" />
          </linearGradient>
          <radialGradient id="networkCore">
            <stop offset="0" stopColor="#e4c997" stopOpacity=".22" />
            <stop offset="1" stopColor="#e4c997" stopOpacity="0" />
          </radialGradient>
          <filter id="softGlow" x="-150%" y="-150%" width="400%" height="400%">
            <feGaussianBlur stdDeviation="3.5" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <circle cx="280" cy="165" r="123" fill="url(#networkCore)" />
        <circle cx="280" cy="165" r="90" className={'orbit'} />
        <circle cx="280" cy="165" r="121" className={'orbitSecondary'} />
        <path d="M56 198 164 112 282 207 402 116 497 202" fill="none" stroke="url(#networkLine)" strokeWidth="1.35" />
        <path d="M56 198 164 112 282 207M164 112 282 207 402 116M282 207 402 116 497 202" fill="none" stroke="url(#networkLine)" strokeWidth=".8" strokeDasharray="2 7" opacity=".7" />
        <path d="M89 270 196 241 282 207 369 244 471 265" fill="none" stroke="#bdc8c0" strokeOpacity=".12" strokeWidth="1" />
        <path d="M113 74 164 112M402 116l43-48M282 207v76" fill="none" stroke="#d9bd8c" strokeOpacity=".16" strokeWidth=".8" strokeDasharray="3 8" />
        <circle cx="280" cy="165" r="46" fill="url(#networkCore)" />
        <circle cx="280" cy="165" r="28" fill="#11130f" stroke="#ddc28f" strokeOpacity=".56" />
        <circle cx="280" cy="165" r="22" fill="#e3c89a" fillOpacity=".045" />
        <path d="M270 168.5 280 154l10 14.5M273.8 163.5h12.4M276.2 169h7.6" fill="none" stroke="#e1c58f" strokeWidth="1.1" strokeLinecap="round" />
        {stageDetails.map((stage, index) => (
          <g key={stage.label} filter={index === 2 ? 'url(#softGlow)' : undefined}>
            <circle cx={stage.x} cy={stage.y} r={index === 2 ? 7 : 5} fill={index === 2 ? '#e2c48c' : '#a9bdb4'} fillOpacity={index === 2 ? '.95' : '.65'} />
            <circle cx={stage.x} cy={stage.y} r={index === 2 ? 14 : 10} fill="none" stroke="#dbc18f" strokeOpacity={index === 2 ? '.28' : '.15'} />
          </g>
        ))}
        <circle cx="89" cy="270" r="2" fill="#d5c6a3" fillOpacity=".7" />
        <circle cx="471" cy="265" r="2" fill="#91b7ae" fillOpacity=".7" />
        <circle cx="113" cy="74" r="1.7" fill="#e1c58f" fillOpacity=".7" />
        <circle cx="445" cy="68" r="1.7" fill="#91b7ae" fillOpacity=".7" />
      </svg>
      <div className={`${'networkTag'} ${'networkTagTop'}`}><span className={'tagDot'} /> A story, seen in context</div>
      <div className={`${'networkTag'} ${'networkTagBottom'}`}><Sparkles aria-hidden="true" size={13} /> A clearer path, one step at a time</div>
      <figcaption className={'networkCaption'}>A framework for making sense of the details.</figcaption>
    </figure>
  );
}

function formatFileSize(size: number) {
  return `${(size / 1024 / 1024).toFixed(2)} MB`;
}

export default function HomeExperience() {
  const router = useRouter();
  const [text, setText] = useState('');
  const [language, setLanguage] = useState<RecognitionLanguage>('English');
  const [inputMethod, setInputMethod] = useState<'text' | 'voice'>('text');
  const [entryMode, setEntryMode] = useState<EntryMode>('text');
  const [voicePreview, setVoicePreview] = useState<VoiceTranscriptResponse | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionStage, setSubmissionStage] = useState<SubmissionStage>('idle');
  const [voiceCaptureStatus, setVoiceCaptureStatus] = useState<'idle' | 'listening' | 'processing'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [createdCaseId, setCreatedCaseId] = useState<string | null>(null);
  const [createdCaseState, setCreatedCaseState] = useState<CaseState | null>(null);
  const [intakeReview, setIntakeReview] = useState<CaseState | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [activeStage, setActiveStage] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const statementRef = useRef<HTMLTextAreaElement>(null);
  const readbackFocusPendingRef = useRef(false);
  const readbackFocusFrameRef = useRef<number | null>(null);
  const modeTabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const stageTabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (!intakeReview || !readbackFocusPendingRef.current) return;
    readbackFocusPendingRef.current = false;
    readbackFocusFrameRef.current = window.requestAnimationFrame(() => {
      const section = document.getElementById('intake-review');
      const heading = document.getElementById('intake-review-heading');
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      section?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
      heading?.focus({ preventScroll: true });
    });

    return () => {
      if (readbackFocusFrameRef.current !== null) {
        window.cancelAnimationFrame(readbackFocusFrameRef.current);
        readbackFocusFrameRef.current = null;
      }
    };
  }, [intakeReview]);

  const scrollToSection = (id: string, focusStatement = false) => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.getElementById(id)?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
    if (focusStatement) statementRef.current?.focus({ preventScroll: true });
  };

  const setMode = (mode: EntryMode) => {
    setEntryMode(mode);
    setInputMethod(mode === 'voice' ? 'voice' : 'text');
    setVoiceCaptureStatus('idle');
    setError(null);
  };

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    const supportedExtension = /\.(pdf|jpg|jpeg|png)$/i.test(file.name);

    if (file.size === 0) {
      setError('This file is empty. Choose a PDF, JPG, or PNG with content.');
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setError('File size must be 25 MiB or less.');
      return;
    }
    if (!supportedExtension) {
      setError('Unsupported file type. Please upload a PDF, JPG, or PNG.');
      return;
    }

    setSelectedFile(file);
    setUploadedFile(null);
    setError(null);
  };

  const handleFileSelect = (event: ChangeEvent<HTMLInputElement>) => {
    handleFile(event.target.files?.[0]);
    event.target.value = '';
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDraggingFile(false);
    handleFile(event.dataTransfer.files?.[0]);
  };

  const removeFile = () => {
    setSelectedFile(null);
    setUploadedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!createdCaseId && !text.trim()) {
      setError(
        entryMode === 'upload'
          ? 'Add a sentence about what happened too. A document can support your case, but it cannot start one by itself.'
          : 'Please describe your situation before continuing.',
      );
      statementRef.current?.focus();
      return;
    }

    setIsSubmitting(true);
    setSubmissionStage('creating_case');
    setError(null);
    let targetCaseId = createdCaseId;

    try {
      if (
        !targetCaseId &&
        inputMethod === 'voice' &&
        (!voicePreview || voicePreview.transcript !== text || voicePreview.status !== 'success' || !voicePreview.caseState)
      ) {
        setSubmissionStage('reviewing_transcript');
        const preview = await previewVoiceTranscript(text);
        setVoicePreview(preview);
        if (preview.status !== 'success' || !preview.caseState) {
          setError(preview.detail || 'The transcript could not be reviewed. You can edit it and try again.');
        }
        setIsSubmitting(false);
        setSubmissionStage('idle');
        return;
      }

      if (!targetCaseId) {
        setSubmissionStage('creating_case');
        const caseData = await createCase({
          initialStatement: text,
          title: null,
          language: inputMethod === 'voice' ? voicePreview?.language ?? null : language.toLowerCase(),
          personName: null,
          inputMethod,
        });

        if (!caseData?.id) throw new Error('Invalid response from server.');

        targetCaseId = caseData.id;
        setCreatedCaseId(targetCaseId);
        setCreatedCaseState(caseData);
        rememberSessionCase(targetCaseId);
      }

      if (selectedFile && uploadedFile !== selectedFile) {
        setSubmissionStage('uploading_document');
        await uploadEvidence(targetCaseId, selectedFile, () => undefined);
        setUploadedFile(selectedFile);
      }
      setSubmissionStage('preparing_review');
      const latestCase = await getCase(targetCaseId);
      setCreatedCaseState(latestCase);
      readbackFocusPendingRef.current = true;
      setIntakeReview(latestCase);
      setIsSubmitting(false);
      setSubmissionStage('idle');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'The request failed.';
      setError(
        targetCaseId
          ? selectedFile && uploadedFile !== selectedFile
            ? `Your case is saved, but the document upload or review could not finish. ${message} Try again to continue.`
            : `Your case is saved, but the review could not be prepared. ${message} Try again to continue.`
          : `Failed to create your case. ${message}`,
      );
      setIsSubmitting(false);
      setSubmissionStage('idle');
    }
  };

  const chooseExample = (statement: string) => {
    setText(statement);
    setMode('text');
    setVoicePreview(null);
    setError(null);
    scrollToSection('your-story', true);
  };

  const handleStageKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | undefined;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % pathway.length;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index - 1 + pathway.length) % pathway.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = pathway.length - 1;
    if (nextIndex !== undefined) {
      event.preventDefault();
      setActiveStage(nextIndex);
      stageTabRefs.current[nextIndex]?.focus();
    }
  };

  const handleModeKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | undefined;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % entryModes.length;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index - 1 + entryModes.length) % entryModes.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = entryModes.length - 1;
    if (nextIndex !== undefined) {
      event.preventDefault();
      setMode(entryModes[nextIndex].id);
      modeTabRefs.current[nextIndex]?.focus();
    }
  };

  const submitLabel = isSubmitting
    ? 'Working on your case…'
    : createdCaseId
      ? selectedFile && uploadedFile !== selectedFile ? 'Retry upload and review' : 'Continue to review'
      : inputMethod === 'voice'
        ? voicePreview && voicePreview.transcript === text && voicePreview.status === 'success' && voicePreview.caseState
          ? 'Create my case'
          : 'Review spoken statement'
        : 'Continue with this statement';

  return (
    <div className={'page'} id="top">
      <div className={'ambient'} aria-hidden="true">
        <div className={'ambientGlow'} />
        <div className={'ambientGrid'} />
      </div>

      <header className={'header'}>
        <a className={'brand'} href="#top" aria-label="LawSense home">
          <span className={'brandIcon'}><BrandMark /></span>
          <span className={'brandWord'}>Law<span>Sense</span></span>
        </a>
        <nav className={'headerNav'} aria-label="Main navigation">
          <a href="#pathway">How it works</a>
          <a href="#examples">Examples</a>
          <a className={'headerCta'} href="#your-story">Begin your story <ArrowUpRight aria-hidden="true" size={14} /></a>
        </nav>
      </header>

      <main>
        <section className={'hero'} aria-labelledby="hero-title">
          <div className={'heroCopy'}>
            <div className={`${'eyebrow'} ${'revealOne'}`}><span className={'eyebrowRule'} /> LEGAL CLARITY, IN CONTEXT</div>
            <h1 id="hero-title" className={`${'heroTitle'} ${'revealTwo'}`}>
              Tell us what<br className={'desktopBreak'} /> happened<span className={'titlePeriod'}>.</span>
            </h1>
            <p className={`${'heroLead'} ${'revealThree'}`}>
              A thoughtful place to begin when something does not feel straightforward.
              Bring the facts as you know them; we will help put the pieces in order.
            </p>
            <div className={`${'heroActions'} ${'revealFour'}`}>
              <a className={'primaryLink'} href="#your-story">Start with your story <ArrowDownRight aria-hidden="true" size={16} /></a>
              <span className={'actionNote'}>No legal terms required</span>
            </div>
            <div className={`${'heroAssurances'} ${'revealFour'}`} aria-label="How LawSense helps">
              <span><ShieldCheck aria-hidden="true" size={15} /> Facts first</span>
              <span className={'assuranceDivider'} aria-hidden="true" />
              <span><FileCheck2 aria-hidden="true" size={15} /> Sources where available</span>
            </div>
          </div>
          <div className={`${'heroVisual'} ${'revealThree'}`}>
            <NetworkArtwork />
          </div>
          <a className={'scrollCue'} href="#your-story"><span /> SCROLL TO BEGIN</a>
        </section>

        <section className={'workspaceSection'} id="your-story" aria-labelledby={intakeReview ? 'intake-review-heading' : 'story-heading'}>
          <SessionCaseChooser activeCaseId={createdCaseId} activeCaseData={createdCaseState} />
          {intakeReview && (
            <CaseIntakeReview
              caseState={intakeReview}
              onCaseUpdate={setIntakeReview}
              onContinue={() => {
                window.sessionStorage.setItem('lawsense:focus-clarification-case', intakeReview.id);
                router.push(`/case/${intakeReview.id}`);
              }}
            />
          )}
          <div hidden={Boolean(intakeReview)}>
          <div className={'sectionHeading'}>
            <div>
              <p className={'sectionEyebrow'}>01 / YOUR STORY</p>
              <h2 id="story-heading">Tell me what happened.</h2>
            </div>
            <p className={'sectionNote'}>You can type it, speak it, or show me a document. Start with whatever feels easiest.</p>
          </div>

          {!intakeReview && <div className="mb-4"><TrustNotice variant="dark" /></div>}

          <form className={'storyCard'} onSubmit={handleSubmit}>
            <div className={'cardTopline'}>
              <div className={'cardTopIdentity'}><span className={'cardSignal'} /> A PLACE TO BEGIN</div>
              <span className={'cardStep'}>A clear first step <span>01</span></span>
            </div>

            <div className={'modeBar'} role="radiogroup" aria-label="Choose how to begin">
              {entryModes.map((mode) => {
                const active = entryMode === mode.id;
                return (
                  <button
                    className={`${'modeButton'} ${active ? 'modeButtonActive' : ''}`}
                    key={mode.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    tabIndex={active ? 0 : -1}
                    ref={(element) => { modeTabRefs.current[entryModes.findIndex((entry) => entry.id === mode.id)] = element; }}
                    onClick={() => setMode(mode.id)}
                    onKeyDown={(event) => handleModeKeyDown(event, entryModes.findIndex((entry) => entry.id === mode.id))}
                  >
                    <span className={'modeGlyph'} aria-hidden="true">
                      {mode.id === 'text' ? <FileText size={16} /> : mode.id === 'voice' ? <Mic2 size={16} /> : <Paperclip size={16} />}
                    </span>
                    <span className={'modeText'}><strong>{mode.title}</strong><small>{mode.description}</small></span>
                    <ArrowRight aria-hidden="true" className={'modeArrow'} size={15} />
                  </button>
                );
              })}
            </div>

            <div className={'inputBody'}>
              <div key={entryMode} className={'modeIntro'} aria-live="polite">
                <div>
                    <h3>{entryMode === 'voice' ? 'Say it in your own words.' : entryMode === 'upload' ? 'Give the document a little context.' : 'I’m listening.'}</h3>
                  <p>
                    {entryMode === 'voice'
                      ? 'Start speaking when you are ready. You can review and edit the transcript before anything is saved.'
                      : entryMode === 'upload'
                        ? 'Add a short account below, then attach a document if it helps explain the situation.'
                        : 'A few sentences is a good start. You do not need to know what the law calls it.'}
                  </p>
                </div>
                <GuidePresence
                  state={isSubmitting || voiceCaptureStatus === 'processing' ? 'THINKING' : voiceCaptureStatus === 'listening' ? 'LISTENING' : entryMode === 'voice' && Boolean(text.trim()) ? 'CLARIFYING' : 'IDLE'}
                  size="compact"
                  detail={isSubmitting
                    ? submissionStage === 'reviewing_transcript'
                      ? 'Reviewing the voice transcript before it is saved.'
                      : submissionStage === 'creating_case'
                        ? 'Saving the first case record.'
                        : submissionStage === 'uploading_document'
                          ? 'Adding the selected document to your case.'
                          : 'Preparing your first case readback.'
                    : voiceCaptureStatus === 'listening'
                      ? 'Listening to your account.'
                      : voiceCaptureStatus === 'processing'
                        ? 'Processing the voice capture before transcript review.'
                        : entryMode === 'voice' && Boolean(text.trim())
                          ? 'Your transcript draft is ready for review.'
                          : 'I’ll keep your account, supporting documents and open questions distinct.'}
                  className="homeGuidePresence"
                />
              </div>

              {entryMode === 'voice' && (
                <div className={'voiceArea'}>
                  <div className={'voicePrompt'}><AudioLines aria-hidden="true" size={20} /><span>Voice input</span><i /></div>
                  <VoiceCapture
                    language={language}
                    disabled={isSubmitting || !!createdCaseId}
                    onTranscript={(spoken) => {
                      setText((current) => [current.trim(), spoken.trim()].filter(Boolean).join(' '));
                      setVoicePreview(null);
                      setInputMethod('voice');
                      setError(null);
                    }}
                    onCaptureStatusChange={setVoiceCaptureStatus}
                  />
                </div>
              )}

              {entryMode === 'upload' && (
                <div
                  className={`${'dropzone'} ${isDraggingFile ? 'dropzoneActive' : ''}`}
                  onDragEnter={(event) => { event.preventDefault(); setIsDraggingFile(true); }}
                  onDragOver={(event) => event.preventDefault()}
                  onDragLeave={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDraggingFile(false);
                  }}
                  onDrop={handleDrop}
                >
                  <div className={'uploadIcon'}><Paperclip aria-hidden="true" size={19} /></div>
                  <div className={'dropzoneText'}>
                    <strong>{selectedFile ? 'Document ready to add' : 'Add a supporting document'}</strong>
                    <span>{selectedFile ? selectedFile.name : 'PDF, JPG or PNG · up to 25 MiB'}</span>
                  </div>
                  <input
                    ref={fileInputRef}
                    className={'fileInput'}
                    id="law-sense-evidence"
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg"
                    onChange={handleFileSelect}
                    aria-label="Choose a PDF, JPG, or PNG document"
                    disabled={isSubmitting}
                  />
                  <label className={'uploadButton'} htmlFor="law-sense-evidence">
                    {selectedFile ? 'Replace file' : 'Choose file'} <ArrowUpRight aria-hidden="true" size={14} />
                  </label>
                </div>
              )}

              <label className={'statementLabel'} htmlFor="case-statement">
                {entryMode === 'voice' ? 'Your transcript' : entryMode === 'upload' ? 'A few words about what happened' : 'Your account'}
                <span>{entryMode === 'voice' ? 'Review before saving' : 'Just start with what you know'}</span>
              </label>
              <textarea
                ref={statementRef}
                id="case-statement"
                className={'statementInput'}
                value={text}
                onChange={(event) => {
                  setText(event.target.value);
                  setVoicePreview(null);
                  setError(null);
                }}
                placeholder={entryMode === 'upload'
                  ? 'For example, when you received it and what you are unsure about…'
                  : 'Start anywhere. What happened, and what would you like to understand?'}
                aria-describedby="statement-hint storage-hint"
                disabled={isSubmitting || !!createdCaseId}
              />
              <div className={'inputMeta'}>
                <div className="inputHints">
                  <p id="statement-hint">You can review and edit your account or transcript before saving.</p>
                  <p id="storage-hint">This demo stores case text and uploaded files on its server. Use synthetic details only.</p>
                </div>
                <label className={'languageLabel'} htmlFor="statement-language">
                  LANGUAGE
                  <select
                    id="statement-language"
                    value={language}
                    onChange={(event) => setLanguage(event.target.value as RecognitionLanguage)}
                    disabled={isSubmitting}
                  >
                    <option value="English">English</option>
                    <option value="Hindi">Hindi</option>
                    <option value="Hinglish">Hinglish</option>
                  </select>
                </label>
              </div>

              {entryMode !== 'upload' && (
                <div className={'attachmentRow'}>
                  <input
                    ref={fileInputRef}
                    className={'fileInput'}
                    id="law-sense-evidence"
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg"
                    onChange={handleFileSelect}
                    aria-label="Choose a PDF, JPG, or PNG document"
                    disabled={isSubmitting}
                  />
                  <label className={'attachmentButton'} htmlFor="law-sense-evidence">
                    <Paperclip aria-hidden="true" size={14} /> {selectedFile ? 'Replace document' : 'Add a document'}
                  </label>
                  <span>Optional · PDF, JPG or PNG</span>
                </div>
              )}

              {selectedFile && (
                <div className={'fileCard'}>
                  <span className={'fileType'}><FileText aria-hidden="true" size={17} /></span>
                  <span className={'fileDetails'}><strong>{selectedFile.name}</strong><small>{formatFileSize(selectedFile.size)} · {selectedFile.type.split('/')[1]?.toUpperCase() || 'FILE'}</small></span>
                  <span className={'fileQueued'}>READY TO ADD</span>
                  <button className={'removeFile'} type="button" aria-label={`Remove ${selectedFile.name}`} onClick={removeFile} disabled={isSubmitting}>
                    <X aria-hidden="true" size={16} />
                  </button>
                </div>
              )}

              {voicePreview && voicePreview.transcript === text && voicePreview.status === 'success' && voicePreview.caseState && (
                <section className={'transcriptReview'} aria-live="polite" aria-label="Voice transcript review">
                  <div className={'reviewHeader'}>
                    <div><span className={'reviewDot'} /><strong>Transcript reviewed</strong></div>
                    <span>Language · {voicePreview.language ? `${voicePreview.language[0].toUpperCase()}${voicePreview.language.slice(1)}` : 'Not detected'}</span>
                  </div>
                  <p>Check the draft details below before creating your case.</p>
                  {voicePreview.caseState.facts.length > 0 && (
                    <ul className={'reviewFacts'}>
                      {voicePreview.caseState.facts.slice(0, 4).map((fact) => (
                        <li key={fact.id}><strong>{fact.key.replaceAll('_', ' ')}:</strong> {String(fact.value)}</li>
                      ))}
                    </ul>
                  )}
                  {voicePreview.caseState.unknowns.length > 0 && (
                    <div className={'reviewUnknowns'}>
                      <strong>Needs clarification</strong>
                      <ul>{voicePreview.caseState.unknowns.slice(0, 4).map((question) => <li key={question}>{question}</li>)}</ul>
                    </div>
                  )}
                </section>
              )}

              {error && <p className={'errorMessage'} role="alert">{error}</p>}
              {createdCaseId && (
                <p className={'caseCreated'} role="status">
                  Your case is saved. Continue here to review what I understood before opening your case.
                </p>
              )}
            </div>

            <div className={'formFooter'}>
              <div className={'footerTrust'}><ShieldCheck aria-hidden="true" size={16} /><span>You choose what to share. Review before saving.</span></div>
              <button className={'submitButton'} type="submit" disabled={isSubmitting}>
                {isSubmitting ? <LoaderCircle aria-hidden="true" className={'spinner'} size={16} /> : null}
                {submitLabel}
                {!isSubmitting && <ArrowUpRight aria-hidden="true" size={16} />}
              </button>
            </div>
          </form>
          <p className={'afterFormNote'}>A document can support your account. Include a short description so your case has context.</p>
          </div>
        </section>

        <section className={'pathwaySection'} id="pathway" aria-labelledby="pathway-title">
          <div className={'sectionHeading'}>
            <div>
              <p className={'sectionEyebrow'}>02 / THE PATH AHEAD</p>
              <h2 id="pathway-title">From a story to a next step.</h2>
            </div>
            <p className={'sectionNote'}>A connected view of the things that shape a legal situation.</p>
          </div>
          <div className={'pathwayCard'}>
            <div className={'pathwayIntro'}>
              <span className={'pathwayOverline'}><span /> THE LAW SENSE PATHWAY</span>
              <p>Tap a point to see what it helps bring into focus.</p>
            </div>
            <div className={'pathTrack'} role="tablist" aria-label="Steps in the LawSense pathway" aria-orientation="horizontal">
              {pathway.map((stage, index) => (
                <button
                  className={`${'pathTab'} ${activeStage === index ? 'pathTabActive' : ''}`}
                  key={stage.name}
                  type="button"
                  role="tab"
                  id={`pathway-tab-${index}`}
                  aria-selected={activeStage === index}
                  aria-controls="pathway-panel"
                  tabIndex={activeStage === index ? 0 : -1}
                  ref={(element) => { stageTabRefs.current[index] = element; }}
                  onClick={() => setActiveStage(index)}
                  onFocus={() => setActiveStage(index)}
                  onKeyDown={(event) => handleStageKeyDown(event, index)}
                >
                  <span className={'pathNode'}><span /></span>
                  <span className={'pathNumber'}>0{index + 1}</span>
                  <strong>{stage.name}</strong>
                  <small>{stage.short}</small>
                </button>
              ))}
            </div>
            <div className={'pathPanel'} role="tabpanel" id="pathway-panel" aria-labelledby={`pathway-tab-${activeStage}`}>
              <span className={'panelIndex'}>0{activeStage + 1}</span>
              <div><strong>{pathway[activeStage].name}</strong><p>{pathway[activeStage].detail}</p></div>
              <span className={'panelProgress'}>{String(activeStage + 1).padStart(2, '0')} <i /> 05</span>
            </div>
          </div>
          <p className={'pathwayFootnote'}>This is a guide to the experience ahead. The information shown for your case depends on what you share and the sources available.</p>
        </section>

        <section className={'examplesSection'} id="examples" aria-labelledby="examples-title">
          <div className={'sectionHeading'}>
            <div>
              <p className={'sectionEyebrow'}>03 / A PLACE TO START</p>
              <h2 id="examples-title">A few familiar beginnings.</h2>
            </div>
            <p className={'sectionNote'}>These examples are fictional. Choose one to edit it into your own words.</p>
          </div>
          <div className={'exampleGrid'}>
            {examples.map((example) => (
              <article className={'exampleCard'} key={example.title}>
                <div className={'exampleTop'}><span>{example.category}</span><span className={'exampleIndex'}>{example.icon}</span></div>
                <h3>{example.title}</h3>
                <p>“{example.statement}”</p>
                <button type="button" onClick={() => chooseExample(example.statement)}>
                  Begin with this <ArrowUpRight aria-hidden="true" size={15} />
                </button>
              </article>
            ))}
          </div>
        </section>

        <section className={'trustSection'} aria-labelledby="trust-title">
          <div className={'trustHeading'}>
            <span className={'trustIcon'}><ShieldCheck aria-hidden="true" size={18} /></span>
            <div><p className={'sectionEyebrow'}>A NOTE ON TRUST</p><h2 id="trust-title">Clear about what this is.</h2></div>
          </div>
          <p className={'trustLead'}>LawSense helps organize information and show available sources. It is not a lawyer and does not provide individualized legal advice.</p>
        </section>
      </main>

      <footer className={'footer'}>
        <a className={'footerBrand'} href="#top"><BrandMark /> LawSense</a>
        <span>Thoughtful first steps. Clearer context.</span>
        <a href="#your-story">Begin again <ArrowRight aria-hidden="true" size={13} /></a>
      </footer>
    </div>
  );
}
