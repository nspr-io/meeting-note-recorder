import React, { useState, useEffect } from 'react';
import styled from '@emotion/styled';
import { CoachConfig, IpcChannels } from '../../shared/types';
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

const CoachBadge = styled.span<{ active?: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  border-radius: 9999px;
  font-size: 11px;
  font-weight: 600;
  background: ${props => props.active ? 'rgba(255,255,255,0.2)' : '#e0f2fe'};
  color: ${props => props.active ? 'white' : '#0369a1'};
  margin-left: 8px;
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
  onManageCoaches: () => void;
}

const SectionHeader = styled.div`
  padding: 12px 16px;
  border-bottom: 1px solid #e5e5e7;
  background: #f3f4f6;
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const HeaderActions = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
`;

const HeaderNote = styled.div`
  font-size: 12px;
  color: #4b5563;
`;

type ButtonVariant = 'default' | 'primary' | 'danger';

const HeaderButton = styled.button<{ variant?: ButtonVariant }>`
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid transparent;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;

  ${({ variant = 'default' }) => {
    switch (variant) {
      case 'primary':
        return `
          background: #007aff;
          border-color: #0062cc;
          color: #ffffff;
          &:hover { background: #0062cc; }
        `;
      case 'danger':
        return `
          background: #fee2e2;
          border-color: #f87171;
          color: #b91c1c;
          &:hover { background: #fecaca; }
        `;
      default:
        return `
          background: #ffffff;
          border-color: #d1d5db;
          color: #007aff;
          &:hover { background: #eff6ff; }
        `;
    }
  }}
`;

const ModalBackdrop = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1200;
`;

const ModalContent = styled.div`
  width: 420px;
  max-width: 90vw;
  background: #ffffff;
  border-radius: 12px;
  box-shadow: 0 20px 45px rgba(15, 23, 42, 0.35);
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

const ModalHeader = styled.div`
  padding: 20px 24px 12px 24px;
  font-size: 18px;
  font-weight: 600;
  color: #1e293b;
`;

const ModalBody = styled.div`
  padding: 0 24px 24px 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

const ModalField = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const ModalLabel = styled.label`
  font-size: 13px;
  font-weight: 500;
  color: #475569;
`;

const ModalInput = styled.input`
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid #d1d5db;
  font-size: 13px;
  &:focus {
    outline: none;
    border-color: #3b82f6;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2);
  }
`;

const ModalTextarea = styled.textarea`
  min-height: 80px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid #d1d5db;
  font-size: 13px;
  resize: vertical;
  &:focus {
    outline: none;
    border-color: #3b82f6;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2);
  }
`;

const ModalFooter = styled.div`
  padding: 16px 24px;
  background: #f8fafc;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
`;

const ModalError = styled.div`
  font-size: 12px;
  color: #ef4444;
`;

export function SystemPromptsList({ onSelectPrompt, selectedPromptId, onManageCoaches }: SystemPromptsListProps) {
  const [prompts, setPrompts] = useState<Record<string, PromptInfo>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [showAddCoachModal, setShowAddCoachModal] = useState(false);
  const [newCoachName, setNewCoachName] = useState('');
  const [newCoachDescription, setNewCoachDescription] = useState('');
  const [addCoachError, setAddCoachError] = useState<string | null>(null);

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

  const handleCreateCoach = async () => {
    const name = newCoachName.trim();
    const description = newCoachDescription.trim();

    if (!name) {
      setAddCoachError('Coach name is required');
      return;
    }

    try {
      const allPrompts = await window.electronAPI.getPrompts();
      const id = generateCoachId(name, allPrompts);

      await window.electronAPI.upsertCoach({
        id,
        name,
        description: description || name,
        enabled: true,
        isCustom: true,
        promptContent: DEFAULT_COACH_PROMPT,
      });

      await loadPrompts();
      onSelectPrompt(id);
      setShowAddCoachModal(false);
      setNewCoachName('');
      setNewCoachDescription('');
      setAddCoachError(null);
    } catch (error) {
      console.error('Failed to create coach prompt:', error);
      setAddCoachError('Failed to create coach. Please try again.');
    }
  };

  if (isLoading) {
    return <div style={{ padding: '20px', textAlign: 'center' }}>Loading prompts...</div>;
  }

  return (
    <>
      <SectionHeader>
        <HeaderActions>
          <HeaderButton onClick={onManageCoaches}>Manage Coaches</HeaderButton>
          <HeaderButton
            onClick={() => {
              setNewCoachName('');
              setNewCoachDescription('');
              setAddCoachError(null);
              setShowAddCoachModal(true);
            }}
          >
            Add Coach
          </HeaderButton>
        </HeaderActions>
        <HeaderNote>
          Coach prompts power real-time coaching. Use "Add Coach" in the editor to create one.
        </HeaderNote>
      </SectionHeader>
      {Object.entries(prompts).map(([id, promptInfo]) => (
        <PromptItem
          key={id}
          active={selectedPromptId === id}
          onClick={() => onSelectPrompt(id)}
        >
          <PromptName>{promptInfo.config.name}</PromptName>
          {id.startsWith('coach-') && (
            <CoachBadge active={selectedPromptId === id}>Coach</CoachBadge>
          )}
          <PromptDescription>{promptInfo.config.description}</PromptDescription>
        </PromptItem>
      ))}

      {showAddCoachModal && (
        <ModalBackdrop>
          <ModalContent>
            <ModalHeader>Add Coach</ModalHeader>
            <ModalBody>
              <ModalField>
                <ModalLabel>Coach name</ModalLabel>
                <ModalInput
                  value={newCoachName}
                  onChange={(e) => setNewCoachName(e.target.value)}
                  placeholder="e.g. Discovery Call Coach"
                  autoFocus
                />
              </ModalField>
              <ModalField>
                <ModalLabel>Description</ModalLabel>
                <ModalTextarea
                  value={newCoachDescription}
                  onChange={(e) => setNewCoachDescription(e.target.value)}
                  placeholder="How this coach will assist during live meetings"
                />
                <div style={{ fontSize: '11px', color: '#64748b' }}>
                  You can edit the underlying prompt after creation.
                </div>
              </ModalField>
              {addCoachError && <ModalError>{addCoachError}</ModalError>}
            </ModalBody>
            <ModalFooter>
              <HeaderButton
                onClick={() => {
                  setShowAddCoachModal(false);
                  setAddCoachError(null);
                }}
              >
                Cancel
              </HeaderButton>
              <HeaderButton variant="primary" onClick={handleCreateCoach}>
                Create Coach
              </HeaderButton>
            </ModalFooter>
          </ModalContent>
        </ModalBackdrop>
      )}
    </>
  );
}

interface SystemPromptEditorProps {
  promptId: string;
}

const DEFAULT_COACH_PROMPT = `{
  "alerts": [],
  "observations": [],
  "suggestions": []
}`;

const generateCoachId = (name: string, existing: Record<string, PromptInfo>): string => {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-');

  let candidate = `coach-${base || 'custom'}`;
  let counter = 1;
  while (existing[candidate]) {
    candidate = `coach-${base || 'custom'}-${counter}`;
    counter += 1;
  }
  return candidate;
};

export function SystemPromptEditor({ promptId }: SystemPromptEditorProps) {
  const [prompt, setPrompt] = useState<PromptInfo | null>(null);
  const [editedContent, setEditedContent] = useState('');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [coachMeta, setCoachMeta] = useState<{ name: string; description: string } | null>(null);
  const isCoachPrompt = promptId.startsWith('coach-');

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
      if (promptId.startsWith('coach-')) {
        try {
          const coaches = await window.electronAPI.getCoaches?.();
          const coach = Array.isArray(coaches) ? coaches.find((c: CoachConfig) => c.id === promptId) : null;
          if (coach) {
            setCoachMeta({ name: coach.name, description: coach.description });
          } else {
            setCoachMeta(null);
          }
        } catch (error) {
          console.error('Failed to load coach metadata:', error);
          setCoachMeta(null);
        }
      } else {
        setCoachMeta(null);
      }
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
        <EditorTitle>
          {prompt.config.name}
          {isCoachPrompt && <CoachBadge>Coach</CoachBadge>}
        </EditorTitle>
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