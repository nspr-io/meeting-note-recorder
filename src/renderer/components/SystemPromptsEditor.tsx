import React, { useState, useEffect } from 'react';
import styled from '@emotion/styled';
import { IpcChannels } from '../../shared/types';
import { extractVariables, validatePromptTemplate } from '../../shared/utils/promptUtils';

const PromptItem = styled.div<{ active: boolean }>`
  padding: 12px 16px;
  cursor: pointer;
  border-bottom: 1px solid #e5e5e7;
  background: ${props => props.active ? '#007aff' : 'transparent'};
  color: ${props => props.active ? 'white' : '#1d1d1f'};

  &:hover {
    background: ${props => props.active ? '#007aff' : '#f0f0f0'};
  }
`;

const PromptName = styled.div`
  font-weight: 500;
  font-size: 14px;
  margin-bottom: 4px;
`;

const PromptDescription = styled.div`
  font-size: 12px;
  opacity: 0.8;
`;

const EditorArea = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  background: white;
  height: 100%;
`;

const EditorHeader = styled.div`
  padding: 24px;
  border-bottom: 1px solid #e5e5e7;
  background: #f9f9f9;
`;

const EditorTitle = styled.h3`
  margin: 0 0 8px 0;
  font-size: 18px;
  font-weight: 600;
`;

const EditorSubtitle = styled.div`
  font-size: 14px;
  color: #86868b;
`;

const TextArea = styled.textarea`
  flex: 1;
  border: none;
  outline: none;
  padding: 24px;
  font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
  font-size: 13px;
  line-height: 1.5;
  resize: none;

  &:focus {
    outline: none;
  }
`;

const EditorFooter = styled.div`
  padding: 16px 24px;
  border-top: 1px solid #e5e5e7;
  background: #f9f9f9;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
`;

const ButtonGroup = styled.div`
  display: flex;
  gap: 8px;
`;

const Button = styled.button<{ variant?: 'primary' | 'secondary' | 'danger' }>`
  padding: 8px 16px;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  font-weight: 500;

  ${props => {
    switch (props.variant) {
      case 'primary':
        return `
          background: #007aff;
          color: white;
          &:hover { background: #0051d5; }
        `;
      case 'danger':
        return `
          background: #ff3b30;
          color: white;
          &:hover { background: #d70015; }
        `;
      default:
        return `
          background: #ffffff;
          color: #007aff;
          border: 1px solid #d1d1d1;
          &:hover { background: #f5f5f7; }
        `;
    }
  }}

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const VariablesInfo = styled.div`
  flex: 1;
  font-size: 11px;
  color: #86868b;
`;

const ErrorMessage = styled.div`
  color: #ff3b30;
  font-size: 11px;
  margin-top: 4px;
`;

interface PromptInfo {
  config: {
    name: string;
    description: string;
    variables: string[];
  };
  content: string;
}

interface SystemPromptsListProps {
  onSelectPrompt: (promptId: string) => void;
  selectedPromptId: string | null;
}

export function SystemPromptsList({ onSelectPrompt, selectedPromptId }: SystemPromptsListProps) {
  const [prompts, setPrompts] = useState<Record<string, PromptInfo>>({});
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadPrompts();
  }, []);

  const loadPrompts = async () => {
    try {
      setIsLoading(true);
      const allPrompts = await window.electronAPI.getPrompts();
      setPrompts(allPrompts);

      // Auto-select first prompt if none selected
      if (!selectedPromptId && Object.keys(allPrompts).length > 0) {
        onSelectPrompt(Object.keys(allPrompts)[0]);
      }
    } catch (error) {
      console.error('Failed to load prompts:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return <div style={{ padding: '20px', textAlign: 'center' }}>Loading prompts...</div>;
  }

  return (
    <>
      {Object.entries(prompts).map(([id, promptInfo]) => (
        <PromptItem
          key={id}
          active={selectedPromptId === id}
          onClick={() => onSelectPrompt(id)}
        >
          <PromptName>{promptInfo.config.name}</PromptName>
          <PromptDescription>{promptInfo.config.description}</PromptDescription>
        </PromptItem>
      ))}
    </>
  );
}

interface SystemPromptEditorProps {
  promptId: string;
}

export function SystemPromptEditor({ promptId }: SystemPromptEditorProps) {
  const [prompt, setPrompt] = useState<PromptInfo | null>(null);
  const [editedContent, setEditedContent] = useState('');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadPrompt();
  }, [promptId]);

  // Load content when prompt data changes
  useEffect(() => {
    if (prompt) {
      setEditedContent(prompt.content);
      setHasUnsavedChanges(false);
      setValidationErrors([]);
    }
  }, [prompt]);

  // Validate on content change
  useEffect(() => {
    if (editedContent !== prompt?.content) {
      setHasUnsavedChanges(true);
      const validation = validatePromptTemplate(editedContent);
      setValidationErrors(validation.errors);
    } else {
      setHasUnsavedChanges(false);
      setValidationErrors([]);
    }
  }, [editedContent, prompt]);

  const loadPrompt = async () => {
    try {
      setIsLoading(true);
      const allPrompts = await window.electronAPI.getPrompts();
      setPrompt(allPrompts[promptId] || null);
    } catch (error) {
      console.error('Failed to load prompt:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    if (!prompt || validationErrors.length > 0) return;

    setIsSaving(true);
    try {
      await window.electronAPI.updatePrompt({
        promptId,
        content: editedContent
      });

      // Reload prompt to get updated data
      await loadPrompt();
      setHasUnsavedChanges(false);
    } catch (error) {
      console.error('Failed to save prompt:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = async () => {
    if (!prompt) return;

    const confirmed = window.confirm(
      `Are you sure you want to reset "${prompt.config.name}" to its default value? This cannot be undone.`
    );

    if (confirmed) {
      try {
        await window.electronAPI.resetPrompt(promptId);
        // Reload prompt to get updated data
        await loadPrompt();
      } catch (error) {
        console.error('Failed to reset prompt:', error);
      }
    }
  };

  const variables = extractVariables(editedContent);

  if (isLoading) {
    return (
      <div style={{ padding: '50px', textAlign: 'center', color: '#86868b' }}>
        <h2>Loading prompt...</h2>
      </div>
    );
  }

  if (!prompt) {
    return (
      <div style={{ padding: '50px', textAlign: 'center', color: '#86868b' }}>
        <h2>Prompt not found</h2>
        <p>The selected prompt could not be loaded.</p>
      </div>
    );
  }

  return (
    <EditorArea>
      <EditorHeader>
        <EditorTitle>{prompt.config.name}</EditorTitle>
        <EditorSubtitle>{prompt.config.description}</EditorSubtitle>
      </EditorHeader>

      <TextArea
        value={editedContent}
        onChange={(e) => setEditedContent(e.target.value)}
        placeholder="Enter your system prompt here..."
      />

      <EditorFooter>
        <VariablesInfo>
          Variables: {variables.length > 0 ? variables.join(', ') : 'None'}
          {validationErrors.length > 0 && (
            <ErrorMessage>
              Errors: {validationErrors.join(', ')}
            </ErrorMessage>
          )}
        </VariablesInfo>

        <ButtonGroup>
          <Button onClick={handleReset}>
            Reset to Default
          </Button>
          <Button
            variant="primary"
            onClick={handleSave}
            disabled={!hasUnsavedChanges || validationErrors.length > 0 || isSaving}
          >
            {isSaving ? 'Saving...' : 'Save Changes'}
          </Button>
        </ButtonGroup>
      </EditorFooter>
    </EditorArea>
  );
}

// Legacy component for backwards compatibility
interface SystemPromptsEditorProps {}

function SystemPromptsEditor({}: SystemPromptsEditorProps) {
  return (
    <div style={{ padding: '20px', textAlign: 'center', color: '#86868b' }}>
      <p>System prompts are now managed in the main interface.</p>
      <p>Please use the Settings view to access prompt editing.</p>
    </div>
  );
}

export default SystemPromptsEditor;