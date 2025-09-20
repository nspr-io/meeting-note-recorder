import Fuse, { IFuseOptions, FuseResult } from 'fuse.js';
import { Meeting } from '../../shared/types';

export interface SearchOptions {
  query: string;
  filters?: {
    dateFrom?: Date;
    dateTo?: Date;
    attendees?: string[];
    status?: Meeting['status'][];
    platforms?: string[];
  };
  limit?: number;
}

export interface SearchResult {
  meeting: Meeting;
  score: number;
  matches: SearchMatch[];
}

export interface SearchMatch {
  field: string;
  value: string;
  indices: [number, number][];
}

export class SearchService {
  private fuse: Fuse<Meeting> | null = null;
  private meetings: Meeting[] = [];
  private searchHistory: string[] = [];
  private maxHistorySize = 10;

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
        { name: 'platform', weight: 0.5 },
      ],
      threshold: 0.3,
      includeScore: true,
      includeMatches: true,
      minMatchCharLength: 2,
      shouldSort: true,
      findAllMatches: false,
      location: 0,
      distance: 100,
      useExtendedSearch: false,
      ignoreLocation: false,
      ignoreFieldNorm: false,
    };

    this.fuse = new Fuse(this.meetings, fuseOptions);
  }

  public updateIndex(meetings: Meeting[]): void {
    this.meetings = meetings;
    this.initializeFuse();
    if (this.meetings.length > 0 && this.fuse) {
      this.fuse.setCollection(this.meetings);
    }
  }

  public search(options: SearchOptions): SearchResult[] {
    if (!this.fuse || !options.query || options.query.trim().length === 0) {
      return this.getAllMeetings(options);
    }

    // Add to search history
    this.addToHistory(options.query);

    // Perform fuzzy search
    const searchResults = this.fuse.search(options.query);

    // Map Fuse results to our SearchResult format
    let results: SearchResult[] = searchResults.map(result => ({
      meeting: result.item,
      score: result.score || 0,
      matches: this.extractMatches(result.matches || []),
    }));

    // Apply filters
    if (options.filters) {
      results = this.applyFilters(results, options.filters);
    }

    // Apply limit
    if (options.limit) {
      results = results.slice(0, options.limit);
    }

    return results;
  }

  private getAllMeetings(options: SearchOptions): SearchResult[] {
    let results: SearchResult[] = this.meetings.map(meeting => ({
      meeting,
      score: 0,
      matches: [],
    }));

    // Apply filters
    if (options.filters) {
      results = this.applyFilters(results, options.filters);
    }

    // Sort by date (newest first)
    results.sort((a, b) => {
      const dateA = new Date(a.meeting.date).getTime();
      const dateB = new Date(b.meeting.date).getTime();
      return dateB - dateA;
    });

    // Apply limit
    if (options.limit) {
      results = results.slice(0, options.limit);
    }

    return results;
  }

  private extractMatches(fuseMatches: readonly any[]): SearchMatch[] {
    return fuseMatches.map(match => ({
      field: match.key || '',
      value: match.value || '',
      indices: match.indices as [number, number][],
    }));
  }

  private applyFilters(results: SearchResult[], filters: SearchOptions['filters']): SearchResult[] {
    if (!filters) return results;

    return results.filter(result => {
      const meeting = result.meeting;

      // Date filter
      if (filters.dateFrom || filters.dateTo) {
        const meetingDate = new Date(meeting.date).getTime();
        if (filters.dateFrom && meetingDate < new Date(filters.dateFrom).getTime()) {
          return false;
        }
        if (filters.dateTo && meetingDate > new Date(filters.dateTo).getTime()) {
          return false;
        }
      }

      // Status filter
      if (filters.status && filters.status.length > 0) {
        if (!filters.status.includes(meeting.status)) {
          return false;
        }
      }

      // Platform filter
      if (filters.platforms && filters.platforms.length > 0) {
        if (!meeting.platform || !filters.platforms.includes(meeting.platform)) {
          return false;
        }
      }

      // Attendees filter
      if (filters.attendees && filters.attendees.length > 0) {
        const meetingAttendees = this.extractAttendeeNames(meeting.attendees);
        const hasMatchingAttendee = filters.attendees.some(filterAttendee =>
          meetingAttendees.some(attendee =>
            attendee.toLowerCase().includes(filterAttendee.toLowerCase())
          )
        );
        if (!hasMatchingAttendee) {
          return false;
        }
      }

      return true;
    });
  }

  private extractAttendeeNames(attendees: string[] | any[]): string[] {
    return attendees.map(attendee => {
      if (typeof attendee === 'string') {
        return attendee;
      } else if (attendee && typeof attendee === 'object') {
        return attendee.name || attendee.email || '';
      }
      return '';
    });
  }

  public getSearchHistory(): string[] {
    return [...this.searchHistory];
  }

  private addToHistory(query: string): void {
    // Remove duplicate if exists
    const index = this.searchHistory.indexOf(query);
    if (index > -1) {
      this.searchHistory.splice(index, 1);
    }

    // Add to beginning
    this.searchHistory.unshift(query);

    // Trim to max size
    if (this.searchHistory.length > this.maxHistorySize) {
      this.searchHistory = this.searchHistory.slice(0, this.maxHistorySize);
    }
  }

  public clearHistory(): void {
    this.searchHistory = [];
  }

  // Advanced search methods
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
      .sort((a, b) => {
        const dateA = new Date(a.date).getTime();
        const dateB = new Date(b.date).getTime();
        return dateB - dateA;
      })
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

    this.meetings.forEach(meeting => {
      // Count by status
      stats.byStatus[meeting.status] = (stats.byStatus[meeting.status] || 0) + 1;

      // Count by platform
      if (meeting.platform) {
        stats.byPlatform[meeting.platform] = (stats.byPlatform[meeting.platform] || 0) + 1;
      }
    });

    return stats;
  }
}