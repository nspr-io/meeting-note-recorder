import Fuse, { IFuseOptions, FuseResult } from 'fuse.js';
import { Meeting, SearchMatch, SearchOptions, SearchResult } from '../types';

export interface SearchMetadata {
  hasPrep?: boolean;
  hasTranscript?: boolean;
  [key: string]: unknown;
}

const PREP_MARKERS = ['<!-- PREP_NOTES -->'];

export class SearchService {
  private fuse: Fuse<Meeting> | null = null;
  private meetings: Meeting[] = [];
  private metadata = new Map<string, SearchMetadata>();
  private searchHistory: string[] = [];
  private readonly maxHistorySize = 10;

  constructor() {
    this.initializeFuse();
  }

  private initializeFuse(): void {
    const fuseOptions: IFuseOptions<Meeting> = {
      keys: [
        { name: 'title', weight: 3 },
        { name: 'insights', weight: 2 },
        { name: 'notes', weight: 2 },
        { name: 'transcript', weight: 1 },
        { name: 'attendees.name', weight: 1.5 },
        { name: 'attendees.email', weight: 1.5 },
        {
          name: 'attendees',
          weight: 1.5,
          getFn: (meeting) => this.extractAttendeeNames(meeting.attendees),
        },
        { name: 'platform', weight: 0.5 },
        { name: 'tags', weight: 1 },
      ],
      threshold: 0.4,
      includeScore: true,
      includeMatches: true,
      minMatchCharLength: 2,
      shouldSort: true,
      ignoreLocation: true,
      findAllMatches: false,
      location: 0,
      distance: 100,
      useExtendedSearch: true,
      ignoreFieldNorm: false,
      ignoreFieldNorm: false,
    };

    this.fuse = new Fuse(this.meetings, fuseOptions);
  }

  public updateIndex(meetings: Meeting[], metadata?: Record<string, SearchMetadata>): void {
    this.meetings = meetings;
    this.metadata.clear();

    if (metadata) {
      Object.entries(metadata).forEach(([meetingId, data]) => {
        if (meetingId) {
          this.metadata.set(meetingId, data);
        }
      });
    }

    this.initializeFuse();
    if (this.meetings.length > 0 && this.fuse) {
      this.fuse.setCollection(this.meetings);
    }
  }

  public getMetadata(meetingId: string): SearchMetadata | undefined {
    return this.metadata.get(meetingId);
  }

  public search(options: SearchOptions): SearchResult[] {
    if (!this.fuse || !options.query || options.query.trim().length === 0) {
      return this.getAllMeetings(options);
    }

    this.addToHistory(options.query);

    const searchResults = this.performSearchWithFallback(options.query);

    let results: SearchResult[] = searchResults.map((result) => ({
      meeting: result.item,
      score: result.score || 0,
      matches: this.extractMatches(result.matches || []),
    }));

    if (options.filters) {
      results = this.applyFilters(results, options.filters);
    }

    if (options.mostRecent) {
      results.sort((a, b) => this.getMeetingTimestamp(b.meeting) - this.getMeetingTimestamp(a.meeting));
    }

    if (options.limit) {
      results = results.slice(0, options.limit);
    }

    return results;
  }

  private performSearchWithFallback(query: string): FuseResult<Meeting>[] {
    if (!this.fuse) {
      return [];
    }

    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      return [];
    }

    const tokens = this.tokenizeQuery(trimmedQuery);
    let results = this.fuse.search(trimmedQuery);
    if (tokens.length <= 1) {
      return results;
    }

    const aggregated = new Map<string, FuseResult<Meeting>>();

    results.forEach((candidate) => {
      const meetingId = candidate.item?.id;
      if (meetingId) {
        aggregated.set(meetingId, candidate);
      }
    });

    tokens.forEach((token) => {
      const tokenResults = this.fuse?.search(token) ?? [];
      tokenResults.forEach((candidate) => {
        const meetingId = candidate.item?.id;
        if (!meetingId) {
          return;
        }
        const existing = aggregated.get(meetingId);
        const candidateScore = candidate.score ?? 0;
        if (!existing || candidateScore < (existing.score ?? Number.POSITIVE_INFINITY)) {
          aggregated.set(meetingId, candidate);
        }
      });
    });

    if (aggregated.size === 0) {
      return results;
    }

    results = Array.from(aggregated.values()).sort((a, b) => (a.score ?? 0) - (b.score ?? 0));
    return results;
  }

  private tokenizeQuery(query: string): string[] {
    return query
      .split(/\s+/)
      .map((token) => token.replace(/["'`]/g, '').trim())
      .filter((token) => token.length > 0);
  }

  private getAllMeetings(options: SearchOptions): SearchResult[] {
    let results: SearchResult[] = this.meetings.map((meeting) => ({
      meeting,
      score: 0,
      matches: [],
    }));

    if (options.filters) {
      results = this.applyFilters(results, options.filters);
    }

    results.sort((a, b) => this.getMeetingTimestamp(b.meeting) - this.getMeetingTimestamp(a.meeting));

    if (options.limit) {
      results = results.slice(0, options.limit);
    }

    return results;
  }

  private extractMatches(fuseMatches: readonly any[]): SearchMatch[] {
    return fuseMatches.map((match) => ({
      field: match.key || '',
      value: match.value || '',
      indices: (match.indices || []) as [number, number][],
    }));
  }

  private applyFilters(results: SearchResult[], filters: NonNullable<SearchOptions['filters']>): SearchResult[] {
    if (!filters) {
      return results;
    }

    return results.filter((result) => {
      const meeting = result.meeting;
      const metadata = meeting.id ? this.metadata.get(meeting.id) : undefined;

      if (filters.dateFrom || filters.dateTo) {
        const meetingDate = new Date(meeting.date).getTime();
        if (filters.dateFrom && meetingDate < new Date(filters.dateFrom).getTime()) {
          return false;
        }
        if (filters.dateTo && meetingDate > new Date(filters.dateTo).getTime()) {
          return false;
        }
      }

      if (filters.status && filters.status.length > 0) {
        if (!filters.status.includes(meeting.status)) {
          return false;
        }
      }

      if (filters.platforms && filters.platforms.length > 0) {
        if (!meeting.platform || !filters.platforms.includes(meeting.platform)) {
          return false;
        }
      }

      if (filters.attendees && filters.attendees.length > 0) {
        const meetingAttendees = this.extractAttendeeNames(meeting.attendees);
        const hasMatchingAttendee = filters.attendees.some((filterAttendee) =>
          meetingAttendees.some((attendee) => attendee.toLowerCase().includes(filterAttendee.toLowerCase()))
        );

        if (!hasMatchingAttendee) {
          return false;
        }
      }

      if (typeof filters.hasPrep === 'boolean') {
        const hasPrep = this.resolveBoolean(metadata?.hasPrep, () => this.detectPrepFromMeeting(meeting));
        if (filters.hasPrep !== hasPrep) {
          return false;
        }
      }

      if (typeof filters.hasTranscript === 'boolean') {
        const hasTranscript = this.resolveBoolean(metadata?.hasTranscript, () => this.detectTranscriptFromMeeting(meeting));
        if (filters.hasTranscript !== hasTranscript) {
          return false;
        }
      }

      return true;
    });
  }

  private resolveBoolean(value: unknown, fallback: () => boolean): boolean {
    if (typeof value === 'boolean') {
      return value;
    }
    return fallback();
  }

  private detectPrepFromMeeting(meeting: Meeting): boolean {
    if (typeof meeting.notes === 'string') {
      const lowerNotes = meeting.notes.toLowerCase();
      return PREP_MARKERS.some((marker) => lowerNotes.includes(marker.toLowerCase()));
    }
    return false;
  }

  private detectTranscriptFromMeeting(meeting: Meeting): boolean {
    if (typeof meeting.transcript === 'string') {
      return meeting.transcript.trim().length > 0;
    }
    return false;
  }

  private extractAttendeeNames(attendees: Meeting['attendees']): string[] {
    return attendees.map((attendee) => {
      if (typeof attendee === 'string') {
        return attendee;
      }
      if (attendee && typeof attendee === 'object') {
        return attendee.name || attendee.email || '';
      }
      return '';
    });
  }

  public getSearchHistory(): string[] {
    return [...this.searchHistory];
  }

  private addToHistory(query: string): void {
    if (!query.trim()) {
      return;
    }

    const existingIndex = this.searchHistory.indexOf(query);
    if (existingIndex > -1) {
      this.searchHistory.splice(existingIndex, 1);
    }

    this.searchHistory.unshift(query);

    if (this.searchHistory.length > this.maxHistorySize) {
      this.searchHistory = this.searchHistory.slice(0, this.maxHistorySize);
    }
  }

  public clearHistory(): void {
    this.searchHistory = [];
  }

  public searchByAttendee(attendeeName: string): SearchResult[] {
    return this.search({
      query: attendeeName,
      filters: {
        attendees: [attendeeName],
      },
    });
  }

  public searchByDateRange(from: Date, to: Date): SearchResult[] {
    return this.search({
      query: '',
      filters: {
        dateFrom: from,
        dateTo: to,
      },
    });
  }

  public searchByStatus(status: Meeting['status'][]): SearchResult[] {
    return this.search({
      query: '',
      filters: {
        status,
      },
    });
  }

  public getRecentMeetings(limit: number = 10): Meeting[] {
    return [...this.meetings]
      .sort((a, b) => this.getMeetingTimestamp(b) - this.getMeetingTimestamp(a))
      .slice(0, limit);
  }

  public getMeetingStats(): {
    total: number;
    byStatus: Record<Meeting['status'], number>;
    byPlatform: Record<string, number>;
  } {
    const stats = {
      total: this.meetings.length,
      byStatus: {} as Record<Meeting['status'], number>,
      byPlatform: {} as Record<string, number>,
    };

    this.meetings.forEach((meeting) => {
      stats.byStatus[meeting.status] = (stats.byStatus[meeting.status] || 0) + 1;

      if (meeting.platform) {
        stats.byPlatform[meeting.platform] = (stats.byPlatform[meeting.platform] || 0) + 1;
      }
    });

    return stats;
  }

  private getMeetingTimestamp(meeting: Meeting): number {
    const candidates = [meeting.date, meeting.updatedAt, meeting.createdAt];
    for (const value of candidates) {
      if (!value) {
        continue;
      }
      const timestamp = new Date(value).getTime();
      if (!Number.isNaN(timestamp)) {
        return timestamp;
      }
    }
    return 0;
  }
}

export default SearchService;
