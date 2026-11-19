/**
 * Split a Guide reply into sentence-aware pieces for progressive local TTS.
 * The caller owns sequencing and cancellation; this helper has no side effects.
 */
export function splitSpeechIntoChunks(text: string, maxChars = 420): string[] {
  if (!Number.isInteger(maxChars) || maxChars < 32) {
    throw new RangeError('maxChars must be an integer of at least 32.');
  }
  const normalized = text.trim();
  if (!normalized) return [];

  const sentences = normalized.match(/[^.!?।\n]+[.!?।]?/gu) ?? [normalized];
  const chunks: string[] = [];
  let current = '';

  const appendWords = (sentence: string) => {
    for (const word of sentence.split(/\s+/u)) {
      if (!word) continue;
      if (word.length > maxChars) {
        if (current) chunks.push(current);
        current = '';
        for (let offset = 0; offset < word.length; offset += maxChars) {
          chunks.push(word.slice(offset, offset + maxChars));
        }
        continue;
      }
      const candidate = current ? current + ' ' + word : word;
      if (candidate.length > maxChars) {
        if (current) chunks.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
  };

  for (const sentence of sentences) {
    const part = sentence.trim();
    if (!part) continue;
    const candidate = current ? current + ' ' + part : part;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      if (current) chunks.push(current);
      current = '';
      appendWords(part);
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
