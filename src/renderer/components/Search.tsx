import React, { useState, useEffect, useCallback, useMemo } from 'react';
import styled from '@emotion/styled';
import SearchBar from './SearchBar';
import SearchResults from './SearchResults';
import { Meeting, SearchOptions, SearchResult } from '../../shared/types';

const SearchWrapper = styled.div<{ collapsed?: boolean }>`
  position: relative;
  max-height: ${props => props.collapsed ? '0' : '300px'};
  opacity: ${props => props.collapsed ? '0' : '1'};
  transition: all 0.3s ease;
  overflow: hidden;
  pointer-events: ${props => props.collapsed ? 'none' : 'auto'};
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

interface SearchProps {
  onSelectMeeting: (meeting: Meeting) => void;
  currentMeeting?: Meeting | null;
  collapsed?: boolean;
}

export default function Search({ onSelectMeeting, currentMeeting, collapsed }: SearchProps) {
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Load search history on mount
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

  const handleSearch = useCallback(async (options: SearchOptions) => {
    // Check if search is empty
    const hasQuery = options.query && options.query.trim().length > 0;
    const hasFilters = options.filters && Object.values(options.filters).some(f => f && (Array.isArray(f) ? f.length > 0 : true));

    if (!hasQuery && !hasFilters) {
      setSearchResults([]);
      setShowResults(false);
      setIsSearching(false);
      return;
    }

    setLoading(true);
    setIsSearching(true);
    setShowResults(true);

    try {
      const results = await window.electronAPI.searchMeetings(options);
      setSearchResults(results || []);

      // Reload search history if a new query was made
      if (options.query) {
        const history = await window.electronAPI.getSearchHistory();
        setSearchHistory(history || []);
      }
    } catch (error) {
      console.error('Search failed:', error);
      setSearchResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleClearSearch = useCallback(() => {
    setSearchResults([]);
    setShowResults(false);
    setIsSearching(false);
  }, []);

  const handleSelectResult = useCallback((meeting: Meeting) => {
    onSelectMeeting(meeting);
    handleClearSearch();
  }, [onSelectMeeting, handleClearSearch]);

  const handleClearHistory = useCallback(async () => {
    try {
      await window.electronAPI.clearSearchHistory();
      setSearchHistory([]);
    } catch (error) {
      console.error('Failed to clear search history:', error);
    }
  }, []);

  // Memoize the SearchBar to prevent unnecessary re-renders
  const searchBar = useMemo(() => (
    <SearchBar
      onSearch={handleSearch}
      onClear={handleClearSearch}
      searchHistory={searchHistory}
    />
  ), [handleSearch, handleClearSearch, searchHistory]);

  return (
    <>
      <SearchWrapper collapsed={collapsed}>
        {searchBar}
        {showResults && (
          <SearchResults
            results={searchResults}
            onSelectResult={handleSelectResult}
            onClear={handleClearSearch}
            loading={loading}
          />
        )}
      </SearchWrapper>
      {showResults && <Overlay onClick={handleClearSearch} />}
    </>
  );
}