import React, { useState, useEffect, useRef, useCallback } from 'react';
import styled from '@emotion/styled';
import { Meeting, Attendee, IpcChannels, CoachingType, CoachingFeedback, CoachingState, NotionShareMode, ActionItemSyncStatus, CoachConfig } from '../../shared/types';
import { format } from 'date-fns';
import MDEditor, { ICommand } from '@uiw/react-md-editor';
import { combineNoteSections, extractNoteSections, hasSectionChanges } from './noteSectionUtils';

const Container = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #ffffff;
`;

const Header = styled.div`
  padding: 20px 24px;
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
  display: ${props => props.isActive ? 'flex' : 'none'};
  flex: 1;
  flex-direction: column;
  width: 100%;
  min-height: 0;
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
  display: flex;
  flex-direction: column;
  background: #fafafa;
  min-height: 0;

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
  padding: 16px;
  background: white;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;

  .w-md-editor {
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    background: white;
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .w-md-editor-toolbar {
    background: #fafafa;
    border-bottom: 1px solid #e5e7eb;
    flex: none;
  }

  .w-md-editor-content {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    flex: 1;
    min-height: 0;
    overflow: auto;
  }

  .w-md-editor-preview {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }

  /* NUCLEAR OVERRIDE - Force full width preview with zero margins */
  &.w-md-editor-show-preview,
  & .w-md-editor.w-md-editor-show-preview,
  & .w-md-editor-show-preview .w-md-editor-preview {
    margin-left: 0 !important;
    margin-right: 0 !important;
    max-width: none !important;
    width: 100% !important;
  }

  /* Enhanced preview styling - Professional UX/UI Design */
  & .w-md-editor-preview {
    font-size: 15px !important;
    line-height: 1.75 !important;
    padding: 20px !important;
    margin-left: 0 !important;
    margin-right: 0 !important;
    max-width: none !important;
    width: 100% !important;
    box-sizing: border-box !important;
  }

  /* Kill ALL centering and max-width from library */
  & .w-md-editor-preview * {
    max-width: none !important;
  }

  & .w-md-editor-preview > * {
    margin-left: 0 !important;
    margin-right: 0 !important;
  }

  /* Base typography */
  & .w-md-editor-preview .wmde-markdown,
  & .w-md-editor-preview .wmde-markdown-var {
    font-size: 15px !important;
    line-height: 1.75 !important;
    color: #2d3748 !important;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica Neue', Arial, sans-serif !important;
    -webkit-font-smoothing: antialiased !important;
    -moz-osx-font-smoothing: grayscale !important;
    padding: 0 !important;
    margin: 0 !important;
    max-width: none !important;
    width: 100% !important;
    box-sizing: border-box !important;
  }

  /* H1 - Main section headers */
  & .w-md-editor-preview .wmde-markdown h1 {
    font-size: 32px !important;
    font-weight: 700 !important;
    margin-top: 48px !important;
    margin-bottom: 24px !important;
    line-height: 1.2 !important;
    letter-spacing: -0.02em !important;
    color: #1a202c !important;
    border-bottom: 2px solid #e2e8f0 !important;
    padding-bottom: 12px !important;
  }

  & .w-md-editor-preview .wmde-markdown h1:first-child {
    margin-top: 0 !important;
  }

  /* H2 - Subsection headers */
  & .w-md-editor-preview .wmde-markdown h2 {
    font-size: 24px !important;
    font-weight: 700 !important;
    margin-top: 40px !important;
    margin-bottom: 16px !important;
    line-height: 1.3 !important;
    letter-spacing: -0.01em !important;
    color: #1a202c !important;
  }

  /* H3 - Section headers */
  & .w-md-editor-preview .wmde-markdown h3 {
    font-size: 20px !important;
    font-weight: 600 !important;
    margin-top: 32px !important;
    margin-bottom: 12px !important;
    line-height: 1.4 !important;
    color: #2d3748 !important;
  }

  /* H4 - Minor headers */
  & .w-md-editor-preview .wmde-markdown h4 {
    font-size: 17px !important;
    font-weight: 600 !important;
    margin-top: 24px !important;
    margin-bottom: 10px !important;
    line-height: 1.5 !important;
    color: #2d3748 !important;
  }

  /* Paragraphs */
  & .w-md-editor-preview .wmde-markdown p {
    margin-top: 0 !important;
    margin-bottom: 20px !important;
    line-height: 1.75 !important;
    color: #4a5568 !important;
  }

  /* Lists - Enhanced spacing and styling */
  & .w-md-editor-preview .wmde-markdown ul,
  & .w-md-editor-preview .wmde-markdown ol {
    margin-top: 0 !important;
    margin-bottom: 20px !important;
    padding-left: 32px !important;
  }

  & .w-md-editor-preview .wmde-markdown ul {
    list-style-type: none !important;
  }

  /* Custom bullet points */
  & .w-md-editor-preview .wmde-markdown ul > li {
    position: relative !important;
    padding-left: 8px !important;
  }

  & .w-md-editor-preview .wmde-markdown ul > li::before {
    content: '•' !important;
    position: absolute !important;
    left: -20px !important;
    color: #667eea !important;
    font-weight: 700 !important;
    font-size: 1.2em !important;
  }

  /* List items */
  & .w-md-editor-preview .wmde-markdown li {
    margin-bottom: 10px !important;
    line-height: 1.75 !important;
    color: #4a5568 !important;
  }

  & .w-md-editor-preview .wmde-markdown li > p {
    margin-bottom: 10px !important;
  }

  & .w-md-editor-preview .wmde-markdown li:last-child {
    margin-bottom: 0 !important;
  }

  /* Nested lists */
  & .w-md-editor-preview .wmde-markdown ul ul,
  & .w-md-editor-preview .wmde-markdown ol ul,
  & .w-md-editor-preview .wmde-markdown ul ol,
  & .w-md-editor-preview .wmde-markdown ol ol {
    margin-top: 10px !important;
    margin-bottom: 10px !important;
  }

  /* Nested list bullets - smaller and different color */
  & .w-md-editor-preview .wmde-markdown ul ul > li::before {
    content: '◦' !important;
    color: #a0aec0 !important;
  }

  /* Strong/Bold text */
  & .w-md-editor-preview .wmde-markdown strong {
    font-weight: 700 !important;
    color: #1a202c !important;
  }

  /* Emphasis/Italic */
  & .w-md-editor-preview .wmde-markdown em {
    font-style: italic !important;
    color: #2d3748 !important;
  }

  /* Blockquotes - Elevated design */
  & .w-md-editor-preview .wmde-markdown blockquote {
    margin: 24px 0 !important;
    padding: 16px 24px !important;
    border-left: 4px solid #667eea !important;
    background: linear-gradient(to right, #f7fafc, #ffffff) !important;
    border-radius: 0 4px 4px 0 !important;
    color: #4a5568 !important;
    font-style: italic !important;
  }

  & .w-md-editor-preview .wmde-markdown blockquote p {
    margin-bottom: 0 !important;
  }

  /* Inline code */
  & .w-md-editor-preview .wmde-markdown code {
    background: #edf2f7 !important;
    color: #d63384 !important;
    padding: 3px 8px !important;
    border-radius: 4px !important;
    font-size: 0.9em !important;
    font-family: 'SF Mono', Monaco, 'Cascadia Code', Consolas, monospace !important;
    font-weight: 500 !important;
  }

  /* Code blocks */
  & .w-md-editor-preview .wmde-markdown pre {
    background: #f7fafc !important;
    border: 1px solid #e2e8f0 !important;
    padding: 20px !important;
    border-radius: 8px !important;
    overflow-x: auto !important;
    margin: 24px 0 !important;
  }

  & .w-md-editor-preview .wmde-markdown pre code {
    background: none !important;
    color: #2d3748 !important;
    padding: 0 !important;
    font-weight: 400 !important;
  }

  /* Horizontal rules */
  & .w-md-editor-preview .wmde-markdown hr {
    border: none !important;
    height: 1px !important;
    background: linear-gradient(to right, transparent, #cbd5e0, transparent) !important;
    margin: 40px 0 !important;
  }

  /* Tables - Clean design */
  & .w-md-editor-preview .wmde-markdown table {
    border-collapse: collapse !important;
    width: 100% !important;
    margin: 24px 0 !important;
    border-radius: 8px !important;
    overflow: hidden !important;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05) !important;
  }

  & .w-md-editor-preview .wmde-markdown table th,
  & .w-md-editor-preview .wmde-markdown table td {
    border: 1px solid #e2e8f0 !important;
    padding: 12px 16px !important;
    text-align: left !important;
  }

  & .w-md-editor-preview .wmde-markdown table th {
    background: #f7fafc !important;
    font-weight: 600 !important;
    color: #2d3748 !important;
    border-bottom: 2px solid #cbd5e0 !important;
  }

  & .w-md-editor-preview .wmde-markdown table tr:hover {
    background: #f7fafc !important;
  }

  /* Links - Subtle and refined */
  & .w-md-editor-preview .wmde-markdown a {
    color: #667eea !important;
    text-decoration: none !important;
    border-bottom: 1px solid transparent !important;
    transition: all 0.2s ease !important;
  }

  & .w-md-editor-preview .wmde-markdown a:hover {
    color: #5a67d8 !important;
    border-bottom-color: #667eea !important;
  }
`;

const SectionStack = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const NotesScrollArea = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;

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

const SectionCard = styled.div`
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  background: #ffffff;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const SectionHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

const SectionTitle = styled.h3`
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: #1a1a1a;
`;

const SectionActions = styled.div`
  display: flex;
  gap: 8px;
`;

const SectionContent = styled.div`
  font-size: 13px;
  color: #4a5568;
  white-space: pre-wrap;
  line-height: 1.6;
`;

const SectionTextarea = styled.textarea`
  width: 100%;
  min-height: 120px;
  border: 1px solid #dfe3eb;
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 13px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: #1a1a1a;
  resize: vertical;

  &:focus {
    outline: none;
    border-color: #667eea;
    box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.15);
  }

  &:disabled {
    background: #f8fafc;
    color: #64748b;
  }
`;

const InlineButton = styled.button`
  border: none;
  background: transparent;
  color: #667eea;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  padding: 4px 0;

  &:hover {
    text-decoration: underline;
  }
`;

const EditorToolbar = styled.div`
  position: sticky;
  top: 0;
  display: flex;
  justify-content: flex-start;
  gap: 4px;
  padding-top: 8px;
  background: white;
  z-index: 1;
`;

const RecordingBanner = styled.div`
  background: linear-gradient(135deg, #ff3b30 0%, #ff6b6b 100%);
  color: white;
  padding: 16px 28px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid rgba(255, 255, 255, 0.2);
  animation: pulse 2s ease-in-out infinite;

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.95; }
  }
`;

const RecordingInfo = styled.div`
  display: flex;
  align-items: center;
  gap: 24px;
  font-size: 14px;
  font-weight: 500;
`;

const RecordingDot = styled.div`
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: white;
  animation: blink 1.5s ease-in-out infinite;

  @keyframes blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }
`;

const RecordingLabel = styled.span`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const RecordingStats = styled.div`
  display: flex;
  gap: 16px;
  font-family: 'SF Mono', Monaco, monospace;
`;

const SaveStatus = styled.div`
  font-size: 12px;
  color: #666;
  display: flex;
  align-items: center;
  gap: 4px;
  margin-right: 8px;
`;

const TranscriptContainer = styled.div`
  padding: 24px;
  background: white;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 20px;

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

const ActionGrid = styled.div`
  display: flex;
  flex-direction: column;
  gap: 20px;
`;

const ActionCard = styled.div`
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

const ActionCardHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
`;

const ActionCardTitle = styled.h3`
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #1a1a1a;
  display: flex;
  align-items: center;
  gap: 8px;
`;

const ActionCardDescription = styled.p`
  margin: 0;
  font-size: 13px;
  color: #6b7280;
`;

const ActionButtonRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`;

const ActionStatus = styled.div`
  font-size: 12px;
  color: #4b5563;
  display: flex;
  align-items: center;
  gap: 8px;
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
  onRefresh?: () => Promise<void> | void;
  onShowToast?: (message: string, type?: 'success' | 'error' | 'info') => void;
  coachingState: (CoachingState & { feedbackHistory: CoachingFeedback[] });
  onCoachingStateRefresh: () => Promise<void> | void;
  activeCoachingMeeting?: Meeting | null;
  isCoachWindowOpen?: boolean;
  onOpenCoachWindow?: (meetingId: string) => void;
  onCloseCoachWindow?: () => void;
  isCoachPopout?: boolean;
}

type ViewMode = 'context' | 'liveNotes' | 'transcript' | 'insights' | 'actions' | 'coach';

// Module-level transcript cache to persist across component re-renders
const transcriptCache = new Map<string, any[]>();
const transcriptSequenceCache = new Map<string, Set<string>>();

function MeetingDetailFinal({ meeting, onUpdateMeeting, onDeleteMeeting, onRefresh, onShowToast, coachingState, onCoachingStateRefresh, activeCoachingMeeting, isCoachWindowOpen = false, onOpenCoachWindow, onCloseCoachWindow, isCoachPopout = false }: MeetingDetailFinalProps) {
  const initialSections = extractNoteSections(meeting.notes || '');
  const [viewMode, setViewMode] = useState<ViewMode>(isCoachPopout ? 'coach' : 'context');
  const [calendarInfo, setCalendarInfo] = useState(initialSections.calendarInfo);
  const [prepNotes, setPrepNotes] = useState(initialSections.prepNotes);
  const [meetingNotes, setMeetingNotes] = useState(initialSections.meetingNotes);
  const [combinedNotes, setCombinedNotes] = useState(combineNoteSections(initialSections));
  const [baselineNotes, setBaselineNotes] = useState(meeting.notes || '');
  const [showPrepEditor, setShowPrepEditor] = useState(false);
  const [isEditingCalendar, setIsEditingCalendar] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [transcriptSegments, setTranscriptSegments] = useState<any[]>(
    transcriptCache.get(meeting.id) || []
  );
  const [isRecording, setIsRecording] = useState(meeting.status === 'recording');
  const [recordingStartTime, setRecordingStartTime] = useState<Date | null>(null);
  const [elapsedTime, setElapsedTime] = useState('00:00:00');
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
  const [notionShared, setNotionShared] = useState(meeting.notionSharedAt ?? null);
  const [notionPageId, setNotionPageId] = useState(meeting.notionPageId ?? '');
  const [sharingToNotionMode, setSharingToNotionMode] = useState<NotionShareMode | null>(null);
  const [actionItemSyncStatus, setActionItemSyncStatus] = useState<ActionItemSyncStatus[]>(meeting.actionItemSyncStatus || []);
  const [isSendingActionItems, setIsSendingActionItems] = useState(false);
  const [actionItemError, setActionItemError] = useState<string | null>(null);
  const [sendingItemIndex, setSendingItemIndex] = useState<number | null>(null);
  const [itemErrors, setItemErrors] = useState<Record<number, string>>({});
  const isFirstRender = useRef(true);
  const previousMeetingIdRef = useRef(meeting.id);

  const meetingDateObj = new Date(meeting.date);
  const hasValidMeetingDate = !Number.isNaN(meetingDateObj.getTime());
  const meetingFullDateLabel = hasValidMeetingDate ? format(meetingDateObj, 'PPP') : 'Date unavailable';
  const meetingDateLabel = hasValidMeetingDate ? format(meetingDateObj, 'MMM d, yyyy') : 'Date unavailable';
  const meetingTimeLabel = hasValidMeetingDate ? format(meetingDateObj, 'h:mm a') : '–';

  const formatTodoDueDate = useCallback((iso?: string | null) => {
    if (!iso) {
      return 'No due date';
    }
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      return iso;
    }
    return format(date, 'PP');
  }, []);

  const sendActionItemsToNotion = useCallback(async () => {
    if (!(window as any).electronAPI?.sendNotionActionItems) {
      setActionItemError('Notion integration is not available.');
      return;
    }

    setIsSendingActionItems(true);
    setActionItemError(null);

    try {
      const result = await (window as any).electronAPI.sendNotionActionItems(meeting.id);

      if (!result?.success) {
        setActionItemError(result?.error || 'Failed to send action items to Notion.');
        if (Array.isArray(result?.results)) {
          setActionItemSyncStatus(result.results);
        }
        return;
      }

      setActionItemSyncStatus(Array.isArray(result.results) ? result.results : []);
      onShowToast?.('Sent action items to Notion.', 'success');
      if (onRefresh) {
        await onRefresh();
      }
    } catch (error) {
      console.error('Failed to send action items:', error);
      setActionItemError('Failed to send action items to Notion.');
    } finally {
      setIsSendingActionItems(false);
    }
  }, [meeting.id, onShowToast]);

  const sendSingleActionItem = useCallback(async (index: number) => {
    if (!(window as any).electronAPI?.sendSingleNotionActionItem) {
      setItemErrors(prev => ({ ...prev, [index]: 'Notion integration is not available.' }));
      return;
    }

    const actionItem = insights?.actionItems?.[index];
    if (!actionItem) {
      setItemErrors(prev => ({ ...prev, [index]: 'Action item could not be found.' }));
      return;
    }

    setSendingItemIndex(index);
    setItemErrors(prev => {
      const next = { ...prev };
      delete next[index];
      return next;
    });

    try {
      const result = await (window as any).electronAPI.sendSingleNotionActionItem({
        meetingId: meeting.id,
        item: {
          insightIndex: index,
          task: actionItem?.task,
          owner: actionItem?.owner,
          due: actionItem?.due
        }
      });

      if (!result?.success) {
        const message = result?.error || 'Failed to send action item to Notion.';
        setItemErrors(prev => ({ ...prev, [index]: message }));
        if (Array.isArray(result?.results)) {
          setActionItemSyncStatus(result.results);
        }
        return;
      }

      if (Array.isArray(result.results)) {
        setActionItemSyncStatus(result.results);
      }

      onShowToast?.('Sent action item to Notion.', 'success');
      if (onRefresh) {
        await onRefresh();
      }
    } catch (error) {
      console.error('Failed to send single action item:', error);
      setItemErrors(prev => ({ ...prev, [index]: 'Failed to send action item to Notion.' }));
    } finally {
      setSendingItemIndex(null);
    }
  }, [insights?.actionItems, meeting.id, onRefresh, onShowToast]);

  // Coaching state
  const [availableCoaches, setAvailableCoaches] = useState<CoachConfig[]>([]);
  const [selectedCoachingType, setSelectedCoachingType] = useState<CoachingType>('');
  const isCoachingActive = coachingState.isActive;
  const isCoachingForCurrentMeeting = isCoachingActive && coachingState.meetingId === meeting.id;
  const isCoachingOnAnotherMeeting = isCoachingActive && coachingState.meetingId !== meeting.id;
  const coachingFeedbackHistory = isCoachingForCurrentMeeting ? coachingState.feedbackHistory : [];
  const isCoaching = isCoachingForCurrentMeeting;
  const hasCalendarContent = calendarInfo.trim().length > 0;
  const hasPrepContent = prepNotes.trim().length > 0;
  const disablePreviewCommands = useCallback((command: ICommand, isExtra: boolean) => {
    if (isExtra) {
      return false;
    }
    return command;
  }, []);

  useEffect(() => {
    if (isCoachingForCurrentMeeting) {
      void onCoachingStateRefresh?.();
    }
  }, [isCoachingForCurrentMeeting, onCoachingStateRefresh]);

  useEffect(() => {
    if (isCoachPopout) {
      setViewMode('coach');
    }
  }, [isCoachPopout]);

  useEffect(() => {
    const sections = { calendarInfo, prepNotes, meetingNotes };
    const nextCombined = combineNoteSections(sections);

    if (nextCombined !== combinedNotes) {
      setCombinedNotes(nextCombined);
    }

    setHasChanges(hasSectionChanges(sections, baselineNotes));
  }, [calendarInfo, prepNotes, meetingNotes, baselineNotes, combinedNotes]);

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

  // Refresh meeting from disk when viewing to get latest content (e.g., external prep notes)
  useEffect(() => {
    const refreshFromDisk = async () => {
      try {
        await window.electronAPI.refreshMeeting(meeting.id);
      } catch (error) {
        console.error('[REFRESH-MEETING] Failed to refresh from disk:', error);
      }
    };
    refreshFromDisk();
  }, [meeting.id]);

  useEffect(() => {
    console.log('[MEETING-CHANGE] Effect triggered', {
      meetingId: meeting.id,
      meetingTitle: meeting.title,
      meetingStatus: meeting.status,
      isRecordingState: isRecording,
      currentSegmentCount: transcriptSegments.length,
      transcriptLength: meeting.transcript?.length || 0
    });

    const previousMeetingId = previousMeetingIdRef.current;
    const meetingIdChanged = previousMeetingId !== meeting.id;

    const parsedSections = extractNoteSections(meeting.notes || '');
    setCalendarInfo(parsedSections.calendarInfo);
    setPrepNotes(parsedSections.prepNotes);
    setMeetingNotes(parsedSections.meetingNotes);
    setIsEditingCalendar(false);
    setCombinedNotes(combineNoteSections(parsedSections));
    setBaselineNotes(meeting.notes || '');
    setEditedTitle(meeting.title); // Update title when meeting prop changes
    setHasChanges(false);
    setIsRecording(meeting.status === 'recording');
    setItemErrors({});
    setSendingItemIndex(null);
    // Initialize recording start time if meeting is already recording
    if (meeting.status === 'recording' && !recordingStartTime) {
      // Use meeting's stored start time if available (persists across navigation)
      setRecordingStartTime(meeting.startTime ? new Date(meeting.startTime) : new Date());
    }
    if (meetingIdChanged) {
      setEditorKey(Date.now()); // Force complete editor remount only when meeting changes
    }
    isFirstRender.current = true; // Reset first render flag for new meeting

    if (meetingIdChanged) {
      setShowPrepEditor(false);
    }

    if (meetingIdChanged) {
      setSelectedCoachingType(prev => {
        if (isCoachingForCurrentMeeting && coachingState.coachingType) {
          return coachingState.coachingType;
        }
        const enabledCoaches = availableCoaches.filter(coach => coach.enabled);
        if (prev && enabledCoaches.some(coach => coach.id === prev)) {
          return prev;
        }
        return enabledCoaches[0]?.id || '';
      });
    }

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

    // Update Notion sharing state
    if (meeting.notionSharedAt) {
      const sharedAt = new Date(meeting.notionSharedAt);
      setNotionShared(Number.isNaN(sharedAt.getTime()) ? null : sharedAt);
    } else {
      setNotionShared(null);
    }
    setNotionPageId(meeting.notionPageId ?? '');
    setSharingToNotionMode(null);
    previousMeetingIdRef.current = meeting.id;

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
  }, [
    meeting.id,
    meeting.status,
    meeting.transcript,
    meeting.notes,
    meeting.title,
    availableCoaches,
    coachingState.coachingType,
    coachingState.meetingId,
    isCoachingForCurrentMeeting
  ]);

  // Listen for recording started events
  useEffect(() => {
    const handleRecordingStarted = (data: any) => {
      if (data.meetingId === meeting.id) {
        console.log('[MeetingDetailFinal] Recording started for this meeting', { startTime: data.startTime });
        setIsRecording(true);
        setRecordingStartTime(data.startTime ? new Date(data.startTime) : new Date());
        // Don't clear segments - keep existing transcript and append new ones
        // This allows resuming recording on same meeting
      }
    };

    const handleRecordingStopped = () => {
      console.log('[MeetingDetailFinal] Recording stopped');
      setIsRecording(false);
      setRecordingStartTime(null);

      // Auto-stop coaching when recording ends
      if (isCoachingForCurrentMeeting) {
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
  }, [meeting.id, isCoachingForCurrentMeeting]);

  // Update elapsed time timer
  useEffect(() => {
    if (!isRecording || !recordingStartTime) {
      setElapsedTime('00:00:00');
      return;
    }

    const updateTimer = () => {
      const now = new Date();
      const elapsed = Math.floor((now.getTime() - recordingStartTime.getTime()) / 1000);
      const hours = Math.floor(elapsed / 3600);
      const minutes = Math.floor((elapsed % 3600) / 60);
      const seconds = elapsed % 60;
      setElapsedTime(
        `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
      );
    };

    // Update immediately
    updateTimer();

    // Update every second
    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [isRecording, recordingStartTime]);

  useEffect(() => {
    setActionItemSyncStatus(meeting.actionItemSyncStatus || []);
  }, [meeting.actionItemSyncStatus]);

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
  const handleCoachingError = useCallback((data: any) => {
    if (data.meetingId === meeting.id) {
      console.error('[COACHING] Error:', data.error);
      alert(`Coaching error: ${data.error}`);
    }
  }, [meeting.id]);

  useEffect(() => {
    const loadCoaches = async () => {
      try {
        const coaches = await (window as any).electronAPI?.getCoaches?.();
        if (Array.isArray(coaches)) {
          setAvailableCoaches(coaches);
          const enabled = coaches.filter((coach: CoachConfig) => coach.enabled);
          setSelectedCoachingType(prev => {
            if (isCoachingForCurrentMeeting && coachingState.coachingType) {
              return coachingState.coachingType;
            }
            if (prev && enabled.some(coach => coach.id === prev)) {
              return prev;
            }
            return enabled[0]?.id || '';
          });
        }
      } catch (error) {
        console.error('[COACHING] Failed to load coaches:', error);
      }
    };

    loadCoaches();
    (window as any).electronAPI?.on?.(IpcChannels.COACHING_ERROR, handleCoachingError);
    (window as any).electronAPI?.on?.(IpcChannels.SETTINGS_UPDATED, loadCoaches);

    return () => {
      (window as any).electronAPI?.removeListener?.(IpcChannels.COACHING_ERROR, handleCoachingError);
      (window as any).electronAPI?.removeListener?.(IpcChannels.SETTINGS_UPDATED, loadCoaches);
    };
  }, [handleCoachingError, isCoachingForCurrentMeeting, coachingState.coachingType]);

  // Sync notes to coaching service every 10 seconds when coaching is active
  useEffect(() => {
    if (!isCoachingForCurrentMeeting) return;

    // Send immediately when coaching starts
    if (combinedNotes) {
      (window as any).electronAPI?.updateCoachingNotes?.(meeting.id, combinedNotes);
    }

    // Then every 10 seconds
    const interval = setInterval(() => {
      if (isCoachingForCurrentMeeting && combinedNotes) {
        (window as any).electronAPI?.updateCoachingNotes?.(meeting.id, combinedNotes);
      }
    }, 10000); // 10 seconds

    return () => clearInterval(interval);
  }, [isCoachingForCurrentMeeting, combinedNotes, meeting.id]);

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

    const sequenceId = data.sequenceId || data.hash;
    if (!transcriptSequenceCache.has(meeting.id)) {
      transcriptSequenceCache.set(meeting.id, new Set());
    }
    const seenSequences = transcriptSequenceCache.get(meeting.id)!;

    setTranscriptSegments(prev => {
      console.log('[TRANSCRIPT-UPDATE] Current segment count before add:', prev.length);

      const newTimestamp = typeof data.timestamp === 'string'
        ? new Date(data.timestamp).getTime()
        : data.timestamp?.getTime?.() || Date.now();

      const isExactDuplicate = prev.some(s => {
        const existingTimestamp = typeof s.timestamp === 'string'
          ? new Date(s.timestamp).getTime()
          : s.timestamp?.getTime?.() || 0;

        return s.text === data.text && Math.abs(existingTimestamp - newTimestamp) < 100;
      });

      if (isExactDuplicate) {
        console.log('[TRANSCRIPT-UPDATE] Duplicate detected via timestamp/text, skipping');
        return prev;
      }

      if (sequenceId) {
        if (seenSequences.has(sequenceId) && !data.isFinal) {
          console.log('[TRANSCRIPT-UPDATE] Partial update received but sequence already processed, skipping');
          return prev;
        }

        const existingIndex = prev.findIndex(segment => segment.sequenceId === sequenceId);
        if (existingIndex >= 0) {
          const updatedSegments = [...prev];
          updatedSegments[existingIndex] = {
            ...updatedSegments[existingIndex],
            time: format(new Date(data.timestamp), 'HH:mm:ss'),
            speaker: data.speaker || 'Unknown Speaker',
            text: data.text,
            timestamp: data.timestamp,
            isFinal: data.isFinal,
            sequenceId,
            hash: data.hash
          };

          transcriptCache.set(meeting.id, updatedSegments);
          seenSequences.add(sequenceId);
          return updatedSegments;
        }
      }

      if (data.isFinal && sequenceId) {
        seenSequences.add(sequenceId);
      }

      const newSegment = {
        id: `${Date.now()}-${Math.random()}`,
        time: format(new Date(data.timestamp), 'HH:mm:ss'),
        speaker: data.speaker || 'Unknown Speaker',
        text: data.text,
        timestamp: data.timestamp,
        isFinal: data.isFinal,
        sequenceId,
        hash: data.hash
      };

      if (sequenceId) {
        seenSequences.add(sequenceId);
      }

      const updated = [...prev, newSegment];
      console.log('[TRANSCRIPT-UPDATE] Added new segment, total now:', updated.length);

      transcriptCache.set(meeting.id, updated);
      return updated;
    });
  }, [meeting.id]);

  // Set up transcript listener with proper cleanup
  useEffect(() => {
    console.log('[MeetingDetailFinal] Setting up transcript listener for meeting:', meeting.id);

    if (!transcriptSequenceCache.has(meeting.id)) {
      transcriptSequenceCache.set(meeting.id, new Set());
    }

    const channel = IpcChannels.TRANSCRIPT_UPDATE;
    (window as any).electronAPI?.on?.(channel, handleTranscriptUpdate);

    const fetchBuffered = async () => {
      try {
        const buffered = await (window as any).electronAPI?.getTranscriptBuffer?.(meeting.id);
        if (Array.isArray(buffered) && buffered.length > 0) {
          console.log('[MeetingDetailFinal] Reconciling buffered transcript chunks', {
            meetingId: meeting.id,
            bufferedCount: buffered.length
          });

          const seenSequences = transcriptSequenceCache.get(meeting.id)!;

          const normalized = buffered.map((chunk: any) => ({
            id: `${Date.now()}-${Math.random()}`,
            time: format(new Date(chunk.timestamp), 'HH:mm:ss'),
            speaker: chunk.speaker || 'Unknown Speaker',
            text: chunk.text,
            timestamp: chunk.timestamp,
            isFinal: chunk.isFinal,
            sequenceId: chunk.sequenceId || chunk.hash,
            hash: chunk.hash
          }));

          normalized.forEach(segment => {
            if (segment.sequenceId) {
              seenSequences.add(segment.sequenceId);
            }
          });

          transcriptCache.set(meeting.id, normalized);
          setTranscriptSegments(normalized);
        }
      } catch (error) {
        console.error('[MeetingDetailFinal] Failed to load buffered transcript chunks', error);
      }
    };

    fetchBuffered();

    return () => {
      console.log('[MeetingDetailFinal] Cleaning up transcript listener for meeting:', meeting.id);
      (window as any).electronAPI?.removeListener?.(channel, handleTranscriptUpdate);
      transcriptSequenceCache.delete(meeting.id);
    };
  }, [handleTranscriptUpdate, meeting.id]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onUpdateMeeting({ ...meeting, notes: combinedNotes });
      setHasChanges(false);
      setBaselineNotes(combinedNotes);
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
      setMeetingNotes(value);
      return;
    }

    setMeetingNotes(value);
  };

  const handlePrepNotesChange = (value: string) => {
    setPrepNotes(value);
  };

  const handleCalendarInfoChange = (value: string) => {
    setCalendarInfo(value);
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
      console.log('[Insights][Renderer] Starting insight generation', {
        meetingId: meeting.id,
        hasNotes: !!meeting.notes,
        hasTranscript: !!meeting.transcript
      });
      setIsGeneratingInsights(true);

      // Call the main process to generate insights
      const result = await (window as any).electronAPI.generateInsights(meeting.id);

      console.log('[Insights][Renderer] IPC response', {
        success: result?.success,
        error: result?.error,
        hasInsights: !!result?.insights
      });

      if (result.success && result.insights) {
        // Parse and set the insights
        console.log('[Insights][Renderer] Parsing insights payload');
        const parsedInsights = JSON.parse(result.insights);
        setInsights(parsedInsights);

        // Refresh meeting data to get updated insights
        if (onRefresh) {
          console.log('[Insights][Renderer] Invoking onRefresh after success');
          await onRefresh();
        }
        onShowToast?.('Insights generated successfully', 'success');
      } else {
        console.error('Failed to generate insights:', result.error);
        onShowToast?.('Failed to generate insights. Please check your Anthropic API key in settings.', 'error');
      }
    } catch (error) {
      console.error('Error generating insights:', error);
      onShowToast?.('An error occurred while generating insights.', 'error');
    } finally {
      console.log('[Insights][Renderer] Finished insight generation flow');
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
        onShowToast?.('Team summary generated successfully', 'success');
      } else {
        console.error('Failed to generate team summary:', result.error);
        onShowToast?.('Failed to generate team summary. Please check your Anthropic API key in settings.', 'error');
      }
    } catch (error) {
      console.error('Error generating team summary:', error);
      onShowToast?.('An error occurred while generating team summary.', 'error');
    } finally {
      setIsGeneratingTeamSummary(false);
    }
  };

  const formatTeamSummary = (summary: any): string => {
    if (!summary) return '';

    let formatted = `# Meeting Summary: ${meeting.title}\n\n`;
    formatted += `**Date:** ${meetingFullDateLabel}\n`;
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
        onShowToast?.('Successfully shared to Slack!', 'success');

        // Refresh meeting data to get updated timestamp
        if (onRefresh) {
          await onRefresh();
        }
      } else {
        console.error('Failed to share to Slack:', result.error);
        onShowToast?.(result.error || 'Failed to share to Slack. Please check your webhook configuration in settings.', 'error');
      }
    } catch (error) {
      console.error('Error sharing to Slack:', error);
      onShowToast?.('An error occurred while sharing to Slack.', 'error');
    } finally {
      setIsSharing(false);
    }
  };

  const handleShareToNotion = async (mode: NotionShareMode) => {
    if (sharingToNotionMode) return;

    try {
      setSharingToNotionMode(mode);
      const result = await (window as any).electronAPI.shareToNotion({
        meetingId: meeting.id,
        mode
      });

      if (result.success) {
        const now = new Date();
        setNotionShared(now);
        if (result.pageId) {
          setNotionPageId(result.pageId);
        }
        onShowToast?.('Shared to Notion successfully.', 'success');
        if (onRefresh) {
          await onRefresh();
        }
      } else {
        onShowToast?.(result.error || 'Failed to share to Notion. Check your Notion settings.', 'error');
      }
    } catch (error) {
      console.error('Error sharing to Notion:', error);
      onShowToast?.('An unexpected error occurred while sharing to Notion.', 'error');
    } finally {
      setSharingToNotionMode(null);
    }
  };

  const handleStartCoaching = async () => {
    if (isCoachingForCurrentMeeting) {
      return;
    }

    if (isCoachingOnAnotherMeeting) {
      onShowToast?.('Coaching is already active on another meeting. Please stop it before starting here.', 'info');
      return;
    }

    const enabledCoach = availableCoaches.find(coach => coach.id === selectedCoachingType && coach.enabled);
    if (!enabledCoach) {
      alert('Please select an enabled coach before starting real-time coaching.');
      return;
    }

    if (!(window as any).electronAPI?.startCoaching) {
      console.error('[COACHING] API not available');
      alert('Coaching API not available. Please restart the application.');
      return;
    }

    try {
      console.log('[COACHING] Starting coaching with type:', selectedCoachingType);
      const result = await (window as any).electronAPI.startCoaching(meeting.id, selectedCoachingType);

      if (result.success) {
        console.log('[COACHING] Coaching started successfully');
        await onCoachingStateRefresh?.();
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
    if (!isCoachingActive) return;

    if (!(window as any).electronAPI?.stopCoaching) {
      console.error('[COACHING] API not available');
      await onCoachingStateRefresh?.();
      return;
    }

    try {
      console.log('[COACHING] Stopping coaching');
      const result = await (window as any).electronAPI.stopCoaching();

      if (result.success) {
        console.log('[COACHING] Coaching stopped successfully');
        await onCoachingStateRefresh?.();
      } else {
        console.error('[COACHING] Failed to stop coaching:', result.error);
        alert('Failed to stop coaching.');
        await onCoachingStateRefresh?.();
      }
    } catch (error) {
      console.error('[COACHING] Error stopping coaching:', error);
      await onCoachingStateRefresh?.();
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

  // Auto-save after 5 seconds of no changes
  useEffect(() => {
    if (!hasChanges) return;

    const timer = setTimeout(() => {
      handleSave();
    }, 5000);

    return () => clearTimeout(timer);
  }, [combinedNotes, hasChanges]);

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
                  onClick={async () => {
                    if (meeting.meetingUrl) {
                      // Use new handler that sets auto-record intent
                      await (window as any).electronAPI.joinMeetingWithIntent(meeting.meetingUrl);
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
                      setRecordingStartTime(new Date());
                      onShowToast?.('Recording started successfully', 'success');
                      // Don't clear segments - append to existing transcript
                    } catch (error) {
                      console.error('Failed to start recording:', error);
                      onShowToast?.('Failed to start recording. Check your recall.ai API key in settings.', 'error');
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
                      setRecordingStartTime(null);
                      onShowToast?.('Recording stopped', 'info');
                    } catch (error) {
                      console.error('Failed to stop recording:', error);
                      onShowToast?.('Failed to stop recording', 'error');
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
              📅 {meetingDateLabel}
            </MetaItem>
            <MetaItem>
              🕐 {meetingTimeLabel}
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
                active={viewMode === 'context'}
                onClick={() => setViewMode('context')}
              >
                Context
              </Tab>
              <Tab
                active={viewMode === 'liveNotes'}
                onClick={() => setViewMode('liveNotes')}
              >
                Live Notes
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
                onClick={() => setViewMode('actions')}
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

        {isRecording && (
          <RecordingBanner>
            <RecordingInfo>
              <RecordingLabel>
                <RecordingDot />
                Recording
              </RecordingLabel>
              <RecordingStats>
                <span>{elapsedTime}</span>
                <span>•</span>
                <span>{transcriptSegments.length} segments</span>
              </RecordingStats>
            </RecordingInfo>
            <Button
              variant="danger"
              onClick={async () => {
                try {
                  await (window as any).electronAPI.stopRecording(meeting.id);
                  setIsRecording(false);
                  setRecordingStartTime(null);
                } catch (error) {
                  console.error('Failed to stop recording:', error);
                }
              }}
              style={{ background: 'rgba(255, 255, 255, 0.2)', color: 'white', border: '1px solid white' }}
            >
              Stop Recording
            </Button>
          </RecordingBanner>
        )}

        <Content>
          {/* Context Panel - Calendar and prep information */}
          <TabPanel isActive={viewMode === 'context'}>
            <EditorContainer>
              <NotesScrollArea>
                {(hasCalendarContent || isEditingCalendar || showPrepEditor || hasPrepContent) && (
                  <SectionStack>
                    {(hasCalendarContent || isEditingCalendar) && (
                      <SectionCard>
                        <SectionHeader>
                          <SectionTitle>Calendar Context</SectionTitle>
                          <SectionActions>
                            <InlineButton onClick={() => setIsEditingCalendar(!isEditingCalendar)}>
                              {isEditingCalendar ? 'Done' : 'Edit'}
                            </InlineButton>
                            {hasCalendarContent && (
                              <InlineButton
                                onClick={() => {
                                  setCalendarInfo('');
                                  setIsEditingCalendar(false);
                                }}
                              >
                                Clear
                              </InlineButton>
                            )}
                          </SectionActions>
                        </SectionHeader>
                        {isEditingCalendar ? (
                          <SectionTextarea
                            value={calendarInfo}
                            onChange={(e) => handleCalendarInfoChange(e.target.value)}
                            placeholder="Paste agenda or dial-in details from the calendar invite."
                          />
                        ) : (
                          <SectionContent>
                            {calendarInfo}
                          </SectionContent>
                        )}
                      </SectionCard>
                    )}
                    {(showPrepEditor || hasPrepContent) && (
                      <SectionCard>
                        <SectionHeader>
                          <SectionTitle>Prep Notes</SectionTitle>
                          <SectionActions>
                            <InlineButton onClick={() => setShowPrepEditor(!showPrepEditor)}>
                              {showPrepEditor ? 'Done' : 'Edit'}
                            </InlineButton>
                            {hasPrepContent && (
                              <InlineButton
                                onClick={() => {
                                  setPrepNotes('');
                                  setShowPrepEditor(false);
                                }}
                              >
                                Clear
                              </InlineButton>
                            )}
                          </SectionActions>
                        </SectionHeader>
                        {showPrepEditor ? (
                          <SectionTextarea
                            value={prepNotes}
                            onChange={(e) => handlePrepNotesChange(e.target.value)}
                            placeholder="Outline goals, risks, and context before the meeting."
                          />
                        ) : (
                          <SectionContent>
                            {prepNotes}
                          </SectionContent>
                        )}
                      </SectionCard>
                    )}
                  </SectionStack>
                )}
                {!hasCalendarContent && !isEditingCalendar && !showPrepEditor && !hasPrepContent && (
                  <EmptyState>
                    <div className="icon">🗒️</div>
                    <h3>No meeting context yet</h3>
                    <p>Add calendar details or prep notes to keep everyone aligned.</p>
                  </EmptyState>
                )}
              </NotesScrollArea>
              <EditorToolbar>
                <SaveStatus>
                  {isSaving ? '💾 Saving...' : hasChanges ? '⚠️ Unsaved changes' : '✓ Saved'}
                </SaveStatus>
                {!hasPrepContent && !showPrepEditor && (
                  <InlineButton onClick={() => setShowPrepEditor(true)}>＋ Add Prep Notes</InlineButton>
                )}
              </EditorToolbar>
            </EditorContainer>
          </TabPanel>

          {/* Live Notes Panel - Markdown editor for real-time notes */}
          <TabPanel isActive={viewMode === 'liveNotes'}>
            <EditorContainer>
              <NotesScrollArea>
                <EditorToolbar>
                  <SaveStatus>
                    {isSaving ? '💾 Saving...' : hasChanges ? '⚠️ Unsaved changes' : '✓ Saved'}
                  </SaveStatus>
                </EditorToolbar>
                <MDEditor
                  key={`editor-${meeting.id}-${editorKey}`}
                  value={meetingNotes}
                  onChange={(value) => handleNotesChange(value || '')}
                  height="100%"
                  preview="edit"
                  hideToolbar={false}
                  commandsFilter={disablePreviewCommands}
                  style={{ flex: 1, minHeight: 0 }}
                  previewOptions={{
                    style: {
                      padding: '20px',
                      margin: 0,
                      width: '100%',
                      maxWidth: 'none',
                      boxSizing: 'border-box'
                    },
                    wrapperElement: {
                      style: {
                        margin: 0,
                        padding: 0,
                        width: '100%',
                        maxWidth: 'none'
                      }
                    }
                  }}
                />
              </NotesScrollArea>
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
            <EditorContainer>
              <ActionGrid>
                <ActionCard>
                  <ActionCardHeader>
                    <ActionCardTitle>📤 Share to Slack</ActionCardTitle>
                    <ActionStatus>
                      {slackShared ? `✅ Shared ${format(new Date(slackShared), 'PPp')}` : 'Keep your team in the loop via Slack'}
                    </ActionStatus>
                  </ActionCardHeader>
                  <ActionCardDescription>
                    Use the team summary to post a digest into your configured Slack webhook. Regenerate the summary first if you need to tweak the content.
                  </ActionCardDescription>

                  {teamSummary ? (
                    <>
                      <ActionButtonRow>
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
                      </ActionButtonRow>

                      <div style={{ marginTop: '12px' }}>
                        <MDEditor
                          key={`team-editor-${meeting.id}`}
                          value={editedTeamContent || formatTeamSummary(teamSummary)}
                          onChange={(value) => setEditedTeamContent(value || '')}
                          height={360}
                          preview="edit"
                          hideToolbar={false}
                          commandsFilter={disablePreviewCommands}
                          previewOptions={{
                            style: {
                              padding: '20px',
                              margin: 0,
                              width: '100%',
                              maxWidth: 'none',
                              boxSizing: 'border-box'
                            },
                            wrapperElement: {
                              style: {
                                margin: 0,
                                padding: 0,
                                width: '100%',
                                maxWidth: 'none'
                              }
                            }
                          }}
                        />
                      </div>
                    </>
                  ) : (
                    <div style={{
                      padding: '16px',
                      borderRadius: '8px',
                      background: '#f9fafb',
                      border: '1px dashed #d1d5db'
                    }}>
                      <div style={{ fontSize: '14px', fontWeight: 500, marginBottom: '8px' }}>
                        {isGeneratingTeamSummary ? 'Generating team summary...' : 'No team summary available yet'}
                      </div>
                      <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '12px' }}>
                        Create a shareable summary from your notes and transcript before sending to Slack.
                      </div>
                      <Button
                        onClick={handleGenerateTeamSummary}
                        disabled={isGeneratingTeamSummary || (!meeting.notes && !meeting.transcript)}
                        style={{
                          background: '#34c759',
                          borderColor: '#34c759',
                          color: 'white'
                        }}
                      >
                        {isGeneratingTeamSummary ? '🔄 Generating...' : '✨ Generate Team Summary'}
                      </Button>
                      {!meeting.notes && !meeting.transcript && (
                        <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '8px' }}>
                          Add notes or a transcript first so the summary has context.
                        </div>
                      )}
                    </div>
                  )}
                </ActionCard>

                <ActionCard>
                  <ActionCardHeader>
                    <ActionCardTitle>🗂️ Share to Notion</ActionCardTitle>
                    <ActionStatus>
                      {notionShared ? `✅ Shared ${format(new Date(notionShared), 'PPp')}` : 'Publish to your Notion workspace'}
                    </ActionStatus>
                  </ActionCardHeader>
                  <ActionCardDescription>
                    Push either the full meeting package or just the AI-generated insights into your configured Notion database. Configure your integration token and database ID in Settings.
                  </ActionCardDescription>

                  <ActionButtonRow>
                    <Button
                      onClick={() => handleShareToNotion('full')}
                      disabled={!!sharingToNotionMode}
                      style={{
                        background: '#2563eb',
                        borderColor: '#2563eb',
                        color: 'white'
                      }}
                    >
                      {sharingToNotionMode === 'full' ? '📤 Sharing...' : '📤 Notes & Transcript'}
                    </Button>
                    <Button
                      onClick={() => handleShareToNotion('insights')}
                      disabled={!!sharingToNotionMode || !insights}
                      style={{
                        background: '#7c3aed',
                        borderColor: '#7c3aed',
                        color: 'white'
                      }}
                    >
                      {sharingToNotionMode === 'insights' ? '📤 Sharing...' : '✨ Insights Only'}
                    </Button>
                  </ActionButtonRow>

                  <div style={{ fontSize: '12px', color: '#6b7280' }}>
                    {notionPageId ? `Last Notion page ID: ${notionPageId}` : 'A new page will be created in your database.'}
                  </div>

                  {!insights && (
                    <div style={{ fontSize: '12px', color: '#9ca3af' }}>
                      Generate insights to enable the insights-only export option.
                    </div>
                  )}

                  {sharingToNotionMode && (
                    <div style={{ fontSize: '12px', color: '#6b7280' }}>
                      Working...
                    </div>
                  )}
                </ActionCard>

                <ActionCard>
                  <ActionCardHeader>
                    <ActionCardTitle>✅ Send Action Items to Notion</ActionCardTitle>
                    <ActionStatus>
                      {isSendingActionItems
                        ? 'Sending...'
                        : actionItemSyncStatus.some(item => item.status === 'sent')
                          ? 'Some action items have been sent to Notion'
                          : 'Send AI action items to your Notion to-do database'}
                    </ActionStatus>
                  </ActionCardHeader>
                  <ActionCardDescription>
                    Push meeting action items into your configured Notion to-do database. Items already sent will be skipped automatically.
                  </ActionCardDescription>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                    <Button
                      onClick={sendActionItemsToNotion}
                      disabled={isSendingActionItems || !insights}
                      style={{
                        background: '#2563eb',
                        borderColor: '#2563eb',
                        color: 'white'
                      }}
                    >
                      {isSendingActionItems ? '🔄 Sending...' : '✨ Send Action Items'}
                    </Button>
                    {!insights && (
                      <span style={{ fontSize: '12px', color: '#9ca3af' }}>
                        Generate insights to view action items.
                      </span>
                    )}
                  </div>

                  {actionItemError && (
                    <div style={{ fontSize: '12px', color: '#dc2626', marginBottom: '12px' }}>
                      {actionItemError}
                    </div>
                  )}

                  {insights?.actionItems && insights.actionItems.length > 0 ? (
                    <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {insights.actionItems.map((item: any, index: number) => {
                        const status = actionItemSyncStatus.find(status =>
                          (typeof status.insightIndex === 'number' && status.insightIndex === index) ||
                          (status.task === item?.task && status.owner === item?.owner)
                        );
                        const isSendingItem = sendingItemIndex === index;
                        return (
                          <li
                            key={`${item?.task || 'item'}-${index}`}
                            style={{
                              padding: '12px',
                              background: '#f9fafb',
                              borderRadius: '8px',
                              border: '1px solid #e5e7eb'
                            }}
                          >
                            <div style={{ fontWeight: 600, marginBottom: '6px', color: '#111827' }}>{item?.task || 'Action Item'}</div>
                            <div style={{ fontSize: '12px', color: '#4b5563', display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
                              {item?.owner && <span>Owner: {item.owner}</span>}
                              {item?.due && <span>Due: {formatTodoDueDate(item.due)}</span>}
                              <span>
                                Status: {' '}
                                {status?.status === 'sent' && (status.notionPageUrl || status.notionPageId)
                                  ? 'Sent'
                                  : status?.status === 'failed'
                                    ? `Failed (${status.error || 'Unknown error'})`
                                    : 'Not sent'}
                              </span>
                            </div>
                            <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                              <Button
                                variant="ghost"
                                onClick={() => sendSingleActionItem(index)}
                                disabled={isSendingActionItems || isSendingItem}
                                style={{
                                  padding: '6px 10px',
                                  border: '1px solid #d1d5db',
                                  borderRadius: '6px',
                                  background: '#fff',
                                  color: '#111827'
                                }}
                              >
                                {isSendingItem ? 'Sending…' : status?.status === 'sent' ? 'Resend' : 'Send to Notion'}
                              </Button>
                              {status?.status === 'sent' && (status.notionPageUrl || status.notionPageId) && (
                                <Button
                                  variant="ghost"
                                  onClick={() => (window as any).electronAPI?.openExternal?.(status.notionPageUrl || `https://www.notion.so/${status.notionPageId?.replace(/-/g, '')}`)}
                                  style={{ padding: '0 4px', color: '#2563eb', fontWeight: 500 }}
                                >
                                  Open ↗
                                </Button>
                              )}
                            </div>
                            {itemErrors[index] && (
                              <div style={{ fontSize: '12px', color: '#dc2626', marginTop: '8px' }}>
                                {itemErrors[index]}
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <div style={{ fontSize: '13px', color: '#6b7280' }}>
                      No action items available yet. Generate insights to populate them.
                    </div>
                  )}
                </ActionCard>
              </ActionGrid>
            </EditorContainer>
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
                    disabled={isCoaching || availableCoaches.filter(c => c.enabled).length === 0}
                  >
                    {availableCoaches.filter(coach => coach.enabled).map(coach => (
                      <option key={coach.id} value={coach.id}>
                        {coach.name}
                      </option>
                    ))}
                  </CoachTypeSelect>
                </CoachTypeSelector>

                <CoachButtonGroup>
                  {!isCoaching ? (
                    <Button
                      onClick={handleStartCoaching}
                      disabled={!isRecording || !selectedCoachingType || isCoachingOnAnotherMeeting}
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
                  {!isCoachPopout ? (
                    <Button
                      onClick={() => onOpenCoachWindow?.(meeting.id)}
                      disabled={isCoachWindowOpen}
                      style={{
                        flex: 1,
                        background: isCoachWindowOpen ? '#93c5fd' : '#2563eb',
                        borderColor: isCoachWindowOpen ? '#93c5fd' : '#2563eb',
                        color: isCoachWindowOpen ? '#1d4ed8' : 'white'
                      }}
                    >
                      {isCoachWindowOpen ? '🟦 Coach Window Open' : '🔲 Pop Out Coach'}
                    </Button>
                  ) : (
                    <Button
                      onClick={() => onCloseCoachWindow?.()}
                      style={{
                        flex: 1,
                        background: '#4b5563',
                        borderColor: '#4b5563',
                        color: 'white'
                      }}
                    >
                      ⬅️ Return to Main Window
                    </Button>
                  )}
                </CoachButtonGroup>
                {!isCoachPopout && isCoachWindowOpen && (
                  <p
                    style={{
                      fontSize: '13px',
                      color: '#2563eb',
                      margin: 0
                    }}
                  >
                    Coach window is active on another screen.
                  </p>
                )}

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
                {isRecording && availableCoaches.filter(coach => coach.enabled).length === 0 && (
                  <p style={{
                    fontSize: '13px',
                    color: '#666',
                    margin: 0,
                    fontStyle: 'italic'
                  }}>
                    💡 Tip: Enable a coach in Settings to start real-time coaching.
                  </p>
                )}
                {isCoachingOnAnotherMeeting && activeCoachingMeeting && (
                  <p
                    style={{
                      fontSize: '13px',
                      color: '#c05621',
                      marginTop: '12px'
                    }}
                  >
                    Coaching is currently active on “{activeCoachingMeeting.title}”. Stop it there (or use the stop button here) before starting on this meeting.
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