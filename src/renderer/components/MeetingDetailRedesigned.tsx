import React, { useState, useEffect } from 'react';
import styled from '@emotion/styled';
import { Meeting } from '../../shared/types';
import { format, formatDistanceToNow } from 'date-fns';
import MDEditor from '@uiw/react-md-editor';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const Container = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #ffffff;
`;

const Header = styled.div`
  padding: 24px 32px;
  background: linear-gradient(135deg, rgba(102, 126, 234, 0.05) 0%, rgba(118, 75, 162, 0.05) 100%);
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
`;

const TitleRow = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 16px;
`;

const TitleSection = styled.div`
  flex: 1;
`;

const Title = styled.h1`
  font-size: 28px;
  font-weight: 700;
  color: #1f2937;
  margin: 0 0 8px 0;
  line-height: 1.2;
`;

const MetaInfo = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
  color: #6b7280;
  font-size: 14px;
`;

const MetaItem = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;

  .icon {
    font-size: 16px;
    opacity: 0.8;
  }

  .label {
    color: #9ca3af;
    margin-right: 4px;
  }
`;

const ActionButtons = styled.div`
  display: flex;
  gap: 8px;
`;

const Button = styled.button<{ variant?: 'primary' | 'danger' | 'ghost'; size?: 'small' | 'medium' }>`
  padding: ${props => props.size === 'small' ? '6px 12px' : '10px 20px'};
  border-radius: 8px;
  font-size: ${props => props.size === 'small' ? '13px' : '14px'};
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  border: none;
  display: flex;
  align-items: center;
  gap: 6px;

  ${props => {
    switch(props.variant) {
      case 'danger':
        return `
          background: #fef2f2;
          color: #dc2626;
          border: 1px solid #fecaca;
          &:hover {
            background: #fee2e2;
            border-color: #f87171;
          }
        `;
      case 'ghost':
        return `
          background: transparent;
          color: #6b7280;
          &:hover {
            background: #f9fafb;
          }
        `;
      default:
        return `
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          &:hover {
            box-shadow: 0 4px 12px rgba(102, 126, 234, 0.25);
          }
        `;
    }
  }}

  &:active {
    transform: scale(0.98);
  }
`;

const TabContainer = styled.div`
  display: flex;
  gap: 2px;
  padding: 0;
  background: rgba(0, 0, 0, 0.03);
  border-radius: 10px;
  padding: 2px;
  margin-top: 20px;
`;

const Tab = styled.button<{ active: boolean }>`
  flex: 1;
  padding: 10px 16px;
  background: ${props => props.active ? '#ffffff' : 'transparent'};
  border: none;
  color: ${props => props.active ? '#374151' : '#9ca3af'};
  font-weight: ${props => props.active ? '600' : '400'};
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
  border-radius: 8px;
  box-shadow: ${props => props.active ? '0 1px 3px rgba(0, 0, 0, 0.1)' : 'none'};

  &:hover {
    color: ${props => props.active ? '#374151' : '#6b7280'};
  }
`;

const Content = styled.div`
  flex: 1;
  padding: 32px;
  overflow-y: auto;
  background: #ffffff;

  &::-webkit-scrollbar {
    width: 10px;
  }

  &::-webkit-scrollbar-track {
    background: #f9fafb;
    border-radius: 5px;
  }

  &::-webkit-scrollbar-thumb {
    background: #d1d5db;
    border-radius: 5px;

    &:hover {
      background: #9ca3af;
    }
  }
`;

const EditorWrapper = styled.div`
  .w-md-editor {
    background: #ffffff;
    border: 1px solid #e5e7eb;
    border-radius: 12px;
    overflow: hidden;

    .w-md-editor-toolbar {
      background: #f9fafb;
      border-bottom: 1px solid #e5e7eb;
      padding: 8px;

      button {
        border-radius: 6px;
        margin: 0 2px;

        &:hover {
          background: #e5e7eb;
        }
      }
    }

    .w-md-editor-content {
      background: #ffffff;
    }

    .w-md-editor-preview {
      padding: 24px;
      background: #ffffff;
    }

    .w-md-editor-input,
    .w-md-editor-preview {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
      font-size: 15px;
      line-height: 1.7;
    }
  }
`;

const MarkdownPreview = styled.div`
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
  font-size: 15px;
  line-height: 1.7;
  color: #374151;

  h1, h2, h3, h4, h5, h6 {
    font-weight: 600;
    margin-top: 24px;
    margin-bottom: 12px;
    color: #1f2937;
  }

  h1 { font-size: 28px; }
  h2 { font-size: 24px; }
  h3 { font-size: 20px; }
  h4 { font-size: 18px; }

  p {
    margin-bottom: 16px;
  }

  ul, ol {
    margin-bottom: 16px;
    padding-left: 24px;
  }

  li {
    margin-bottom: 8px;
  }

  blockquote {
    border-left: 4px solid #667eea;
    padding-left: 16px;
    margin: 16px 0;
    color: #6b7280;
    font-style: italic;
  }

  code {
    background: #f3f4f6;
    padding: 2px 6px;
    border-radius: 4px;
    font-family: 'SF Mono', Monaco, monospace;
    font-size: 14px;
  }

  pre {
    background: #1f2937;
    color: #f3f4f6;
    padding: 16px;
    border-radius: 8px;
    overflow-x: auto;
    margin: 16px 0;

    code {
      background: transparent;
      color: inherit;
      padding: 0;
    }
  }

  table {
    width: 100%;
    border-collapse: collapse;
    margin: 16px 0;

    th, td {
      border: 1px solid #e5e7eb;
      padding: 8px 12px;
      text-align: left;
    }

    th {
      background: #f9fafb;
      font-weight: 600;
    }
  }

  a {
    color: #667eea;
    text-decoration: none;

    &:hover {
      text-decoration: underline;
    }
  }

  hr {
    border: none;
    border-top: 1px solid #e5e7eb;
    margin: 24px 0;
  }

  img {
    max-width: 100%;
    height: auto;
    border-radius: 8px;
    margin: 16px 0;
  }
`;

const TranscriptContainer = styled.div`
  background: #f9fafb;
  border-radius: 12px;
  padding: 24px;
`;

const TranscriptHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
`;

const TranscriptTitle = styled.h2`
  font-size: 20px;
  font-weight: 600;
  color: #1f2937;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 8px;
`;

const TranscriptSegment = styled.div`
  margin-bottom: 24px;
  padding-bottom: 24px;
  border-bottom: 1px solid #e5e7eb;

  &:last-child {
    border-bottom: none;
    padding-bottom: 0;
  }
`;

const TranscriptTime = styled.div`
  font-size: 12px;
  color: #9ca3af;
  font-weight: 500;
  margin-bottom: 8px;
  font-family: 'SF Mono', Monaco, monospace;
`;

const TranscriptSpeaker = styled.div`
  font-weight: 600;
  color: #667eea;
  margin-bottom: 6px;
  font-size: 14px;
`;

const TranscriptText = styled.div`
  color: #374151;
  line-height: 1.7;
  font-size: 15px;
`;

const EmptyState = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px;
  text-align: center;
  color: #9ca3af;

  .icon {
    font-size: 48px;
    margin-bottom: 16px;
    opacity: 0.5;
  }

  h3 {
    font-size: 18px;
    font-weight: 500;
    margin-bottom: 8px;
    color: #6b7280;
  }

  p {
    font-size: 14px;
  }
`;

const Modal = styled.div<{ show: boolean }>`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: ${props => props.show ? 'flex' : 'none'};
  align-items: center;
  justify-content: center;
  z-index: 1000;
  backdrop-filter: blur(4px);
`;

const ModalContent = styled.div`
  background: white;
  border-radius: 16px;
  padding: 24px;
  max-width: 420px;
  width: 90%;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
`;

const ModalTitle = styled.h3`
  font-size: 20px;
  font-weight: 600;
  color: #1f2937;
  margin-bottom: 12px;
`;

const ModalText = styled.p`
  color: #6b7280;
  font-size: 14px;
  margin-bottom: 24px;
  line-height: 1.5;
`;

const ModalButtons = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 12px;
`;

interface MeetingDetailRedesignedProps {
  meeting: Meeting;
  onUpdateMeeting: (meeting: Meeting) => void;
  onDeleteMeeting?: (meetingId: string) => void;
}

type ViewMode = 'notes' | 'transcript';
type EditorMode = 'edit' | 'preview';

function MeetingDetailRedesigned({ meeting, onUpdateMeeting, onDeleteMeeting }: MeetingDetailRedesignedProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('notes');
  const [editorMode, setEditorMode] = useState<EditorMode>('preview');
  const [notes, setNotes] = useState(meeting.notes || '');
  const [isSaving, setIsSaving] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    setNotes(meeting.notes || '');
    setHasChanges(false);
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

  const handleNotesChange = (value: string | undefined) => {
    setNotes(value || '');
    setHasChanges(true);
  };

  const handleDelete = () => {
    if (onDeleteMeeting) {
      onDeleteMeeting(meeting.id);
      setShowDeleteModal(false);
    }
  };

  const parseTranscript = (transcript: string) => {
    // Parse transcript with timestamps
    const segments: { time: string; speaker: string; text: string }[] = [];
    const lines = transcript.split('\n');

    let currentTime = '';
    let currentSpeaker = '';
    let currentText = '';

    lines.forEach(line => {
      // Check for timestamp pattern [HH:MM:SS]
      const timeMatch = line.match(/^\[(\d{1,2}:\d{2}:\d{2})\]/);
      if (timeMatch) {
        // Save previous segment if exists
        if (currentText) {
          segments.push({
            time: currentTime || '00:00:00',
            speaker: currentSpeaker || 'Speaker',
            text: currentText
          });
        }
        currentTime = timeMatch[1];

        // Check for speaker after timestamp
        const remainingLine = line.substring(timeMatch[0].length).trim();
        const speakerMatch = remainingLine.match(/^(\w+):\s*(.*)/);
        if (speakerMatch) {
          currentSpeaker = speakerMatch[1];
          currentText = speakerMatch[2];
        } else {
          currentText = remainingLine;
        }
      } else {
        // Check for speaker without timestamp
        const speakerMatch = line.match(/^(\w+):\s*(.*)/);
        if (speakerMatch) {
          if (currentText) {
            segments.push({
              time: currentTime || '00:00:00',
              speaker: currentSpeaker || 'Speaker',
              text: currentText
            });
          }
          currentSpeaker = speakerMatch[1];
          currentText = speakerMatch[2];
          if (!currentTime) currentTime = '00:00:00';
        } else if (line.trim()) {
          // Continue previous segment
          currentText += ' ' + line.trim();
        }
      }
    });

    // Add the last segment
    if (currentText) {
      segments.push({
        time: currentTime || '00:00:00',
        speaker: currentSpeaker || 'Speaker',
        text: currentText
      });
    }

    // If no segments were created, create simple segments from the text
    if (segments.length === 0 && transcript.trim()) {
      const simpleLines = transcript.split('\n').filter(l => l.trim());
      simpleLines.forEach((line, i) => {
        segments.push({
          time: `00:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}`,
          speaker: 'Speaker',
          text: line
        });
      });
    }

    return segments;
  };

  return (
    <>
      <Container>
        <Header>
          <TitleRow>
            <TitleSection>
              <Title>{meeting.title}</Title>
              <MetaInfo>
                <MetaItem>
                  <span className="icon">📅</span>
                  <span>{format(new Date(meeting.date), 'MMM d, yyyy')}</span>
                </MetaItem>
                <MetaItem>
                  <span className="icon">🕒</span>
                  <span>{format(new Date(meeting.date), 'h:mm a')}</span>
                </MetaItem>
                {meeting.duration && (
                  <MetaItem>
                    <span className="icon">⏱️</span>
                    <span>{meeting.duration} min</span>
                  </MetaItem>
                )}
                {meeting.platform && (
                  <MetaItem>
                    <span className="icon">💻</span>
                    <span>{meeting.platform}</span>
                  </MetaItem>
                )}
                {meeting.attendees && meeting.attendees.length > 0 && (
                  <MetaItem>
                    <span className="icon">👥</span>
                    <span>{meeting.attendees.length} attendees</span>
                  </MetaItem>
                )}
              </MetaInfo>
            </TitleSection>
            <ActionButtons>
              {hasChanges && (
                <Button onClick={handleSave} disabled={isSaving} size="small">
                  {isSaving ? 'Saving...' : 'Save'}
                </Button>
              )}
              <Button variant="danger" onClick={() => setShowDeleteModal(true)} size="small">
                Delete
              </Button>
            </ActionButtons>
          </TitleRow>

          <TabContainer>
            <Tab
              active={viewMode === 'notes'}
              onClick={() => setViewMode('notes')}
            >
              📝 Notes
            </Tab>
            <Tab
              active={viewMode === 'transcript'}
              onClick={() => setViewMode('transcript')}
            >
              🎙️ Transcript
            </Tab>
          </TabContainer>
        </Header>

        <Content>
          {viewMode === 'notes' && (
            <>
              {editorMode === 'edit' ? (
                <EditorWrapper>
                  <MDEditor
                    value={notes}
                    onChange={handleNotesChange}
                    preview="edit"
                    height={500}
                    data-color-mode="light"
                    visibleDragbar={false}
                    textareaProps={{
                      placeholder: 'Start typing your notes here...',
                    }}
                    commandsFilter={(cmd) => {
                      // Hide unnecessary commands
                      if (cmd.name === 'help' || cmd.name === 'fullscreen') return false;
                      return cmd;
                    }}
                  />
                  <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
                    <Button onClick={() => setEditorMode('preview')}>
                      Done Editing
                    </Button>
                  </div>
                </EditorWrapper>
              ) : (
                <>
                  {notes ? (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
                        <Button variant="ghost" onClick={() => setEditorMode('edit')} size="small">
                          ✏️ Edit Notes
                        </Button>
                      </div>
                      <MarkdownPreview>
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {notes}
                        </ReactMarkdown>
                      </MarkdownPreview>
                    </div>
                  ) : (
                    <EmptyState>
                      <span className="icon">📝</span>
                      <h3>No notes yet</h3>
                      <p>Click the edit button to start adding notes</p>
                      <Button
                        style={{ marginTop: 16 }}
                        onClick={() => setEditorMode('edit')}
                      >
                        Start Writing
                      </Button>
                    </EmptyState>
                  )}
                </>
              )}
            </>
          )}

          {viewMode === 'transcript' && (
            <>
              {meeting.transcript ? (
                <TranscriptContainer>
                  <TranscriptHeader>
                    <TranscriptTitle>
                      <span>🎙️</span>
                      Meeting Transcript
                    </TranscriptTitle>
                  </TranscriptHeader>
                  {parseTranscript(meeting.transcript).map((segment, index) => (
                    <TranscriptSegment key={index}>
                      <TranscriptTime>{segment.time}</TranscriptTime>
                      <TranscriptSpeaker>{segment.speaker}</TranscriptSpeaker>
                      <TranscriptText>{segment.text}</TranscriptText>
                    </TranscriptSegment>
                  ))}
                </TranscriptContainer>
              ) : (
                <EmptyState>
                  <span className="icon">🎙️</span>
                  <h3>No transcript available</h3>
                  <p>Transcript will appear here once the meeting is recorded</p>
                </EmptyState>
              )}
            </>
          )}
        </Content>
      </Container>

      <Modal show={showDeleteModal}>
        <ModalContent>
          <ModalTitle>⚠️ Delete Meeting?</ModalTitle>
          <ModalText>
            Are you sure you want to delete "{meeting.title}"? This will permanently remove all notes and transcripts associated with this meeting.
          </ModalText>
          <ModalButtons>
            <Button variant="ghost" onClick={() => setShowDeleteModal(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleDelete}>
              Delete Meeting
            </Button>
          </ModalButtons>
        </ModalContent>
      </Modal>
    </>
  );
}

export default MeetingDetailRedesigned;