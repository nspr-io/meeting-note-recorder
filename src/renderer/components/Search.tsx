import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import styled from '@emotion/styled';
import SearchBar, { SearchQuickFilters } from './SearchBar';
import SearchResults from './SearchResults';
import { Meeting, SavedSearchDefinition, SearchOptions, SearchResult } from '../../shared/types';

const SearchWrapper = styled.div<{ collapsed?: boolean }>`
  position: relative;
  max-height: ${props => (props.collapsed ? '0' : 'none')};
  opacity: ${props => (props.collapsed ? '0' : '1')};
  transition: all 0.3s ease;
  overflow: ${props => (props.collapsed ? 'hidden' : 'visible')};
  pointer-events: ${props => (props.collapsed ? 'none' : 'auto')};
`;

const Overlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.3);
  z-index: 1000;
  animation: fadeIn 0.2s;

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
`;

const SavedSearchContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 12px 20px 0 20px;
`;

const SavedSearchLabel = styled.span`
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #6b7280;
  font-weight: 600;
`;

const SavedSearchChip = styled.button<{ active?: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 9999px;
  border: 1px solid rgba(102, 126, 234, 0.3);
  background: ${props => (props.active ? 'rgba(102, 126, 234, 0.12)' : '#ffffff')};
  color: ${props => (props.active ? '#4c51bf' : '#4c51bf')};
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  position: relative;

  &:hover {
    border-color: #4c51bf;
    background: rgba(102, 126, 234, 0.16);
  }
`;

const ChipDeleteButton = styled.button`
  border: none;
  background: transparent;
  color: #a0aec0;
  font-size: 12px;
  cursor: pointer;
  padding: 0;
  line-height: 1;

  &:hover {
    color: #e53e3e;
  }
`;

const AdvancedOverlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(17, 24, 39, 0.45);
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 24px;
`;

const AdvancedPanel = styled.div`
  background: #ffffff;
  border-radius: 16px;
  width: 640px;
  max-width: 100%;
  max-height: 90vh;
  overflow: hidden;
  box-shadow: 0 24px 50px rgba(30, 64, 175, 0.25);
  display: flex;
  flex-direction: column;
`;

const AdvancedHeader = styled.div`
  padding: 20px 24px 16px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.24);
  display: flex;
  align-items: center;
  justify-content: space-between;

  h3 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    color: #1f2937;
  }
`;

const AdvancedBody = styled.div`
  padding: 20px 24px;
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
`;

const AdvancedSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const FieldLabel = styled.label`
  font-size: 13px;
  font-weight: 600;
  color: #374151;
  text-transform: uppercase;
  letter-spacing: 0.05em;
`;

const TextInput = styled.input`
  border-radius: 8px;
  border: 1px solid rgba(148, 163, 184, 0.6);
  padding: 10px 12px;
  font-size: 13px;
  transition: border-color 0.2s, box-shadow 0.2s;

  &:focus {
    outline: none;
    border-color: #667eea;
    box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.2);
  }
`;

const Textarea = styled.textarea`
  border-radius: 8px;
  border: 1px solid rgba(148, 163, 184, 0.6);
  padding: 10px 12px;
  font-size: 13px;
  min-height: 68px;
  resize: vertical;
  transition: border-color 0.2s, box-shadow 0.2s;

  &:focus {
    outline: none;
    border-color: #667eea;
    box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.2);
  }
`;

const DateRow = styled.div`
  display: flex;
  gap: 12px;

  ${TextInput} {
    flex: 1;
  }
`;

const ToggleGroup = styled.div`
  display: inline-flex;
  border-radius: 9999px;
  border: 1px solid rgba(102, 126, 234, 0.4);
  overflow: hidden;
`;

const ToggleButton = styled.button<{ active?: boolean }>`
  padding: 6px 14px;
  font-size: 12px;
  border: none;
  cursor: pointer;
  background: ${props => (props.active ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' : 'transparent')};
  color: ${props => (props.active ? '#ffffff' : '#4c51bf')};
  transition: background 0.2s;

  &:hover {
    background: ${props => (props.active ? 'linear-gradient(135deg, #5a67d8 0%, #6b46c1 100%)' : 'rgba(102, 126, 234, 0.1)')};
  }
`;

const FooterActions = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 24px;
  border-top: 1px solid rgba(148, 163, 184, 0.24);
`;

const ButtonGroup = styled.div`
  display: flex;
  gap: 8px;
`;

const ActionButton = styled.button<{ variant?: 'primary' | 'ghost' | 'danger' }>`
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  padding: 8px 16px;
  cursor: pointer;
  border: none;
  transition: all 0.2s ease;

  ${props => {
    switch (props.variant) {
      case 'primary':
        return `
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          &:hover {
            background: linear-gradient(135deg, #5a67d8 0%, #6b46c1 100%);
          }
          &:disabled {
            background: rgba(102, 126, 234, 0.4);
            cursor: not-allowed;
          }
        `;
      case 'danger':
        return `
          background: rgba(220, 38, 38, 0.1);
          color: #dc2626;
          &:hover {
            background: rgba(220, 38, 38, 0.16);
          }
        `;
      default:
        return `
          background: rgba(102, 126, 234, 0.08);
          color: #4c51bf;
          &:hover {
            background: rgba(102, 126, 234, 0.16);
          }
        `;
    }
  }}
`;

const SaveRow = styled.div`
  display: flex;
  gap: 8px;
  align-items: center;
`;

const SaveError = styled.div`
  font-size: 12px;
  color: #dc2626;
`;

type TriState = 'any' | 'yes' | 'no';

interface AdvancedFiltersState {
  attendees: string[];
  dateFrom?: string;
  dateTo?: string;
  hasPrep: TriState;
  hasTranscript: TriState;
  limit?: number | null;
}

interface SavedSearchRequest {
  id?: string;
  name: string;
  options: SearchOptions;
}

interface SearchProps {
  onSelectMeeting: (meeting: Meeting) => void;
  collapsed?: boolean;
  savedSearches?: SavedSearchDefinition[];
  onSaveSearch?: (payload: SavedSearchRequest) => Promise<void>;
  onDeleteSavedSearch?: (id: string) => Promise<void>;
}

const createDefaultAdvancedFilters = (): AdvancedFiltersState => ({
  attendees: [],
  dateFrom: undefined,
  dateTo: undefined,
  hasPrep: 'any',
  hasTranscript: 'any',
  limit: undefined,
});

const parseAttendeesInput = (value: string): string[] =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

const formatDateInput = (value?: string | Date): string | undefined => {
  if (!value) {
    return undefined;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return date.toISOString().slice(0, 10);
};

const toIsoDate = (value?: string, endOfDay = false): string | undefined => {
  if (!value) {
    return undefined;
  }
  const seed = endOfDay ? `${value}T23:59:59.999` : `${value}T00:00:00.000`;
  const date = new Date(seed);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return date.toISOString();
};

interface AdvancedSearchPanelProps {
  filters: AdvancedFiltersState;
  onFiltersChange: (filters: AdvancedFiltersState) => void;
  onClose: () => void;
  onReset: () => void;
  onSave: (name: string) => Promise<void>;
  isSaving: boolean;
  canSave: boolean;
}

function AdvancedSearchPanel({ filters, onFiltersChange, onClose, onReset, onSave, isSaving, canSave }: AdvancedSearchPanelProps) {
  const [attendeeInput, setAttendeeInput] = useState(filters.attendees.join(', '));
  const [saveName, setSaveName] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setAttendeeInput(filters.attendees.join(', '));
  }, [filters.attendees]);

  const handleSave = useCallback(async () => {
    if (!canSave) {
      setSaveError('Add a search term or filter before saving.');
      return;
    }

    if (!saveName.trim()) {
      setSaveError('Name is required to save this view.');
      return;
    }

    try {
      await onSave(saveName.trim());
      setSaveName('');
      setSaveError(null);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unable to save this search view.';
      setSaveError(message);
    }
  }, [canSave, onSave, saveName]);

  const updateFilters = useCallback((updates: Partial<AdvancedFiltersState>) => {
    onFiltersChange({
      ...filters,
      ...updates,
    });
  }, [filters, onFiltersChange]);

  return (
    <AdvancedPanel onClick={(event) => event.stopPropagation()}>
      <AdvancedHeader>
        <h3>Advanced filters</h3>
        <ActionButton variant="ghost" onClick={onClose}>Close</ActionButton>
      </AdvancedHeader>

      <AdvancedBody>
        <AdvancedSection>
          <FieldLabel htmlFor="advanced-attendees">Attendees (comma separated)</FieldLabel>
          <Textarea
            id="advanced-attendees"
            value={attendeeInput}
            onChange={(event) => {
              const value = event.target.value;
              setAttendeeInput(value);
              updateFilters({ attendees: parseAttendeesInput(value) });
            }}
            placeholder="e.g. Sarah Chen, John Doe"
          />
        </AdvancedSection>

        <AdvancedSection>
          <FieldLabel>Date range</FieldLabel>
          <DateRow>
            <TextInput
              type="date"
              value={filters.dateFrom ?? ''}
              onChange={(event) => updateFilters({ dateFrom: event.target.value || undefined })}
            />
            <TextInput
              type="date"
              value={filters.dateTo ?? ''}
              onChange={(event) => updateFilters({ dateTo: event.target.value || undefined })}
            />
          </DateRow>
        </AdvancedSection>

        <AdvancedSection>
          <FieldLabel>Content filters</FieldLabel>
          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <span style={{ fontSize: '12px', color: '#4b5563', fontWeight: 500 }}>Prep notes</span>
              <ToggleGroup>
                <ToggleButton active={filters.hasPrep === 'any'} onClick={() => updateFilters({ hasPrep: 'any' })}>Any</ToggleButton>
                <ToggleButton active={filters.hasPrep === 'yes'} onClick={() => updateFilters({ hasPrep: 'yes' })}>Has prep</ToggleButton>
                <ToggleButton active={filters.hasPrep === 'no'} onClick={() => updateFilters({ hasPrep: 'no' })}>Missing prep</ToggleButton>
              </ToggleGroup>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <span style={{ fontSize: '12px', color: '#4b5563', fontWeight: 500 }}>Transcript</span>
              <ToggleGroup>
                <ToggleButton active={filters.hasTranscript === 'any'} onClick={() => updateFilters({ hasTranscript: 'any' })}>Any</ToggleButton>
                <ToggleButton active={filters.hasTranscript === 'yes'} onClick={() => updateFilters({ hasTranscript: 'yes' })}>Has transcript</ToggleButton>
                <ToggleButton active={filters.hasTranscript === 'no'} onClick={() => updateFilters({ hasTranscript: 'no' })}>Missing transcript</ToggleButton>
              </ToggleGroup>
            </div>
          </div>
        </AdvancedSection>

        <AdvancedSection>
          <FieldLabel htmlFor="advanced-limit">Result limit (optional)</FieldLabel>
          <TextInput
            id="advanced-limit"
            type="number"
            min={1}
            placeholder="Default shows all matching results"
            value={filters.limit ?? ''}
            onChange={(event) => {
              const rawValue = event.target.value;
              const parsed = Number(rawValue);
              updateFilters({ limit: rawValue ? (Number.isNaN(parsed) ? undefined : parsed) : undefined });
            }}
          />
        </AdvancedSection>

        <AdvancedSection>
          <FieldLabel>Save this view</FieldLabel>
          <SaveRow>
            <TextInput
              type="text"
              placeholder="Name (e.g. Customer QBRs)"
              value={saveName}
              onChange={(event) => {
                setSaveName(event.target.value);
                setSaveError(null);
              }}
              style={{ flex: 1 }}
            />
            <ActionButton
              variant="primary"
              onClick={handleSave}
              disabled={isSaving || !canSave}
            >
              {isSaving ? 'Saving…' : 'Save view'}
            </ActionButton>
          </SaveRow>
          {saveError && <SaveError>{saveError}</SaveError>}
        </AdvancedSection>
      </AdvancedBody>

      <FooterActions>
        <ActionButton variant="ghost" onClick={onReset}>Reset filters</ActionButton>
        <ButtonGroup>
          <ActionButton variant="ghost" onClick={onClose}>Done</ActionButton>
        </ButtonGroup>
      </FooterActions>
    </AdvancedPanel>
  );
}

export default function Search({
  onSelectMeeting,
  collapsed,
  savedSearches = [],
  onSaveSearch,
  onDeleteSavedSearch
}: SearchProps) {
  const [query, setQuery] = useState('');
  const [quickFilters, setQuickFilters] = useState<SearchQuickFilters>({ status: [], platforms: [] });
  const [advancedFilters, setAdvancedFilters] = useState<AdvancedFiltersState>(createDefaultAdvancedFilters);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isSavingSearch, setIsSavingSearch] = useState(false);
  const [activeSavedSearchId, setActiveSavedSearchId] = useState<string | null>(null);
  const debounceRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    let mounted = true;
    const loadHistory = async () => {
      try {
        const history = await window.electronAPI.getSearchHistory();
        if (mounted) {
          setSearchHistory(history || []);
        }
      } catch (error) {
        console.error('Failed to load search history:', error);
      }
    };
    loadHistory();
    return () => {
      mounted = false;
    };
  }, []);

  const hasQuickFilters = useMemo(
    () => quickFilters.status.length > 0 || quickFilters.platforms.length > 0,
    [quickFilters]
  );

  const advancedActive = useMemo(
    () =>
      advancedFilters.attendees.length > 0 ||
      !!advancedFilters.dateFrom ||
      !!advancedFilters.dateTo ||
      advancedFilters.hasPrep !== 'any' ||
      advancedFilters.hasTranscript !== 'any' ||
      (advancedFilters.limit !== undefined && advancedFilters.limit !== null),
    [advancedFilters]
  );

  const buildSearchOptions = useCallback((): SearchOptions => {
    const filters: NonNullable<SearchOptions['filters']> = {};

    if (quickFilters.status.length > 0) {
      filters.status = quickFilters.status as Meeting['status'][];
    }

    if (quickFilters.platforms.length > 0) {
      filters.platforms = [...quickFilters.platforms];
    }

    if (advancedFilters.attendees.length > 0) {
      filters.attendees = [...advancedFilters.attendees];
    }

    const fromIso = toIsoDate(advancedFilters.dateFrom, false);
    if (fromIso) {
      filters.dateFrom = fromIso;
    }

    const toIso = toIsoDate(advancedFilters.dateTo, true);
    if (toIso) {
      filters.dateTo = toIso;
    }

    if (advancedFilters.hasPrep !== 'any') {
      filters.hasPrep = advancedFilters.hasPrep === 'yes';
    }

    if (advancedFilters.hasTranscript !== 'any') {
      filters.hasTranscript = advancedFilters.hasTranscript === 'yes';
    }

    const options: SearchOptions = {
      query,
      filters: Object.keys(filters).length > 0 ? filters : undefined,
      limit: advancedFilters.limit ?? undefined,
    };

    return options;
  }, [advancedFilters, quickFilters, query]);

  const performSearch = useCallback(async () => {
    const options = buildSearchOptions();
    setLoading(true);
    try {
      const results = await window.electronAPI.searchMeetings(options);
      setSearchResults(results || []);
      if (options.query && options.query.trim()) {
        const history = await window.electronAPI.getSearchHistory();
        setSearchHistory(history || []);
      }
    } catch (error) {
      console.error('Search failed:', error);
      setSearchResults([]);
    } finally {
      setLoading(false);
      setIsSearching(false);
    }
  }, [buildSearchOptions]);

  useEffect(() => {
    const hasQuery = query.trim().length > 0;
    const shouldRun = hasQuery || hasQuickFilters || advancedActive;

    if (!shouldRun) {
      if (debounceRef.current !== undefined) {
        window.clearTimeout(debounceRef.current);
      }
      setSearchResults([]);
      setShowResults(false);
      setIsSearching(false);
      setLoading(false);
      return;
    }

    setIsSearching(true);
    setShowResults(true);

    if (debounceRef.current !== undefined) {
      window.clearTimeout(debounceRef.current);
    }

    debounceRef.current = window.setTimeout(() => {
      void performSearch();
    }, 250);

    return () => {
      if (debounceRef.current !== undefined) {
        window.clearTimeout(debounceRef.current);
      }
    };
  }, [advancedActive, hasQuickFilters, performSearch, query]);

  const handleClearSearch = useCallback(() => {
    setQuery('');
    setQuickFilters({ status: [], platforms: [] });
    setAdvancedFilters(createDefaultAdvancedFilters());
    setSearchResults([]);
    setShowResults(false);
    setIsSearching(false);
    setActiveSavedSearchId(null);
  }, []);

  const handleSelectResult = useCallback((meeting: Meeting) => {
    onSelectMeeting(meeting);
    handleClearSearch();
  }, [handleClearSearch, onSelectMeeting]);

  const handleHistorySelect = useCallback((value: string) => {
    setQuery(value);
  }, []);

  const handleApplySavedSearch = useCallback((saved: SavedSearchDefinition) => {
    const options = saved.options;
    setQuery(options.query || '');
    setQuickFilters({
      status: options.filters?.status ? [...options.filters.status] : [],
      platforms: options.filters?.platforms ? [...options.filters.platforms] : [],
    });
    setAdvancedFilters({
      attendees: options.filters?.attendees ? [...options.filters.attendees] : [],
      dateFrom: formatDateInput(options.filters?.dateFrom),
      dateTo: formatDateInput(options.filters?.dateTo),
      hasPrep:
        options.filters?.hasPrep === undefined
          ? 'any'
          : options.filters.hasPrep
          ? 'yes'
          : 'no',
      hasTranscript:
        options.filters?.hasTranscript === undefined
          ? 'any'
          : options.filters.hasTranscript
          ? 'yes'
          : 'no',
      limit: options.limit ?? undefined,
    });
    setActiveSavedSearchId(saved.id);
    setShowAdvanced(false);
  }, []);

  const handleDeleteSavedSearch = useCallback(async (id: string) => {
    if (!onDeleteSavedSearch) {
      return;
    }
    try {
      await onDeleteSavedSearch(id);
      if (activeSavedSearchId === id) {
        setActiveSavedSearchId(null);
      }
    } catch (error) {
      console.error('Failed to delete saved search', error);
    }
  }, [activeSavedSearchId, onDeleteSavedSearch]);

  const handleSaveCurrentSearch = useCallback(async (name: string) => {
    if (!onSaveSearch) {
      return;
    }
    const payload: SavedSearchRequest = {
      name,
      options: buildSearchOptions(),
    };
    setIsSavingSearch(true);
    try {
      await onSaveSearch(payload);
    } finally {
      setIsSavingSearch(false);
    }
  }, [buildSearchOptions, onSaveSearch]);

  const handleResetAdvancedFilters = useCallback(() => {
    setAdvancedFilters(createDefaultAdvancedFilters());
  }, []);

  return (
    <>
      <SearchWrapper collapsed={collapsed}>
        <SearchBar
          query={query}
          onQueryChange={setQuery}
          quickFilters={quickFilters}
          onQuickFiltersChange={setQuickFilters}
          onClear={handleClearSearch}
          onRequestAdvanced={() => setShowAdvanced(true)}
          advancedActive={advancedActive}
          searchHistory={searchHistory}
          onHistorySelect={handleHistorySelect}
        />

        {savedSearches.length > 0 && (
          <SavedSearchContainer>
            <SavedSearchLabel>Saved views</SavedSearchLabel>
            {savedSearches.map((saved) => (
              <SavedSearchChip
                type="button"
                key={saved.id}
                active={saved.id === activeSavedSearchId}
                onClick={() => handleApplySavedSearch(saved)}
              >
                <span>{saved.name}</span>
                {onDeleteSavedSearch && (
                  <ChipDeleteButton
                    type="button"
                    aria-label={`Delete saved search ${saved.name}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleDeleteSavedSearch(saved.id);
                    }}
                  >
                    ✕
                  </ChipDeleteButton>
                )}
              </SavedSearchChip>
            ))}
          </SavedSearchContainer>
        )}

        {showResults && (
          <SearchResults
            results={searchResults}
            onSelectResult={handleSelectResult}
            onClear={handleClearSearch}
            loading={loading || isSearching}
          />
        )}
      </SearchWrapper>

      {showResults && <Overlay onClick={handleClearSearch} />}

      {showAdvanced && (
        <AdvancedOverlay onClick={() => setShowAdvanced(false)}>
          <AdvancedSearchPanel
            filters={advancedFilters}
            onFiltersChange={setAdvancedFilters}
            onClose={() => setShowAdvanced(false)}
            onReset={handleResetAdvancedFilters}
            onSave={handleSaveCurrentSearch}
            isSaving={isSavingSearch}
            canSave={query.trim().length > 0 || hasQuickFilters || advancedActive}
          />
        </AdvancedOverlay>
      )}
    </>
  );
}