import React, { useState, useEffect, useRef, useCallback } from 'react';
import styled from '@emotion/styled';
import { Meeting, Attendee, IpcChannels, CoachingType, CoachingFeedback } from '../../shared/types';
import { format, formatDistanceToNow } from 'date-fns';
import MDEditor from '@uiw/react-md-editor';

const Container = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #ffffff;
`;

const Header = styled.div`
  padding: 20px 28px;
  background: #ffffff;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
`;

const TitleRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
`;

const Title = styled.h1`
  font-size: 24px;
  font-weight: 600;
  color: #1a1a1a;
  margin: 0;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  position: relative;
  transition: color 0.2s;

  &:hover {
    color: #007AFF;

    .edit-icon {
      opacity: 1;
    }
  }

  .edit-icon {
    margin-left: 12px;
    font-size: 16px;
    opacity: 0;
    transition: opacity 0.2s;
    display: inline-block;
  }
`;

const TitleInput = styled.input`
  font-size: 24px;
  font-weight: 600;
  color: #1a1a1a;
  margin: 0;
  padding: 4px 8px;
  border: 2px solid #007AFF;
  border-radius: 6px;
  outline: none;
  background: white;
  width: 100%;

  &:focus {
    box-shadow: 0 0 0 3px rgba(0, 122, 255, 0.1);
  }
`;

const MetaInfo = styled.div`
  display: flex;
  gap: 16px;
  color: #666;
  font-size: 13px;
  align-items: center;
`;

const MetaItem = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  position: relative;
`;

const AttendeesList = styled.div`
  position: absolute;
  top: 100%;
  left: 0;
  margin-top: 8px;
  background: white;
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 8px;
  padding: 12px;
  min-width: 250px;
  max-width: 350px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  z-index: 1000;
`;

const AttendeeItem = styled.div`
  padding: 6px 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);

  &:last-child {
    border-bottom: none;
  }
`;

const AttendeeName = styled.div`
  font-size: 13px;
  color: #1a1a1a;
  font-weight: 500;
`;

const AttendeeEmail = styled.div`
  font-size: 12px;
  color: #666;
  user-select: all;
  cursor: text;
`;

const AttendeeToggle = styled.button`
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
  color: #666;
  font-size: 13px;

  &:hover {
    color: #1a1a1a;
  }
`;

const TabPanel = styled.div<{ isActive: boolean }>`
  display: ${props => props.isActive ? 'block' : 'none'};
  width: 100%;
  height: 100%;
`;

const ActionButtons = styled.div`
  display: flex;
  gap: 8px;
`;

const ShowInFinderButton = styled.button`
  padding: 8px 14px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
  background: #f5f5f7;
  color: #333;
  border: 1px solid rgba(0, 0, 0, 0.1);

  &:hover {
    background: #e8e8ea;
  }
`;

const Button = styled.button<{ variant?: 'primary' | 'danger' | 'ghost' }>`
  padding: 8px 14px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
  border: none;

  ${props => {
    switch(props.variant) {
      case 'danger':
        return `
          background: #fff;
          color: #dc2626;
          border: 1px solid #fee2e2;
          &:hover {
            background: #fef2f2;
          }
        `;
      case 'ghost':
        return `
          background: transparent;
          color: #666;
          &:hover {
            background: #f5f5f5;
          }
        `;
      default:
        return `
          background: #667eea;
          color: white;
          &:hover {
            background: #5a67d8;
          }
        `;
    }
  }}
`;

const TabContainer = styled.div`
  display: flex;
  gap: 0;
  margin-top: 12px;
  border-bottom: 1px solid #e5e7eb;
`;

const Tab = styled.button<{ active: boolean }>`
  padding: 10px 16px;
  background: transparent;
  border: none;
  border-bottom: 2px solid ${props => props.active ? '#667eea' : 'transparent'};
  color: ${props => props.active ? '#667eea' : '#666'};
  font-weight: ${props => props.active ? '500' : '400'};
  font-size: 14px;
  cursor: pointer;
  transition: all 0.15s;
  margin-bottom: -1px;

  &:hover {
    color: #667eea;
  }
`;

const Content = styled.div`
  flex: 1;
  overflow-y: auto;
  background: #fafafa;

  &::-webkit-scrollbar {
    width: 8px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    background: #ddd;
    border-radius: 4px;

    &:hover {
      background: #ccc;
    }
  }
`;

const EditorContainer = styled.div`
  padding: 24px;
  background: white;
  min-height: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;

  .w-md-editor {
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    background: white;
  }

  .w-md-editor-toolbar {
    background: #fafafa;
    border-bottom: 1px solid #e5e7eb;
  }

  .w-md-editor-content {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }
`;

const EditorToolbar = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 4px;
`;

const EditorModeButton = styled.button<{ isActive?: boolean }>`
  padding: 6px 12px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
  border: 1px solid ${props => props.isActive ? '#007AFF' : 'rgba(0, 0, 0, 0.1)'};
  background: ${props => props.isActive ? '#007AFF' : 'white'};
  color: ${props => props.isActive ? 'white' : '#333'};

  &:hover {
    background: ${props => props.isActive ? '#0051D5' : '#f0f0f0'};
  }
`;

const TranscriptContainer = styled.div`
  padding: 24px;
  background: white;
  min-height: 100%;
`;

const TranscriptHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
`;

const TranscriptTitle = styled.h2`
  font-size: 18px;
  font-weight: 600;
  color: #1a1a1a;
  margin: 0;
`;

const TranscriptSegment = styled.div`
  margin-bottom: 20px;
  padding: 16px;
  background: #fafafa;
  border-radius: 8px;
  border-left: 3px solid #667eea;
`;

const TranscriptMeta = styled.div`
  display: flex;
  gap: 12px;
  margin-bottom: 8px;
  font-size: 12px;
`;

const TranscriptTime = styled.span`
  color: #667eea;
  font-weight: 600;
  font-family: 'SF Mono', Monaco, monospace;
`;

const TranscriptSpeaker = styled.span`
  color: #666;
  font-weight: 500;
`;

const TranscriptText = styled.p`
  color: #333;
  line-height: 1.6;
  font-size: 14px;
  margin: 0;
`;

const EmptyState = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px;
  text-align: center;
  color: #999;
  min-height: 400px;

  .icon {
    font-size: 48px;
    margin-bottom: 16px;
    opacity: 0.3;
  }

  h3 {
    font-size: 18px;
    font-weight: 500;
    margin-bottom: 8px;
    color: #666;
  }

  p {
    font-size: 14px;
    color: #999;
  }
`;

const Modal = styled.div<{ show: boolean }>`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.4);
  display: ${props => props.show ? 'flex' : 'none'};
  align-items: center;
  justify-content: center;
  z-index: 1000;
`;

const ModalContent = styled.div`
  background: white;
  border-radius: 12px;
  padding: 24px;
  max-width: 400px;
  width: 90%;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
`;

const ModalTitle = styled.h3`
  font-size: 18px;
  font-weight: 600;
  color: #1a1a1a;
  margin-bottom: 8px;
`;

const ModalText = styled.p`
  color: #666;
  font-size: 14px;
  margin-bottom: 20px;
  line-height: 1.5;
`;

const ModalButtons = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 10px;
`;

const CoachContainer = styled.div`
  padding: 24px;
  background: white;
  min-height: 100%;
  display: flex;
  flex-direction: column;
  gap: 20px;
`;

const CoachControls = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  background: #fafafa;
  border-radius: 12px;
  border: 1px solid #e5e7eb;
`;

const CoachTypeSelector = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const CoachTypeLabel = styled.label`
  font-size: 14px;
  font-weight: 600;
  color: #333;
`;

const CoachTypeSelect = styled.select`
  padding: 10px 12px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  font-size: 14px;
  background: white;
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    border-color: #667eea;
  }

  &:focus {
    outline: none;
    border-color: #667eea;
    box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
  }
`;

const CoachButtonGroup = styled.div`
  display: flex;
  gap: 12px;
`;

const CoachStatusBadge = styled.div<{ isActive: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 600;
  background: ${props => props.isActive ? '#d4f4dd' : '#f5f5f7'};
  color: ${props => props.isActive ? '#00875a' : '#666'};
`;

const FeedbackList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-height: 600px;
  overflow-y: auto;

  &::-webkit-scrollbar {
    width: 8px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    background: #ddd;
    border-radius: 4px;

    &:hover {
      background: #ccc;
    }
  }
`;

const FeedbackCard = styled.div`
  padding: 16px;
  background: #fafafa;
  border-radius: 12px;
  border: 1px solid #e5e7eb;
  animation: slideIn 0.3s ease;

  @keyframes slideIn {
    from {
      opacity: 0;
      transform: translateY(-10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
`;

const FeedbackTimestamp = styled.div`
  font-size: 12px;
  color: #999;
  margin-bottom: 12px;
  font-family: 'SF Mono', Monaco, monospace;
`;

const FeedbackSection = styled.div<{ type: 'alert' | 'observation' | 'suggestion' }>`
  margin-bottom: 12px;

  &:last-child {
    margin-bottom: 0;
  }

  h4 {
    font-size: 13px;
    font-weight: 600;
    margin-bottom: 8px;
    display: flex;
    align-items: center;
    gap: 6px;
    color: ${props => {
      switch(props.type) {
        case 'alert': return '#ff3b30';
        case 'observation': return '#007AFF';
        case 'suggestion': return '#34c759';
      }
    }};
  }

  ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }

  li {
    padding: 8px 12px;
    margin-bottom: 6px;
    background: white;
    border-radius: 6px;
    font-size: 13px;
    line-height: 1.5;
    color: #333;
    border-left: 3px solid ${props => {
      switch(props.type) {
        case 'alert': return '#ff3b30';
        case 'observation': return '#007AFF';
        case 'suggestion': return '#34c759';
      }
    }};

    &:last-child {
      margin-bottom: 0;
    }
  }
`;

interface MeetingDetailFinalProps {
  meeting: Meeting;
  onUpdateMeeting: (meeting: Meeting) => void;
  onDeleteMeeting?: (meetingId: string) => void;
  onRefresh?: () => void;
}

type ViewMode = 'notes' | 'transcript' | 'insights' | 'actions' | 'coach';

// Module-level transcript cache to persist across component re-renders
const transcriptCache = new Map<string, any[]>();

function MeetingDetailFinal({ meeting, onUpdateMeeting, onDeleteMeeting, onRefresh }: MeetingDetailFinalProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('notes');
  const [notes, setNotes] = useState(meeting.notes || '');
  const [editorPreviewMode, setEditorPreviewMode] = useState<'edit' | 'live' | 'preview'>('preview');
  const [isSaving, setIsSaving] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [transcriptSegments, setTranscriptSegments] = useState<any[]>(
    transcriptCache.get(meeting.id) || []
  );
  const [isRecording, setIsRecording] = useState(meeting.status === 'recording');
  const [showAttendees, setShowAttendees] = useState(false);
  const [isCorrecting, setIsCorrecting] = useState(false);
  const [correctionProgress, setCorrectionProgress] = useState<{ current: number; total: number; percentage: number } | null>(null);
  const [editorKey, setEditorKey] = useState(Date.now()); // Force fresh editor instance
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState(meeting.title);
  const [insights, setInsights] = useState<any>(null);
  const [isGeneratingInsights, setIsGeneratingInsights] = useState(false);
  const [teamSummary, setTeamSummary] = useState<any>(null);
  const [isGeneratingTeamSummary, setIsGeneratingTeamSummary] = useState(false);
  const [editedTeamContent, setEditedTeamContent] = useState('');
  const [slackShared, setSlackShared] = useState(meeting.slackSharedAt);
  const [isSharing, setIsSharing] = useState(false);
  const isFirstRender = useRef(true);

  // Coaching state
  const [isCoaching, setIsCoaching] = useState(false);
  const [selectedCoachingType, setSelectedCoachingType] = useState<CoachingType>('coach-sales');
  const [coachingFeedbackHistory, setCoachingFeedbackHistory] = useState<CoachingFeedback[]>([]);

  // Update cache when segments change
  useEffect(() => {
    console.log('[CACHE-UPDATE] Setting cache', {
      meetingId: meeting.id,
      meetingTitle: meeting.title,
      segmentCount: transcriptSegments.length,
      firstSegment: transcriptSegments[0]?.text?.substring(0, 50),
      lastSegment: transcriptSegments[transcriptSegments.length - 1]?.text?.substring(0, 50)
    });
    transcriptCache.set(meeting.id, transcriptSegments);
  }, [meeting.id, transcriptSegments]);

  useEffect(() => {
    console.log('[MEETING-CHANGE] Effect triggered', {
      meetingId: meeting.id,
      meetingTitle: meeting.title,
      meetingStatus: meeting.status,
      isRecordingState: isRecording,
      currentSegmentCount: transcriptSegments.length,
      transcriptLength: meeting.transcript?.length || 0
    });

    setNotes(meeting.notes || '');
    setEditedTitle(meeting.title); // Update title when meeting prop changes
    setHasChanges(false);
    setIsRecording(meeting.status === 'recording');
    setEditorKey(Date.now()); // Force complete editor remount when meeting changes
    isFirstRender.current = true; // Reset first render flag for new meeting

    // Clear coaching state when switching meetings
    if (isCoaching) {
      console.log('[COACHING] Auto-stopping coaching due to meeting change');
      handleStopCoaching();
    }
    setCoachingFeedbackHistory([]);
    setSelectedCoachingType('coach-sales');

    // Load existing insights if available
    if (meeting.insights) {
      try {
        setInsights(JSON.parse(meeting.insights));
      } catch (e) {
        console.error('Failed to parse insights:', e);
        setInsights(null);
      }
    }

    // Load existing team summary if available
    if (meeting.teamSummary) {
      try {
        setTeamSummary(JSON.parse(meeting.teamSummary));
      } catch (e) {
        console.error('Failed to parse team summary:', e);
        setTeamSummary(null);
      }
    } else {
      setTeamSummary(null);
    }

    // Update slack shared status
    setSlackShared(meeting.slackSharedAt);

    // When recording stops, clear segments and load from stored transcript
    // When recording is active, don't parse stored transcript (rely on real-time)
    // When viewing completed meetings, parse the stored transcript
    if (meeting.status !== 'recording') {
      console.log('[MEETING-CHANGE] Loading transcript (not recording)');
      if (meeting.transcript) {
        const parsed = parseTranscript(meeting.transcript);
        console.log('[MEETING-CHANGE] Parsed transcript segments:', parsed.length);
        setTranscriptSegments(parsed);
        // Clear the cache when we parse from stored transcript to avoid duplicates
        transcriptCache.set(meeting.id, parsed);
      } else {
        console.log('[MEETING-CHANGE] No transcript, clearing segments');
        setTranscriptSegments([]);
        transcriptCache.set(meeting.id, []);
      }
    } else if (meeting.status === 'recording' && !isRecording) {
      // Just started recording - clear old segments
      console.log('[MEETING-CHANGE] Just started recording, clearing segments');
      setTranscriptSegments([]);
      transcriptCache.set(meeting.id, []);
    } else if (meeting.status === 'recording' && isRecording) {
      // Recording in progress - load from cache to avoid duplication
      console.log('[MEETING-CHANGE] Recording in progress, loading from cache');
      const cachedSegments = transcriptCache.get(meeting.id) || [];
      console.log('[MEETING-CHANGE] Loaded from cache:', cachedSegments.length, 'segments');
      setTranscriptSegments(cachedSegments);
    } else {
      console.log('[MEETING-CHANGE] Unknown state, clearing segments', {
        status: meeting.status,
        isRecording: isRecording
      });
      setTranscriptSegments([]);
      transcriptCache.set(meeting.id, []);
    }
  }, [meeting.id, meeting.status, meeting.transcript, meeting.title]);

  // Check for prep note on-demand when viewing a meeting without a file
  useEffect(() => {
    const checkForPrepNote = async () => {
      // Only check if meeting has no file yet
      if (!meeting.filePath) {
        // Check if we already attempted to find prep note for this meeting in this session
        const attemptedKey = `prep-check-${meeting.id}`;
        const lastAttempt = sessionStorage.getItem(attemptedKey);

        // Only search if we haven't checked in this session (hybrid approach)
        if (!lastAttempt) {
          console.log(`[PREP-NOTE-CHECK] Checking for prep note: ${meeting.title}`);
          try {
            const updatedMeeting = await window.electronAPI.checkPrepNote(meeting.id);

            if (updatedMeeting?.filePath) {
              console.log(`[PREP-NOTE-CHECK] Prep note found and adopted: ${updatedMeeting.filePath}`);
              // Meeting will be updated via MEETINGS_UPDATED event from backend
            } else {
              console.log(`[PREP-NOTE-CHECK] No prep note found for: ${meeting.title}`);
            }

            // Mark as checked in this session
            sessionStorage.setItem(attemptedKey, Date.now().toString());
          } catch (error) {
            console.error('[PREP-NOTE-CHECK] Failed to check for prep note:', error);
          }
        }
      }
    };

    checkForPrepNote();
  }, [meeting.id, meeting.filePath]);

  // Listen for recording started events
  useEffect(() => {
    const handleRecordingStarted = (data: any) => {
      if (data.meetingId === meeting.id) {
        console.log('[MeetingDetailFinal] Recording started for this meeting');
        setIsRecording(true);
        // Don't clear segments - keep existing transcript and append new ones
        // This allows resuming recording on same meeting
      }
    };

    const handleRecordingStopped = () => {
      console.log('[MeetingDetailFinal] Recording stopped');
      setIsRecording(false);

      // Auto-stop coaching when recording ends
      if (isCoaching) {
        console.log('[COACHING] Auto-stopping coaching due to recording end');
        handleStopCoaching();
      }
    };

    (window as any).electronAPI?.on?.('recording-started', handleRecordingStarted);
    (window as any).electronAPI?.on?.('recording-stopped', handleRecordingStopped);

    return () => {
      (window as any).electronAPI?.removeListener?.('recording-started', handleRecordingStarted);
      (window as any).electronAPI?.removeListener?.('recording-stopped', handleRecordingStopped);
    };
  }, [meeting.id, isCoaching]);

  // Listen for correction progress updates
  useEffect(() => {
    const handleCorrectionProgress = (data: any) => {
      if (data.meetingId === meeting.id) {
        setCorrectionProgress({
          current: data.current,
          total: data.total,
          percentage: data.percentage
        });
      }
    };

    const handleCorrectionCompleted = (data: any) => {
      if (data.meetingId === meeting.id) {
        // Refresh the meeting data after correction completes
        if (onRefresh) {
          onRefresh();
        }
        setIsCorrecting(false);
        setCorrectionProgress(null);
      }
    };

    (window as any).electronAPI?.on?.('correction-progress', handleCorrectionProgress);
    (window as any).electronAPI?.on?.('correction-completed', handleCorrectionCompleted);

    return () => {
      (window as any).electronAPI?.removeListener?.('correction-progress', handleCorrectionProgress);
      (window as any).electronAPI?.removeListener?.('correction-completed', handleCorrectionCompleted);
    };
  }, [meeting.id, onRefresh]);

  // Listen for coaching feedback
  // Listen for real-time coaching feedback
  // Use useCallback to create stable handler references that prevent duplicate listeners
  const handleCoachingFeedback = useCallback((data: any) => {
    if (data.meetingId === meeting.id) {
      console.log('[COACHING] Received feedback:', data.feedback);
      setCoachingFeedbackHistory(prev => [...prev, data.feedback]);
    }
  }, [meeting.id]);

  const handleCoachingError = useCallback((data: any) => {
    if (data.meetingId === meeting.id) {
      console.error('[COACHING] Error:', data.error);
      alert(`Coaching error: ${data.error}`);
    }
  }, [meeting.id]);

  useEffect(() => {
    (window as any).electronAPI?.on?.(IpcChannels.COACHING_FEEDBACK, handleCoachingFeedback);
    (window as any).electronAPI?.on?.(IpcChannels.COACHING_ERROR, handleCoachingError);

    return () => {
      (window as any).electronAPI?.removeListener?.(IpcChannels.COACHING_FEEDBACK, handleCoachingFeedback);
      (window as any).electronAPI?.removeListener?.(IpcChannels.COACHING_ERROR, handleCoachingError);
    };
  }, [handleCoachingFeedback, handleCoachingError]);

  // Listen for real-time transcript updates
  // IMPORTANT: We use useCallback with meeting.id dependency to create a stable handler
  // that updates when meeting changes but doesn't cause duplicate listeners
  const handleTranscriptUpdate = useCallback((data: any) => {
    console.log('[TRANSCRIPT-UPDATE] Received', {
      dataMeetingId: data.meetingId,
      currentMeetingId: meeting.id,
      matches: data.meetingId === meeting.id,
      text: data.text?.substring(0, 50)
    });

    if (data.meetingId !== meeting.id) {
      console.log('[TRANSCRIPT-UPDATE] Ignoring - not for current meeting');
      return;
    }

    setTranscriptSegments(prev => {
      console.log('[TRANSCRIPT-UPDATE] Current segment count before add:', prev.length);

      // Normalize timestamp for comparison (IPC serializes Date to string)
      const newTimestamp = typeof data.timestamp === 'string'
        ? new Date(data.timestamp).getTime()
        : data.timestamp?.getTime?.() || Date.now();

      // Check for duplicates before adding - compare text and normalized timestamps
      const isDuplicate = prev.some(s => {
        const existingTimestamp = typeof s.timestamp === 'string'
          ? new Date(s.timestamp).getTime()
          : s.timestamp?.getTime?.() || 0;

        // Consider duplicate if same text and timestamp within 100ms (accounts for slight timing differences)
        return s.text === data.text && Math.abs(existingTimestamp - newTimestamp) < 100;
      });

      if (!isDuplicate) {
        const newSegment = {
          id: `${Date.now()}-${Math.random()}`,
          time: format(new Date(data.timestamp), 'HH:mm:ss'),
          speaker: data.speaker || 'Unknown Speaker',
          text: data.text,
          timestamp: data.timestamp
        };

        const updated = [...prev, newSegment];
        console.log('[TRANSCRIPT-UPDATE] Added new segment, total now:', updated.length);

        // Update cache immediately
        transcriptCache.set(meeting.id, updated);
        return updated;
      }
      console.log('[TRANSCRIPT-UPDATE] Duplicate detected, not adding');
      return prev;
    });
  }, [meeting.id]);

  // Set up transcript listener with proper cleanup
  useEffect(() => {
    console.log('[MeetingDetailFinal] Setting up transcript listener for meeting:', meeting.id);

    // Use the IPC channel directly without the wrapper issue
    const channel = 'transcript-update';

    // Register the listener
    (window as any).electronAPI?.on?.(channel, handleTranscriptUpdate);

    // Return cleanup function
    return () => {
      console.log('[MeetingDetailFinal] Cleaning up transcript listener for meeting:', meeting.id);
      (window as any).electronAPI?.removeListener?.(channel, handleTranscriptUpdate);
    };
  }, [handleTranscriptUpdate]); // Depend on the memoized handler, not meeting.id directly

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onUpdateMeeting({ ...meeting, notes });
      setHasChanges(false);
    } catch (error) {
      console.error('Failed to save notes:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleNotesChange = (value: string) => {
    // Ignore the first onChange trigger from editor mount
    if (isFirstRender.current) {
      isFirstRender.current = false;
      setNotes(value);
      return;
    }

    setNotes(value);
    // Only mark as changed if the value actually differs from the original
    const originalNotes = meeting.notes || '';
    setHasChanges(value !== originalNotes);
  };

  const handleDelete = () => {
    if (onDeleteMeeting) {
      onDeleteMeeting(meeting.id);
      setShowDeleteModal(false);
    }
  };

  const handleCorrectTranscript = async () => {
    if (!meeting.transcript || isCorrecting) return;

    try {
      setIsCorrecting(true);
      setCorrectionProgress(null);

      // Estimate correction time
      const lines = meeting.transcript.split('\n').filter((line: string) => line.trim()).length;
      const blocks = Math.ceil(lines / 100);
      const estimatedSeconds = Math.round(blocks * 2.5);

      console.log(`Transcript has ${lines} lines, will process in ${blocks} blocks (~${estimatedSeconds}s)`);

      // Call the main process to correct the transcript
      const result = await (window as any).electronAPI.correctTranscript(meeting.id);

      if (result.success) {
        // Transcript correction succeeded - refresh meeting data
        if (result.transcript) {
          // Update local state with corrected transcript
          setTranscriptSegments(parseTranscript(result.transcript));
          // The parent component should refresh the meeting data from storage
          if (onRefresh) {
            await onRefresh();
          }
        }
      } else {
        console.error('Transcript correction failed:', result.error);
        alert('Failed to correct transcript. Please check your Anthropic API key in settings.');
      }
    } catch (error) {
      console.error('Error correcting transcript:', error);
      alert('An error occurred while correcting the transcript.');
    } finally {
      setIsCorrecting(false);
      setCorrectionProgress(null);
    }
  };

  const handleShowInFinder = async () => {
    if (meeting.filePath) {
      try {
        await (window as any).electronAPI?.showInFinder?.(meeting.filePath);
      } catch (error) {
        console.error('Failed to show in Finder:', error);
      }
    }
  };

  const handleGenerateInsights = async () => {
    if (isGeneratingInsights) return;

    try {
      setIsGeneratingInsights(true);

      // Call the main process to generate insights
      const result = await (window as any).electronAPI.generateInsights(meeting.id);

      if (result.success && result.insights) {
        // Parse and set the insights
        const parsedInsights = JSON.parse(result.insights);
        setInsights(parsedInsights);

        // Refresh meeting data to get updated insights
        if (onRefresh) {
          await onRefresh();
        }
      } else {
        console.error('Failed to generate insights:', result.error);
        alert('Failed to generate insights. Please check your Anthropic API key in settings.');
      }
    } catch (error) {
      console.error('Error generating insights:', error);
      alert('An error occurred while generating insights.');
    } finally {
      setIsGeneratingInsights(false);
    }
  };

  const handleGenerateTeamSummary = async () => {
    if (isGeneratingTeamSummary) return;

    try {
      setIsGeneratingTeamSummary(true);

      // Call the main process to generate team summary
      const result = await (window as any).electronAPI.generateTeamSummary(meeting.id);

      if (result.success && result.teamSummary) {
        // Parse and set the team summary
        const parsedTeamSummary = JSON.parse(result.teamSummary);
        setTeamSummary(parsedTeamSummary);

        // Refresh meeting data to get updated team summary
        if (onRefresh) {
          await onRefresh();
        }
      } else {
        console.error('Failed to generate team summary:', result.error);
        alert('Failed to generate team summary. Please check your Anthropic API key in settings.');
      }
    } catch (error) {
      console.error('Error generating team summary:', error);
      alert('An error occurred while generating team summary.');
    } finally {
      setIsGeneratingTeamSummary(false);
    }
  };

  const formatTeamSummary = (summary: any): string => {
    if (!summary) return '';

    let formatted = `# Meeting Summary: ${meeting.title}\n\n`;
    formatted += `**Date:** ${format(new Date(meeting.date), 'PPP')}\n`;
    formatted += `**Attendees:** ${Array.isArray(meeting.attendees) ? meeting.attendees.join(', ') : meeting.attendees}\n\n`;

    if (summary.summary) {
      formatted += `## Overview\n${summary.summary}\n\n`;
    }

    if (summary.keyDecisions && summary.keyDecisions.length > 0) {
      formatted += `## Key Decisions\n`;
      summary.keyDecisions.forEach((decision: string, index: number) => {
        formatted += `${index + 1}. ${decision}\n`;
      });
      formatted += '\n';
    }

    if (summary.actionItems && summary.actionItems.length > 0) {
      formatted += `## Action Items\n`;
      summary.actionItems.forEach((item: any, index: number) => {
        formatted += `${index + 1}. **${item.owner || 'Unassigned'}**: ${item.task}`;
        if (item.due) formatted += ` (Due: ${item.due})`;
        formatted += '\n';
      });
      formatted += '\n';
    }

    if (summary.followUps && summary.followUps.length > 0) {
      formatted += `## Follow-up Items\n`;
      summary.followUps.forEach((item: string, index: number) => {
        formatted += `${index + 1}. ${item}\n`;
      });
    }

    return formatted;
  };

  const handleShareToSlack = async () => {
    if (isSharing) return;

    try {
      setIsSharing(true);

      const contentToShare = editedTeamContent || formatTeamSummary(teamSummary);

      // Call the main process to share to Slack
      const result = await (window as any).electronAPI.shareToSlack({
        meetingId: meeting.id,
        content: contentToShare
      });

      if (result.success) {
        setSlackShared(new Date());
        alert('Successfully shared to Slack!');

        // Refresh meeting data to get updated timestamp
        if (onRefresh) {
          await onRefresh();
        }
      } else {
        console.error('Failed to share to Slack:', result.error);
        alert(result.error || 'Failed to share to Slack. Please check your webhook configuration in settings.');
      }
    } catch (error) {
      console.error('Error sharing to Slack:', error);
      alert('An error occurred while sharing to Slack.');
    } finally {
      setIsSharing(false);
    }
  };

  const handleStartCoaching = async () => {
    if (isCoaching) return;

    if (!(window as any).electronAPI?.startCoaching) {
      console.error('[COACHING] API not available');
      alert('Coaching API not available. Please restart the application.');
      return;
    }

    try {
      console.log('[COACHING] Starting coaching with type:', selectedCoachingType);
      const result = await (window as any).electronAPI.startCoaching(meeting.id, selectedCoachingType);

      if (result.success) {
        setIsCoaching(true);
        setCoachingFeedbackHistory([]);
        console.log('[COACHING] Coaching started successfully');
      } else {
        console.error('[COACHING] Failed to start coaching:', result.error);
        alert('Failed to start coaching. Please check your Anthropic API key in settings.');
      }
    } catch (error) {
      console.error('[COACHING] Error starting coaching:', error);
      alert('An error occurred while starting coaching.');
    }
  };

  const handleStopCoaching = async () => {
    if (!isCoaching) return;

    if (!(window as any).electronAPI?.stopCoaching) {
      console.error('[COACHING] API not available');
      setIsCoaching(false);
      return;
    }

    try {
      console.log('[COACHING] Stopping coaching');
      const result = await (window as any).electronAPI.stopCoaching();

      if (result.success) {
        setIsCoaching(false);
        console.log('[COACHING] Coaching stopped successfully');
      } else {
        console.error('[COACHING] Failed to stop coaching:', result.error);
        alert('Failed to stop coaching.');
        // Still set to false locally even if backend fails
        setIsCoaching(false);
      }
    } catch (error) {
      console.error('[COACHING] Error stopping coaching:', error);
      // Still set to false locally even if backend fails
      setIsCoaching(false);
    }
  };

  // Helper function to extract unique speakers from transcript
  const getSpeakersFromTranscript = (): string[] => {
    const speakers = new Set<string>();

    // Get speakers from real-time transcript segments
    transcriptSegments.forEach(segment => {
      if (segment.speaker && segment.speaker !== 'Unknown') {
        speakers.add(segment.speaker);
      }
    });

    // Get speakers from stored transcript
    if (meeting.transcript) {
      const segments = parseTranscript(meeting.transcript);
      segments.forEach(segment => {
        if (segment.speaker && segment.speaker !== 'Unknown') {
          speakers.add(segment.speaker);
        }
      });
    }

    return Array.from(speakers);
  };

  // Helper function to parse attendees
  const getAttendeesList = (): (string | Attendee)[] => {
    // First check if we have calendar attendees
    if (meeting.attendees && meeting.attendees.length > 0) {
      // Check if it's already an array of Attendee objects
      if (typeof meeting.attendees[0] === 'object') {
        return meeting.attendees as Attendee[];
      }

      // Parse string attendees (format: "Name <email>" or just "Name")
      return (meeting.attendees as string[]).map(attendee => {
        const match = attendee.match(/^([^<]+?)(?:\s*<([^>]+)>)?$/);
        if (match) {
          return {
            name: match[1].trim(),
            email: match[2]?.trim()
          };
        }
        return { name: attendee, email: undefined };
      });
    }

    // If no calendar attendees, try to get speakers from transcript
    const speakers = getSpeakersFromTranscript();
    if (speakers.length > 0) {
      return speakers.map(speaker => ({
        name: speaker,
        email: undefined
      }));
    }

    return [];
  };

  const parseTranscript = (transcript: string) => {
    const segments: { time: string; speaker: string; text: string }[] = [];
    const lines = transcript.split('\n');

    let currentSegment: { time: string; speaker: string; text: string } | null = null;
    let lastSpeaker = '';
    let segmentCounter = 0;

    lines.forEach((line, index) => {
      const trimmedLine = line.trim();
      if (!trimmedLine) return;

      // Check for timestamp pattern [HH:MM:SS] or (HH:MM:SS)
      const timeMatch = trimmedLine.match(/^[\[(]?(\d{1,2}:\d{2}(?::\d{2})?)[\])]?\s*(.*)/) ||
                        trimmedLine.match(/^(\d{1,2}:\d{2}(?::\d{2})?)\s+(.*)/);

      if (timeMatch) {
        // Save previous segment if exists
        if (currentSegment && currentSegment.text) {
          segments.push(currentSegment);
        }

        const time = timeMatch[1];
        const restOfLine = timeMatch[2] || '';

        // Check for speaker in the rest of the line
        const speakerMatch = restOfLine.match(/^([A-Z][^:]+):\s*(.*)/);

        if (speakerMatch) {
          lastSpeaker = speakerMatch[1].trim();
          currentSegment = {
            time,
            speaker: lastSpeaker,
            text: speakerMatch[2].trim()
          };
        } else {
          currentSegment = {
            time,
            speaker: lastSpeaker || 'Speaker',
            text: restOfLine.trim()
          };
        }
      } else {
        // Check for speaker pattern without timestamp
        const speakerMatch = trimmedLine.match(/^([A-Z][^:]+):\s*(.*)/);

        if (speakerMatch) {
          // Save previous segment if exists
          if (currentSegment && currentSegment.text) {
            segments.push(currentSegment);
          }

          lastSpeaker = speakerMatch[1].trim();
          segmentCounter++;

          currentSegment = {
            time: `00:${String(Math.floor(segmentCounter / 2)).padStart(2, '0')}:${String((segmentCounter % 2) * 30).padStart(2, '0')}`,
            speaker: lastSpeaker,
            text: speakerMatch[2].trim()
          };
        } else if (currentSegment) {
          // Continue current segment
          currentSegment.text += ' ' + trimmedLine;
        } else {
          // Create new segment without explicit speaker
          segmentCounter++;
          currentSegment = {
            time: `00:${String(Math.floor(segmentCounter / 2)).padStart(2, '0')}:${String((segmentCounter % 2) * 30).padStart(2, '0')}`,
            speaker: lastSpeaker || 'Speaker',
            text: trimmedLine
          };
        }
      }
    });

    // Add the last segment
    if (currentSegment && (currentSegment as any).text) {
      segments.push(currentSegment);
    }

    // If no structured segments found, create simple segments
    if (segments.length === 0 && transcript.trim()) {
      const simpleLines = transcript.split(/\n+/).filter(l => l.trim());
      simpleLines.forEach((line, i) => {
        segments.push({
          time: `00:${String(Math.floor(i / 2)).padStart(2, '0')}:${String((i % 2) * 30).padStart(2, '0')}`,
          speaker: 'Speaker',
          text: line.trim()
        });
      });
    }

    // Group consecutive segments from the same speaker
    const groupedSegments: { time: string; speaker: string; text: string }[] = [];

    segments.forEach((segment, index) => {
      const lastGrouped = groupedSegments[groupedSegments.length - 1];

      // If same speaker as previous segment, combine them
      if (lastGrouped && lastGrouped.speaker === segment.speaker) {
        lastGrouped.text += ' ' + segment.text;
      } else {
        // Different speaker or first segment, add new one
        groupedSegments.push({ ...segment });
      }
    });

    return groupedSegments;
  };

  // Auto-save after 2 seconds of no changes
  useEffect(() => {
    if (!hasChanges) return;

    const timer = setTimeout(() => {
      handleSave();
    }, 2000);

    return () => clearTimeout(timer);
  }, [notes, hasChanges]);

  return (
    <>
      <Container>
        <Header>
          <TitleRow>
            {isEditingTitle ? (
              <TitleInput
                value={editedTitle}
                onChange={(e) => setEditedTitle(e.target.value)}
                onBlur={async () => {
                  if (editedTitle !== meeting.title && editedTitle.trim()) {
                    await onUpdateMeeting({ ...meeting, title: editedTitle });
                    setHasChanges(false);
                  }
                  setIsEditingTitle(false);
                }}
                onKeyDown={async (e) => {
                  if (e.key === 'Enter') {
                    if (editedTitle !== meeting.title && editedTitle.trim()) {
                      await onUpdateMeeting({ ...meeting, title: editedTitle });
                      setHasChanges(false);
                    }
                    setIsEditingTitle(false);
                  } else if (e.key === 'Escape') {
                    setEditedTitle(meeting.title);
                    setIsEditingTitle(false);
                  }
                }}
                autoFocus
              />
            ) : (
              <Title onClick={() => setIsEditingTitle(true)} title="Click to edit">
                {editedTitle}
                <span className="edit-icon">✏️</span>
              </Title>
            )}
            <ActionButtons>
              {meeting.meetingUrl && (
                <Button
                  variant="primary"
                  onClick={() => {
                    if (meeting.meetingUrl) {
                      (window as any).electronAPI.openExternal(meeting.meetingUrl);
                    }
                  }}
                  style={{
                    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                    marginRight: '8px'
                  }}
                >
                  Join Meeting
                </Button>
              )}
              {meeting.calendarInviteUrl && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    if (meeting.calendarInviteUrl) {
                      (window as any).electronAPI.openExternal(meeting.calendarInviteUrl);
                    }
                  }}
                  style={{
                    marginRight: '8px',
                    border: '1px solid #e2e8f0'
                  }}
                >
                  📅 Calendar Event
                </Button>
              )}
              {!isRecording && (
                <Button
                  variant="primary"
                  onClick={async () => {
                    try {
                      await (window as any).electronAPI.startRecording(meeting.id);
                      setIsRecording(true);
                      // Don't clear segments - append to existing transcript
                    } catch (error) {
                      console.error('Failed to start recording:', error);
                    }
                  }}
                >
                  Start Recording
                </Button>
              )}
              {isRecording && (
                <Button
                  variant="danger"
                  onClick={async () => {
                    try {
                      await (window as any).electronAPI.stopRecording(meeting.id);
                      setIsRecording(false);
                    } catch (error) {
                      console.error('Failed to stop recording:', error);
                    }
                  }}
                >
                  Stop Recording
                </Button>
              )}
              {hasChanges && (
                <Button onClick={handleSave} disabled={isSaving}>
                  {isSaving ? 'Saving...' : 'Save'}
                </Button>
              )}
              <Button variant="danger" onClick={() => setShowDeleteModal(true)}>
                Delete
              </Button>
            </ActionButtons>
          </TitleRow>

          <MetaInfo>
            <MetaItem>
              📅 {format(new Date(meeting.date), 'MMM d, yyyy')}
            </MetaItem>
            <MetaItem>
              🕐 {format(new Date(meeting.date), 'h:mm a')}
            </MetaItem>
            {meeting.duration && (
              <MetaItem>
                ⏱️ {meeting.duration} min
              </MetaItem>
            )}
            {(() => {
              const attendeesList = getAttendeesList();
              if (attendeesList.length > 0) {
                const isFromTranscript = !meeting.attendees || meeting.attendees.length === 0;
                return (
                  <MetaItem>
                    <AttendeeToggle onClick={() => setShowAttendees(!showAttendees)}>
                      👥 {attendeesList.length} {isFromTranscript ? 'participant' : 'attendee'}{attendeesList.length !== 1 ? 's' : ''}
                      {isFromTranscript && <span style={{ fontSize: '11px', marginLeft: '4px' }}>(from transcript)</span>}
                      <span style={{ fontSize: '10px' }}>{showAttendees ? '▲' : '▼'}</span>
                    </AttendeeToggle>
                    {showAttendees && (
                      <AttendeesList>
                        {attendeesList.map((attendee, index) => {
                      const attendeeObj = typeof attendee === 'string'
                        ? { name: attendee, email: undefined }
                        : attendee as Attendee;
                      return (
                        <AttendeeItem key={index}>
                          <AttendeeName>{attendeeObj.name}</AttendeeName>
                          {attendeeObj.email && (
                            <AttendeeEmail title="Click to select">{attendeeObj.email}</AttendeeEmail>
                          )}
                        </AttendeeItem>
                      );
                    })}
                  </AttendeesList>
                    )}
                  </MetaItem>
                );
              }
              return null;
            })()}
          </MetaInfo>

          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginTop: '16px' }}>
            <TabContainer style={{ flex: 1 }}>
              <Tab
                active={viewMode === 'notes'}
                onClick={() => setViewMode('notes')}
              >
                Notes
              </Tab>
              <Tab
                active={viewMode === 'transcript'}
                onClick={() => setViewMode('transcript')}
              >
                Transcript
              </Tab>
              <Tab
                active={viewMode === 'insights'}
                onClick={() => setViewMode('insights')}
              >
                Insights
              </Tab>
              <Tab
                active={viewMode === 'actions'}
                onClick={() => {
                  setViewMode('actions');
                  if (!teamSummary && !isGeneratingTeamSummary) {
                    handleGenerateTeamSummary();
                  }
                }}
              >
                Actions
              </Tab>
              <Tab
                active={viewMode === 'coach'}
                onClick={() => setViewMode('coach')}
              >
                Coach
              </Tab>
            </TabContainer>
            {meeting.filePath && (
              <ShowInFinderButton onClick={handleShowInFinder}>
                📁 Show in Finder
              </ShowInFinderButton>
            )}
          </div>
        </Header>

        <Content>
          {/* Notes Panel - Always rendered but hidden when not active */}
          <TabPanel isActive={viewMode === 'notes'}>
            <EditorContainer>
              <EditorToolbar>
                <EditorModeButton
                  isActive={editorPreviewMode === 'preview'}
                  onClick={() => setEditorPreviewMode('preview')}
                >
                  📖 Preview
                </EditorModeButton>
                <EditorModeButton
                  isActive={editorPreviewMode === 'live'}
                  onClick={() => setEditorPreviewMode('live')}
                >
                  ⚡ Split
                </EditorModeButton>
                <EditorModeButton
                  isActive={editorPreviewMode === 'edit'}
                  onClick={() => setEditorPreviewMode('edit')}
                >
                  ✏️ Edit
                </EditorModeButton>
              </EditorToolbar>
              <MDEditor
                key={`editor-${meeting.id}-${editorKey}`}
                value={notes}
                onChange={(value) => handleNotesChange(value || '')}
                height={400}
                preview={editorPreviewMode}
                hideToolbar={false}
              />
            </EditorContainer>
          </TabPanel>

          {/* Transcript Panel - Always rendered but hidden when not active */}
          <TabPanel isActive={viewMode === 'transcript'}>
            <TranscriptContainer>
              {(meeting.transcript || transcriptSegments.length > 0) ? (
                <>
                  <TranscriptHeader>
                    <TranscriptTitle>
                      Meeting Transcript
                      {isRecording && (
                        <span style={{ marginLeft: '10px', fontSize: '14px', color: '#ff3b30' }}>
                          🔴 Recording...
                        </span>
                      )}
                    </TranscriptTitle>
                    {meeting.transcript && !isRecording && (
                      <Button
                        onClick={handleCorrectTranscript}
                        disabled={isCorrecting}
                        style={{
                          background: isCorrecting ? '#c7c7cc' : '#667eea',
                          borderColor: isCorrecting ? '#c7c7cc' : '#667eea',
                          color: 'white'
                        }}
                      >
                        {isCorrecting ? (
                          <>
                            {correctionProgress ?
                              `Processing block ${correctionProgress.current}/${correctionProgress.total}...` :
                              'Preparing correction...'
                            }
                          </>
                        ) : (
                          <>✨ Improve with AI</>
                        )}
                      </Button>
                    )}
                  </TranscriptHeader>
                  {/* Show transcript (real-time updates during recording, parsed saved transcript after) */}
                  {(() => {
                    // Group consecutive segments from the same speaker
                    const groupedSegments: Array<{
                      speaker: string;
                      time: string;
                      texts: string[];
                    }> = [];

                    transcriptSegments.forEach((segment, index) => {
                      const lastGroup = groupedSegments[groupedSegments.length - 1];

                      if (lastGroup && lastGroup.speaker === segment.speaker) {
                        // Same speaker - add to existing group
                        lastGroup.texts.push(segment.text);
                      } else {
                        // New speaker - create new group
                        groupedSegments.push({
                          speaker: segment.speaker,
                          time: segment.time,
                          texts: [segment.text]
                        });
                      }
                    });

                    return groupedSegments.map((group, index) => (
                      <TranscriptSegment key={index}>
                        <TranscriptMeta>
                          <TranscriptTime>{group.time}</TranscriptTime>
                          <TranscriptSpeaker>{group.speaker}</TranscriptSpeaker>
                        </TranscriptMeta>
                        <TranscriptText>
                          {group.texts.join(' ')}
                        </TranscriptText>
                      </TranscriptSegment>
                    ));
                  })()}
                </>
              ) : (
                <EmptyState>
                  <span className="icon">🎙️</span>
                  <h3>No transcript available</h3>
                  <p>Transcript will appear here once the meeting is recorded</p>
                </EmptyState>
              )}
            </TranscriptContainer>
          </TabPanel>

          {/* Insights Panel - Always rendered but hidden when not active */}
          <TabPanel isActive={viewMode === 'insights'}>
            <TranscriptContainer>
              {insights ? (
                <div style={{ padding: '20px' }}>
                  <TranscriptHeader>
                    <TranscriptTitle>Meeting Insights</TranscriptTitle>
                    <Button
                      onClick={handleGenerateInsights}
                      disabled={isGeneratingInsights}
                      style={{
                        background: '#667eea',
                        borderColor: '#667eea',
                        color: 'white'
                      }}
                    >
                      {isGeneratingInsights ? '🔄 Generating...' : '✨ Regenerate Insights'}
                    </Button>
                  </TranscriptHeader>

                  {/* Summary */}
                  <div style={{ marginBottom: '30px' }}>
                    <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '10px' }}>Summary</h3>
                    <p style={{ lineHeight: '1.6', color: '#333' }}>{insights.summary}</p>
                  </div>

                  {/* Action Items */}
                  {insights.actionItems && insights.actionItems.length > 0 && (
                    <div style={{ marginBottom: '30px' }}>
                      <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '10px' }}>Action Items</h3>
                      <ul style={{ listStyle: 'none', padding: 0 }}>
                        {insights.actionItems.map((item: any, index: number) => (
                          <li key={index} style={{
                            marginBottom: '10px',
                            padding: '10px',
                            background: '#f5f5f7',
                            borderRadius: '6px',
                            display: 'flex',
                            alignItems: 'flex-start'
                          }}>
                            <span style={{ marginRight: '10px' }}>☐</span>
                            <div style={{ flex: 1 }}>
                              <strong>{item.owner || 'Unassigned'}</strong>: {item.task}
                              {item.due && <span style={{ marginLeft: '10px', color: '#666' }}>Due: {item.due}</span>}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Key Decisions */}
                  {insights.keyDecisions && insights.keyDecisions.length > 0 && (
                    <div style={{ marginBottom: '30px' }}>
                      <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '10px' }}>Key Decisions</h3>
                      <ul style={{ listStyle: 'none', padding: 0 }}>
                        {insights.keyDecisions.map((decision: string, index: number) => (
                          <li key={index} style={{
                            marginBottom: '10px',
                            padding: '10px',
                            background: '#e8f4f8',
                            borderRadius: '6px',
                            borderLeft: '3px solid #007AFF'
                          }}>
                            ✓ {decision}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Follow-ups */}
                  {insights.followUps && insights.followUps.length > 0 && (
                    <div style={{ marginBottom: '30px' }}>
                      <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '10px' }}>Follow-up Items</h3>
                      <ul style={{ listStyle: 'none', padding: 0 }}>
                        {insights.followUps.map((followUp: string, index: number) => (
                          <li key={index} style={{
                            marginBottom: '10px',
                            padding: '10px',
                            background: '#fff9e6',
                            borderRadius: '6px',
                            borderLeft: '3px solid #ffc107'
                          }}>
                            ❓ {followUp}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Notes Highlights */}
                  {insights.notesHighlights && insights.notesHighlights.length > 0 && (
                    <div style={{ marginBottom: '30px' }}>
                      <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '10px' }}>Key Points from Notes</h3>
                      <ul style={{ listStyle: 'none', padding: 0 }}>
                        {insights.notesHighlights.map((highlight: string, index: number) => (
                          <li key={index} style={{
                            marginBottom: '10px',
                            padding: '10px',
                            background: '#f0f0f0',
                            borderRadius: '6px'
                          }}>
                            📝 {highlight}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ) : (
                <EmptyState>
                  <span className="icon">💡</span>
                  <h3>No insights generated yet</h3>
                  <p>Generate AI-powered insights from your meeting notes and transcript</p>
                  <Button
                    onClick={handleGenerateInsights}
                    disabled={isGeneratingInsights || (!meeting.notes && !meeting.transcript)}
                    style={{
                      marginTop: '20px',
                      background: '#667eea',
                      borderColor: '#667eea',
                      color: 'white'
                    }}
                  >
                    {isGeneratingInsights ? '🔄 Generating...' : '✨ Generate Insights'}
                  </Button>
                  {!meeting.notes && !meeting.transcript && (
                    <p style={{ marginTop: '10px', fontSize: '12px', color: '#999' }}>
                      Add notes or a transcript first to generate insights
                    </p>
                  )}
                </EmptyState>
              )}
            </TranscriptContainer>
          </TabPanel>

          {/* Actions Panel - Always rendered but hidden when not active */}
          <TabPanel isActive={viewMode === 'actions'}>
            <TranscriptContainer>
              {teamSummary ? (
                <div style={{ padding: '20px' }}>
                  {slackShared && (
                    <div style={{
                      background: '#d4f4dd',
                      padding: '10px',
                      marginBottom: '20px',
                      borderRadius: '6px',
                      fontSize: '13px',
                      color: '#00875a'
                    }}>
                      ✅ Shared to Slack at {format(new Date(slackShared), 'PPp')}
                    </div>
                  )}

                  <TranscriptHeader>
                    <TranscriptTitle>Team Summary</TranscriptTitle>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <Button
                        onClick={handleGenerateTeamSummary}
                        disabled={isGeneratingTeamSummary}
                        style={{
                          background: '#34c759',
                          borderColor: '#34c759',
                          color: 'white'
                        }}
                      >
                        {isGeneratingTeamSummary ? '🔄 Generating...' : '🔄 Regenerate'}
                      </Button>
                      <Button
                        onClick={handleShareToSlack}
                        disabled={isSharing || !teamSummary}
                        style={{
                          background: '#4a154b',
                          borderColor: '#4a154b',
                          color: 'white'
                        }}
                      >
                        {isSharing ? '📤 Sharing...' : (slackShared ? '📤 Share Again' : '📤 Share to Slack')}
                      </Button>
                    </div>
                  </TranscriptHeader>

                  <div style={{ marginTop: '20px' }}>
                    <MDEditor
                      key={`team-editor-${meeting.id}`}
                      value={editedTeamContent || formatTeamSummary(teamSummary)}
                      onChange={(value) => setEditedTeamContent(value || '')}
                      height={400}
                      preview={editorPreviewMode}
                      hideToolbar={false}
                    />
                  </div>
                </div>
              ) : (
                <EmptyState>
                  <span className="icon">🎯</span>
                  <h3>{isGeneratingTeamSummary ? 'Generating team summary...' : 'No team summary generated yet'}</h3>
                  <p>Generate a team-appropriate summary from your meeting notes and transcript</p>
                  {!isGeneratingTeamSummary && (
                    <Button
                      onClick={handleGenerateTeamSummary}
                      disabled={isGeneratingTeamSummary || (!meeting.notes && !meeting.transcript)}
                      style={{
                        marginTop: '20px',
                        background: '#34c759',
                        borderColor: '#34c759',
                        color: 'white'
                      }}
                    >
                      {isGeneratingTeamSummary ? '🔄 Generating...' : '✨ Generate Team Summary'}
                    </Button>
                  )}
                  {!meeting.notes && !meeting.transcript && (
                    <p style={{ marginTop: '10px', fontSize: '12px', color: '#999' }}>
                      Add notes or a transcript first to generate team summary
                    </p>
                  )}
                </EmptyState>
              )}
            </TranscriptContainer>
          </TabPanel>

          {/* Coach Panel - Always rendered but hidden when not active */}
          <TabPanel isActive={viewMode === 'coach'}>
            <CoachContainer>
              <CoachControls>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <h3 style={{ fontSize: '18px', fontWeight: '600', margin: 0 }}>Real-time Coaching</h3>
                  <CoachStatusBadge isActive={isCoaching}>
                    {isCoaching ? (
                      <>
                        <span style={{ fontSize: '10px' }}>🔴</span> Active
                      </>
                    ) : (
                      <>
                        <span style={{ fontSize: '10px' }}>⚫</span> Inactive
                      </>
                    )}
                  </CoachStatusBadge>
                </div>

                <CoachTypeSelector>
                  <CoachTypeLabel>Coaching Type</CoachTypeLabel>
                  <CoachTypeSelect
                    value={selectedCoachingType}
                    onChange={(e) => setSelectedCoachingType(e.target.value as CoachingType)}
                    disabled={isCoaching}
                  >
                    <option value="coach-sales">Sales Coach</option>
                    <option value="coach-interview">Interview Coach</option>
                    <option value="coach-facilitator">Meeting Facilitator Coach</option>
                  </CoachTypeSelect>
                </CoachTypeSelector>

                <CoachButtonGroup>
                  {!isCoaching ? (
                    <Button
                      onClick={handleStartCoaching}
                      disabled={!isRecording}
                      style={{
                        background: '#34c759',
                        borderColor: '#34c759',
                        color: 'white',
                        flex: 1
                      }}
                    >
                      {!isRecording ? '⏸ Start Recording First' : '▶️ Start Coaching'}
                    </Button>
                  ) : (
                    <Button
                      onClick={handleStopCoaching}
                      variant="danger"
                      style={{ flex: 1 }}
                    >
                      ⏹ Stop Coaching
                    </Button>
                  )}
                </CoachButtonGroup>

                {!isRecording && (
                  <p style={{
                    fontSize: '13px',
                    color: '#666',
                    margin: 0,
                    fontStyle: 'italic'
                  }}>
                    💡 Tip: Start recording first to enable real-time coaching
                  </p>
                )}
              </CoachControls>

              {coachingFeedbackHistory.length > 0 ? (
                <FeedbackList>
                  {[...coachingFeedbackHistory].reverse().map((feedback, index) => {
                    // Skip feedback cards with no content
                    const hasContent = feedback.alerts.length > 0 ||
                                      feedback.observations.length > 0 ||
                                      feedback.suggestions.length > 0;

                    if (!hasContent) return null;

                    return (
                      <FeedbackCard key={index}>
                        <FeedbackTimestamp>
                          {format(new Date(feedback.timestamp), 'HH:mm:ss')}
                        </FeedbackTimestamp>

                        {feedback.alerts.length > 0 && (
                          <FeedbackSection type="alert">
                            <h4>⚠️ Alerts</h4>
                            <ul>
                              {feedback.alerts.map((alert, i) => (
                                <li key={i}>{alert}</li>
                              ))}
                            </ul>
                          </FeedbackSection>
                        )}

                        {feedback.observations.length > 0 && (
                          <FeedbackSection type="observation">
                            <h4>📊 Observations</h4>
                            <ul>
                              {feedback.observations.map((obs, i) => (
                                <li key={i}>{obs}</li>
                              ))}
                            </ul>
                          </FeedbackSection>
                        )}

                        {feedback.suggestions.length > 0 && (
                          <FeedbackSection type="suggestion">
                            <h4>💡 Suggestions</h4>
                            <ul>
                              {feedback.suggestions.map((sugg, i) => (
                                <li key={i}>{sugg}</li>
                              ))}
                            </ul>
                          </FeedbackSection>
                        )}
                      </FeedbackCard>
                    );
                  })}
                </FeedbackList>
              ) : (
                <EmptyState>
                  <span className="icon">🎓</span>
                  <h3>No coaching feedback yet</h3>
                  <p>
                    {isCoaching
                      ? 'Coaching is active. Feedback will appear here every 30 seconds.'
                      : 'Start recording and enable coaching to get real-time feedback during your call.'
                    }
                  </p>
                </EmptyState>
              )}
            </CoachContainer>
          </TabPanel>
        </Content>
      </Container>

      <Modal show={showDeleteModal}>
        <ModalContent>
          <ModalTitle>Delete Meeting?</ModalTitle>
          <ModalText>
            Are you sure you want to delete "{meeting.title}"? This will permanently remove all notes and transcripts.
          </ModalText>
          <ModalButtons>
            <Button variant="ghost" onClick={() => setShowDeleteModal(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleDelete}>
              Delete
            </Button>
          </ModalButtons>
        </ModalContent>
      </Modal>
    </>
  );
}

export default MeetingDetailFinal;