import { Meeting, Attendee } from '../../shared/types';
import { createServiceLogger } from './ServiceLogger';
import { ApiError, AuthenticationError, NetworkError, ServiceError } from './ServiceError';
import path from 'path';

const logger = createServiceLogger('FirefliesTranscriptService');

interface FirefliesTranscriptSentence {
  index: number;
  speaker_name?: string | null;
  text?: string | null;
  start_time?: string | number | null;
}

interface FirefliesTranscriptSummary {
  id: string;
  title?: string | null;
  date?: number | null;
  meeting_link?: string | null;
  calendar_id?: string | null;
  participants?: string[] | null;
  sentences?: FirefliesTranscriptSentence[] | null;
}

interface FetchResult {
  transcript: string;
  transcriptId: string;
}

interface FirefliesSearchAttempt {
  label: string;
  variables: Record<string, unknown>;
}

const GRAPHQL_ENDPOINT = 'https://api.fireflies.ai/graphql';

export class FirefliesTranscriptService {
  private apiKey?: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey;
  }

  setApiKey(apiKey?: string): void {
    this.apiKey = apiKey;
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  async fetchTranscriptForMeeting(meeting: Meeting): Promise<FetchResult> {
    logger.methodEntry('fetchTranscriptForMeeting', {
      meetingId: meeting.id,
      meetingTitle: meeting.title,
      calendarEventId: meeting.calendarEventId,
      hasAttendees: Array.isArray(meeting.attendees) && meeting.attendees.length > 0,
      meetingUrl: meeting.meetingUrl
    });

    if (!this.isConfigured()) {
      logger.warn('Attempted to fetch transcript without Fireflies API key', { meetingId: meeting.id });
      throw new AuthenticationError('Fireflies API key not configured');
    }

    try {
      const candidateTranscripts = await this.searchCandidateTranscripts(meeting);

      if (!candidateTranscripts.length) {
        logger.info('No candidate Fireflies transcripts returned for meeting', { meetingId: meeting.id });
        throw new ServiceError(
          'No Fireflies transcripts were returned for the search window',
          'FIREFLIES_NO_CANDIDATES',
          {
            context: this.buildSearchContext(meeting),
            isRetryable: false
          }
        );
      }

      const bestMatch = this.selectBestTranscript(candidateTranscripts, meeting);
      if (!bestMatch) {
        logger.info('No Fireflies transcript met match threshold', { meetingId: meeting.id });
        throw new ServiceError(
          'Fireflies transcripts were found but none passed the confidence threshold',
          'FIREFLIES_LOW_SCORE',
          {
            context: this.buildSearchContext(meeting),
            isRetryable: false
          }
        );
      }

      const formattedTranscript = this.formatSentences(bestMatch.sentences || []);
      if (!formattedTranscript.trim()) {
        logger.warn('Matched Fireflies transcript had no usable sentences', {
          meetingId: meeting.id,
          transcriptId: bestMatch.id
        });
        throw new ServiceError(
          'Matched Fireflies transcript contained no usable content',
          'FIREFLIES_EMPTY_TRANSCRIPT',
          {
            context: {
              meetingId: meeting.id,
              transcriptId: bestMatch.id
            },
            isRetryable: false
          }
        );
      }

      const result = {
        transcript: formattedTranscript,
        transcriptId: bestMatch.id
      };

      logger.methodExit('fetchTranscriptForMeeting', {
        meetingId: meeting.id,
        transcriptId: bestMatch.id,
        transcriptLength: formattedTranscript.length
      });

      return result;
    } catch (error) {
      const serviceError = error instanceof ServiceError
        ? error
        : new ServiceError(
            error instanceof Error ? error.message : 'Unknown Fireflies error',
            'FIREFLIES_UNKNOWN',
            { cause: error instanceof Error ? error : undefined }
          );

      logger.error('Failed to fetch Fireflies transcript', {
        meetingId: meeting.id,
        code: serviceError.code,
        message: serviceError.message,
        isRetryable: serviceError.isRetryable,
        context: serviceError.context
      });

      throw serviceError;
    }
  }

  private async searchCandidateTranscripts(meeting: Meeting): Promise<FirefliesTranscriptSummary[]> {
    const meetingDate = this.resolveMeetingDate(meeting);
    const attendeeEmails = this.extractAttendeeEmails(meeting);
    const attempts = this.buildSearchAttempts(meeting, meetingDate, attendeeEmails);

    const query = `
      query FirefliesTranscripts($fromDate: DateTime, $toDate: DateTime, $participants: [String!], $keyword: String, $limit: Int) {
        transcripts(fromDate: $fromDate, toDate: $toDate, participants: $participants, keyword: $keyword, limit: $limit) {
          id
          title
          date
          meeting_link
          calendar_id
          participants
          sentences {
            index
            speaker_name
            text
            start_time
          }
        }
      }
    `;

    const aggregated = new Map<string, FirefliesTranscriptSummary>();
    let successfulAttempt: string | null = null;

    for (const attempt of attempts) {
      const attemptVariables = { ...attempt.variables } as Record<string, unknown>;
      const participantsValue = (attemptVariables as Record<string, unknown>).participants;
      const keywordValue = (attemptVariables as Record<string, unknown>).keyword;

      logger.debug('Searching Fireflies transcripts', {
        meetingId: meeting.id,
        attempt: attempt.label,
        query: {
          fromDate: attemptVariables.fromDate,
          toDate: attemptVariables.toDate,
          limit: attemptVariables.limit,
          participantsCount: Array.isArray(participantsValue) ? participantsValue.length : 0,
          hasKeyword: typeof keywordValue === 'string' && keywordValue.trim().length > 0
        }
      });

      const response = await this.executeGraphQL<{ transcripts: FirefliesTranscriptSummary[] | null }>(query, attemptVariables);
      const transcripts = response?.transcripts ?? [];

      logger.info('Fireflies returned transcript candidates', {
        meetingId: meeting.id,
        attempt: attempt.label,
        candidateCount: transcripts.length
      });

      transcripts.forEach((transcript) => {
        if (!aggregated.has(transcript.id)) {
          aggregated.set(transcript.id, transcript);
        }
      });

      if (aggregated.size > 0) {
        successfulAttempt = attempt.label;
        break;
      }
    }

    const results = Array.from(aggregated.values());

    if (!results.length) {
      logger.info('No candidate Fireflies transcripts returned for meeting', {
        meetingId: meeting.id,
        attemptsTried: attempts.map((attempt) => attempt.label)
      });
    } else {
      logger.info('Fireflies candidate search completed', {
        meetingId: meeting.id,
        candidateCount: results.length,
        attempt: successfulAttempt ?? attempts[attempts.length - 1]?.label
      });
    }

    return results;
  }

  private buildSearchAttempts(meeting: Meeting, meetingDate: Date, attendeeEmails: string[]): FirefliesSearchAttempt[] {
    const fromDate = new Date(meetingDate.getTime() - 2 * 60 * 60 * 1000);
    const toDate = new Date(meetingDate.getTime() + 6 * 60 * 60 * 1000);

    const baseWindow = {
      fromDate: fromDate.toISOString(),
      toDate: toDate.toISOString()
    };

    const participants = attendeeEmails.length ? attendeeEmails : undefined;
    const keywordCandidates = this.buildKeywordCandidates(meeting);
    const attempts: FirefliesSearchAttempt[] = [];

    keywordCandidates.forEach((keyword, index) => {
      const variables: Record<string, unknown> = {
        ...baseWindow,
        limit: 20,
        keyword
      };

      if (participants) {
        variables.participants = participants;
      }

      attempts.push({
        label: `keyword-${index + 1}`,
        variables
      });
    });

    const fallbackVariables: Record<string, unknown> = {
      ...baseWindow,
      limit: participants ? 30 : 50
    };

    if (participants) {
      fallbackVariables.participants = participants;
    }

    attempts.push({
      label: 'fallback-no-keyword',
      variables: fallbackVariables
    });

    return attempts;
  }

  private buildKeywordCandidates(meeting: Meeting): string[] {
    const candidates = new Set<string>();

    const addCandidate = (value?: string | null) => {
      if (!value) {
        return;
      }
      const normalized = value.trim().replace(/\s+/g, ' ');
      if (!normalized) {
        return;
      }
      candidates.add(normalized.length > 255 ? normalized.substring(0, 255) : normalized);
    };

    addCandidate(meeting.title);

    if (meeting.filePath) {
      const baseName = path.basename(meeting.filePath, path.extname(meeting.filePath));
      let cleaned = baseName.replace(/^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-/, '');
      cleaned = cleaned.replace(/^\[[^\]]+\]-/, '');
      cleaned = cleaned.replace(/[-_]+/g, ' ').trim();
      addCandidate(cleaned);
    }

    return Array.from(candidates);
  }

  private selectBestTranscript(candidates: FirefliesTranscriptSummary[], meeting: Meeting): FirefliesTranscriptSummary | null {
    const meetingDate = this.resolveMeetingDate(meeting);
    const meetingUrl = meeting.meetingUrl?.trim().toLowerCase();
    const calendarId = meeting.calendarEventId?.trim();
    const attendeeEmails = new Set(this.extractAttendeeEmails(meeting).map((email) => email.toLowerCase()));
    const normalizedTitle = this.normalizeTitle(meeting.title);

    let bestScore = 0;
    let bestCandidate: FirefliesTranscriptSummary | null = null;
    const evaluations: Array<Record<string, unknown>> = [];

    for (const candidate of candidates) {
      let score = 0;

      const evaluation: Record<string, unknown> = {
        transcriptId: candidate.id,
        calendarId: candidate.calendar_id,
        meetingLink: candidate.meeting_link,
        hasSentences: Boolean(candidate.sentences && candidate.sentences.length > 0),
        points: [] as Array<{ reason: string; value?: unknown; points: number }>
      };

      if (!candidate.sentences || candidate.sentences.length === 0) {
        evaluation.reason = 'NO_SENTENCES';
        evaluations.push(evaluation);
        continue;
      }

      if (calendarId && candidate.calendar_id && calendarId === candidate.calendar_id) {
        score += 150;
        (evaluation.points as Array<{ reason: string; value?: unknown; points: number }>).push({
          reason: 'CALENDAR_MATCH',
          value: candidate.calendar_id,
          points: 150
        });
      }

      if (meetingUrl && candidate.meeting_link && meetingUrl === candidate.meeting_link.trim().toLowerCase()) {
        score += 120;
        (evaluation.points as Array<{ reason: string; value?: unknown; points: number }>).push({
          reason: 'URL_MATCH',
          value: candidate.meeting_link,
          points: 120
        });
      }

      if (candidate.date) {
        const diffMinutes = Math.abs(candidate.date - meetingDate.getTime()) / 60000;
        score += Math.max(0, 60 - diffMinutes);
        (evaluation.points as Array<{ reason: string; value?: unknown; points: number }>).push({
          reason: 'TIME_PROXIMITY',
          value: diffMinutes,
          points: Math.max(0, 60 - diffMinutes)
        });
      }

      const participants = Array.isArray(candidate.participants) ? candidate.participants : [];
      if (participants.length) {
        const overlap = participants.reduce((acc: number, participant: string) => {
          if (participant && attendeeEmails.has(participant.toLowerCase())) {
            return acc + 1;
          }
          return acc;
        }, 0);
        score += overlap * 10;
        (evaluation.points as Array<{ reason: string; value?: unknown; points: number }>).push({
          reason: 'ATTENDEE_OVERLAP',
          value: overlap,
          points: overlap * 10
        });
      }

      const candidateTitle = this.normalizeTitle(candidate.title || '');
      if (normalizedTitle && candidateTitle) {
        if (normalizedTitle === candidateTitle) {
          score += 40;
          (evaluation.points as Array<{ reason: string; value?: unknown; points: number }>).push({
            reason: 'TITLE_EXACT_MATCH',
            points: 40
          });
        } else if (candidateTitle.includes(normalizedTitle) || normalizedTitle.includes(candidateTitle)) {
          score += 25;
          (evaluation.points as Array<{ reason: string; value?: unknown; points: number }>).push({
            reason: 'TITLE_PARTIAL_MATCH',
            points: 25
          });
        }
      }

      evaluation.score = score;
      evaluations.push(evaluation);

      if (score > bestScore) {
        bestScore = score;
        bestCandidate = candidate;
      }
    }

    logger.debug('Fireflies transcript candidate evaluations', {
      meetingId: meeting.id,
      evaluationCount: evaluations.length,
      evaluations
    });

    if (!bestCandidate || bestScore < 40) {
      return null;
    }

    logger.info('Selected Fireflies transcript candidate', {
      meetingId: meeting.id,
      transcriptId: bestCandidate.id,
      score: bestScore
    });

    return bestCandidate;
  }

  private formatSentences(sentences: FirefliesTranscriptSentence[]): string {
    const lines: string[] = [];

    sentences
      .filter((sentence) => sentence && sentence.text && sentence.text.trim())
      .sort((a, b) => a.index - b.index)
      .forEach((sentence, index) => {
        const timestamp = this.formatTimestamp(sentence.start_time, index);
        const speaker = sentence.speaker_name?.trim() || 'Speaker';
        const text = sentence.text?.trim() || '';
        if (!text) {
          return;
        }
        lines.push(`[${timestamp}] ${speaker}: ${text}`);
      });

    return lines.join('\n');
  }

  private formatTimestamp(rawValue: string | number | null | undefined, fallbackIndex: number): string {
    const seconds = this.parseSeconds(rawValue, fallbackIndex);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  private parseSeconds(rawValue: string | number | null | undefined, fallbackIndex: number): number {
    if (typeof rawValue === 'number' && !Number.isNaN(rawValue)) {
      return Math.max(0, rawValue >= 1e6 ? rawValue / 1000 : rawValue);
    }

    if (typeof rawValue === 'string') {
      const trimmed = rawValue.trim();
      const numeric = Number(trimmed);
      if (!Number.isNaN(numeric) && numeric >= 0) {
        return numeric >= 1e6 ? numeric / 1000 : numeric;
      }

      const parsed = Date.parse(trimmed);
      if (!Number.isNaN(parsed)) {
        return parsed / 1000;
      }
    }

    // Fallback to monotonically increasing timestamps (30s apart)
    return fallbackIndex * 30;
  }

  private extractAttendeeEmails(meeting: Meeting): string[] {
    if (!meeting.attendees) {
      return [];
    }

    const emails = new Set<string>();

    meeting.attendees.forEach((attendee) => {
      if (typeof attendee === 'string') {
        const email = attendee.trim();
        if (this.isEmail(email)) {
          emails.add(email.toLowerCase());
        }
      } else if ((attendee as Attendee).email) {
        const email = (attendee as Attendee).email?.trim();
        if (email && this.isEmail(email)) {
          emails.add(email.toLowerCase());
        }
      }
    });

    return Array.from(emails);
  }

  private normalizeTitle(title?: string | null): string {
    if (!title) {
      return '';
    }
    return title.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  private resolveMeetingDate(meeting: Meeting): Date {
    const dateCandidate = meeting.startTime || meeting.date || new Date();
    const date = dateCandidate instanceof Date ? dateCandidate : new Date(dateCandidate);
    if (Number.isNaN(date.getTime())) {
      return new Date();
    }
    return date;
  }

  private isEmail(value: string): boolean {
    return /.+@.+\..+/.test(value);
  }

  private async executeGraphQL<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    if (!this.apiKey) {
      throw new ServiceError('Fireflies API key not configured', 'FIREFLIES_NO_KEY');
    }

    try {
      logger.debug('Executing Fireflies GraphQL request', {
        endpoint: GRAPHQL_ENDPOINT,
        variables: this.sanitizeGraphQLVariables(variables)
      });
      const response = await fetch(GRAPHQL_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({ query, variables })
      });

      if (!response.ok) {
        const text = await response.text();
        if (response.status === 401 || response.status === 403) {
          throw new ApiError('Fireflies authentication failed', response.status, { context: text });
        }
        if (response.status === 429) {
          throw new ApiError('Fireflies rate limit exceeded', response.status, { context: text });
        }
        if (response.status >= 500) {
          throw new ApiError('Fireflies service unavailable', response.status, { context: text });
        }
        throw new ApiError('Fireflies API error', response.status, { context: text });
      }

      const json = await response.json();
      logger.debug('Fireflies GraphQL response received', {
        hasErrors: Boolean(json?.errors?.length),
        hasData: Boolean(json?.data)
      });
      if (json.errors && Array.isArray(json.errors) && json.errors.length > 0) {
        const message = json.errors.map((err: any) => err.message).join('; ');
        throw new ServiceError(`Fireflies GraphQL error: ${message}`, 'FIREFLIES_GRAPHQL_ERROR', { context: json.errors });
      }

      return json.data as T;
    } catch (error: any) {
      if (error instanceof ServiceError) {
        throw error;
      }
      if (error?.name === 'FetchError' || error?.code === 'ECONNRESET') {
        throw new NetworkError('Fireflies request failed', error);
      }
      throw new ServiceError(error?.message || 'Unknown Fireflies error', 'FIREFLIES_UNKNOWN', {
        cause: error instanceof Error ? error : undefined
      });
    }
  }

  private buildSearchContext(meeting: Meeting) {
    const meetingDate = this.resolveMeetingDate(meeting);
    const fromDate = new Date(meetingDate.getTime() - 2 * 60 * 60 * 1000);
    const toDate = new Date(meetingDate.getTime() + 6 * 60 * 60 * 1000);

    return {
      meetingId: meeting.id,
      meetingTitle: meeting.title,
      calendarEventId: meeting.calendarEventId,
      meetingUrl: meeting.meetingUrl,
      attendeeCount: Array.isArray(meeting.attendees) ? meeting.attendees.length : 0,
      windowStart: fromDate.toISOString(),
      windowEnd: toDate.toISOString()
    };
  }

  private sanitizeGraphQLVariables(variables: Record<string, unknown>) {
    const { participants, keyword, ...rest } = variables;

    return {
      ...rest,
      keyword,
      participants: Array.isArray(participants)
        ? (participants as string[]).map((email) => this.maskEmail(email))
        : undefined
    };
  }

  private maskEmail(email: string): string {
    const [localPart, domain] = email.split('@');
    if (!domain || !localPart) {
      return email;
    }

    if (localPart.length <= 2) {
      return `${localPart[0] ?? ''}***@${domain}`;
    }

    return `${localPart[0]}***${localPart[localPart.length - 1]}@${domain}`;
  }
}

export default FirefliesTranscriptService;
