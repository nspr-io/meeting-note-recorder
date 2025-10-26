import React, { useState, useEffect, useRef } from 'react';
import styled from '@emotion/styled';
import Split from 'react-split';
import Editor from '@monaco-editor/react';
import { Meeting, TranscriptChunk, IpcChannels } from '../../shared/types';
import { format } from 'date-fns';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkHtml from 'remark-html';

const DetailContainer = styled.div`
  height: 100%;
  display: flex;
  flex-direction: column;
`;

const Header = styled.div`
  padding: 16px 24px;
  border-bottom: 1px solid #e5e5e7;
  background: #f9f9f9;
`;

const TitleInput = styled.input`
  font-size: 20px;
  font-weight: 600;
  color: #1d1d1f;
  border: none;
  background: transparent;
  width: 100%;
  margin-bottom: 8px;
  
  &:focus {
    outline: none;
    background: white;
    padding: 4px 8px;
    margin: -4px -8px;
    border-radius: 4px;
  }
`;

const MetaInfo = styled.div`
  display: flex;
  gap: 16px;
  font-size: 13px;
  color: #86868b;
`;

const ActionBar = styled.div`
  display: flex;
  gap: 8px;
  margin-top: 12px;
`;

const Button = styled.button`
  padding: 6px 12px;
  background: #007aff;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  
  &:hover {
    background: #0051d5;
  }
  
  &:disabled {
    background: #c7c7cc;
    cursor: not-allowed;
  }
`;

const SecondaryButton = styled(Button)`
  background: #ffffff;
  color: #007aff;
  border: 1px solid #007aff;
  
  &:hover {
    background: #f5f5f7;
  }
`;

const SplitContainer = styled.div`
  flex: 1;
  overflow: hidden;
  
  .gutter {
    background-color: #e5e5e7;
    cursor: col-resize;
    
    &:hover {
      background-color: #c7c7cc;
    }
  }
`;

const PaneContainer = styled.div`
  height: 100%;
  display: flex;
  flex-direction: column;
  background: white;
`;

const PaneHeader = styled.div`
  padding: 8px 16px;
  border-bottom: 1px solid #e5e5e7;
  background: #f9f9f9;
  font-size: 13px;
  font-weight: 500;
  color: #86868b;
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

const PaneContent = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 16px;
`;

const TranscriptLine = styled.div<{ isNew?: boolean }>`
  margin-bottom: 12px;
  padding: 8px;
  border-radius: 6px;
  background: ${props => props.isNew ? '#fffacd' : 'transparent'};
  animation: ${props => props.isNew ? 'highlight 1s ease-out' : 'none'};
  
  @keyframes highlight {
    from {
      background: #ffeb3b;
    }
    to {
      background: #fffacd;
    }
  }
`;

const Timestamp = styled.span`
  color: #007aff;
  font-size: 12px;
  margin-right: 8px;
`;

const Speaker = styled.span`
  font-weight: 500;
  color: #1d1d1f;
  margin-right: 8px;
`;

const PreviewToggle = styled.button`
  padding: 4px 8px;
  background: transparent;
  border: 1px solid #d1d1d1;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  
  &:hover {
    background: #f5f5f7;
  }
`;

const MarkdownPreview = styled.div`
  padding: 16px;
  
  h1 { font-size: 24px; margin-bottom: 16px; }
  h2 { font-size: 20px; margin-bottom: 12px; }
  h3 { font-size: 16px; margin-bottom: 8px; }
  
  p { margin-bottom: 12px; line-height: 1.6; }
  
  ul, ol {
    margin-bottom: 12px;
    padding-left: 24px;
  }
  
  li { margin-bottom: 4px; }
  
  code {
    background: #f5f5f7;
    padding: 2px 4px;
    border-radius: 3px;
    font-family: 'SF Mono', Monaco, monospace;
  }
  
  pre {
    background: #f5f5f7;
    padding: 12px;
    border-radius: 6px;
    overflow-x: auto;
  }
  
  blockquote {
    border-left: 4px solid #007aff;
    padding-left: 16px;
    color: #86868b;
  }
`;

interface MeetingDetailProps {
  meeting: Meeting;
  onUpdateMeeting: (updates: Partial<Meeting>) => void;
  isRecording: boolean;
}

function MeetingDetail({ meeting, onUpdateMeeting, isRecording }: MeetingDetailProps) {
  const [notes, setNotes] = useState(meeting.notes || '');
  const [title, setTitle] = useState(meeting.title);
  const [showPreview, setShowPreview] = useState(false);
  const [previewHtml, setPreviewHtml] = useState('');
  const [transcript, setTranscript] = useState(meeting.transcript || '');
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const dedupeMapRef = useRef<Map<string, string>>(new Map());
  const saveTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);

  const meetingDateObj = new Date(meeting.date);
  const hasValidMeetingDate = !Number.isNaN(meetingDateObj.getTime());
  const meetingDateLabel = hasValidMeetingDate
    ? format(meetingDateObj, 'MMMM d, yyyy • h:mm a')
    : 'Date unavailable';

  console.log('[JOURNEY-DETAIL-1] MeetingDetail rendered', {
    meetingId: meeting.id,
    title: meeting.title,
    status: meeting.status,
    isRecording,
    hasNotes: !!meeting.notes,
    hasTranscript: !!meeting.transcript,
    transcriptLength: meeting.transcript?.length,
    timestamp: new Date().toISOString()
  });

  useEffect(() => {
    console.log('[JOURNEY-DETAIL-2] Meeting prop changed, updating state', {
      meetingId: meeting.id,
      title: meeting.title,
      notesLength: meeting.notes?.length,
      transcriptLength: meeting.transcript?.length
    });
    setNotes(meeting.notes || '');
    setTitle(meeting.title);
    setTranscript(meeting.transcript || '');
    dedupeMapRef.current.clear();
  }, [meeting]);

  useEffect(() => {
    // Listen for live transcript updates
    const handleTranscriptUpdate = (chunk: TranscriptChunk) => {
      if (chunk.meetingId && chunk.meetingId !== meeting.id) {
        console.log('[JOURNEY-DETAIL-TRANSCRIPT] Ignoring chunk for different meeting', {
          chunkMeetingId: chunk.meetingId,
          currentMeetingId: meeting.id
        });
        return;
      }

      console.log('[JOURNEY-DETAIL-TRANSCRIPT] Received transcript chunk', {
        speaker: chunk.speaker,
        text: chunk.text,
        timestamp: chunk.timestamp
      });

      const timestamp = format(new Date(chunk.timestamp), 'HH:mm:ss');
      const line = chunk.speaker
        ? `[${timestamp}] ${chunk.speaker}: ${chunk.text}`
        : `[${timestamp}] ${chunk.text}`;

      setTranscript(prev => {
        const previous = prev || '';
        const dedupeKey = chunk.sequenceId || chunk.hash;
        let lines = previous ? previous.split('\n') : [];

        if (dedupeKey) {
          const existingLine = dedupeMapRef.current.get(dedupeKey);
          if (existingLine) {
            const index = lines.lastIndexOf(existingLine);
            if (index >= 0) {
              lines[index] = line;
            } else {
              lines.push(line);
            }
            dedupeMapRef.current.set(dedupeKey, line);
            const updated = lines.join('\n');
            console.log('[JOURNEY-DETAIL-TRANSCRIPT-2] Replaced existing transcript line', {
              dedupeKey,
              isFinal: chunk.isFinal,
              newLength: updated.length
            });
            return updated;
          }
          dedupeMapRef.current.set(dedupeKey, line);
        }

        if (lines.length > 0 && lines[lines.length - 1] === line) {
          return previous;
        }

        lines.push(line);
        const updated = lines.join('\n');
        console.log('[JOURNEY-DETAIL-TRANSCRIPT-2] Updated transcript state', {
          previousLength: previous.length,
          newLength: updated.length,
          newLine: line
        });
        return updated;
      });
      
      // Auto-scroll to bottom
      setTimeout(() => {
        transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    };

    window.electronAPI.on(IpcChannels.TRANSCRIPT_UPDATE, handleTranscriptUpdate);
    
    return () => {
      window.electronAPI.removeListener(IpcChannels.TRANSCRIPT_UPDATE, handleTranscriptUpdate);
    };
  }, []);

  useEffect(() => {
    // Convert markdown to HTML for preview
    if (showPreview) {
      (async () => {
        const processor = unified()
          .use(remarkParse)
          .use(remarkHtml);
        const file = await processor.process(notes);
        setPreviewHtml(String(file));
      })();
    }
  }, [notes, showPreview]);

  const handleNotesChange = (value: string | undefined) => {
    console.log('[JOURNEY-DETAIL-NOTES] Notes changed', {
      newLength: value?.length,
      meetingId: meeting.id
    });
    setNotes(value || '');

    // Debounce auto-save
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(() => {
      console.log('[JOURNEY-DETAIL-NOTES-SAVE] Auto-saving notes');
      onUpdateMeeting({ notes: value || '' });
    }, 1000); // Save after 1 second of inactivity
  };

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTitle(e.target.value);
    onUpdateMeeting({ title: e.target.value });
  };

  const handleStartRecording = async () => {
    console.log('[JOURNEY-DETAIL-ACTION-1] Start recording button clicked', {
      meetingId: meeting.id,
      title: meeting.title,
      timestamp: new Date().toISOString()
    });
    try {
      const result = await window.electronAPI.startRecording(meeting.id);
      console.log('[JOURNEY-DETAIL-ACTION-2] Start recording API called', {
        result,
        meetingId: meeting.id
      });
    } catch (error) {
      console.error('[JOURNEY-DETAIL-ACTION-ERROR] Error starting recording:', error);
    }
  };

  const handleStopRecording = async () => {
    console.log('[JOURNEY-DETAIL-STOP] Stop recording clicked');
    await window.electronAPI.stopRecording();
    console.log('[JOURNEY-DETAIL-STOP-2] Stop recording API called');
  };

  const handleOpenFile = () => {
    window.electronAPI.openMeetingFile(meeting.id);
  };

  const formatTranscriptLines = (transcript: string) => {
    return transcript.split('\n').map((line, index) => {
      const match = line.match(/\[(\d{2}:\d{2}:\d{2})\]\s*([^:]+):\s*(.+)/);
      if (match) {
        return (
          <TranscriptLine key={index}>
            <Timestamp>{match[1]}</Timestamp>
            <Speaker>{match[2]}:</Speaker>
            {match[3]}
          </TranscriptLine>
        );
      }
      
      const simpleMatch = line.match(/\[(\d{2}:\d{2}:\d{2})\]\s*(.+)/);
      if (simpleMatch) {
        return (
          <TranscriptLine key={index}>
            <Timestamp>{simpleMatch[1]}</Timestamp>
            {simpleMatch[2]}
          </TranscriptLine>
        );
      }
      
      return <TranscriptLine key={index}>{line}</TranscriptLine>;
    });
  };

  return (
    <DetailContainer>
      <Header>
        <TitleInput
          value={title}
          onChange={handleTitleChange}
          placeholder="Meeting Title"
        />
        <MetaInfo>
          <span>{meetingDateLabel}</span>
          {meeting.duration && <span>• {meeting.duration} minutes</span>}
          {meeting.attendees.length > 0 && (
            <span>• {meeting.attendees.length} attendees</span>
          )}
        </MetaInfo>
        <ActionBar>
          {!isRecording && meeting.status !== 'completed' && (
            <Button onClick={handleStartRecording}>
              Start Recording
            </Button>
          )}
          {isRecording && (
            <Button onClick={handleStopRecording}>
              Stop Recording
            </Button>
          )}
          <SecondaryButton onClick={handleOpenFile}>
            Open in Finder
          </SecondaryButton>
          {meeting.recallVideoUrl && (
            <SecondaryButton 
              onClick={() => window.open(meeting.recallVideoUrl, '_blank')}
            >
              View Recording
            </SecondaryButton>
          )}
        </ActionBar>
      </Header>
      
      <SplitContainer>
        <Split
          sizes={[50, 50]}
          minSize={300}
          gutterSize={4}
          gutterAlign="center"
          direction="horizontal"
          cursor="col-resize"
          style={{ display: 'flex', height: '100%' }}
        >
          <PaneContainer>
            <PaneHeader>
              <span>Notes</span>
              <PreviewToggle onClick={() => setShowPreview(!showPreview)}>
                {showPreview ? 'Edit' : 'Preview'}
              </PreviewToggle>
            </PaneHeader>
            {!showPreview ? (
              <Editor
                height="100%"
                defaultLanguage="markdown"
                value={notes}
                onChange={handleNotesChange}
                theme="light"
                options={{
                  minimap: { enabled: false },
                  fontSize: 14,
                  wordWrap: 'on',
                  lineNumbers: 'off',
                  padding: { top: 16, bottom: 16 },
                  scrollBeyondLastLine: false,
                }}
              />
            ) : (
              <MarkdownPreview 
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            )}
          </PaneContainer>
          
          <PaneContainer>
            <PaneHeader>
              <span>Transcript</span>
              {isRecording && <span style={{ color: '#ff3b30' }}>● Recording</span>}
            </PaneHeader>
            <PaneContent>
              {transcript ? (
                <>
                  {formatTranscriptLines(transcript)}
                  <div ref={transcriptEndRef} />
                </>
              ) : (
                <div style={{ color: '#86868b', textAlign: 'center', marginTop: 32 }}>
                  {isRecording ? 'Waiting for transcript...' : 'No transcript yet'}
                </div>
              )}
            </PaneContent>
          </PaneContainer>
        </Split>
      </SplitContainer>
    </DetailContainer>
  );
}

export default MeetingDetail;