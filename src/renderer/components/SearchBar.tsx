import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import styled from '@emotion/styled';
import { SearchOptions } from '../../shared/types';
import { debounce } from 'lodash';

const SearchContainer = styled.div`
  position: relative;
  padding: 12px 20px;
  background: linear-gradient(to bottom, #fafafa, #f5f5f5);
  border-bottom: 1px solid #e5e5e7;
`;

const SearchInputWrapper = styled.div`
  position: relative;
  display: flex;
  align-items: center;
  background: white;
  border-radius: 10px;
  border: 1px solid #e5e5e7;
  padding: 10px 16px;
  max-width: 800px;
  margin: 0 auto;
  transition: all 0.2s;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);

  &:focus-within {
    border-color: #667eea;
    box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1), 0 2px 6px rgba(0, 0, 0, 0.08);
  }
`;

const SearchIcon = styled.span`
  color: #86868b;
  margin-right: 8px;
  font-size: 16px;
`;

const SearchInput = styled.input`
  flex: 1;
  border: none;
  outline: none;
  font-size: 14px;
  color: #1d1d1f;

  &::placeholder {
    color: #86868b;
  }
`;

const ClearButton = styled.button`
  background: none;
  border: none;
  color: #86868b;
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.2s;

  &:hover {
    color: #1d1d1f;
  }
`;

const KeyboardShortcut = styled.span`
  background: #f0f0f0;
  border: 1px solid #d1d1d1;
  border-radius: 4px;
  padding: 2px 6px;
  font-size: 11px;
  color: #86868b;
  margin-left: 8px;
`;

const FilterBar = styled.div`
  display: flex;
  gap: 8px;
  margin-top: 10px;
  flex-wrap: wrap;
  justify-content: center;
  max-width: 800px;
  margin-left: auto;
  margin-right: auto;
`;

const FilterChip = styled.button<{ active?: boolean }>`
  padding: 6px 12px;
  border-radius: 16px;
  border: 1px solid ${props => props.active ? '#667eea' : '#e5e5e7'};
  background: ${props => props.active ? 'rgba(102, 126, 234, 0.1)' : 'white'};
  color: ${props => props.active ? '#667eea' : '#86868b'};
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    border-color: #667eea;
    background: rgba(102, 126, 234, 0.05);
  }
`;

const SearchHistory = styled.div`
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  width: calc(100% - 40px);
  max-width: 800px;
  background: white;
  border: 1px solid #e5e5e7;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  max-height: 200px;
  overflow-y: auto;
  z-index: 1000;
  margin-top: 4px;
`;

const HistoryItem = styled.div`
  padding: 8px 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #1d1d1f;

  &:hover {
    background: #f9f9f9;
  }

  span {
    color: #86868b;
    font-size: 12px;
  }
`;

interface SearchBarProps {
  onSearch: (options: SearchOptions) => void;
  onClear?: () => void;
  searchHistory?: string[];
  placeholder?: string;
}

export default function SearchBar({ onSearch, onClear, searchHistory = [], placeholder = "Search meetings, transcripts, notes..." }: SearchBarProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [activeFilters, setActiveFilters] = useState({
    status: [] as string[],
    platforms: [] as string[],
  });
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Create debounced search function - memoized properly
  const debouncedSearch = useMemo(
    () => debounce((query: string, filters: typeof activeFilters) => {
      const options: SearchOptions = {
        query,
        filters: {
          status: filters.status.length > 0 ? filters.status as any : undefined,
          platforms: filters.platforms.length > 0 ? filters.platforms : undefined,
        },
      };
      onSearch(options);
    }, 300),
    [onSearch]
  );

  useEffect(() => {
    // Only search if there's a query or active filters
    if (searchQuery || activeFilters.status.length > 0 || activeFilters.platforms.length > 0) {
      debouncedSearch(searchQuery, activeFilters);
    }

    // Cleanup function to cancel pending debounced calls
    return () => {
      debouncedSearch.cancel();
    };
  }, [searchQuery, activeFilters, debouncedSearch]);

  // Setup keyboard shortcut (Cmd+K or Ctrl+K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      if (e.key === 'Escape' && document.activeElement === searchInputRef.current) {
        searchInputRef.current?.blur();
        setShowHistory(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleClear = () => {
    setSearchQuery('');
    setActiveFilters({ status: [], platforms: [] });
    onClear?.();
  };

  const handleHistoryClick = (query: string) => {
    setSearchQuery(query);
    setShowHistory(false);
    searchInputRef.current?.focus();
  };

  const toggleFilter = (type: 'status' | 'platforms', value: string) => {
    setActiveFilters(prev => ({
      ...prev,
      [type]: prev[type].includes(value)
        ? prev[type].filter(v => v !== value)
        : [...prev[type], value],
    }));
  };

  return (
    <SearchContainer>
      <SearchInputWrapper>
        <SearchIcon>🔍</SearchIcon>
        <SearchInput
          ref={searchInputRef}
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onFocus={() => setShowHistory(true)}
          onBlur={() => setTimeout(() => setShowHistory(false), 200)}
          placeholder={placeholder}
        />
        {searchQuery && (
          <ClearButton onClick={handleClear}>
            ✕
          </ClearButton>
        )}
        <KeyboardShortcut>⌘K</KeyboardShortcut>
      </SearchInputWrapper>

      <FilterBar>
        <FilterChip
          active={activeFilters.status.includes('completed')}
          onClick={() => toggleFilter('status', 'completed')}
        >
          ✅ Completed
        </FilterChip>
        <FilterChip
          active={activeFilters.status.includes('recording')}
          onClick={() => toggleFilter('status', 'recording')}
        >
          🔴 Recording
        </FilterChip>
        <FilterChip
          active={activeFilters.status.includes('scheduled')}
          onClick={() => toggleFilter('status', 'scheduled')}
        >
          📅 Scheduled
        </FilterChip>
        <FilterChip
          active={activeFilters.platforms.includes('zoom')}
          onClick={() => toggleFilter('platforms', 'zoom')}
        >
          Zoom
        </FilterChip>
        <FilterChip
          active={activeFilters.platforms.includes('googlemeet')}
          onClick={() => toggleFilter('platforms', 'googlemeet')}
        >
          Google Meet
        </FilterChip>
        <FilterChip
          active={activeFilters.platforms.includes('teams')}
          onClick={() => toggleFilter('platforms', 'teams')}
        >
          Teams
        </FilterChip>
      </FilterBar>

      {showHistory && searchHistory.length > 0 && !searchQuery && (
        <SearchHistory>
          {searchHistory.map((query, index) => (
            <HistoryItem key={index} onClick={() => handleHistoryClick(query)}>
              <SearchIcon>🔍</SearchIcon>
              {query}
              <span>recent</span>
            </HistoryItem>
          ))}
        </SearchHistory>
      )}
    </SearchContainer>
  );
}