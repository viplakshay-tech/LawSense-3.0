'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, Shield, Lock, FileText, X, Loader2 } from 'lucide-react';
import { createCase, previewVoiceTranscript, uploadEvidence, type VoiceTranscriptResponse } from '@/lib/api';
import VoiceCapture, { type RecognitionLanguage } from '@/components/voice/VoiceCapture';
import { TrustNotice } from '@/components/TrustNotice';

export default function Home() {
  const router = useRouter();
  const [text, setText] = useState('');
  const [language, setLanguage] = useState('English');
  const [inputMethod, setInputMethod] = useState<'text' | 'voice'>('text');
  const [voicePreview, setVoicePreview] = useState<VoiceTranscriptResponse | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdCaseId, setCreatedCaseId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const supportedExtension = /\.(pdf|jpg|jpeg|png)$/i.test(file.name);

      if (file.size > 25 * 1024 * 1024) {
        setError('File size must be 25 MiB or less.');
        return;
      }

      if (!supportedExtension) {
        setError('Unsupported file type. Please upload a PDF, JPG, or PNG.');
        return;
      }
      
      setSelectedFile(file);
      setError(null);
    }
  };

  const removeFile = () => {
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!createdCaseId && !text.trim()) {
      setError('Please describe your situation.');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    let targetCaseId = createdCaseId;

    try {
      if (
        !targetCaseId &&
        inputMethod === 'voice' &&
        (!voicePreview || voicePreview.transcript !== text || voicePreview.status !== 'success' || !voicePreview.caseState)
      ) {
        const preview = await previewVoiceTranscript(text);
        setVoicePreview(preview);
        if (preview.status !== 'success' || !preview.caseState) {
          setError(preview.detail || 'The transcript could not be reviewed. You can edit it and try again.');
        }
        setIsSubmitting(false);
        return;
      }

      if (!targetCaseId) {
        const caseData = await createCase({
          initialStatement: text,
          title: null,
          language: inputMethod === 'voice' ? voicePreview?.language ?? null : language.toLowerCase(),
          personName: null,
          inputMethod,
        });

        if (!caseData?.id) {
          throw new Error('Invalid response from server.');
        }

        targetCaseId = caseData.id;
        setCreatedCaseId(targetCaseId);
      }

      if (selectedFile) {
        await uploadEvidence(targetCaseId, selectedFile, () => undefined);
      }

      router.push(`/case/${targetCaseId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'The request failed.';
      setError(
        targetCaseId
          ? `Your case was created, but the document could not be uploaded. ${message} Retry the upload or open your case below.`
          : `Failed to create your case. ${message}`,
      );
      setIsSubmitting(false);
    }
  };
  return (
    <div className="min-h-screen bg-[#fafafa] dark:bg-[#0a0a0a] text-zinc-900 dark:text-zinc-50 font-sans selection:bg-zinc-200 dark:selection:bg-zinc-800">
      <main className="max-w-4xl mx-auto px-6 py-20 flex flex-col items-center">
        
        {/* Header */}
        <div className="text-center mb-12 space-y-4">
          <h1 className="text-4xl md:text-5xl font-semibold tracking-tight text-zinc-900 dark:text-white">
            Tell us what happened.
          </h1>
          <p className="text-lg text-zinc-500 dark:text-zinc-400 max-w-xl mx-auto leading-relaxed">
            You don&apos;t need to know the legal terminology. Just explain the situation in your own words.
          </p>
        </div>

        <div className="mb-6 w-full max-w-3xl">
          <TrustNotice />
        </div>

        {/* Main Input Card */}
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full bg-white dark:bg-[#111] border border-zinc-200 dark:border-zinc-800/80 shadow-sm rounded-3xl overflow-hidden"
        >
          <form onSubmit={handleSubmit}>
            <div className="p-6 md:p-8">
              <textarea
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  if (inputMethod === 'voice') setVoicePreview(null);
                }}
                placeholder="Mere landlord ne ₹30,000 security deposit return nahi kiya. Agreement bhi hai..."
                className="w-full min-h-[160px] text-xl md:text-2xl bg-transparent resize-none outline-none placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:ring-0 p-0"
                disabled={isSubmitting || !!createdCaseId}
              />
              {inputMethod === 'voice' && (
                <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                  Voice transcript ready. Review or edit it here; language and extracted details are checked before saving.
                </p>
              )}
              {inputMethod === 'voice' && voicePreview && voicePreview.transcript === text && voicePreview.status === 'success' && voicePreview.caseState && (
                <section aria-live="polite" className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 dark:border-emerald-900/70 dark:bg-emerald-950/20">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-sm font-semibold">Review extracted details</h2>
                    <span className="rounded-full bg-white px-3 py-1 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                      Language · {voicePreview.language ? `${voicePreview.language[0].toUpperCase()}${voicePreview.language.slice(1)}` : 'Not detected'}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-300">
                    These draft details are based on the transcript above. Saving updates your case clarification and journey.
                  </p>
                  {voicePreview.caseState.facts.length > 0 && (
                    <ul className="mt-3 space-y-1.5 text-sm">
                      {voicePreview.caseState.facts.slice(0, 4).map((fact) => (
                        <li key={fact.id} className="rounded-lg bg-white/80 px-3 py-2 dark:bg-zinc-900/80">
                          <span className="font-medium">{fact.key.replaceAll('_', ' ')}:</span> {String(fact.value)}
                        </li>
                      ))}
                    </ul>
                  )}
                  {voicePreview.caseState.unknowns.length > 0 && (
                    <div className="mt-3">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Needs clarification</h3>
                      <ul className="mt-1 list-inside list-disc space-y-1 text-sm text-zinc-700 dark:text-zinc-300">
                        {voicePreview.caseState.unknowns.slice(0, 4).map((question) => <li key={question}>{question}</li>)}
                      </ul>
                    </div>
                  )}
                </section>
              )}

              <AnimatePresence>
                {selectedFile && (
                  <motion.div
                    initial={{ opacity: 0, height: 0, marginTop: 0 }}
                    animate={{ opacity: 1, height: 'auto', marginTop: 16 }}
                    exit={{ opacity: 0, height: 0, marginTop: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="flex items-center justify-between p-4 bg-zinc-50 dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800">
                      <div className="flex items-center space-x-4 overflow-hidden">
                        <div className="h-10 w-10 shrink-0 bg-white dark:bg-zinc-800 rounded-xl flex items-center justify-center border border-zinc-200 dark:border-zinc-700">
                          <FileText className="w-5 h-5 text-zinc-500 dark:text-zinc-400" />
                        </div>
                        <div className="truncate">
                          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                            {selectedFile.name}
                          </p>
                          <p className="text-xs text-zinc-500">
                            {(selectedFile.size / 1024 / 1024).toFixed(2)} MB • {selectedFile.type.split('/')[1]?.toUpperCase() || 'FILE'}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={removeFile}
                        className="p-2 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-full transition-colors"
                      >
                        <X className="w-4 h-4 text-zinc-500" />
                      </button>
                    </div>
                    <p className="text-xs text-zinc-500 mt-3 ml-2 flex items-center gap-1.5">
                      <Shield className="w-3.5 h-3.5" />
                      {createdCaseId
                        ? 'This document will upload to your created case when you continue.'
                        : 'This document will upload when you continue.'}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
              
              <AnimatePresence>
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="mt-4 p-4 text-sm text-red-600 bg-red-50 dark:bg-red-950/30 dark:text-red-400 rounded-xl"
                  >
                    {error}
                  </motion.div>
                )}
              </AnimatePresence>
              {createdCaseId && (
                <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
                  Your case is saved.{' '}
                  <button
                    type="button"
                    onClick={() => router.push(`/case/${createdCaseId}`)}
                    className="underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100"
                  >
                    Open it now
                  </button>
                  {selectedFile ? ' or retry the document upload.' : '.'}
                </p>
              )}
            </div>

            {/* Toolbar */}
            <div className="bg-zinc-50 dark:bg-[#151515] px-6 md:px-8 py-4 border-t border-zinc-100 dark:border-zinc-800/80 flex flex-col sm:flex-row items-center justify-between gap-4">
              
              <div className="flex items-center gap-3 w-full sm:w-auto overflow-x-auto pb-2 sm:pb-0 scrollbar-hide">
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="h-10 px-4 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-full text-sm font-medium hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors focus:outline-none appearance-none pr-8 relative cursor-pointer"
                  style={{
                    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='currentColor'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`,
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'right 12px center',
                    backgroundSize: '12px'
                  }}
                  disabled={isSubmitting}
                >
                  <option value="English">English</option>
                  <option value="Hindi">Hindi</option>
                  <option value="Hinglish">Hinglish</option>
                </select>

                <div className="h-6 w-px bg-zinc-200 dark:bg-zinc-800 shrink-0" />

                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileSelect}
                  className="hidden"
                  accept=".pdf,.png,.jpg,.jpeg"
                />
                
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="h-10 px-4 flex items-center justify-center gap-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-full text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors text-zinc-700 dark:text-zinc-300 shrink-0"
                  disabled={isSubmitting || !!selectedFile}
                >
                  <Upload className="w-4 h-4" />
                  <span className="hidden sm:inline">Upload</span>
                </button>

                <VoiceCapture
                  language={language as RecognitionLanguage}
                  disabled={isSubmitting || !!createdCaseId}
                  onTranscript={(spoken) => {
                    setText((current) => [current.trim(), spoken.trim()].filter(Boolean).join(' '));
                    setInputMethod('voice');
                    setVoicePreview(null);
                    setError(null);
                  }}
                />
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full sm:w-auto h-12 px-8 flex items-center justify-center gap-2 bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-900 rounded-full font-medium shadow-sm hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors disabled:opacity-70 disabled:cursor-not-allowed shrink-0"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  createdCaseId
                    ? (selectedFile ? 'Retry Upload & Open Case' : 'Open My Case')
                    : inputMethod === 'voice'
                      ? (voicePreview && voicePreview.transcript === text && voicePreview.status === 'success' && voicePreview.caseState
                        ? 'Save Reviewed Statement'
                        : 'Review Voice Transcript')
                      : 'Understand My Situation'
                )}
              </button>
            </div>
          </form>
        </motion.div>

        {/* Trust Indicators */}
        <div className="mt-16 flex flex-wrap justify-center gap-8 text-sm text-zinc-500 dark:text-zinc-500 font-medium">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4" />
            <span>Evidence-first</span>
          </div>
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4" />
            <span>Source links where available</span>
          </div>
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4" />
            <span>Server-side case storage</span>
          </div>
        </div>
      </main>
    </div>
  );
}
