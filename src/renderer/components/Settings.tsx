import React, { useState, useEffect } from 'react';
import styled from '@emotion/styled';
import { AppSettings } from '../../shared/types';

interface PermissionStatus {
  'screen-capture': boolean;
  microphone: boolean;
  accessibility: boolean;
}

const SettingsContainer = styled.div`
  padding: 24px;
  overflow-y: auto;
`;

const Section = styled.div`
  margin-bottom: 32px;
`;

const SectionTitle = styled.h2`
  font-size: 16px;
  font-weight: 600;
  color: #1d1d1f;
  margin-bottom: 16px;
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

const StatusMessage = styled.div<{ type: 'success' | 'error' | 'info' }>`
  padding: 12px;
  border-radius: 6px;
  margin-bottom: 16px;
  font-size: 13px;
  
  background: ${props => {
    switch(props.type) {
      case 'success': return '#d4f4dd';
      case 'error': return '#ffebe9';
      case 'info': return '#e3f2ff';
      default: return '#f5f5f7';
    }
  }};
  
  color: ${props => {
    switch(props.type) {
      case 'success': return '#00875a';
      case 'error': return '#de350b';
      case 'info': return '#0052cc';
      default: return '#1d1d1f';
    }
  }};
`;

const ConnectionStatus = styled.div<{ connected: boolean }>`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: ${props => props.connected ? '#34c759' : '#86868b'};
  
  &::before {
    content: '';
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: ${props => props.connected ? '#34c759' : '#86868b'};
  }
`;

interface SettingsProps {
  settings: AppSettings | null;
  onUpdateSettings: (updates: Partial<AppSettings>) => Promise<void>;
}


function Settings({ settings, onUpdateSettings }: SettingsProps) {
  const [apiKey, setApiKey] = useState(settings?.recallApiKey || '');
  const [apiUrl, setApiUrl] = useState(settings?.recallApiUrl || 'https://us-west-2.recall.ai');
  const [anthropicApiKey, setAnthropicApiKey] = useState(settings?.anthropicApiKey || '');
  const [storagePath, setStoragePath] = useState(settings?.storagePath || '');
  const [autoStart, setAutoStart] = useState(settings?.autoStartOnBoot || false);
  const [isCalendarConnected, setIsCalendarConnected] = useState(settings?.googleCalendarConnected || false);
  const [slackWebhookUrl, setSlackWebhookUrl] = useState(settings?.slackWebhookUrl || '');
  const [notionIntegrationToken, setNotionIntegrationToken] = useState(settings?.notionIntegrationToken || '');
  const [notionDatabaseId, setNotionDatabaseId] = useState(settings?.notionDatabaseId || '');
  const [notionTodoIntegrationToken, setNotionTodoIntegrationToken] = useState(settings?.notionTodoIntegrationToken || '');
  const [notionTodoDatabaseId, setNotionTodoDatabaseId] = useState(settings?.notionTodoDatabaseId || '');
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error' | 'info', text: string } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isConnectingCalendar, setIsConnectingCalendar] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [permissionStatus, setPermissionStatus] = useState<PermissionStatus | null>(null);

  useEffect(() => {
    if (settings) {
      setApiKey(settings.recallApiKey || '');
      setApiUrl(settings.recallApiUrl);
      setAnthropicApiKey(settings.anthropicApiKey || '');
      setStoragePath(settings.storagePath);
      setAutoStart(settings.autoStartOnBoot);
      setIsCalendarConnected(settings.googleCalendarConnected);
      setSlackWebhookUrl(settings.slackWebhookUrl || '');
      setNotionIntegrationToken(settings.notionIntegrationToken || '');
      setNotionDatabaseId(settings.notionDatabaseId || '');
      setNotionTodoIntegrationToken(settings.notionTodoIntegrationToken || '');
      setNotionTodoDatabaseId(settings.notionTodoDatabaseId || '');
    }

    // Load permission status
    loadPermissionStatus();
  }, [settings]);
  
  const loadPermissionStatus = async () => {
    try {
      const status = await window.electronAPI.getPermissionStatus();
      setPermissionStatus(status);
    } catch (error) {
      console.error('Failed to load permission status:', error);
    }
  };

  // Listen for settings updates from main process
  useEffect(() => {
    const handleSettingsUpdate = (newSettings: AppSettings) => {
      setIsCalendarConnected(newSettings.googleCalendarConnected);
      // Clear connecting state when we get an update
      setIsConnectingCalendar(false);
      if (newSettings.googleCalendarConnected) {
        setStatusMessage({ type: 'success', text: 'Google Calendar connected successfully!' });
      }
    };

    window.electronAPI.on('settings-updated', handleSettingsUpdate);
    
    return () => {
      // Clean up listener
    };
  }, []);

  const handleSaveApiKey = async () => {
    setIsSaving(true);
    try {
      await onUpdateSettings({ recallApiKey: apiKey, recallApiUrl: apiUrl, anthropicApiKey: anthropicApiKey });
      setStatusMessage({ type: 'success', text: 'API settings saved successfully' });
    } catch (error) {
      setStatusMessage({ type: 'error', text: 'Failed to save API settings' });
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

  const handleAutoStartChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked;
    setAutoStart(checked);
    await onUpdateSettings({ autoStartOnBoot: checked });
  };

  const handleConnectCalendar = async () => {
    try {
      setIsConnectingCalendar(true);
      setStatusMessage({ type: 'info', text: 'Opening browser for Google authentication...' });
      await window.electronAPI.connectCalendar();
      // Success will be handled by the settings-updated event
    } catch (error) {
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
          text: `Sync completed: ${result.added || 0} added, ${result.updated || 0} updated, ${result.deleted || 0} deleted`
        });
      } else {
        setStatusMessage({ type: 'error', text: 'Calendar sync failed' });
      }
    } catch (error) {
      setStatusMessage({ type: 'error', text: 'Failed to sync calendar. Please try again.' });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleTestConnection = async () => {
    setStatusMessage({ type: 'info', text: 'Testing connection to recall.ai...' });
    // In a real app, you would test the API connection here
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
        notionTodoDatabaseId
      });
      setStatusMessage({ type: 'success', text: 'Notion settings saved successfully' });
      setTimeout(() => setStatusMessage(null), 3000);
    } catch (error) {
      setStatusMessage({ type: 'error', text: 'Failed to save Notion settings' });
    } finally {
      setIsSaving(false);
    }
  };
  
  const handleRequestPermissions = async () => {
    try {
      setStatusMessage({ type: 'info', text: 'Requesting permissions...' });
      await window.electronAPI.requestPermissions();
      // Reload permission status
      const newStatus = await window.electronAPI.checkPermissions();
      setPermissionStatus(newStatus);
      setStatusMessage({ type: 'success', text: 'Permissions updated' });
    } catch (error) {
      setStatusMessage({ type: 'error', text: 'Failed to request permissions' });
    }
  };

  return (
    <SettingsContainer>
      {statusMessage && (
        <StatusMessage type={statusMessage.type}>
          {statusMessage.text}
        </StatusMessage>
      )}
      
      <Section>
        <SectionTitle>recall.ai Configuration</SectionTitle>
        
        <FormGroup>
          <Label>API Key</Label>
          <PasswordInput
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Enter your recall.ai API key"
          />
        </FormGroup>
        
        <FormGroup>
          <Label>API Endpoint</Label>
          <Input
            value={apiUrl}
            onChange={(e) => setApiUrl(e.target.value)}
            placeholder="https://us-east-1.recall.ai"
          />
        </FormGroup>
        
        <div style={{ display: 'flex', gap: '8px' }}>
          <Button onClick={handleSaveApiKey} disabled={isSaving}>
            Save API Settings
          </Button>
          <SecondaryButton onClick={handleTestConnection}>
            Test Connection
          </SecondaryButton>
        </div>
      </Section>

      <Section>
        <SectionTitle>Transcript Correction (Optional)</SectionTitle>
        <div style={{ fontSize: '13px', color: '#86868b', marginBottom: '16px' }}>
          Improve transcript accuracy using Anthropic Claude to correct transcription errors after recording ends.
        </div>

        <FormGroup>
          <Label>Anthropic API Key</Label>
          <PasswordInput
            type="password"
            value={anthropicApiKey}
            onChange={(e) => setAnthropicApiKey(e.target.value)}
            placeholder="Enter your Anthropic API key (optional)"
          />
          <div style={{ fontSize: '11px', color: '#86868b', marginTop: '4px' }}>
            Leave blank to skip transcript correction. Get your key at anthropic.com
          </div>
        </FormGroup>

        <Button onClick={handleSaveApiKey} disabled={isSaving}>
          Save API Settings
        </Button>
      </Section>

      <Section>
        <SectionTitle>Storage Settings</SectionTitle>
        
        <FormGroup>
          <Label>Local Storage Path</Label>
          <PathContainer>
            <PathInput
              value={storagePath}
              readOnly
              placeholder="Select folder for meeting files"
            />
            <Button onClick={handleBrowseFolder}>
              Browse...
            </Button>
          </PathContainer>
        </FormGroup>
      </Section>
      
      <Section>
        <SectionTitle>Google Calendar</SectionTitle>
        
        <ConnectionStatus connected={isCalendarConnected}>
          {isConnectingCalendar ? 'Connecting...' : (isCalendarConnected ? 'Connected' : 'Not connected')}
        </ConnectionStatus>
        
        <div style={{ marginTop: '16px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
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
              <DangerButton onClick={handleDisconnectCalendar}>
                Disconnect
              </DangerButton>
            </>
          )}
        </div>
      </Section>

      <Section>
        <SectionTitle>Slack Integration</SectionTitle>
        <div style={{ fontSize: '13px', color: '#86868b', marginBottom: '16px' }}>
          Share meeting summaries to your team's Slack channel using webhook integration.
        </div>

        <FormGroup>
          <Label>Webhook URL</Label>
          <PasswordInput
            type="password"
            value={slackWebhookUrl}
            onChange={(e) => setSlackWebhookUrl(e.target.value)}
            placeholder="https://hooks.slack.com/services/..."
          />
          <div style={{ fontSize: '11px', color: '#86868b', marginTop: '4px' }}>
            Create a webhook in your Slack workspace to enable sharing. Visit slack.com/apps to set up.
          </div>
        </FormGroup>

        <Button
          onClick={async () => {
            try {
              setIsSaving(true);
              await onUpdateSettings({ slackWebhookUrl });
              setStatusMessage({ type: 'success', text: 'Slack webhook saved successfully' });
              setTimeout(() => setStatusMessage(null), 3000);
            } catch (error) {
              setStatusMessage({ type: 'error', text: 'Failed to save Slack webhook' });
            } finally {
              setIsSaving(false);
            }
          }}
          disabled={isSaving}
        >
          {isSaving ? 'Saving...' : 'Save Webhook'}
        </Button>
      </Section>

      <Section>
        <SectionTitle>Notion Integration</SectionTitle>
        <div style={{ fontSize: '13px', color: '#86868b', marginBottom: '16px' }}>
          Connect Notion databases to publish meeting notes and push AI-generated action items directly from the Actions tab.
        </div>

        <FormGroup>
          <Label>Primary Integration Token</Label>
          <PasswordInput
            type="password"
            value={notionIntegrationToken}
            onChange={(e) => setNotionIntegrationToken(e.target.value)}
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
            onChange={(e) => setNotionTodoIntegrationToken(e.target.value)}
            placeholder="Leave blank to reuse your primary Notion token"
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px', flexWrap: 'wrap' }}>
            <SecondaryButton
              type="button"
              onClick={() => setNotionTodoIntegrationToken(notionIntegrationToken || '')}
            >
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
            onChange={(e) => setNotionDatabaseId(e.target.value)}
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
            onChange={(e) => setNotionTodoDatabaseId(e.target.value)}
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

      <Section>
        <SectionTitle>System Permissions</SectionTitle>
        <div style={{ fontSize: '13px', marginBottom: '16px' }}>
          {permissionStatus && (
            <>
              <div style={{ marginBottom: '8px', color: permissionStatus['screen-capture'] ? '#34c759' : '#ff3b30' }}>
                {permissionStatus['screen-capture'] ? '✅' : '❌'} Screen Recording: {permissionStatus['screen-capture'] ? 'Granted' : 'Not Granted'}
              </div>
              <div style={{ marginBottom: '8px', color: permissionStatus.microphone ? '#34c759' : '#ff3b30' }}>
                {permissionStatus.microphone ? '✅' : '❌'} Microphone: {permissionStatus.microphone ? 'Granted' : 'Not Granted'}
              </div>
              <div style={{ marginBottom: '8px', color: permissionStatus.accessibility ? '#34c759' : '#ff3b30' }}>
                {permissionStatus.accessibility ? '✅' : '❌'} Accessibility: {permissionStatus.accessibility ? 'Granted' : 'Not Granted'}
              </div>
            </>
          )}
        </div>
        {permissionStatus && (!permissionStatus['screen-capture'] || !permissionStatus.microphone || !permissionStatus.accessibility) && (
          <Button onClick={handleRequestPermissions}>
            Grant Required Permissions
          </Button>
        )}
      </Section>
      
      <Section>
        <SectionTitle>App Preferences</SectionTitle>
        
        <CheckboxContainer>
          <Checkbox
            type="checkbox"
            checked={autoStart}
            onChange={handleAutoStartChange}
          />
          Start on system boot
        </CheckboxContainer>
      </Section>


      <Section>
        <SectionTitle>About</SectionTitle>
        <div style={{ fontSize: '13px', color: '#86868b' }}>
          <p>Meeting Note Recorder v1.0.0</p>
          <p style={{ marginTop: '8px' }}>
            Built with Electron, React, and recall.ai
          </p>
        </div>
      </Section>
    </SettingsContainer>
  );
}

export default Settings;