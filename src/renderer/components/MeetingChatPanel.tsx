import React, { useCallback, useEffect, useRef, useState } from 'react';
import styled from '@emotion/styled';
import { Meeting, MeetingChatMessage } from '../../shared/types';

const PanelContainer = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #ffffff;
`;

const MessagesContainer = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: #f7f7fb;

  &::-webkit-scrollbar {
    width: 8px;
  }

  &::-webkit-scrollbar-thumb {
    background: #cbd5f5;
    border-radius: 4px;
  }
`;

const MessageGroup = styled.div<{ role: MeetingChatMessage['role'] }>`
  align-self: ${({ role }) => (role === 'assistant' ? 'flex-start' : 'flex-end')};
  max-width: 75%;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const MessageBubble = styled.div<{ role: MeetingChatMessage['role'] }>`
  background: ${({ role }) => (role === 'assistant' ? '#ffffff' : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)')};
  color: ${({ role }) => (role === 'assistant' ? '#1a1a1a' : '#ffffff')};
  border: ${({ role }) => (role === 'assistant' ? '1px solid rgba(102, 126, 234, 0.2)' : 'none')};
  box-shadow: ${({ role }) => (role === 'assistant' ? '0 4px 12px rgba(102, 126, 234, 0.2)' : 'none')};
  border-radius: 16px;
  padding: 12px 16px;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 14px;
  line-height: 1.6;
`;

const Timestamp = styled.span<{ role: MeetingChatMessage['role'] }>`
  font-size: 11px;
  color: #888;
  text-align: ${({ role }) => (role === 'assistant' ? 'left' : 'right')};
`;

const Composer = styled.form`
  padding: 16px 20px;
  border-top: 1px solid rgba(102, 126, 234, 0.12);
  background: #ffffff;
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const TextArea = styled.textarea`
  width: 100%;
  min-height: 96px;
  border-radius: 12px;
  border: 1px solid #d2d6f5;
  padding: 12px 14px;
  font-size: 14px;
  line-height: 1.6;
  resize: vertical;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;

  &:focus {
    outline: none;
    border-color: #667eea;
    box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.2);
  }

  &:disabled {
    background: #f0f1ff;
    color: #7a7ea8;
    cursor: not-allowed;
  }
`;

const ComposerActions = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding-right: 88px;
`;

const ActionButtons = styled.div`
  display: flex;
  gap: 8px;
`;

const Button = styled.button<{ variant?: 'primary' | 'ghost' | 'danger' }>`
  padding: 8px 16px;
  border-radius: 9999px;
  font-size: 13px;
  font-weight: 600;
  border: none;
  cursor: pointer;
  transition: all 0.2s;

  ${({ variant }) => {
    switch (variant) {
      case 'danger':
        return `
          background: rgba(220, 38, 38, 0.1);
          color: #dc2626;
          &:hover {
            background: rgba(220, 38, 38, 0.18);
          }
        `;
      case 'ghost':
        return `
          background: transparent;
          color: #667eea;
          &:hover {
            background: rgba(102, 126, 234, 0.12);
          }
        `;
      default:
        return `
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: #ffffff;
          &:hover {
            filter: brightness(0.95);
          }
          &:disabled {
            background: rgba(102, 126, 234, 0.4);
            cursor: not-allowed;
          }
        `;
    }
  }}
`;

const StatusText = styled.span`
  font-size: 12px;
  color: #6b6f8b;
`;

const EmptyState = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: #777aa6;
  padding: 40px 20px;
  text-align: center;
`;

interface MeetingChatPanelProps {
  meeting: Meeting;
  isActive: boolean;
}

export function MeetingChatPanel({ meeting, isActive }: MeetingChatPanelProps) {
  const [messages, setMessages] = useState<MeetingChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const messagesRef = useRef<HTMLDivElement | null>(null);

  const electronAPI = (window as any).electronAPI;

  const scrollToBottom = useCallback(() => {
    const container = messagesRef.current;
    if (container) {
      requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight;
      });
    }
  }, []);

  const loadHistory = useCallback(async () => {
    if (!electronAPI?.getMeetingChatHistory) {
      setStatus('Meeting chat is unavailable in this build.');
      return;
    }

    try {
      const response = await electronAPI.getMeetingChatHistory(meeting.id);
      if (response?.success) {
        setMessages(response.history ?? []);
        setStatus(null);
      } else if (response?.error) {
        setStatus(response.error);
      } else {
        setStatus('Unable to load chat history.');
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to load chat history.');
    }
  }, [electronAPI, meeting.id]);

  useEffect(() => {
    if (!isActive) {
      return;
    }
    void loadHistory();
  }, [isActive, loadHistory, meeting.id]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const handleSubmit = useCallback(async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = inputValue.trim();
    if (!trimmed || !electronAPI?.sendMeetingChatMessage) {
      return;
    }

    setIsSending(true);
    setStatus(null);

    try {
      const response = await electronAPI.sendMeetingChatMessage({
        meetingId: meeting.id,
        message: trimmed,
      });

      if (!response?.success) {
        throw new Error(response?.error || 'Failed to send message.');
      }

      setMessages(response.history ?? []);
      setInputValue('');
      setStatus(null);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to send message.');
    } finally {
      setIsSending(false);
    }
  }, [electronAPI, inputValue, meeting.id]);

  const handleClear = useCallback(async () => {
    if (!electronAPI?.clearMeetingChatHistory) {
      return;
    }

    setIsClearing(true);
    try {
      const response = await electronAPI.clearMeetingChatHistory(meeting.id);
      if (!response?.success) {
        throw new Error(response?.error || 'Failed to clear chat history.');
      }
      setMessages([]);
      setStatus(null);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to clear chat history.');
    } finally {
      setIsClearing(false);
    }
  }, [electronAPI, meeting.id]);

  const renderTimestamp = useCallback((value: string) => {
    try {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) {
        return '';
      }
      return new Intl.DateTimeFormat(undefined, {
        hour: 'numeric',
        minute: 'numeric',
      }).format(date);
    } catch {
      return '';
    }
  }, []);

  return (
    <PanelContainer>
      {messages.length === 0 && !status ? (
        <EmptyState>
          <div style={{ fontSize: '42px' }}>💬</div>
          <div style={{ fontWeight: 600 }}>Ask anything about this meeting</div>
          <div style={{ fontSize: '13px', maxWidth: 360 }}>
            Meeting Chat uses the notes, transcript, and calendar context to answer questions in real time.
          </div>
        </EmptyState>
      ) : (
        <MessagesContainer ref={messagesRef}>
          {messages.map((message) => (
            <MessageGroup role={message.role} key={message.id}>
              <MessageBubble role={message.role}>{message.content}</MessageBubble>
              <Timestamp role={message.role}>{renderTimestamp(message.createdAt)}</Timestamp>
            </MessageGroup>
          ))}
        </MessagesContainer>
      )}

      <Composer onSubmit={handleSubmit}>
        <TextArea
          value={inputValue}
          onChange={(event) => setInputValue(event.target.value)}
          placeholder={electronAPI?.sendMeetingChatMessage ? 'Ask a question about this meeting…' : 'Meeting chat is unavailable.'}
          disabled={isSending || !electronAPI?.sendMeetingChatMessage}
        />
        <ComposerActions>
          <StatusText>
            {isSending && 'Sending…'}
            {isClearing && 'Clearing history…'}
            {!isSending && !isClearing && status}
          </StatusText>
          <ActionButtons>
            <Button
              type="button"
              variant="ghost"
              onClick={handleClear}
              disabled={messages.length === 0 || isSending || isClearing || !electronAPI?.clearMeetingChatHistory}
            >
              Clear
            </Button>
            <Button type="submit" disabled={isSending || !inputValue.trim()}>
              Send
            </Button>
          </ActionButtons>
        </ComposerActions>
      </Composer>
    </PanelContainer>
  );
}

export default MeetingChatPanel;
