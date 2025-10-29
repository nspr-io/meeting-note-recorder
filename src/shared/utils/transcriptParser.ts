export interface TranscriptSegment {
  time: string;
  speaker: string;
  text: string;
}

const DEVICE_PREFIXES = ['iphone', 'ipad', 'android', 'phone', 'mobile', 'macbook', 'mac', 'pc', 'windows'];
const LOWERCASE_PARTICLES = new Set(['de', 'da', 'del', 'della', 'di', 'van', 'von', 'der', 'den', 'la', 'le', 'du', 'of', 'the', 'and', 'or']);

const TIMESTAMP_REGEX = /^\s*[\[(]?\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*[\])]?[\s,;\-–—]*\s*(.*)$/i;

export function parseTranscript(rawTranscript: string | null | undefined): TranscriptSegment[] {
  if (!rawTranscript) {
    return [];
  }

  const segments: TranscriptSegment[] = [];
  const lines = rawTranscript.split(/\r?\n/);

  let currentSegment: TranscriptSegment | null = null;
  let lastSpeaker = '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const timestampMatch = trimmed.match(TIMESTAMP_REGEX);
    if (timestampMatch) {
      if (currentSegment && currentSegment.text.trim()) {
        segments.push(currentSegment);
      }

      const time = normalizeTime(timestampMatch[1]);
      const restOfLine = timestampMatch[2] || '';
      const speakerInfo = extractSpeaker(restOfLine, lastSpeaker);

      if (speakerInfo) {
        lastSpeaker = speakerInfo.speaker;
        currentSegment = {
          time,
          speaker: speakerInfo.speaker,
          text: speakerInfo.text
        };
      } else {
        currentSegment = {
          time,
          speaker: lastSpeaker || 'Speaker',
          text: restOfLine.trim()
        };
      }

      continue;
    }

    const speakerInfo = extractSpeaker(trimmed, lastSpeaker);
    if (speakerInfo) {
      if (currentSegment && currentSegment.text.trim()) {
        segments.push(currentSegment);
      }

      lastSpeaker = speakerInfo.speaker;
      currentSegment = {
        time: inferTime(segments.length),
        speaker: speakerInfo.speaker,
        text: speakerInfo.text
      };
      continue;
    }

    if (!currentSegment) {
      currentSegment = {
        time: inferTime(segments.length),
        speaker: lastSpeaker || 'Speaker',
        text: trimmed
      };
    } else {
      currentSegment.text = `${currentSegment.text} ${trimmed}`.trim();
    }
  }

  if (currentSegment && currentSegment.text.trim()) {
    segments.push(currentSegment);
  }

  const merged = mergeConsecutiveSegments(segments);

  return merged.map(segment => ({
    ...segment,
    speaker: finalizeSpeakerName(segment.speaker)
  }));
}

function mergeConsecutiveSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  const merged: TranscriptSegment[] = [];

  for (const segment of segments) {
    const last = merged[merged.length - 1];
    if (last && normalizeSpeakerKey(last.speaker) === normalizeSpeakerKey(segment.speaker)) {
      last.text = `${last.text} ${segment.text}`.trim();
    } else {
      merged.push({ ...segment, text: segment.text.trim() });
    }
  }

  return merged;
}

function normalizeSpeakerKey(value: string): string {
  return value.trim().toLowerCase();
}

function finalizeSpeakerName(speaker: string): string {
  let text = collapseWhitespace(speaker);

  if (!text) {
    return 'Speaker';
  }

  const deviceMatch = text.match(new RegExp(`^(${DEVICE_PREFIXES.join('|')})\\s*\\(([^)]+)\\)$`, 'i'));
  if (deviceMatch) {
    text = deviceMatch[2].trim();
  }

  if (/^\(.*\)$/.test(text)) {
    text = text.slice(1, -1).trim();
  }

  return titleCaseName(text);
}

function extractSpeaker(line: string, lastSpeaker: string): { speaker: string; text: string } | null {
  const colonIndex = line.indexOf(':');
  if (colonIndex === -1) {
    return null;
  }

  let candidateRaw = line.slice(0, colonIndex).trim();
  const remainder = line.slice(colonIndex + 1).trim();

  if (!candidateRaw || !remainder) {
    return null;
  }

  const deviceLabelMatch = candidateRaw.match(new RegExp(`^(${DEVICE_PREFIXES.join('|')})\\s*\\(([^)]+)\\)$`, 'i'));
  if (deviceLabelMatch) {
    candidateRaw = deviceLabelMatch[2].trim();
  }

  const normalized = normalizeSpeaker(candidateRaw, lastSpeaker);

  if (!normalized || !isLikelySpeakerCandidate(normalized)) {
    return null;
  }

  return {
    speaker: normalized,
    text: remainder
  };
}

function normalizeSpeaker(speaker: string, lastSpeaker: string): string {
  let text = speaker.trim();

  // Strip common role prefixes
  text = text.replace(/^\[?(host|co-host|participant|speaker)\]?\s*[:\-]?\s*/i, '').trim();

  // Handle device prefixes like "iPhone (janine)"
  const deviceMatch = text.match(new RegExp(`^(${DEVICE_PREFIXES.join('|')})\\s*\\(([^)]+)\\)$`, 'i'));
  if (deviceMatch) {
    text = deviceMatch[2].trim();
  }

  const deviceDashMatch = text.match(new RegExp(`^(${DEVICE_PREFIXES.join('|')})\\s*-\\s*(.+)$`, 'i'));
  if (deviceDashMatch) {
    text = deviceDashMatch[2].trim();
  }

  // Drop surrounding parentheses
  if (/^\(.*\)$/.test(text)) {
    text = text.slice(1, -1).trim();
  }

  text = collapseWhitespace(text);

  if (!text && lastSpeaker) {
    return lastSpeaker;
  }

  const deviceFallback = text.match(new RegExp(`^(${DEVICE_PREFIXES.join('|')})\\s*\\(([^)]+)\\)$`, 'i'));
  if (deviceFallback) {
    text = deviceFallback[2].trim();
  }

  return titleCaseName(text);
}

function titleCaseName(name: string): string {
  return name
    .split(/(\s+)/)
    .map(token => {
      if (/^\s+$/.test(token)) {
        return token;
      }

      const lower = token.toLowerCase();
      if (LOWERCASE_PARTICLES.has(lower)) {
        return lower;
      }

      if (/^[A-Z0-9]+$/.test(token)) {
        return token;
      }

      if (/^[A-Z]/.test(token) && token.slice(1) === token.slice(1).toLowerCase()) {
        return token;
      }

      return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
    })
    .join('')
    .trim();
}

function isLikelySpeakerCandidate(name: string): boolean {
  if (!name) {
    return false;
  }

  if (name.length > 120) {
    return false;
  }

  if (!/[A-Za-zÀ-ÖØ-öø-ÿ]/.test(name)) {
    return false;
  }

  const tokens = name.split(/\s+/).filter(Boolean);
  if (!tokens.length || tokens.length > 8) {
    return false;
  }

  let strongTokens = 0;

  for (const token of tokens) {
    if (/^[A-ZÀ-ÖØ-Þ][a-zÀ-ÖØ-öø-ÿ'’.-]*$/.test(token)) {
      strongTokens += 1;
      continue;
    }

    if (/^[A-Z0-9]+$/.test(token)) {
      strongTokens += 1;
      continue;
    }

    if (LOWERCASE_PARTICLES.has(token.toLowerCase())) {
      continue;
    }

    if (/^(Jr\.?|Sr\.?|II|III|IV)$/i.test(token)) {
      strongTokens += 1;
      continue;
    }

    if (/^[-–—]$/.test(token)) {
      continue;
    }

    if (/^\(.*\)$/.test(token)) {
      strongTokens += 1;
      continue;
    }

    return false;
  }

  return strongTokens > 0;
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeTime(value: string): string {
  const parts = value.split(':').map(part => part.padStart(2, '0'));
  if (parts.length === 2) {
    return `${parts[0]}:${parts[1]}:00`;
  }
  if (parts.length === 3) {
    return `${parts[0]}:${parts[1]}:${parts[2]}`;
  }
  return value;
}

function inferTime(index: number): string {
  const minutes = Math.floor(index / 2);
  const seconds = (index % 2) * 30;
  return `00:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
