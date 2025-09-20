import React from 'react';
import styled from '@emotion/styled';
import { SearchResult, Meeting } from '../../shared/types';
import { format, formatDistanceToNow } from 'date-fns';

const ResultsContainer = styled.div`
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  width: calc(100% - 40px);
  max-width: 800px;
  background: white;
  border: 1px solid #e5e5e7;
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  max-height: 500px;
  overflow-y: auto;
  z-index: 1001;
  margin-top: 8px;
`;

const ResultItem = styled.div`
  padding: 16px;
  border-bottom: 1px solid #e5e5e7;
  cursor: pointer;
  transition: background 0.2s;

  &:hover {
    background: #f9f9f9;
  }

  &:last-child {
    border-bottom: none;
  }
`;

const ResultHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
`;

const ResultTitle = styled.h3`
  font-size: 15px;
  font-weight: 600;
  color: #1d1d1f;
  margin: 0;
`;

const ResultMeta = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  color: #86868b;
`;

const StatusBadge = styled.span<{ status: Meeting['status'] }>`
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 600;
  background: ${props => {
    switch(props.status) {
      case 'recording': return '#ff3b30';
      case 'completed': return '#34c759';
      case 'scheduled': return '#667eea';
      case 'partial': return '#ff9500';
      case 'error': return '#ff3b30';
      default: return '#86868b';
    }
  }};
  color: white;
`;

const MatchPreview = styled.div`
  margin-top: 8px;
  padding: 8px;
  background: #f9f9f9;
  border-radius: 6px;
  font-size: 13px;
  line-height: 1.5;
  color: #1d1d1f;
  max-height: 60px;
  overflow: hidden;
  position: relative;

  &::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 20px;
    background: linear-gradient(transparent, #f9f9f9);
  }
`;

const Highlight = styled.mark`
  background: rgba(255, 204, 0, 0.4);
  padding: 0 2px;
  border-radius: 2px;
  font-weight: 500;
`;

const MatchInfo = styled.div`
  display: flex;
  gap: 8px;
  margin-top: 6px;
  font-size: 11px;
  color: #86868b;
`;

const MatchField = styled.span`
  background: rgba(102, 126, 234, 0.1);
  color: #667eea;
  padding: 2px 6px;
  border-radius: 4px;
  font-weight: 500;
`;

const Score = styled.span`
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 600;
`;

const NoResults = styled.div`
  padding: 32px;
  text-align: center;
  color: #86868b;
`;

const ResultsHeader = styled.div`
  padding: 12px 16px;
  background: #f9f9f9;
  border-bottom: 1px solid #e5e5e7;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  color: #86868b;
`;

const ClearButton = styled.button`
  background: none;
  border: none;
  color: #667eea;
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;

  &:hover {
    text-decoration: underline;
  }
`;

interface SearchResultsProps {
  results: SearchResult[];
  onSelectResult: (meeting: Meeting) => void;
  onClear?: () => void;
  loading?: boolean;
}

export default function SearchResults({ results, onSelectResult, onClear, loading }: SearchResultsProps) {
  const highlightText = (text: string, indices: [number, number][]): React.ReactNode => {
    if (!text || !indices || indices.length === 0) return text;

    const elements: React.ReactNode[] = [];
    let lastIndex = 0;

    indices.forEach(([start, end]) => {
      if (start > lastIndex) {
        elements.push(text.substring(lastIndex, start));
      }
      elements.push(<Highlight key={`${start}-${end}`}>{text.substring(start, end + 1)}</Highlight>);
      lastIndex = end + 1;
    });

    if (lastIndex < text.length) {
      elements.push(text.substring(lastIndex));
    }

    return <>{elements}</>;
  };

  const getMatchPreview = (result: SearchResult): React.ReactNode => {
    // Find the best match to show
    const relevantMatch = result.matches.find(m =>
      m.field === 'transcript' || m.field === 'notes' || m.field === 'insights'
    ) || result.matches[0];

    if (!relevantMatch) return null;

    const text = relevantMatch.value;
    if (!text) return null;

    // Get context around the first match
    const firstIndex = relevantMatch.indices[0]?.[0] || 0;
    const contextStart = Math.max(0, firstIndex - 50);
    const contextEnd = Math.min(text.length, firstIndex + 150);

    let preview = text.substring(contextStart, contextEnd);
    if (contextStart > 0) preview = '...' + preview;
    if (contextEnd < text.length) preview = preview + '...';

    // Adjust indices for the substring
    const adjustedIndices = relevantMatch.indices
      .filter(([start]) => start >= contextStart && start < contextEnd)
      .map(([start, end]): [number, number] => [
        start - contextStart + (contextStart > 0 ? 3 : 0),
        Math.min(end - contextStart + (contextStart > 0 ? 3 : 0), preview.length - 1)
      ]);

    return highlightText(preview, adjustedIndices);
  };

  const formatScore = (score: number): string => {
    return Math.round((1 - score) * 100) + '%';
  };

  if (loading) {
    return (
      <ResultsContainer>
        <NoResults>
          Searching...
        </NoResults>
      </ResultsContainer>
    );
  }

  if (results.length === 0) {
    return null;
  }

  return (
    <ResultsContainer>
      <ResultsHeader>
        <span>Found {results.length} result{results.length !== 1 ? 's' : ''}</span>
        {onClear && (
          <ClearButton onClick={onClear}>Clear search</ClearButton>
        )}
      </ResultsHeader>

      {results.map((result, index) => (
        <ResultItem key={index} onClick={() => onSelectResult(result.meeting)}>
          <ResultHeader>
            <ResultTitle>{result.meeting.title}</ResultTitle>
            <Score>{formatScore(result.score)}</Score>
          </ResultHeader>

          <ResultMeta>
            <span>
              {format(new Date(result.meeting.date), 'MMM d, yyyy')} • {' '}
              {formatDistanceToNow(new Date(result.meeting.date), { addSuffix: true })}
            </span>
            <StatusBadge status={result.meeting.status}>
              {result.meeting.status}
            </StatusBadge>
            {result.meeting.platform && (
              <span>{result.meeting.platform}</span>
            )}
          </ResultMeta>

          {result.matches.length > 0 && (
            <>
              <MatchPreview>
                {getMatchPreview(result)}
              </MatchPreview>
              <MatchInfo>
                {Array.from(new Set(result.matches.map(m => m.field))).map(field => (
                  <MatchField key={field}>{field}</MatchField>
                ))}
              </MatchInfo>
            </>
          )}
        </ResultItem>
      ))}
    </ResultsContainer>
  );
}