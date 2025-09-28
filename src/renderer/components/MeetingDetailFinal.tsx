import React, { useState, useEffect, useRef, ErrorInfo } from 'react';
import styled from '@emotion/styled';
import { Meeting, Attendee, IpcChannels } from '../../shared/types';
import { format, formatDistanceToNow } from 'date-fns';
import {
  MDXEditor,
  headingsPlugin,
  listsPlugin,
  quotePlugin,
  thematicBreakPlugin,
  markdownShortcutPlugin,
  linkPlugin,
  linkDialogPlugin,
  tablePlugin,
  codeBlockPlugin,
  codeMirrorPlugin,
  diffSourcePlugin,
  toolbarPlugin,
  UndoRedo,
  BoldItalicUnderlineToggles,
  ListsToggle,
  BlockTypeSelect,
  CreateLink,
  InsertTable,
  InsertCodeBlock,
  DiffSourceToggleWrapper,
  Separator
} from '@mdxeditor/editor';
import '@mdxeditor/editor/style.css';

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

  .mdxeditor {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    background: white;
  }

  .mdxeditor-toolbar {
    background: #fafafa;
    border-bottom: 1px solid #e5e7eb;
    padding: 8px;
    gap: 4px;
  }

  .mdxeditor-toolbar-contents {
    gap: 8px;
  }

  ._separator_1fwlh_97 {
    background: #e5e7eb;
    margin: 0 8px;
  }

  .mdxeditor-root-contenteditable {
    padding: 20px;
    min-height: 400px;
    position: relative;

    /* Remove default paragraph margins */
    p {
      margin: 0;
      padding: 0;
      line-height: 1.6;
    }

    /* First paragraph should have no top margin */
    > p:first-child {
      margin-top: 0;
    }
  }

  /* Override MDXEditor's placeholder positioning */
  .mdxeditor [contenteditable="true"]:empty::before,
  .mdxeditor .mdxeditor-root-contenteditable:empty::before {
    content: attr(data-placeholder) !important;
    position: absolute;
    top: 20px;
    left: 20px;
    color: #999;
    pointer-events: none;
  }

  /* Hide the default placeholder that appears above */
  .mdxeditor [data-placeholder]:not(:empty)::before {
    display: none !important;
  }

  /* Ensure the contenteditable area starts at the right position */
  .mdxeditor [contenteditable="true"] {
    min-height: inherit;
  }

  .mdxeditor-root-contenteditable h1 { font-size: 28px; font-weight: 700; margin: 20px 0 12px; }
  .mdxeditor-root-contenteditable h2 { font-size: 24px; font-weight: 600; margin: 18px 0 10px; }
  .mdxeditor-root-contenteditable h3 { font-size: 20px; font-weight: 600; margin: 16px 0 8px; }

  .mdxeditor-root-contenteditable p {
    line-height: 1.6;
    margin: 12px 0;
  }

  .mdxeditor-root-contenteditable ul,
  .mdxeditor-root-contenteditable ol {
    padding-left: 24px;
    margin: 12px 0;
  }

  .mdxeditor-root-contenteditable li {
    margin: 4px 0;
    line-height: 1.6;
  }

  .mdxeditor-root-contenteditable blockquote {
    border-left: 3px solid #667eea;
    padding-left: 16px;
    margin: 16px 0;
    color: #555;
  }

  .mdxeditor-root-contenteditable code {
    background: #f3f4f6;
    padding: 2px 6px;
    border-radius: 3px;
    font-family: 'SF Mono', Monaco, monospace;
    font-size: 0.9em;
  }

  .mdxeditor-root-contenteditable pre {
    background: #1e1e1e;
    color: #d4d4d4;
    padding: 16px;
    border-radius: 6px;
    overflow-x: auto;
    margin: 16px 0;
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

interface MeetingDetailFinalProps {
  meeting: Meeting;
  onUpdateMeeting: (meeting: Meeting) => void;
  onDeleteMeeting?: (meetingId: string) => void;
  onRefresh?: () => void;
}

type ViewMode = 'notes' | 'transcript' | 'insights';

// Module-level transcript cache to persist across component re-renders
const transcriptCache = new Map<string, any[]>();

// Error boundary for MDX Editor
class MDXErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode; fallback: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('MDX Editor Error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }

    return this.props.children;
  }
}

// Sanitize markdown content to prevent MDX parsing errors
function sanitizeMarkdown(content: string): string {
  if (!content) return content;

  return content
    // Remove or fix problematic HTML tags that MDX can't handle
    .replace(/<br\s*\/?>/gi, '\n') // Convert <br> tags to newlines
    .replace(/<\/br>/gi, '') // Remove invalid </br> closing tags
    .replace(/<p\s*>/gi, '\n\n') // Convert <p> to paragraph breaks
    .replace(/<\/p>/gi, '\n\n') // Convert </p> to paragraph breaks
    .replace(/<div[^>]*>/gi, '\n') // Convert <div> to newlines
    .replace(/<\/div>/gi, '\n') // Convert </div> to newlines

    // Fix double backslashes and escape sequences
    .replace(/\\\\/g, '\\') // Convert double backslashes to single
    .replace(/\\n/g, '\n') // Convert literal \n to actual newlines
    .replace(/\\t/g, '\t') // Convert literal \t to actual tabs

    // Escape problematic characters that could be mistaken for JSX
    .replace(/(?<!\\)</g, '\\<') // Escape unescaped < characters
    .replace(/(?<!\\)>/g, '\\>') // Escape unescaped > characters
    .replace(/(?<!\\)\{/g, '\\{') // Escape unescaped { characters
    .replace(/(?<!\\)\}/g, '\\}') // Escape unescaped } characters

    // Fix malformed HTML-like constructs
    .replace(/<\/(?![a-zA-Z])/g, '\\<\\/')
    .replace(/<(?![a-zA-Z/!])/g, '\\<')

    // Clean up multiple consecutive newlines
    .replace(/\n\n\n+/g, '\n\n')

    // Fix markdown link syntax
    .replace(/\[([^\]]*)\]\s*\(\s*([^)]*)\s*\)/g, '[$1]($2)')

    // Remove any remaining problematic escape sequences
    .replace(/\\([^\\<>{}ntr])/g, '$1'); // Remove unnecessary escapes except for our intentional ones
}

function MeetingDetailFinal({ meeting, onUpdateMeeting, onDeleteMeeting, onRefresh }: MeetingDetailFinalProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('notes');
  const [notes, setNotes] = useState(meeting.notes || '');
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
  const mdxEditorRef = useRef<any>(null);
  const isFirstRender = useRef(true);

  // Update cache when segments change
  useEffect(() => {
    transcriptCache.set(meeting.id, transcriptSegments);
  }, [meeting.id, transcriptSegments]);

  useEffect(() => {
    setNotes(meeting.notes || '');
    setEditedTitle(meeting.title); // Update title when meeting prop changes
    setHasChanges(false);
    setIsRecording(meeting.status === 'recording');
    setEditorKey(Date.now()); // Force complete editor remount when meeting changes
    isFirstRender.current = true; // Reset first render flag for new meeting

    // Load existing insights if available
    if (meeting.insights) {
      try {
        setInsights(JSON.parse(meeting.insights));
      } catch (e) {
        console.error('Failed to parse insights:', e);
        setInsights(null);
      }
    }

    // When recording stops, clear segments and load from stored transcript
    // When recording is active, don't parse stored transcript (rely on real-time)
    // When viewing completed meetings, parse the stored transcript
    if (meeting.status !== 'recording') {
      if (meeting.transcript) {
        const parsed = parseTranscript(meeting.transcript);
        setTranscriptSegments(parsed);
        // Clear the cache when we parse from stored transcript to avoid duplicates
        transcriptCache.set(meeting.id, parsed);
      } else {
        setTranscriptSegments([]);
        transcriptCache.set(meeting.id, []);
      }
    } else if (meeting.status === 'recording' && !isRecording) {
      // Just started recording - clear old segments
      setTranscriptSegments([]);
      transcriptCache.set(meeting.id, []);
    }
  }, [meeting.id, meeting.status, meeting.transcript, meeting.title]);

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
    };

    (window as any).electronAPI?.on?.('recording-started', handleRecordingStarted);
    (window as any).electronAPI?.on?.('recording-stopped', handleRecordingStopped);

    return () => {
      (window as any).electronAPI?.removeListener?.('recording-started', handleRecordingStarted);
      (window as any).electronAPI?.removeListener?.('recording-stopped', handleRecordingStopped);
    };
  }, [meeting.id]);

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

  // Create a stable reference for the transcript handler
  const handleTranscriptUpdateRef = useRef<any>(null);

  // Listen for real-time transcript updates
  useEffect(() => {
    // Remove any existing listener before adding a new one
    if (handleTranscriptUpdateRef.current) {
      (window as any).electronAPI?.removeListener?.('transcript-update', handleTranscriptUpdateRef.current);
    }

    const handleTranscriptUpdate = (data: any) => {
      console.log('[MeetingDetailFinal] Received transcript update:', data);
      if (data.meetingId !== meeting.id) return;

      setTranscriptSegments(prev => {
        // Check for duplicates before adding
        const isDuplicate = prev.some(
          s => s.timestamp === data.timestamp &&
               s.text === data.text
        );

        if (!isDuplicate) {
          const newSegment = {
            id: `${Date.now()}-${Math.random()}`,
            time: format(new Date(data.timestamp), 'HH:mm:ss'),
            speaker: data.speaker || 'Unknown Speaker',
            text: data.text,
            timestamp: data.timestamp
          };

          const updated = [...prev, newSegment];

          // Update cache immediately
          transcriptCache.set(meeting.id, updated);
          return updated;
        }
        return prev;
      });
    };

    // Store the handler reference
    handleTranscriptUpdateRef.current = handleTranscriptUpdate;

    // Listen for transcript updates using the correct channel
    (window as any).electronAPI?.on?.('transcript-update', handleTranscriptUpdate);

    return () => {
      if (handleTranscriptUpdateRef.current) {
        (window as any).electronAPI?.removeListener?.('transcript-update', handleTranscriptUpdateRef.current);
        handleTranscriptUpdateRef.current = null;
      }
    };
  }, [meeting.id]);

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
    // Ignore the first onChange trigger from MDXEditor mount
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
              <MDXErrorBoundary
                key={`boundary-${editorKey}`}
                fallback={
                  <div style={{
                    padding: '20px',
                    border: '1px solid #e1e5e9',
                    borderRadius: '8px',
                    backgroundColor: '#f8f9fa'
                  }}>
                    <h3 style={{ color: '#d73a49', marginBottom: '10px' }}>Editor Error</h3>
                    <p>The markdown content contains syntax that cannot be parsed. Please switch to source mode to fix the content, or clear the notes to start fresh.</p>
                    <button
                      onClick={() => {
                        setNotes('');
                        setEditorKey(Date.now()); // Force fresh editor instance
                      }}
                      style={{
                        marginTop: '10px',
                        padding: '8px 16px',
                        backgroundColor: '#0366d6',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer'
                      }}
                    >
                      Clear Notes
                    </button>
                  </div>
                }
              >
                <MDXEditor
                  key={`editor-${meeting.id}-${editorKey}`}
                  ref={mdxEditorRef}
                  markdown={sanitizeMarkdown(notes)}
                  onChange={handleNotesChange}
                  placeholder="Start typing your notes..."
                  plugins={[
                    headingsPlugin(),
                    listsPlugin(),
                    quotePlugin(),
                    thematicBreakPlugin(),
                    markdownShortcutPlugin(),
                    linkPlugin(),
                    linkDialogPlugin(),
                    tablePlugin(),
                    codeBlockPlugin({ defaultCodeBlockLanguage: 'js' }),
                    codeMirrorPlugin({ codeBlockLanguages: { js: 'JavaScript', css: 'CSS', txt: 'Plain Text', tsx: 'TypeScript' } }),
                    diffSourcePlugin({ viewMode: 'rich-text' }),
                    toolbarPlugin({
                      toolbarContents: () => (
                        <>
                          <UndoRedo />
                          <Separator />
                          <BoldItalicUnderlineToggles />
                          <Separator />
                          <BlockTypeSelect />
                          <Separator />
                          <ListsToggle />
                          <Separator />
                          <CreateLink />
                          <InsertTable />
                          <InsertCodeBlock />
                          <Separator />
                          <DiffSourceToggleWrapper>
                            <div />
                          </DiffSourceToggleWrapper>
                        </>
                      )
                    })
                  ]}
                />
              </MDXErrorBoundary>
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
                  {transcriptSegments.map((segment, index) => (
                    <TranscriptSegment key={index}>
                      <TranscriptMeta>
                        <TranscriptTime>{segment.time}</TranscriptTime>
                        <TranscriptSpeaker>{segment.speaker}</TranscriptSpeaker>
                      </TranscriptMeta>
                      <TranscriptText>{segment.text}</TranscriptText>
                    </TranscriptSegment>
                  ))}
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