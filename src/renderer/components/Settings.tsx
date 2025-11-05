import React, { useCallback, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import styled from '@emotion/styled';
import { AppSettings, CoachConfig, IpcChannels } from '../../shared/types';

interface PermissionStatus {
  'screen-capture': boolean;
  microphone: boolean;
  accessibility: boolean;
}

const NavigationPane = styled.nav`
  width: 268px;
  border-right: 1px solid #e5e5e7;
  background: rgba(255, 255, 255, 0.76);
  backdrop-filter: blur(18px);
  display: flex;
  flex-direction: column;
  padding: 32px 0;
  gap: 24px;
  overflow-y: auto;
`;

const NavigationHeader = styled.div`
  padding: 0 28px;
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const NavigationTitle = styled.h2`
  font-size: 16px;
  font-weight: 700;
  margin: 0;
  color: #111827;
`;

const NavigationSubtitle = styled.p`
  font-size: 13px;
  color: #6b7280;
  margin: 0;
`;

const NavigationList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 12px;
`;

const NavItem = styled.button<{ active: boolean }>`
  position: relative;
  width: 100%;
  border: none;
  border-radius: 14px;
  padding: 16px 18px 16px 26px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  background: ${props => (props.active ? '#ffffff' : 'transparent')};
  color: ${props => (props.active ? '#111827' : '#4b5563')};
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: ${props => (props.active ? '0 12px 28px rgba(15, 23, 42, 0.12)' : 'none')};
  border: 1px solid ${props => (props.active ? '#e5e7eb' : 'transparent')};

  &:hover {
    background: #ffffff;
    color: #111827;
    border-color: #e5e7eb;
  }
`;

const NavIndicator = styled.span<{ active: boolean }>`
  position: absolute;
  left: 10px;
  top: 16px;
  bottom: 16px;
  width: 3px;
  border-radius: 12px;
  background: ${props => (props.active ? '#007aff' : 'transparent')};
`;

const NavLabel = styled.span`
  font-size: 14px;
  font-weight: 600;
`;

const NavDescription = styled.span`
  font-size: 12px;
  color: #6b7280;
`;

const NavStatus = styled.span<{ tone: 'ready' | 'warning' | 'info' }>`
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: ${props => {
    switch (props.tone) {
      case 'ready':
        return '#0f9d58';
      case 'warning':
        return '#d83a3a';
      default:
        return '#2563eb';
    }
  }};
`;

const SettingsContainer = styled.div`
  height: 100%;
  background: linear-gradient(180deg, #f5f7fb 0%, #f1f3f8 100%);
  color: #1d1d1f;
  display: flex;
  flex-direction: column;
`;

const ContentScroll = styled.div`
  flex: 1;
  overflow-y: auto;
`;

const ContentInner = styled.div`
  max-width: 880px;
  margin: 0 auto;
  padding: 48px 56px 96px;
  display: flex;
  flex-direction: column;
  gap: 32px;
`;

const ContentHeader = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const ContentTitle = styled.h1`
  font-size: 26px;
  font-weight: 700;
  color: #0b1120;
  margin: 0;
`;

const ContentSubtitle = styled.p`
  font-size: 14px;
  color: #667085;
  margin: 0;
`;

const Section = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

const SectionTitle = styled.h2`
  font-size: 18px;
  font-weight: 600;
  color: #111827;
  margin: 0;
`;

const SectionDescription = styled.p`
  font-size: 13px;
  color: #6b7280;
  margin: -8px 0 12px;
`;

const FormGroup = styled.div`
  margin-bottom: 16px;
`;

const Label = styled.label`
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: #86868b;
  margin-bottom: 6px;
`;

const Input = styled.input`
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #d1d1d1;
  border-radius: 6px;
  font-size: 13px;

  &:focus {
    outline: none;
    border-color: #007aff;
    box-shadow: 0 0 0 3px rgba(0, 122, 255, 0.1);
  }
`;

const PasswordInput = styled(Input)`
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', sans-serif;
`;

const PathContainer = styled.div`
  display: flex;
  gap: 8px;
`;

const PathInput = styled(Input)`
  flex: 1;
`;

const Button = styled.button`
  padding: 8px 16px;
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

const DangerButton = styled(Button)`
  background: #ff3b30;

  &:hover {
    background: #d70015;
  }
`;

const CheckboxContainer = styled.label`
  display: flex;
  align-items: center;
  cursor: pointer;
  font-size: 13px;
  color: #1d1d1f;
`;

const Checkbox = styled.input`
  margin-right: 8px;
`;

const CoachList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const CoachCard = styled.div`
  padding: 12px;
  border: 1px solid #d1d1d1;
  border-radius: 8px;
  display: flex;
  justify-content: space-between;
  gap: 12px;
`;

const CoachInfo = styled.div`
  flex: 1;
`;

const CoachActions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const Toggle = styled.label`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  cursor: pointer;
`;

const ToggleInput = styled.input`
  width: 32px;
  height: 18px;
`;

const Badge = styled.span`
  margin-left: 8px;
  padding: 2px 6px;
  border-radius: 4px;
  background: #f5f5f7;
  font-size: 11px;
  font-weight: 600;
  color: #6b7280;
`;

const StatusMessage = styled.div<{ type: 'success' | 'error' | 'info' }>`
  padding: 12px;
  border-radius: 6px;
  margin-bottom: 16px;
  font-size: 13px;

  background: ${props => {
    switch (props.type) {
      case 'success':
        return '#d4f4dd';
      case 'error':
        return '#ffebe9';
      case 'info':
        return '#e3f2ff';
      default:
        return '#f5f5f7';
    }
  }};

  color: ${props => {
    switch (props.type) {
      case 'success':
        return '#00875a';
      case 'error':
        return '#de350b';
      case 'info':
        return '#0052cc';
      default:
        return '#1d1d1f';
    }
  }};
`;

const ConnectionStatus = styled.div<{ connected: boolean }>`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: ${props => (props.connected ? '#34c759' : '#86868b')};

  &::before {
    content: '';
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: ${props => (props.connected ? '#34c759' : '#86868b')};
  }
`;

const SavedBadge = styled.span`
  margin-left: 8px;
  font-size: 12px;
  font-weight: 600;
  color: #34c759;
`;

const StatusGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 18px;
`;

const StatusCard = styled.div`
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.9) 0%, #ffffff 100%);
  border: 1px solid #e2e8f0;
  border-radius: 18px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-shadow: 0 14px 32px rgba(15, 23, 42, 0.08);
`;

const StatusCardHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
`;

const StatusCardTitle = styled.h3`
  font-size: 15px;
  font-weight: 600;
  color: #111827;
  margin: 0;
`;

const StatusPill = styled.span<{ tone: 'ready' | 'warning' | 'info' }>`
  display: inline-flex;
  align-items: center;
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  background: ${props => {
    switch (props.tone) {
      case 'ready':
        return '#e6f4ea';
      case 'warning':
        return '#fdecec';
      default:
        return '#e7f0ff';
    }
  }};
  color: ${props => {
    switch (props.tone) {
      case 'ready':
        return '#0f9d58';
      case 'warning':
        return '#c62828';
      default:
        return '#1d4ed8';
    }
  }};
`;

const StatusCardDescription = styled.p`
  font-size: 13px;
  color: #4b5563;
  margin: 0;
`;

const StatusCardAction = styled.button`
  background: none;
  border: none;
  color: #007aff;
  font-size: 12px;
  font-weight: 600;
  padding: 0;
  cursor: pointer;

  &:hover {
    text-decoration: underline;
  }
`;

const MASKED_VALUE = '••••••••••';

type SectionId = 'overview' | 'coaching' | 'recording' | 'integrations' | 'automation' | 'storage' | 'preferences';

interface SectionNavItem {
  id: SectionId;
  label: string;
  description: string;
  status?: {
    text: string;
    tone: 'ready' | 'warning' | 'info';
  };
}

interface OverviewCard {
  id: SectionId;
  title: string;
  status: string;
  tone: 'ready' | 'warning' | 'info';
  description: string;
  action: string;
}

function useSettingsModel(settings: AppSettings | null, onUpdateSettings: (updates: Partial<AppSettings>) => Promise<void>) {
  const [apiKey, setApiKey] = useState(settings?.recallApiKey ? MASKED_VALUE : '');
  const [apiUrl, setApiUrl] = useState(settings?.recallApiUrl || 'https://us-west-2.recall.ai');
  const [anthropicApiKey, setAnthropicApiKey] = useState(settings?.anthropicApiKey ? MASKED_VALUE : '');
  const [firefliesApiKey, setFirefliesApiKey] = useState(settings?.firefliesApiKey ? MASKED_VALUE : '');
  const [storagePath, setStoragePath] = useState(settings?.storagePath || '');
  const [autoStart, setAutoStart] = useState(settings?.autoStartOnBoot || false);
  const [isCalendarConnected, setIsCalendarConnected] = useState(settings?.googleCalendarConnected || false);
  const [slackWebhookUrl, setSlackWebhookUrl] = useState(settings?.slackWebhookUrl || '');
  const [notionIntegrationToken, setNotionIntegrationToken] = useState(settings?.notionIntegrationToken || '');
  const [notionDatabaseId, setNotionDatabaseId] = useState(settings?.notionDatabaseId || '');
  const [notionTodoIntegrationToken, setNotionTodoIntegrationToken] = useState(settings?.notionTodoIntegrationToken || '');
  const [notionTodoDatabaseId, setNotionTodoDatabaseId] = useState(settings?.notionTodoDatabaseId || '');
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isConnectingCalendar, setIsConnectingCalendar] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [permissionStatus, setPermissionStatus] = useState<PermissionStatus | null>(null);
  const [hasSavedRecallApiKey, setHasSavedRecallApiKey] = useState<boolean>(Boolean(settings?.recallApiKey));
  const [hasSavedAnthropicKey, setHasSavedAnthropicKey] = useState<boolean>(Boolean(settings?.anthropicApiKey));
  const [hasSavedFirefliesKey, setHasSavedFirefliesKey] = useState<boolean>(Boolean(settings?.firefliesApiKey));
  const [isRecallApiKeyMasked, setIsRecallApiKeyMasked] = useState<boolean>(Boolean(settings?.recallApiKey));
  const [isAnthropicApiKeyMasked, setIsAnthropicApiKeyMasked] = useState<boolean>(Boolean(settings?.anthropicApiKey));
  const [isFirefliesApiKeyMasked, setIsFirefliesApiKeyMasked] = useState<boolean>(Boolean(settings?.firefliesApiKey));
  const [coaches, setCoaches] = useState<CoachConfig[]>(settings?.coaches || []);
  const [activeSection, setActiveSection] = useState<SectionId>('overview');

  const loadPermissionStatus = useCallback(async () => {
    try {
      const status = await window.electronAPI.getPermissionStatus();
      setPermissionStatus(status);
    } catch (error) {
      console.error('Failed to load permission status:', error);
    }
  }, []);

  useEffect(() => {
    if (settings) {
      const hasRecallKey = Boolean(settings.recallApiKey);
      const hasAnthropic = Boolean(settings.anthropicApiKey);
      const hasFireflies = Boolean(settings.firefliesApiKey);
      setHasSavedRecallApiKey(hasRecallKey);
      setIsRecallApiKeyMasked(hasRecallKey);
      setApiKey(hasRecallKey ? MASKED_VALUE : '');
      setApiUrl(settings.recallApiUrl);
      setHasSavedAnthropicKey(hasAnthropic);
      setIsAnthropicApiKeyMasked(hasAnthropic);
      setAnthropicApiKey(hasAnthropic ? MASKED_VALUE : '');
      setHasSavedFirefliesKey(hasFireflies);
      setIsFirefliesApiKeyMasked(hasFireflies);
      setFirefliesApiKey(hasFireflies ? MASKED_VALUE : '');
      setStoragePath(settings.storagePath);
      setAutoStart(settings.autoStartOnBoot);
      setIsCalendarConnected(settings.googleCalendarConnected);
      setSlackWebhookUrl(settings.slackWebhookUrl || '');
      setNotionIntegrationToken(settings.notionIntegrationToken || '');
      setNotionDatabaseId(settings.notionDatabaseId || '');
      setNotionTodoIntegrationToken(settings.notionTodoIntegrationToken || '');
      setNotionTodoDatabaseId(settings.notionTodoDatabaseId || '');
      setCoaches(settings.coaches || []);
    }
    loadPermissionStatus();
  }, [settings, loadPermissionStatus]);

  useEffect(() => {
    const handleSettingsUpdate = (newSettings: AppSettings) => {
      setIsCalendarConnected(newSettings.googleCalendarConnected);
      setCoaches(newSettings.coaches || []);
      setIsConnectingCalendar(false);
      if (newSettings.googleCalendarConnected) {
        setStatusMessage({ type: 'success', text: 'Google Calendar connected successfully!' });
      }
    };

    window.electronAPI.on(IpcChannels.SETTINGS_UPDATED, handleSettingsUpdate);

    return () => {
      window.electronAPI.removeListener(IpcChannels.SETTINGS_UPDATED, handleSettingsUpdate);
    };
  }, []);

  const handleSaveApiKey = async () => {
    setIsSaving(true);
    try {
      const updates: Partial<AppSettings> = { recallApiUrl: apiUrl };
      const shouldUpdateRecallKey = !isRecallApiKeyMasked && apiKey.trim().length > 0;
      const shouldUpdateAnthropicKey = !isAnthropicApiKeyMasked && anthropicApiKey.trim().length > 0;

      if (shouldUpdateRecallKey) {
        updates.recallApiKey = apiKey.trim();
      }
      if (shouldUpdateAnthropicKey) {
        updates.anthropicApiKey = anthropicApiKey.trim();
      }

      await onUpdateSettings(updates);
      if (shouldUpdateRecallKey) {
        setApiKey(MASKED_VALUE);
        setIsRecallApiKeyMasked(true);
        setHasSavedRecallApiKey(true);
      }
      if (shouldUpdateAnthropicKey) {
        setAnthropicApiKey(MASKED_VALUE);
        setIsAnthropicApiKeyMasked(true);
        setHasSavedAnthropicKey(true);
      }
      setStatusMessage({ type: 'success', text: 'API settings saved successfully' });
    } catch (error) {
      console.error('Failed to save API settings:', error);
      setStatusMessage({ type: 'error', text: 'Failed to save API settings' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleClearApiKey = async () => {
    setIsSaving(true);
    try {
      await onUpdateSettings({ recallApiKey: '' });
      setHasSavedRecallApiKey(false);
      setApiKey('');
      setIsRecallApiKeyMasked(false);
      setStatusMessage({ type: 'success', text: 'Recall API key removed' });
    } catch (error) {
      console.error('Failed to clear Recall API key:', error);
      setStatusMessage({ type: 'error', text: 'Failed to clear Recall API key' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleClearAnthropicKey = async () => {
    setIsSaving(true);
    try {
      await onUpdateSettings({ anthropicApiKey: '' });
      setHasSavedAnthropicKey(false);
      setAnthropicApiKey('');
      setIsAnthropicApiKeyMasked(false);
      setStatusMessage({ type: 'success', text: 'Anthropic API key removed' });
    } catch (error) {
      console.error('Failed to clear Anthropic API key:', error);
      setStatusMessage({ type: 'error', text: 'Failed to clear Anthropic API key' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveFirefliesKey = async () => {
    setIsSaving(true);
    try {
      const shouldUpdateFirefliesKey = !isFirefliesApiKeyMasked && firefliesApiKey.trim().length > 0;

      if (!shouldUpdateFirefliesKey) {
        setStatusMessage({ type: 'info', text: 'No changes to Fireflies API key' });
        return;
      }

      await onUpdateSettings({ firefliesApiKey: firefliesApiKey.trim() });
      setFirefliesApiKey(MASKED_VALUE);
      setIsFirefliesApiKeyMasked(true);
      setHasSavedFirefliesKey(true);
      setStatusMessage({ type: 'success', text: 'Fireflies API key saved successfully' });
    } catch (error) {
      console.error('Failed to save Fireflies API key:', error);
      setStatusMessage({ type: 'error', text: 'Failed to save Fireflies API key' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleClearFirefliesKey = async () => {
    setIsSaving(true);
    try {
      await onUpdateSettings({ firefliesApiKey: '' });
      setHasSavedFirefliesKey(false);
      setFirefliesApiKey('');
      setIsFirefliesApiKeyMasked(false);
      setStatusMessage({ type: 'success', text: 'Fireflies API key removed' });
    } catch (error) {
      console.error('Failed to clear Fireflies API key:', error);
      setStatusMessage({ type: 'error', text: 'Failed to clear Fireflies API key' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleBrowseFolder = async () => {
    const result = await window.electronAPI.selectStoragePath();
    if (result.path) {
      setStoragePath(result.path);
      await onUpdateSettings({ storagePath: result.path });
      setStatusMessage({ type: 'success', text: 'Storage path updated' });
    }
  };

  const handleAutoStartChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const checked = event.target.checked;
    setAutoStart(checked);
    await onUpdateSettings({ autoStartOnBoot: checked });
  };

  const handleConnectCalendar = async () => {
    try {
      setIsConnectingCalendar(true);
      setStatusMessage({ type: 'info', text: 'Opening browser for Google authentication...' });
      await window.electronAPI.connectCalendar();
    } catch (error) {
      console.error('Failed to connect Google Calendar:', error);
      setIsConnectingCalendar(false);
      setStatusMessage({ type: 'error', text: 'Failed to connect Google Calendar. Please try again.' });
    }
  };

  const handleDisconnectCalendar = async () => {
    try {
      await window.electronAPI.disconnectCalendar();
      setIsCalendarConnected(false);
      setStatusMessage({ type: 'success', text: 'Google Calendar disconnected' });
    } catch (error) {
      console.error('Failed to disconnect Google Calendar:', error);
      setStatusMessage({ type: 'error', text: 'Failed to disconnect Google Calendar' });
    }
  };

  const handleSyncCalendar = async () => {
    try {
      setIsSyncing(true);
      setStatusMessage({ type: 'info', text: 'Syncing calendar events...' });
      const result = await window.electronAPI.syncCalendar();
      if (result.success) {
        setStatusMessage({
          type: 'success',
          text: `Sync completed: ${result.added || 0} added, ${result.updated || 0} updated, ${result.deleted || 0} deleted`,
        });
      } else {
        setStatusMessage({ type: 'error', text: 'Calendar sync failed' });
      }
    } catch (error) {
      console.error('Failed to sync calendar:', error);
      setStatusMessage({ type: 'error', text: 'Failed to sync calendar. Please try again.' });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleTestConnection = async () => {
    setStatusMessage({ type: 'info', text: 'Testing connection to recall.ai...' });
    setTimeout(() => {
      if (apiKey) {
        setStatusMessage({ type: 'success', text: 'Connection successful!' });
      } else {
        setStatusMessage({ type: 'error', text: 'Please enter an API key first' });
      }
    }, 1000);
  };

  const handleSaveNotionSettings = async () => {
    setIsSaving(true);
    try {
      await onUpdateSettings({
        notionIntegrationToken,
        notionDatabaseId,
        notionTodoIntegrationToken,
        notionTodoDatabaseId,
      });
      setStatusMessage({ type: 'success', text: 'Notion settings saved successfully' });
      setTimeout(() => setStatusMessage(null), 3000);
    } catch (error) {
      console.error('Failed to save Notion settings:', error);
      setStatusMessage({ type: 'error', text: 'Failed to save Notion settings' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveSlackWebhook = async () => {
    setIsSaving(true);
    try {
      await onUpdateSettings({ slackWebhookUrl });
      setStatusMessage({ type: 'success', text: 'Slack webhook saved successfully' });
      setTimeout(() => setStatusMessage(null), 3000);
    } catch (error) {
      console.error('Failed to save Slack webhook:', error);
      setStatusMessage({ type: 'error', text: 'Failed to save Slack webhook' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleRequestPermissions = async () => {
    try {
      setStatusMessage({ type: 'info', text: 'Requesting permissions...' });
      await window.electronAPI.requestPermissions();
      const status = await window.electronAPI.checkPermissions();
      setPermissionStatus(status);
      setStatusMessage({ type: 'success', text: 'Permissions updated' });
    } catch (error) {
      console.error('Failed to request permissions:', error);
      setStatusMessage({ type: 'error', text: 'Failed to request permissions' });
    }
  };

  const handleToggleCoach = async (coachId: string, enabled: boolean) => {
    try {
      await window.electronAPI.toggleCoach(coachId, enabled);
    } catch (error) {
      console.error('Failed to toggle coach:', error);
      setStatusMessage({ type: 'error', text: 'Failed to update coach' });
    }
  };

  const handleDeleteCoach = async (coachId: string) => {
    const coach = coaches.find(c => c.id === coachId);
    if (!coach || !coach.isCustom) {
      return;
    }

    const confirmed = window.confirm(`Delete "${coach.name}"? This cannot be undone.`);
    if (!confirmed) {
      return;
    }

    try {
      await window.electronAPI.deleteCoach(coachId);
    } catch (error) {
      console.error('Failed to delete coach:', error);
      setStatusMessage({ type: 'error', text: 'Failed to delete coach' });
    }
  };

  const enabledCoachCount = useMemo(() => coaches.filter(coach => coach.enabled).length, [coaches]);

  const allPermissionsGranted = useMemo(
    () =>
      Boolean(
        permissionStatus &&
          permissionStatus['screen-capture'] &&
          permissionStatus.microphone &&
          permissionStatus.accessibility,
      ),
    [permissionStatus],
  );

  const hasAnyIntegration = useMemo(
    () =>
      Boolean(
        hasSavedFirefliesKey ||
          slackWebhookUrl ||
          notionIntegrationToken ||
          notionTodoIntegrationToken,
      ),
    [hasSavedFirefliesKey, slackWebhookUrl, notionIntegrationToken, notionTodoIntegrationToken],
  );

  const sections = useMemo<SectionNavItem[]>(
    () => [
      {
        id: 'overview',
        label: 'Overview',
        description: 'Readiness summary and quick actions',
      },
      {
        id: 'coaching',
        label: 'Coaching',
        description: 'Enable live coaches and manage custom ones',
        status: {
          text: enabledCoachCount > 0 ? `${enabledCoachCount} active` : 'No coaches enabled',
          tone: enabledCoachCount > 0 ? 'ready' : 'warning',
        },
      },
      {
        id: 'recording',
        label: 'Recording & recall.ai',
        description: 'Recorder configuration and transcript cleanup',
        status: {
          text: hasSavedRecallApiKey ? 'Ready' : 'Needs API key',
          tone: hasSavedRecallApiKey ? 'ready' : 'warning',
        },
      },
      {
        id: 'integrations',
        label: 'Integrations',
        description: 'Fireflies, Slack, and Notion connections',
        status: {
          text: hasAnyIntegration ? 'Connected' : 'Optional',
          tone: hasAnyIntegration ? 'ready' : 'info',
        },
      },
      {
        id: 'automation',
        label: 'Automation',
        description: 'Calendar syncing and recording hand-offs',
        status: {
          text: isCalendarConnected ? 'Calendar connected' : 'Not connected',
          tone: isCalendarConnected ? 'ready' : 'info',
        },
      },
      {
        id: 'storage',
        label: 'Storage & permissions',
        description: 'Local backups and required OS permissions',
        status: {
          text: allPermissionsGranted ? 'All granted' : 'Action needed',
          tone: allPermissionsGranted ? 'ready' : 'warning',
        },
      },
      {
        id: 'preferences',
        label: 'Preferences & about',
        description: 'Startup behavior and app details',
        status: {
          text: autoStart ? 'Launch on boot' : 'Manual launch',
          tone: autoStart ? 'ready' : 'info',
        },
      },
    ],
    [
      enabledCoachCount,
      hasSavedRecallApiKey,
      hasAnyIntegration,
      isCalendarConnected,
      allPermissionsGranted,
      autoStart,
    ],
  );

  const overviewCards = useMemo<OverviewCard[]>(
    () => [
      {
        id: 'recording',
        title: 'Recording readiness',
        status: hasSavedRecallApiKey ? 'Ready' : 'Setup required',
        tone: hasSavedRecallApiKey ? 'ready' : 'warning',
        description: hasSavedRecallApiKey
          ? 'recall.ai is connected and ready to record meetings.'
          : 'Add your recall.ai API key and endpoint to start capturing meetings.',
        action: hasSavedRecallApiKey ? 'Manage recording settings' : 'Add API key',
      },
      {
        id: 'automation',
        title: 'Calendar sync',
        status: isCalendarConnected ? 'Connected' : 'Not connected',
        tone: isCalendarConnected ? 'ready' : 'info',
        description: isCalendarConnected
          ? 'Events sync automatically from Google Calendar.'
          : 'Connect Google Calendar to import upcoming meetings automatically.',
        action: isCalendarConnected ? 'Sync & manage' : 'Connect calendar',
      },
      {
        id: 'storage',
        title: 'System permissions',
        status: allPermissionsGranted ? 'All granted' : 'Needs attention',
        tone: allPermissionsGranted ? 'ready' : 'warning',
        description: allPermissionsGranted
          ? 'Screen capture, microphone, and accessibility permissions are granted.'
          : 'Grant screen capture, microphone, and accessibility to ensure recordings succeed.',
        action: 'Review permissions',
      },
      {
        id: 'integrations',
        title: 'External integrations',
        status: hasAnyIntegration ? 'Connected' : 'Optional',
        tone: hasAnyIntegration ? 'ready' : 'info',
        description: hasAnyIntegration
          ? 'Fireflies, Slack, or Notion integrations are configured.'
          : 'Connect Fireflies, Slack, or Notion to extend meeting workflows.',
        action: hasAnyIntegration ? 'Manage integrations' : 'Connect services',
      },
      {
        id: 'coaching',
        title: 'Real-time coaching',
        status: enabledCoachCount > 0 ? 'Active' : 'Disabled',
        tone: enabledCoachCount > 0 ? 'ready' : 'info',
        description:
          enabledCoachCount > 0
            ? `${enabledCoachCount} coach${enabledCoachCount === 1 ? '' : 'es'} active for live feedback.`
            : 'Turn on coaches to provide helpful nudges during meetings.',
        action: enabledCoachCount > 0 ? 'Adjust coaches' : 'Enable coaches',
      },
    ],
    [
      hasSavedRecallApiKey,
      isCalendarConnected,
      allPermissionsGranted,
      hasAnyIntegration,
      enabledCoachCount,
    ],
  );

  return {
    apiKey,
    setApiKey,
    apiUrl,
    setApiUrl,
    anthropicApiKey,
    setAnthropicApiKey,
    firefliesApiKey,
    setFirefliesApiKey,
    storagePath,
    autoStart,
    isCalendarConnected,
    slackWebhookUrl,
    setSlackWebhookUrl,
    notionIntegrationToken,
    setNotionIntegrationToken,
    notionDatabaseId,
    setNotionDatabaseId,
    notionTodoIntegrationToken,
    setNotionTodoIntegrationToken,
    notionTodoDatabaseId,
    setNotionTodoDatabaseId,
    statusMessage,
    setStatusMessage,
    isSaving,
    isConnectingCalendar,
    isSyncing,
    permissionStatus,
    hasSavedRecallApiKey,
    hasSavedAnthropicKey,
    hasSavedFirefliesKey,
    isRecallApiKeyMasked,
    setIsRecallApiKeyMasked,
    isAnthropicApiKeyMasked,
    setIsAnthropicApiKeyMasked,
    isFirefliesApiKeyMasked,
    setIsFirefliesApiKeyMasked,
    coaches,
    sections,
    overviewCards,
    activeSection,
    setActiveSection,
    handleSaveApiKey,
    handleClearApiKey,
    handleTestConnection,
    handleClearAnthropicKey,
    handleSaveFirefliesKey,
    handleClearFirefliesKey,
    handleBrowseFolder,
    handleAutoStartChange,
    handleConnectCalendar,
    handleDisconnectCalendar,
    handleSyncCalendar,
    handleSaveNotionSettings,
    handleSaveSlackWebhook,
    handleRequestPermissions,
    handleToggleCoach,
    handleDeleteCoach,
  };
}

type SettingsModel = ReturnType<typeof useSettingsModel>;

const SettingsContext = React.createContext<SettingsModel | null>(null);

const useSettingsContext = () => {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('Settings components must be rendered within SettingsProvider');
  }
  return context;
};

interface SettingsProviderProps {
  settings: AppSettings | null;
  onUpdateSettings: (updates: Partial<AppSettings>) => Promise<void>;
  children: ReactNode;
}

export const SettingsProvider: React.FC<SettingsProviderProps> = ({ settings, onUpdateSettings, children }) => {
  const model = useSettingsModel(settings, onUpdateSettings);
  return <SettingsContext.Provider value={model}>{children}</SettingsContext.Provider>;
};

export const SettingsNavigation: React.FC = () => {
  const { sections, activeSection, setActiveSection } = useSettingsContext();

  return (
    <NavigationPane>
      <NavigationHeader>
        <NavigationTitle>Settings</NavigationTitle>
        <NavigationSubtitle>Configure recording, automations, and integrations.</NavigationSubtitle>
      </NavigationHeader>
      <NavigationList>
        {sections.map(section => (
          <NavItem
            key={section.id}
            type="button"
            active={activeSection === section.id}
            onClick={() => setActiveSection(section.id)}
          >
            <NavIndicator active={activeSection === section.id} />
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <NavLabel>{section.label}</NavLabel>
              {section.status && <NavStatus tone={section.status.tone}>{section.status.text}</NavStatus>}
            </div>
            <NavDescription>{section.description}</NavDescription>
          </NavItem>
        ))}
      </NavigationList>
    </NavigationPane>
  );
};

export const SettingsContent: React.FC = () => {
  const {
    statusMessage,
    overviewCards,
    activeSection,
    setActiveSection,
    coaches,
    handleToggleCoach,
    handleDeleteCoach,
    hasSavedRecallApiKey,
    apiKey,
    setApiKey,
    isRecallApiKeyMasked,
    setIsRecallApiKeyMasked,
    handleSaveApiKey,
    handleClearApiKey,
    handleTestConnection,
    apiUrl,
    setApiUrl,
    isSaving,
    hasSavedAnthropicKey,
    anthropicApiKey,
    setAnthropicApiKey,
    isAnthropicApiKeyMasked,
    setIsAnthropicApiKeyMasked,
    handleClearAnthropicKey,
    handleSaveFirefliesKey,
    firefliesApiKey,
    setFirefliesApiKey,
    isFirefliesApiKeyMasked,
    setIsFirefliesApiKeyMasked,
    hasSavedFirefliesKey,
    handleClearFirefliesKey,
    storagePath,
    handleBrowseFolder,
    isCalendarConnected,
    isConnectingCalendar,
    handleConnectCalendar,
    handleSyncCalendar,
    handleDisconnectCalendar,
    isSyncing,
    slackWebhookUrl,
    setSlackWebhookUrl,
    handleSaveNotionSettings,
    handleSaveSlackWebhook,
    notionIntegrationToken,
    setNotionIntegrationToken,
    notionTodoIntegrationToken,
    setNotionTodoIntegrationToken,
    notionDatabaseId,
    setNotionDatabaseId,
    notionTodoDatabaseId,
    setNotionTodoDatabaseId,
    permissionStatus,
    handleRequestPermissions,
    autoStart,
    handleAutoStartChange,
  } = useSettingsContext();

  const renderActiveSection = () => {
    switch (activeSection) {
      case 'overview':
        return (
          <>
            <ContentHeader>
              <ContentTitle>Overview</ContentTitle>
              <ContentSubtitle>Check system readiness and jump into detailed settings.</ContentSubtitle>
            </ContentHeader>
            <StatusGrid>
              {overviewCards.map(card => (
                <StatusCard key={card.title}>
                  <StatusCardHeader>
                    <StatusCardTitle>{card.title}</StatusCardTitle>
                    <StatusPill tone={card.tone}>{card.status}</StatusPill>
                  </StatusCardHeader>
                  <StatusCardDescription>{card.description}</StatusCardDescription>
                  <StatusCardAction type="button" onClick={() => setActiveSection(card.id)}>
                    {card.action}
                  </StatusCardAction>
                </StatusCard>
              ))}
            </StatusGrid>
          </>
        );
      case 'coaching':
        return (
          <>
            <ContentHeader>
              <ContentTitle>Real-time coaching</ContentTitle>
              <ContentSubtitle>Enable built-in coaches or manage custom guidance for your team.</ContentSubtitle>
            </ContentHeader>
            <Section>
              <SectionTitle>Coaches</SectionTitle>
              <SectionDescription>Toggle coaches that appear during live recordings.</SectionDescription>
              <CoachList>
                {coaches.map(coach => (
                  <CoachCard key={coach.id}>
                    <CoachInfo>
                      <div style={{ display: 'flex', alignItems: 'center' }}>
                        <strong>{coach.name}</strong>
                        {!coach.isCustom && <Badge>Default</Badge>}
                      </div>
                      <div style={{ fontSize: '13px', color: '#6b7280', marginTop: '4px' }}>
                        {coach.description}
                      </div>
                    </CoachInfo>
                    <CoachActions>
                      <Toggle>
                        <ToggleInput
                          type="checkbox"
                          checked={coach.enabled}
                          onChange={event => handleToggleCoach(coach.id, event.target.checked)}
                        />
                        {coach.enabled ? 'Enabled' : 'Disabled'}
                      </Toggle>
                      {coach.isCustom && (
                        <DangerButton type="button" onClick={() => handleDeleteCoach(coach.id)}>
                          Delete
                        </DangerButton>
                      )}
                    </CoachActions>
                  </CoachCard>
                ))}
              </CoachList>
              <div style={{ fontSize: '12px', color: '#4b5563' }}>
                Create new coaches from the Prompts tab using "Add Coach".
              </div>
            </Section>
          </>
        );
      case 'recording':
        return (
          <>
            <ContentHeader>
              <ContentTitle>Recording configuration</ContentTitle>
              <ContentSubtitle>Manage recall.ai credentials and transcript cleanup.</ContentSubtitle>
            </ContentHeader>
            <Section>
              <SectionTitle>recall.ai API</SectionTitle>
              <SectionDescription>Connect your recorder account and test connectivity.</SectionDescription>
              <FormGroup>
                <Label>
                  API Key
                  {hasSavedRecallApiKey && <SavedBadge>Saved</SavedBadge>}
                </Label>
                <PasswordInput
                  type="password"
                  value={apiKey}
                  placeholder={hasSavedRecallApiKey && !apiKey ? '••••••••••' : 'Enter your recall.ai API key'}
                  onFocus={() => {
                    if (isRecallApiKeyMasked) {
                      setApiKey('');
                      setIsRecallApiKeyMasked(false);
                    }
                  }}
                  onBlur={() => {
                    if (!apiKey && hasSavedRecallApiKey) {
                      setApiKey(MASKED_VALUE);
                      setIsRecallApiKeyMasked(true);
                    }
                  }}
                  onChange={event => setApiKey(event.target.value)}
                />
              </FormGroup>
              <FormGroup>
                <Label>API Endpoint</Label>
                <Input
                  value={apiUrl}
                  onChange={event => setApiUrl(event.target.value)}
                  placeholder="https://us-east-1.recall.ai"
                />
              </FormGroup>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <Button onClick={handleSaveApiKey} disabled={isSaving}>
                  Save API Settings
                </Button>
                {hasSavedRecallApiKey && (
                  <SecondaryButton type="button" onClick={handleClearApiKey} disabled={isSaving}>
                    Remove Key
                  </SecondaryButton>
                )}
                <SecondaryButton onClick={handleTestConnection}>Test Connection</SecondaryButton>
              </div>
            </Section>
            <Section>
              <SectionTitle>Transcript correction</SectionTitle>
              <SectionDescription>Optionally correct transcripts using Anthropic Claude after recordings finish.</SectionDescription>
              <FormGroup>
                <Label>
                  Anthropic API Key
                  {hasSavedAnthropicKey && <SavedBadge>Saved</SavedBadge>}
                </Label>
                <PasswordInput
                  type="password"
                  value={anthropicApiKey}
                  placeholder={hasSavedAnthropicKey && !anthropicApiKey ? '••••••••••' : 'Enter your Anthropic API key (optional)'}
                  onFocus={() => {
                    if (isAnthropicApiKeyMasked) {
                      setAnthropicApiKey('');
                      setIsAnthropicApiKeyMasked(false);
                    }
                  }}
                  onBlur={() => {
                    if (!anthropicApiKey && hasSavedAnthropicKey) {
                      setAnthropicApiKey(MASKED_VALUE);
                      setIsAnthropicApiKeyMasked(true);
                    }
                  }}
                  onChange={event => setAnthropicApiKey(event.target.value)}
                />
                <div style={{ fontSize: '11px', color: '#86868b', marginTop: '4px' }}>
                  Leave blank to skip transcript correction. Get your key at anthropic.com
                </div>
              </FormGroup>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <Button onClick={handleSaveApiKey} disabled={isSaving}>
                  Save API Settings
                </Button>
                {hasSavedAnthropicKey && (
                  <SecondaryButton type="button" onClick={handleClearAnthropicKey} disabled={isSaving}>
                    Remove Key
                  </SecondaryButton>
                )}
              </div>
            </Section>
          </>
        );
      case 'integrations':
        return (
          <>
            <ContentHeader>
              <ContentTitle>Integrations</ContentTitle>
              <ContentSubtitle>Extend meeting workflows with transcription, messaging, and documentation tools.</ContentSubtitle>
            </ContentHeader>
            <Section>
              <SectionTitle>Fireflies.ai</SectionTitle>
              <SectionDescription>Capture Fireflies transcripts alongside recall.ai recordings.</SectionDescription>
              <FormGroup>
                <Label>
                  API Key
                  {hasSavedFirefliesKey && <SavedBadge>Saved</SavedBadge>}
                </Label>
                <PasswordInput
                  type="password"
                  value={firefliesApiKey}
                  placeholder={hasSavedFirefliesKey && !firefliesApiKey ? MASKED_VALUE : 'Enter your Fireflies API key'}
                  onFocus={() => {
                    if (isFirefliesApiKeyMasked) {
                      setFirefliesApiKey('');
                      setIsFirefliesApiKeyMasked(false);
                    }
                  }}
                  onBlur={() => {
                    if (!firefliesApiKey && hasSavedFirefliesKey) {
                      setFirefliesApiKey(MASKED_VALUE);
                      setIsFirefliesApiKeyMasked(true);
                    }
                  }}
                  onChange={event => setFirefliesApiKey(event.target.value)}
                />
              </FormGroup>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <Button onClick={handleSaveFirefliesKey} disabled={isSaving}>
                  Save Fireflies Key
                </Button>
                {hasSavedFirefliesKey && (
                  <SecondaryButton type="button" onClick={handleClearFirefliesKey} disabled={isSaving}>
                    Remove Key
                  </SecondaryButton>
                )}
              </div>
            </Section>
            <Section>
              <SectionTitle>Slack</SectionTitle>
              <SectionDescription>Push meeting summaries to your team’s Slack channel.</SectionDescription>
              <FormGroup>
                <Label>Webhook URL</Label>
                <PasswordInput
                  type="password"
                  value={slackWebhookUrl}
                  onChange={event => setSlackWebhookUrl(event.target.value)}
                  placeholder="https://hooks.slack.com/services/..."
                />
                <div style={{ fontSize: '11px', color: '#86868b', marginTop: '4px' }}>
                  Create a webhook in your Slack workspace to enable sharing. Visit slack.com/apps to set up.
                </div>
              </FormGroup>
              <Button onClick={handleSaveSlackWebhook} disabled={isSaving}>
                {isSaving ? 'Saving...' : 'Save Webhook'}
              </Button>
            </Section>
            <Section>
              <SectionTitle>Notion</SectionTitle>
              <SectionDescription>Publish notes and action items to Notion databases.</SectionDescription>
              <FormGroup>
                <Label>Primary Integration Token</Label>
                <PasswordInput
                  type="password"
                  value={notionIntegrationToken}
                  onChange={event => setNotionIntegrationToken(event.target.value)}
                  placeholder="Enter your Notion integration token"
                />
                <div style={{ fontSize: '11px', color: '#86868b', marginTop: '4px' }}>
                  Create an internal integration at notion.so/my-integrations and share your meeting notes database with it.
                </div>
              </FormGroup>
              <FormGroup>
                <Label>To-Do Integration Token (optional)</Label>
                <PasswordInput
                  type="password"
                  value={notionTodoIntegrationToken}
                  onChange={event => setNotionTodoIntegrationToken(event.target.value)}
                  placeholder="Leave blank to reuse your primary Notion token"
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px', flexWrap: 'wrap' }}>
                  <SecondaryButton type="button" onClick={() => setNotionTodoIntegrationToken(notionIntegrationToken || '')}>
                    Use primary token
                  </SecondaryButton>
                  <span style={{ fontSize: '11px', color: '#86868b' }}>
                    Provide a dedicated token if your to-do database uses a different integration, or leave this blank to reuse the primary one.
                  </span>
                </div>
              </FormGroup>
              <FormGroup>
                <Label>Database ID</Label>
                <Input
                  value={notionDatabaseId}
                  onChange={event => setNotionDatabaseId(event.target.value)}
                  placeholder="Paste the target database ID"
                />
                <div style={{ fontSize: '11px', color: '#86868b', marginTop: '4px' }}>
                  Open your database in a browser, copy the URL, and grab the 32-character identifier after the last slash.
                </div>
              </FormGroup>
              <FormGroup>
                <Label>To-Do Database ID</Label>
                <Input
                  value={notionTodoDatabaseId}
                  onChange={event => setNotionTodoDatabaseId(event.target.value)}
                  placeholder="Paste the to-do database ID"
                />
                <div style={{ fontSize: '11px', color: '#86868b', marginTop: '4px' }}>
                  Provide the database where new action items should be created when you push them from meeting insights.
                </div>
              </FormGroup>
              <Button onClick={handleSaveNotionSettings} disabled={isSaving}>
                {isSaving ? 'Saving...' : 'Save Notion Settings'}
              </Button>
            </Section>
          </>
        );
      case 'automation':
        return (
          <>
            <ContentHeader>
              <ContentTitle>Automation</ContentTitle>
              <ContentSubtitle>Keep meetings in sync and trigger workflows automatically.</ContentSubtitle>
            </ContentHeader>
            <Section>
              <SectionTitle>Google Calendar</SectionTitle>
              <SectionDescription>Connect your calendar to import upcoming meetings.</SectionDescription>
              <ConnectionStatus connected={isCalendarConnected}>
                {isConnectingCalendar ? 'Connecting...' : isCalendarConnected ? 'Connected' : 'Not connected'}
              </ConnectionStatus>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {!isCalendarConnected ? (
                  <Button onClick={handleConnectCalendar} disabled={isConnectingCalendar}>
                    {isConnectingCalendar ? 'Connecting...' : 'Connect Google Calendar'}
                  </Button>
                ) : (
                  <>
                    <Button onClick={handleSyncCalendar} disabled={isSyncing}>
                      {isSyncing ? 'Syncing...' : 'Sync Now'}
                    </Button>
                    <SecondaryButton onClick={handleConnectCalendar} disabled={isConnectingCalendar}>
                      Reconnect
                    </SecondaryButton>
                    <DangerButton onClick={handleDisconnectCalendar}>Disconnect</DangerButton>
                  </>
                )}
              </div>
            </Section>
          </>
        );
      case 'storage':
        return (
          <>
            <ContentHeader>
              <ContentTitle>Storage & permissions</ContentTitle>
              <ContentSubtitle>Choose where recordings live and ensure macOS access is granted.</ContentSubtitle>
            </ContentHeader>
            <Section>
              <SectionTitle>Storage</SectionTitle>
              <SectionDescription>Select the local folder used for meeting files.</SectionDescription>
              <PathContainer>
                <PathInput value={storagePath} readOnly placeholder="Select folder for meeting files" />
                <Button onClick={handleBrowseFolder}>Browse...</Button>
              </PathContainer>
            </Section>
            <Section>
              <SectionTitle>System permissions</SectionTitle>
              <SectionDescription>Grant these permissions so recording and coaching work reliably.</SectionDescription>
              <div style={{ fontSize: '13px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {permissionStatus ? (
                  <>
                    <div style={{ color: permissionStatus['screen-capture'] ? '#34c759' : '#ff3b30' }}>
                      {permissionStatus['screen-capture'] ? '✅' : '❌'} Screen Recording: {permissionStatus['screen-capture'] ? 'Granted' : 'Not Granted'}
                    </div>
                    <div style={{ color: permissionStatus.microphone ? '#34c759' : '#ff3b30' }}>
                      {permissionStatus.microphone ? '✅' : '❌'} Microphone: {permissionStatus.microphone ? 'Granted' : 'Not Granted'}
                    </div>
                    <div style={{ color: permissionStatus.accessibility ? '#34c759' : '#ff3b30' }}>
                      {permissionStatus.accessibility ? '✅' : '❌'} Accessibility: {permissionStatus.accessibility ? 'Granted' : 'Not Granted'}
                    </div>
                  </>
                ) : (
                  <div style={{ color: '#6b7280' }}>Checking current permission status…</div>
                )}
              </div>
              {permissionStatus && (!permissionStatus['screen-capture'] || !permissionStatus.microphone || !permissionStatus.accessibility) && (
                <Button onClick={handleRequestPermissions}>Grant Required Permissions</Button>
              )}
            </Section>
          </>
        );
      case 'preferences':
        return (
          <>
            <ContentHeader>
              <ContentTitle>Preferences & about</ContentTitle>
              <ContentSubtitle>Control app behavior and review build details.</ContentSubtitle>
            </ContentHeader>
            <Section>
              <SectionTitle>App preferences</SectionTitle>
              <SectionDescription>Choose how the recorder launches with your Mac.</SectionDescription>
              <CheckboxContainer>
                <Checkbox type="checkbox" checked={autoStart} onChange={handleAutoStartChange} />
                Start on system boot
              </CheckboxContainer>
            </Section>
            <Section>
              <SectionTitle>About</SectionTitle>
              <SectionDescription>Version and stack details.</SectionDescription>
              <div style={{ fontSize: '13px', color: '#86868b' }}>
                <p style={{ margin: 0 }}>Meeting Note Recorder v1.0.0</p>
                <p style={{ marginTop: '8px' }}>Built with Electron, React, and recall.ai</p>
              </div>
            </Section>
          </>
        );
      default:
        return null;
    }
  };

  return (
    <SettingsContainer>
      <ContentScroll>
        <ContentInner>
          {statusMessage && <StatusMessage type={statusMessage.type}>{statusMessage.text}</StatusMessage>}
          {renderActiveSection()}
        </ContentInner>
      </ContentScroll>
    </SettingsContainer>
  );
};

export type { SectionId };
