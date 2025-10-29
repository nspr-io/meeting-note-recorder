import React, { useState, useEffect } from 'react';
import styled from '@emotion/styled';
import { Meeting } from '../../shared/types';
import { parseTranscript as parseTranscriptUtility } from '../../shared/utils/transcriptParser';
import { format } from 'date-fns';
import MDEditor from '@uiw/react-md-editor';

const Container = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  padding: 2px;
  border-radius: 12px;
`;

const InnerContainer = styled.div`
  background: #ffffff;
  border-radius: 10px;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

const Header = styled.div`
  padding: 24px;
  border-bottom: 1px solid #e5e7eb;
  background: linear-gradient(135deg, #f5f7fa 0%, #ffffff 100%);
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
  color: #1f2937;
  margin: 0;
`;

const ActionButtons = styled.div`
  display: flex;
  gap: 8px;
`;

const Button = styled.button<{ variant?: 'primary' | 'danger' | 'ghost' }>`
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  border: none;

  ${props => {
    switch(props.variant) {
      case 'danger':
        return `
          background: #ef4444;
          color: white;
          &:hover {
            background: #dc2626;
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(239, 68, 68, 0.3);
          }
        `;
      case 'ghost':
        return `
          background: transparent;
          color: #6b7280;
          border: 1px solid #e5e7eb;
          &:hover {
            background: #f9fafb;
            border-color: #d1d5db;
          }
        `;
      default:
        return `
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          &:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
          }
        `;
    }
  }}

  &:active {
    transform: translateY(0);
  }
`;

const MetaInfo = styled.div`
  display: flex;
  gap: 24px;
  color: #6b7280;
  font-size: 14px;
`;

const MetaItem = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;

  span.icon {
    font-size: 16px;
  }
`;

const TabContainer = styled.div`
  display: flex;
  gap: 4px;
  padding: 0 24px;
  margin-top: 16px;
  border-bottom: 1px solid #e5e7eb;
`;

const Tab = styled.button<{ active: boolean }>`
  padding: 12px 20px;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: ${props => props.active ? '#667eea' : '#6b7280'};
  font-weight: ${props => props.active ? '600' : '400'};
  cursor: pointer;
  transition: all 0.2s;

  ${props => props.active && `
    border-bottom-color: #667eea;
  `}

  &:hover {
    color: #667eea;
    background: #f9fafb;
  }
`;

const Content = styled.div`
  flex: 1;
  padding: 24px;
  overflow-y: auto;

  &::-webkit-scrollbar {
    width: 8px;
  }

  &::-webkit-scrollbar-track {
    background: #f1f1f1;
    border-radius: 4px;
  }

  &::-webkit-scrollbar-thumb {
    background: #cbd5e1;
    border-radius: 4px;

    &:hover {
      background: #94a3b8;
    }
  }
`;

const Section = styled.div`
  margin-bottom: 32px;
`;

const SectionTitle = styled.h2`
  font-size: 18px;
  font-weight: 600;
  color: #374151;
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  gap: 8px;

  span.icon {
    font-size: 20px;
  }
`;

const TranscriptContainer = styled.div`
  background: #f9fafb;
  border-radius: 8px;
  padding: 16px;
  max-height: 400px;
  overflow-y: auto;
`;

const TranscriptLine = styled.div`
  margin-bottom: 12px;

  .speaker {
    font-weight: 600;
    color: #667eea;
    margin-bottom: 4px;
    font-size: 13px;
  }

  .text {
    color: #374151;
    line-height: 1.6;
    font-size: 14px;
  }
`;

const EditorToggle = styled.div`
  display: flex;
  justify-content: flex-end;
  margin-bottom: 12px;
  gap: 8px;
`;

const ToggleButton = styled.button<{ active: boolean }>`
  padding: 6px 12px;
  border: 1px solid #e5e7eb;
  background: ${props => props.active ? '#667eea' : '#ffffff'};
  color: ${props => props.active ? '#ffffff' : '#6b7280'};
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    background: ${props => props.active ? '#5a67d8' : '#f9fafb'};
  }
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
  border-radius: 12px;
  padding: 24px;
  max-width: 400px;
  width: 90%;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
`;

const ModalTitle = styled.h3`
  font-size: 18px;
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

interface MeetingDetailEnhancedProps {
  meeting: Meeting;
  onUpdateMeeting: (meeting: Meeting) => void;
  onDeleteMeeting?: (meetingId: string) => void;
}

type ViewMode = 'notes' | 'transcript';
type EditorMode = 'edit' | 'preview';

function MeetingDetailEnhanced({ meeting, onUpdateMeeting, onDeleteMeeting }: MeetingDetailEnhancedProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('notes');
  const [editorMode, setEditorMode] = useState<EditorMode>('preview');
  const [notes, setNotes] = useState(meeting.notes || '');
  const [isSaving, setIsSaving] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  const meetingDateObj = new Date(meeting.date);
  const hasValidMeetingDate = !Number.isNaN(meetingDateObj.getTime());
  const meetingDateLabel = hasValidMeetingDate
    ? format(meetingDateObj, 'MMM d, yyyy h:mm a')
    : 'Date unavailable';

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

  const parseTranscript = (transcript: string) => parseTranscriptUtility(transcript);

  return (
    <>
      <Container>
        <InnerContainer>
          <Header>
            <TitleRow>
              <Title>{meeting.title}</Title>
              <ActionButtons>
                {hasChanges && (
                  <Button onClick={handleSave} disabled={isSaving}>
                    {isSaving ? '💾 Saving...' : '💾 Save Changes'}
                  </Button>
                )}
                <Button variant="danger" onClick={() => setShowDeleteModal(true)}>
                  🗑️ Delete
                </Button>
              </ActionButtons>
            </TitleRow>
            <MetaInfo>
              <MetaItem>
                <span className="icon">📅</span>
                {meetingDateLabel}
              </MetaItem>
              {meeting.duration && (
                <MetaItem>
                  <span className="icon">⏱️</span>
                  {meeting.duration} minutes
                </MetaItem>
              )}
              {meeting.platform && (
                <MetaItem>
                  <span className="icon">💻</span>
                  {meeting.platform}
                </MetaItem>
              )}
              {meeting.attendees && meeting.attendees.length > 0 && (
                <MetaItem>
                  <span className="icon">👥</span>
                  {meeting.attendees.length} attendees
                </MetaItem>
              )}
            </MetaInfo>
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
              <Section>
                <SectionTitle>
                  <span className="icon">📝</span>
                  Meeting Notes
                </SectionTitle>
                <EditorToggle>
                  <ToggleButton
                    active={editorMode === 'edit'}
                    onClick={() => setEditorMode('edit')}
                  >
                    ✏️ Edit
                  </ToggleButton>
                  <ToggleButton
                    active={editorMode === 'preview'}
                    onClick={() => setEditorMode('preview')}
                  >
                    👁️ Preview
                  </ToggleButton>
                </EditorToggle>
                <div data-color-mode="light">
                  <MDEditor
                    value={notes}
                    onChange={handleNotesChange}
                    preview={editorMode === 'preview' ? 'preview' : 'edit'}
                    hideToolbar={editorMode === 'preview'}
                    height={400}
                  />
                </div>
              </Section>
            )}

            {viewMode === 'transcript' && (
              <Section>
                <SectionTitle>
                  <span className="icon">🎙️</span>
                  Meeting Transcript
                </SectionTitle>
                {meeting.transcript ? (
                  <TranscriptContainer>
                    {parseTranscript(meeting.transcript).map((line, index) => (
                      <TranscriptLine key={index}>
                        <div className="speaker">{line.speaker}</div>
                        <div className="text">{line.text}</div>
                      </TranscriptLine>
                    ))}
                  </TranscriptContainer>
                ) : (
                  <EmptyState>
                    <span className="icon">🎙️</span>
                    <h3>No transcript available</h3>
                    <p>Transcript will appear here once the meeting is recorded</p>
                  </EmptyState>
                )}
              </Section>
            )}
          </Content>
        </InnerContainer>
      </Container>

      <Modal show={showDeleteModal}>
        <ModalContent>
          <ModalTitle>Delete Meeting?</ModalTitle>
          <ModalText>
            Are you sure you want to delete "{meeting.title}"? This action cannot be undone and will permanently remove all notes and transcripts.
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

export default MeetingDetailEnhanced;