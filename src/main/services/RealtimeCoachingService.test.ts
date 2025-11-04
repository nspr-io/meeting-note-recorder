import { RealtimeCoachingService } from './RealtimeCoachingService';
import type { PromptService } from './PromptService';
import type { SettingsService } from './SettingsService';
import type { StorageService } from './StorageService';
import type { Meeting } from '../../shared/types';
import { combineNoteSections } from '../../renderer/components/noteSectionUtils';

jest.mock('./ServiceLogger', () => ({
  createServiceLogger: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    log: jest.fn()
  }))
}));

describe('RealtimeCoachingService', () => {
  const buildService = () => {
    const promptService = {
      getInterpolatedPrompt: jest.fn()
    } as unknown as PromptService;

    const settingsService = {
      getCoaches: jest.fn(() => [])
    } as unknown as SettingsService;

    const storageService = {
      refreshMeetingFromDisk: jest.fn(),
      getMeeting: jest.fn()
    } as unknown as StorageService;

    const service = new RealtimeCoachingService(promptService, settingsService, storageService);
    const internals = service as any;
    internals.isActive = true;
    internals.meetingId = 'meeting-1';

    return { service, storageService };
  };

  it('extracts prep notes from live meeting updates', () => {
    const { service } = buildService();

    const combinedNotes = combineNoteSections({
      calendarInfo: 'Agenda: Q4 Review',
      prepNotes: 'Prep: confirm metrics baseline',
      meetingNotes: 'Key decision: extend pilot.'
    });

    service.updateMeetingNotes('meeting-1', combinedNotes);

    const internals = service as any;
    expect(internals.currentMeetingPrep).toBe('Prep: confirm metrics baseline');
    expect(internals.currentMeetingNotes).toContain('Key decision: extend pilot.');
    expect(internals.currentMeetingNotesCombined).toContain('Prep: confirm metrics baseline');
  });

  it('loads meeting context from storage with prep notes', async () => {
    const { service, storageService } = buildService();

    const combinedNotes = combineNoteSections({
      calendarInfo: 'Agenda: Standup',
      prepNotes: 'Prep: share blockers',
      meetingNotes: 'Update: onboarding completed.'
    });

    const meeting: Meeting = {
      id: 'meeting-1',
      title: 'Daily Sync',
      date: new Date().toISOString(),
      attendees: [],
      status: 'completed',
      notes: combinedNotes,
      transcript: ''
    };

    (storageService.refreshMeetingFromDisk as jest.Mock).mockResolvedValue(meeting);

    await (service as any).loadMeetingContext('meeting-1', { refresh: true });

    const internals = service as any;
    expect(internals.currentMeetingPrep).toBe('Prep: share blockers');
    expect(internals.currentMeetingNotes).toContain('Update: onboarding completed.');
  });
});
