import React, { useState, useEffect } from 'react';
import styled from '@emotion/styled';
import { Meeting } from '../../shared/types';
import { format, isToday, isTomorrow, isYesterday, formatDistanceToNow } from 'date-fns';

const ListContainer = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  padding-bottom: 60px;
`;

const MeetingItem = styled.div<{ selected: boolean }>`
  padding: 14px;
  margin: 0 8px 8px 8px;
  background: ${props => props.selected ?
    'linear-gradient(135deg, rgba(102, 126, 234, 0.1) 0%, rgba(118, 75, 162, 0.1) 100%)' :
    '#ffffff'};
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.3s;
  border: 2px solid ${props => props.selected ? 'rgba(102, 126, 234, 0.5)' : 'transparent'};
  box-shadow: ${props => props.selected ?
    '0 4px 12px rgba(102, 126, 234, 0.15)' :
    '0 2px 4px rgba(0, 0, 0, 0.05)'};

  &:hover {
    background: ${props => props.selected ?
      'linear-gradient(135deg, rgba(102, 126, 234, 0.1) 0%, rgba(118, 75, 162, 0.1) 100%)' :
      '#f9fafb'};
    transform: translateX(2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  }
`;

const MeetingTitle = styled.div`
  font-size: 14px;
  font-weight: 500;
  color: #1d1d1f;
  margin-bottom: 4px;
`;

const MeetingMeta = styled.div`
  font-size: 12px;
  color: #86868b;
  display: flex;
  align-items: center;
  gap: 8px;
`;

const StatusBadge = styled.span<{ status: Meeting['status'] }>`
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 20px;
  font-size: 11px;
  font-weight: 600;
  background: ${props => {
    switch(props.status) {
      case 'recording': return 'linear-gradient(135deg, #ff3b30 0%, #ff6b6b 100%)';
      case 'completed': return 'linear-gradient(135deg, #34c759 0%, #51cf66 100%)';
      case 'scheduled': return 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
      case 'partial': return 'linear-gradient(135deg, #ff9500 0%, #ffab00 100%)';
      case 'error': return 'linear-gradient(135deg, #ff3b30 0%, #ff6b6b 100%)';
      default: return 'linear-gradient(135deg, #86868b 0%, #94a3b8 100%)';
    }
  }};
  color: white;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
`;

const Icons = styled.div`
  display: flex;
  gap: 4px;
  margin-left: auto;
`;

const ReadyBadge = styled.div`
  background: #00C851;
  color: white;
  padding: 2px 8px;
  border-radius: 8px;
  font-size: 11px;
  font-weight: 600;
  animation: pulse 2s infinite;
  margin-left: auto;

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.7; }
  }
`;

const Icon = styled.span`
  font-size: 16px;
`;

const SyncStatus = styled.div`
  padding: 10px;
  margin: 12px;
  font-size: 12px;
  color: #6b7280;
  text-align: center;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  background: rgba(102, 126, 234, 0.05);
  border-radius: 8px;

  &::before {
    content: '';
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: linear-gradient(135deg, #34c759 0%, #51cf66 100%);
    display: inline-block;
    animation: pulse 2s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.7; transform: scale(0.9); }
  }
`;

const EmptyState = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px;
  text-align: center;
  color: #86868b;
  
  h3 {
    font-size: 16px;
    font-weight: 500;
    margin-bottom: 8px;
  }
  
  p {
    font-size: 13px;
  }
`;

interface MeetingListProps {
  meetings: Meeting[];
  selectedMeeting: Meeting | null;
  onSelectMeeting: (meeting: Meeting) => void;
  onSyncCalendar: () => Promise<any>;
  readyToRecordMeetings?: Set<string>;
}

function MeetingList({ meetings, selectedMeeting, onSelectMeeting, onSyncCalendar, readyToRecordMeetings }: MeetingListProps) {
  const [lastSyncTime, setLastSyncTime] = useState<Date>(new Date());

  useEffect(() => {
    // Update sync time whenever meetings change
    setLastSyncTime(new Date());
  }, [meetings]);

  useEffect(() => {
    // Update the sync status every 30 seconds to keep the relative time fresh
    const interval = setInterval(() => {
      setLastSyncTime((prev) => new Date(prev));
    }, 30000);
    
    return () => clearInterval(interval);
  }, []);
  const formatMeetingDate = (date: Date | string) => {
    const meetingDate = new Date(date);
    
    if (isToday(meetingDate)) {
      return `Today, ${format(meetingDate, 'h:mm a')}`;
    } else if (isTomorrow(meetingDate)) {
      return `Tomorrow, ${format(meetingDate, 'h:mm a')}`;
    } else if (isYesterday(meetingDate)) {
      return `Yesterday, ${format(meetingDate, 'h:mm a')}`;
    } else {
      return format(meetingDate, 'MMM d, h:mm a');
    }
  };

  const getStatusLabel = (status: Meeting['status']) => {
    switch(status) {
      case 'recording': return '🔴 Recording';
      case 'completed': return 'Completed';
      case 'scheduled': return 'Scheduled';
      case 'partial': return 'Partial';
      case 'error': return 'Error';
      default: return status;
    }
  };

  if (meetings.length === 0) {
    return (
      <ListContainer>
        <EmptyState>
          <h3>No meetings yet</h3>
          <p>Your calendar syncs automatically</p>
        </EmptyState>
        <SyncStatus>
          Auto-syncing • Last sync {formatDistanceToNow(lastSyncTime, { addSuffix: true })}
        </SyncStatus>
      </ListContainer>
    );
  }

  return (
    <ListContainer>
      <SyncStatus>
        Auto-syncing • Last sync {formatDistanceToNow(lastSyncTime, { addSuffix: true })}
      </SyncStatus>
      
      {meetings.map(meeting => (
        <MeetingItem
          key={meeting.id}
          selected={selectedMeeting?.id === meeting.id}
          onClick={() => onSelectMeeting(meeting)}
        >
          <MeetingTitle>{meeting.title}</MeetingTitle>
          <MeetingMeta>
            <span>{formatMeetingDate(meeting.date)}</span>
            {meeting.duration && <span>• {meeting.duration} min</span>}
            {readyToRecordMeetings?.has(meeting.calendarEventId || meeting.id) && (
              <ReadyBadge>Ready to Record</ReadyBadge>
            )}
            <Icons>
              {meeting.notes && <Icon title="Has notes">📝</Icon>}
              {meeting.transcript && <Icon title="Has transcript">🎙️</Icon>}
              {meeting.calendarEventId && <Icon title="From calendar">📅</Icon>}
            </Icons>
          </MeetingMeta>
          <StatusBadge status={meeting.status}>
            {getStatusLabel(meeting.status)}
          </StatusBadge>
        </MeetingItem>
      ))}
    </ListContainer>
  );
}

export default MeetingList;