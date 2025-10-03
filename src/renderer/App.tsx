import React, { useState, useEffect } from 'react';
import styled from '@emotion/styled';
import Split from 'react-split';
import { Meeting, AppSettings, IpcChannels } from '../shared/types';
import MeetingList from './components/MeetingList';
import MeetingDetailFinal from './components/MeetingDetailFinal';
import Settings from './components/Settings';
import Profile from './components/Profile';
import Search from './components/Search';
import { SystemPromptsList, SystemPromptEditor } from './components/SystemPromptsEditor';
import { ElectronAPI } from '../main/preload';

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

const AppContainer = styled.div`
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #f5f5f7;
`;

const TitleBar = styled.div`
  height: 38px;
  background: linear-gradient(180deg, #f6f6f6 0%, #e8e8e8 100%);
  border-bottom: 1px solid #d1d1d1;
  display: flex;
  align-items: center;
  padding: 0 80px; /* Space for window controls */
  -webkit-app-region: drag;
  position: relative;
`;

const AppTitle = styled.div`
  font-size: 14px;
  font-weight: 600;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  user-select: none;
`;

const SearchWrapper = styled.div`
  position: relative;
`;

const SearchContainer = styled.div<{ collapsed: boolean }>`
  background: #f9f9f9;
  border-bottom: 1px solid #e5e5e7;
  transition: all 0.3s ease;
  position: relative;
  max-height: ${props => props.collapsed ? '0' : '400px'};
  overflow: hidden;
  opacity: ${props => props.collapsed ? '0' : '1'};
`;

const SearchToggle = styled.button<{ collapsed: boolean }>`
  position: ${props => props.collapsed ? 'relative' : 'absolute'};
  top: ${props => props.collapsed ? '0' : '8px'};
  right: ${props => props.collapsed ? '0' : '12px'};
  margin: ${props => props.collapsed ? '8px 12px' : '0'};
  background: #ffffff;
  border: 1px solid #e5e5e7;
  color: #86868b;
  font-size: 16px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  transition: all 0.2s;
  z-index: 10;
  -webkit-app-region: no-drag;
  float: ${props => props.collapsed ? 'right' : 'none'};

  &:hover {
    background: #e8e8e8;
    color: #333;
  }
`;

const MainContent = styled.div`
  flex: 1;
  display: flex;
  overflow: hidden;
  background: #ffffff;

  .split {
    display: flex;
    width: 100%;
  }

  .gutter {
    background-color: #e5e5e7;
    background-repeat: no-repeat;
    background-position: 50%;
    cursor: col-resize;
    transition: background-color 0.2s;

    &:hover {
      background-color: #d1d1d1;
    }
  }

  .gutter.gutter-horizontal {
    background-image: url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAeCAYAAADkftS9AAAAIklEQVQoU2M4c+bMfxAGAgYYmwGrIIiDjrELjpo5aiZeMwF+yNnOs5KSvgAAAABJRU5ErkJggg==');
    cursor: col-resize;
  }
`;

const SidebarWrapper = styled.div<{ collapsed: boolean }>`
  position: relative;
  width: ${props => props.collapsed ? '0' : 'auto'};
  min-width: ${props => props.collapsed ? '0' : '200px'};
  transition: all 0.3s ease;
  overflow: visible;
`;

const Sidebar = styled.div<{ collapsed: boolean }>`
  background: #ffffff;
  display: flex;
  flex-direction: column;
  height: 100%;
  width: ${props => props.collapsed ? '0' : 'auto'};
  opacity: ${props => props.collapsed ? '0' : '1'};
  transition: all 0.3s ease;
  overflow: hidden;
`;

const SidebarToggle = styled.button<{ collapsed: boolean }>`
  position: absolute;
  top: 50%;
  left: ${props => props.collapsed ? '0' : 'calc(100% - 28px)'};
  transform: translateY(-50%);
  background: #ffffff;
  border: 1px solid #e5e5e7;
  color: #86868b;
  font-size: 16px;
  cursor: pointer;
  padding: ${props => props.collapsed ? '24px 10px' : '8px 6px'};
  border-radius: ${props => props.collapsed ? '0 8px 8px 0' : '4px'};
  transition: all 0.3s ease;
  z-index: 100;
  box-shadow: ${props => props.collapsed ? '2px 0 8px rgba(0, 0, 0, 0.05)' : 'none'};

  &:hover {
    background: #f9f9f9;
    color: #333;
  }
`;

const SidebarContent = styled.div`
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding-bottom: 80px; /* Space for bottom navigation */
`;

const BottomNav = styled.div`
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  background: #fafafa;
  border-top: 1px solid #e5e5e7;
  z-index: 100;
  height: 80px; /* Fixed height for navigation */
`;

const NavButton = styled.button<{ active?: boolean }>`
  flex: 1;
  padding: 12px;
  background: ${props => props.active ? '#667eea' : 'transparent'};
  border: none;
  color: ${props => props.active ? 'white' : '#666'};
  font-size: 20px;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;

  &:hover {
    background: ${props => props.active ? '#5a67d8' : '#e8e8e8'};
    color: ${props => props.active ? 'white' : '#333'};
  }

  span {
    font-size: 10px;
    font-weight: 500;
    margin-top: 2px;
  }
`;

const TabBar = styled.div`
  display: flex;
  border-bottom: 1px solid #e5e5e7;
  background: #f9f9f9;
`;

const Tab = styled.button<{ active: boolean }>`
  flex: 1;
  padding: 10px;
  background: ${props => props.active ? '#ffffff' : 'transparent'};
  border: none;
  border-bottom: ${props => props.active ? '2px solid #007aff' : 'none'};
  color: ${props => props.active ? '#007aff' : '#86868b'};
  font-size: 13px;
  font-weight: 500;
  transition: all 0.2s;
  
  &:hover {
    color: #007aff;
  }
`;

const ContentArea = styled.div`
  flex: 1;
  background: #ffffff;
  overflow: hidden;
`;

const StatusBar = styled.div`
  height: 24px;
  background: #f6f6f6;
  border-top: 1px solid #d1d1d1;
  display: flex;
  align-items: center;
  padding: 0 12px;
  font-size: 11px;
  color: #86868b;
`;

const StatusIndicator = styled.div<{ type: 'recording' | 'connected' | 'disconnected' }>`
  display: flex;
  align-items: center;
  gap: 6px;
  
  &::before {
    content: '';
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: ${props => {
      switch(props.type) {
        case 'recording': return '#ff3b30';
        case 'connected': return '#34c759';
        case 'disconnected': return '#ff9500';
        default: return '#86868b';
      }
    }};
    ${props => props.type === 'recording' && `
      animation: pulse 1.5s ease-in-out infinite;
    `}
  }
  
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }
`;

const FloatingActionButton = styled.button`
  position: fixed;
  bottom: 40px;
  right: 24px;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: #007aff;
  color: white;
  border: none;
  box-shadow: 0 4px 12px rgba(0, 122, 255, 0.3);
  font-size: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;

  &:hover {
    transform: scale(1.05);
    box-shadow: 0 6px 16px rgba(0, 122, 255, 0.4);
  }

  &:active {
    transform: scale(0.95);
  }
`;

const ConnectionErrorBanner = styled.div`
  background: linear-gradient(135deg, #ff9500 0%, #ffab00 100%);
  color: white;
  padding: 12px 28px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid rgba(255, 255, 255, 0.2);
  font-size: 13px;
  font-weight: 500;
`;

const ConnectionErrorMessage = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;

  &::before {
    content: '⚠️';
    font-size: 16px;
  }
`;

const ConnectionErrorButton = styled.button`
  background: rgba(255, 255, 255, 0.2);
  color: white;
  border: 1px solid white;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    background: rgba(255, 255, 255, 0.3);
  }
`;

const Toast = styled.div<{ show: boolean; type?: 'success' | 'error' | 'info' }>`
  position: fixed;
  bottom: 40px;
  left: 50%;
  transform: translateX(-50%) translateY(${props => props.show ? '0' : '100px'});
  background: ${props => {
    switch(props.type) {
      case 'error': return 'linear-gradient(135deg, #ff3b30 0%, #ff6b6b 100%)';
      case 'info': return 'linear-gradient(135deg, #007AFF 0%, #5856D6 100%)';
      default: return 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
    }
  }};
  color: white;
  padding: 16px 24px;
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(102, 126, 234, 0.4);
  font-size: 14px;
  font-weight: 500;
  z-index: 1000;
  opacity: ${props => props.show ? 1 : 0};
  transition: all 0.3s ease;
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: 400px;

  &::before {
    content: ${props => {
      switch(props.type) {
        case 'error': return "'✕'";
        case 'info': return "'ℹ'";
        default: return "'✓'";
      }
    }};
    display: inline-block;
    width: 20px;
    height: 20px;
    background: rgba(255, 255, 255, 0.2);
    border-radius: 50%;
    text-align: center;
    line-height: 20px;
    font-size: 12px;
  }
`;

type ViewMode = 'meetings' | 'settings' | 'profile' | 'prompts';
type TabMode = 'upcoming' | 'past';

function App() {
  const [viewMode, setViewMode] = useState<ViewMode>('meetings');
  const [tabMode, setTabMode] = useState<TabMode>('upcoming');
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected'>('connected');
  const [readyToRecordMeetings, setReadyToRecordMeetings] = useState<Set<string>>(new Set());
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState<'success' | 'error' | 'info'>('success');
  const [searchCollapsed, setSearchCollapsed] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isLoadingMeetings, setIsLoadingMeetings] = useState(false);

  useEffect(() => {
    // Check if electronAPI is available
    if (typeof window.electronAPI === 'undefined') {
      console.error('electronAPI is not available!');
      return;
    }
    
    loadMeetings();
    loadSettings();
    setupEventListeners();

    return () => {
      // Cleanup event listeners
    };
  }, []);

  const loadMeetings = async () => {
    try {
      setIsLoadingMeetings(true);
      console.log('[JOURNEY-UI-LOAD-1] Loading meetings from backend');
      const loadedMeetings = await window.electronAPI.getMeetings();
      console.log('[JOURNEY-UI-LOAD-2] Meetings loaded', {
        count: loadedMeetings.length,
        meetings: loadedMeetings.map((m: Meeting) => ({ id: m.id, title: m.title, status: m.status }))
      });
      setMeetings(loadedMeetings);

      // Restore recording state if active (HMR-safe)
      const recState = await window.electronAPI.getRecordingState();
      if (recState.isRecording && recState.meeting) {
        console.log('[HMR-RECOVERY] Restoring active recording', {
          meetingId: recState.meetingId,
          title: recState.meeting.title
        });
        setIsRecording(true);
        setSelectedMeeting(recState.meeting);
        setTabMode('upcoming'); // Show upcoming tab where recording is
      }
    } catch (error) {
      console.error('[JOURNEY-UI-LOAD-ERROR] Failed to load meetings:', error);
    } finally {
      setIsLoadingMeetings(false);
    }
  };

  const loadSettings = async () => {
    try {
      const loadedSettings = await window.electronAPI.getSettings();
      setSettings(loadedSettings);
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  };

  const showToastHelper = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToastMessage(message);
    setToastType(type);
    setShowToast(true);
    setTimeout(() => setShowToast(false), 5000);
  };

  const setupEventListeners = () => {
    window.electronAPI.on(IpcChannels.MEETINGS_UPDATED, loadMeetings);
    window.electronAPI.on(IpcChannels.RECORDING_STARTED, async (data: any) => {
      console.log('[JOURNEY-UI-EVENT-1] RECORDING_STARTED event received:', {
        data,
        timestamp: new Date().toISOString()
      });
      setIsRecording(true);
      console.log('[JOURNEY-UI-STATE-1] isRecording set to true');

      // If meeting object is provided directly, use it immediately
      if (data.meeting) {
        console.log('[JOURNEY-UI-EVENT-2] Using meeting object from event:', {
          id: data.meeting.id,
          title: data.meeting.title,
          status: data.meeting.status
        });
        setSelectedMeeting(data.meeting);
        console.log('[JOURNEY-UI-STATE-2] selectedMeeting set to:', data.meeting.id);
        setViewMode('meetings');
        console.log('[JOURNEY-UI-STATE-3] viewMode set to: meetings');
        setTabMode('upcoming');
        console.log('[JOURNEY-UI-STATE-4] tabMode set to: upcoming');

        // Also update the meetings list to include this new meeting
        setMeetings(prev => {
          const exists = prev.some(m => m.id === data.meeting.id);
          console.log('[JOURNEY-UI-STATE-5] Updating meetings list', {
            meetingId: data.meeting.id,
            alreadyExists: exists,
            previousCount: prev.length
          });
          if (!exists) {
            console.log('[JOURNEY-UI-STATE-6] Adding new meeting to list');
            return [...prev, data.meeting];
          }
          return prev;
        });
      } else if (data.meetingId) {
        console.log('[JOURNEY-UI-EVENT-3] Only meetingId provided, loading from storage');
        // Fallback to loading from storage
        await loadMeetings();
        const loadedMeetings = await window.electronAPI.getMeetings();
        console.log('[JOURNEY-UI-EVENT-4] Meetings loaded for selection:', loadedMeetings.length);
        const meeting = loadedMeetings.find((m: Meeting) => m.id === data.meetingId);
        console.log('[JOURNEY-UI-EVENT-5] Meeting search result:', {
          searchId: data.meetingId,
          found: !!meeting,
          title: meeting?.title
        });
        if (meeting) {
          setSelectedMeeting(meeting);
          setViewMode('meetings');
          setTabMode('upcoming');
          console.log('[JOURNEY-UI-EVENT-6] Meeting selected successfully');
        } else {
          console.error('[JOURNEY-UI-EVENT-ERROR] Meeting not found in list:', data.meetingId);
        }
      }
    });
    window.electronAPI.on(IpcChannels.RECORDING_STOPPED, () => {
      console.log('[JOURNEY-UI-STOP] Recording stopped event received');
      setIsRecording(false);
      console.log('[JOURNEY-UI-STATE-STOP] isRecording set to false');
      loadMeetings(); // Refresh to update status
    });

    // Handle auto-stop notifications
    window.electronAPI.on('recording-auto-stopped', (data: any) => {
      console.log('[AUTO-STOP] Recording automatically stopped:', data);

      const reason = data.reason === 'window-closed'
        ? 'Meeting window closed'
        : 'Meeting ended';

      const message = `Recording automatically stopped: ${reason}`;

      // Show toast notification
      setToastMessage(message);
      setShowToast(true);
      setTimeout(() => setShowToast(false), 5000);

      // Also log transcript count if available
      if (data.transcriptCount > 0) {
        console.log(`[AUTO-STOP] Saved ${data.transcriptCount} transcript segments`);
      }
    });

    window.electronAPI.on(IpcChannels.CONNECTION_STATUS, (status: string) => {
      console.log('[JOURNEY-UI-CONNECTION] Connection status changed:', status);
      setConnectionStatus(status as 'connected' | 'disconnected');
    });
    window.electronAPI.on(IpcChannels.SETTINGS_UPDATED, (newSettings: AppSettings) => {
      setSettings(newSettings);
    });
    // Listen for select-meeting event from main process
    window.electronAPI.on('select-meeting', async (data: { meetingId: string }) => {
      // Reload meetings first
      await loadMeetings();
      const loadedMeetings = await window.electronAPI.getMeetings();
      const meeting = loadedMeetings.find((m: Meeting) => m.id === data.meetingId);
      if (meeting) {
        setSelectedMeeting(meeting);
        setViewMode('meetings');
        // If it's a recording meeting, switch to upcoming tab
        if (meeting.status === 'recording' || meeting.status === 'active') {
          setTabMode('upcoming');
        }
      }
    });

    // Listen for meeting-ready events from pre-meeting notifications
    window.electronAPI.on('meeting-ready', (data: any) => {
      console.log('[MEETING-READY] Meeting ready for recording:', data);
      if (data.calendarEvent) {
        // Add to ready set
        setReadyToRecordMeetings(prev => {
          const newSet = new Set(prev);
          newSet.add(data.calendarEvent.id);
          // Auto-clear after 5 minutes
          setTimeout(() => {
            setReadyToRecordMeetings(p => {
              const updated = new Set(p);
              updated.delete(data.calendarEvent.id);
              return updated;
            });
          }, 300000);
          return newSet;
        });
      }
    });
  };

  const handleCreateMeeting = async () => {
    try {
      console.log('[JOURNEY-UI-CREATE-1] Creating new meeting');
      const newMeeting = await window.electronAPI.createMeeting({
        title: 'New Meeting',
        date: new Date(),
        status: 'scheduled',
        notes: '',
      });
      console.log('[JOURNEY-UI-CREATE-2] Meeting created:', {
        id: newMeeting.id,
        title: newMeeting.title
      });
      await loadMeetings();
      setSelectedMeeting(newMeeting);
      console.log('[JOURNEY-UI-CREATE-3] New meeting selected');
    } catch (error) {
      console.error('[JOURNEY-UI-CREATE-ERROR] Failed to create meeting:', error);
    }
  };

  const handleSyncCalendar = async () => {
    try {
      const result = await window.electronAPI.syncCalendar();
      await loadMeetings();
      showToastHelper('Calendar synced successfully', 'success');
      return result;
    } catch (error) {
      console.error('Failed to sync calendar:', error);
      showToastHelper('Failed to sync calendar. Check your connection and try again.', 'error');
      throw error;
    }
  };

  const filterMeetings = (meetings: Meeting[]): Meeting[] => {
    const now = new Date();
    let filtered: Meeting[];

    // Filter out [DELETED] meetings from all tabs (these are orphaned from old recurring event bug)
    const nonDeletedMeetings = meetings.filter(m => !m.title.startsWith('[DELETED]'));

    if (tabMode === 'upcoming') {
      // Show meetings that haven't ended yet (or are actively recording)
      filtered = nonDeletedMeetings.filter(m => {
        // Calculate end time: use endTime if available, otherwise use duration, fallback to 1 hour
        const startTime = new Date(m.date).getTime();
        const durationMs = m.duration ? m.duration * 60 * 1000 : 60 * 60 * 1000; // duration is in minutes
        const endTime = m.endTime ? new Date(m.endTime) : new Date(startTime + durationMs);
        return endTime >= now ||
               m.status === 'recording' ||
               m.status === 'active';
      });
    } else {
      // Show past meetings - only those that have ended and have content
      filtered = nonDeletedMeetings.filter(m => {
        // Calculate end time: use endTime if available, otherwise use duration, fallback to 1 hour
        const startTime = new Date(m.date).getTime();
        const durationMs = m.duration ? m.duration * 60 * 1000 : 60 * 60 * 1000; // duration is in minutes
        const endTime = m.endTime ? new Date(m.endTime) : new Date(startTime + durationMs);
        return (endTime < now || m.status === 'completed') &&
               m.status !== 'recording' &&
               m.status !== 'active' &&
               // Only show past meetings that have actual content
               ((m.notes && m.notes.trim().length > 0) ||
                (m.transcript && m.transcript.trim().length > 0));
      });
    }
    
    // Sort meetings by date - upcoming meetings in ascending order, past in descending
    return filtered.sort((a, b) => {
      const dateA = new Date(a.date).getTime();
      const dateB = new Date(b.date).getTime();
      
      if (tabMode === 'upcoming') {
        return dateA - dateB; // Ascending for upcoming (next meeting first)
      } else {
        return dateB - dateA; // Descending for past (most recent first)
      }
    });
  };

  // Show error if electronAPI is not available
  if (typeof window.electronAPI === 'undefined') {
    return (
      <AppContainer>
        <div style={{ padding: 50, textAlign: 'center' }}>
          <h1>Error: Application not loaded properly</h1>
          <p>The Electron API is not available. Please restart the application.</p>
          <p>If this persists, check the console for errors.</p>
        </div>
      </AppContainer>
    );
  }

  return (
    <AppContainer>
      <TitleBar>
        <AppTitle>Meeting Note Recorder</AppTitle>
      </TitleBar>

      <SearchWrapper>
        <SearchToggle
          collapsed={searchCollapsed}
          onClick={() => setSearchCollapsed(!searchCollapsed)}
        >
          {searchCollapsed ? '▼' : '▲'}
        </SearchToggle>
        <SearchContainer collapsed={searchCollapsed}>
          <Search
            onSelectMeeting={setSelectedMeeting}
            currentMeeting={selectedMeeting}
            collapsed={searchCollapsed}
          />
        </SearchContainer>
      </SearchWrapper>

      {connectionStatus === 'disconnected' && (
        <ConnectionErrorBanner>
          <ConnectionErrorMessage>
            Not connected to recall.ai. Recordings won't work.
          </ConnectionErrorMessage>
          <ConnectionErrorButton onClick={() => setViewMode('settings')}>
            Check Settings
          </ConnectionErrorButton>
        </ConnectionErrorBanner>
      )}

      <MainContent>
        <Split
          className="split"
          sizes={sidebarCollapsed ? [0, 100] : [25, 75]}
          minSize={sidebarCollapsed ? [0, 400] : [200, 400]}
          expandToMin={false}
          gutterSize={sidebarCollapsed ? 0 : 6}
          gutterAlign="center"
          snapOffset={30}
          dragInterval={1}
          direction="horizontal"
          cursor="col-resize"
        >
          <SidebarWrapper collapsed={sidebarCollapsed}>
            <SidebarToggle
              collapsed={sidebarCollapsed}
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            >
              {sidebarCollapsed ? '▶' : '◀'}
            </SidebarToggle>
            <Sidebar collapsed={sidebarCollapsed}>
              <SidebarContent>
              {viewMode === 'meetings' && (
                <>
                  <TabBar>
                    <Tab
                      active={tabMode === 'upcoming'}
                      onClick={() => setTabMode('upcoming')}
                    >
                      Upcoming
                    </Tab>
                    <Tab
                      active={tabMode === 'past'}
                      onClick={() => setTabMode('past')}
                    >
                      Past
                    </Tab>
                  </TabBar>

                  <MeetingList
                    meetings={filterMeetings(meetings)}
                    selectedMeeting={selectedMeeting}
                    onSelectMeeting={setSelectedMeeting}
                    onSyncCalendar={handleSyncCalendar}
                    readyToRecordMeetings={readyToRecordMeetings}
                    isLoading={isLoadingMeetings}
                  />
                </>
              )}

              {viewMode === 'settings' && (
                <Settings
                  settings={settings}
                  onUpdateSettings={async (updates) => {
                    await window.electronAPI.updateSettings(updates);
                    await loadSettings();
                  }}
                />
              )}

              {viewMode === 'profile' && (
                <Profile />
              )}

              {viewMode === 'prompts' && (
                <SystemPromptsList
                  onSelectPrompt={setSelectedPromptId}
                  selectedPromptId={selectedPromptId}
                />
              )}
            </SidebarContent>

            <BottomNav>
              <NavButton
                active={viewMode === 'meetings'}
                onClick={() => setViewMode('meetings')}
                title="Meetings"
              >
                📅
                <span>Meetings</span>
              </NavButton>
              <NavButton
                active={viewMode === 'profile'}
                onClick={() => setViewMode('profile')}
                title="Profile"
              >
                👤
                <span>Profile</span>
              </NavButton>
              <NavButton
                active={viewMode === 'prompts'}
                onClick={() => setViewMode('prompts')}
                title="Prompts"
              >
                📝
                <span>Prompts</span>
              </NavButton>
              <NavButton
                active={viewMode === 'settings'}
                onClick={() => setViewMode('settings')}
                title="Settings"
              >
                ⚙️
                <span>Settings</span>
              </NavButton>
            </BottomNav>
            </Sidebar>
          </SidebarWrapper>

          <ContentArea>
          {viewMode === 'meetings' && (
            selectedMeeting ? (
              <MeetingDetailFinal
                key={selectedMeeting.id}
                meeting={selectedMeeting}
                onUpdateMeeting={async (updates) => {
                  await window.electronAPI.updateMeeting(selectedMeeting.id, updates);
                  await loadMeetings();
                }}
                onDeleteMeeting={async (meetingId) => {
                  await window.electronAPI.deleteMeeting(meetingId);
                  setSelectedMeeting(null);
                  await loadMeetings();
                }}
                onRefresh={async () => {
                  await loadMeetings();
                  // Update selected meeting with refreshed data
                  const updatedMeetings = await window.electronAPI.getMeetings();
                  const updatedMeeting = updatedMeetings.find((m: Meeting) => m.id === selectedMeeting.id);
                  if (updatedMeeting) {
                    setSelectedMeeting(updatedMeeting);
                  }
                }}
                onShowToast={showToastHelper}
              />
            ) : (
              <div style={{ padding: 50, textAlign: 'center', color: '#86868b' }}>
                <h2>No meeting selected</h2>
                <p>Select a meeting from the list or start a new recording</p>
              </div>
            )
          )}

          {viewMode === 'prompts' && (
            selectedPromptId ? (
              <SystemPromptEditor promptId={selectedPromptId} />
            ) : (
              <div style={{ padding: 50, textAlign: 'center', color: '#86868b' }}>
                <h2>No prompt selected</h2>
                <p>Select a prompt from the list to edit it</p>
              </div>
            )
          )}
        </ContentArea>
        </Split>
      </MainContent>
      
      <StatusBar>
        {isRecording && (
          <StatusIndicator type="recording">Recording</StatusIndicator>
        )}
        {!isRecording && (
          <StatusIndicator type={connectionStatus}>
            {connectionStatus === 'connected' ? 'Connected' : 'Disconnected'}
          </StatusIndicator>
        )}
      </StatusBar>
      
      {viewMode === 'meetings' && (
        <FloatingActionButton onClick={handleCreateMeeting}>
          +
        </FloatingActionButton>
      )}

      <Toast show={showToast} type={toastType}>
        {toastMessage}
      </Toast>
    </AppContainer>
  );
}

export default App;