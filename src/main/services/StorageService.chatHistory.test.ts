import fs from 'fs/promises';
import { StorageService } from './StorageService';
import type { SettingsService } from './SettingsService';
import type { MeetingChatMessage } from '../../shared/types';

jest.mock('./DescriptionProcessingService', () => ({
  DescriptionProcessingService: jest.fn().mockImplementation(() => ({
    initialize: jest.fn(),
    processDescription: jest.fn().mockResolvedValue({ notes: '', platform: undefined })
  }))
}));

jest.mock('fs/promises', () => ({
  writeFile: jest.fn().mockResolvedValue(undefined),
  readFile: jest.fn(),
  readdir: jest.fn().mockResolvedValue([]),
  mkdir: jest.fn().mockResolvedValue(undefined),
  rename: jest.fn().mockResolvedValue(undefined),
  stat: jest.fn().mockResolvedValue({ mtime: new Date() }),
  access: jest.fn().mockResolvedValue(undefined),
  unlink: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid')
}));

const mockedFs = fs as jest.Mocked<typeof fs>;

const createStorageService = () => {
  const settingsService = {
    getSettings: jest.fn().mockReturnValue({
      storagePath: '/tmp/meeting-storage',
      anthropicApiKey: null
    })
  } as unknown as SettingsService;

  const service = new StorageService(settingsService, jest.fn());
  (service as any).meetingsCache.clear();
  return service;
};

const createMessage = (overrides: Partial<MeetingChatMessage> = {}): MeetingChatMessage => ({
  id: 'chat-1',
  role: 'assistant',
  content: 'Test reply',
  createdAt: new Date().toISOString(),
  ...overrides
});

describe('StorageService chat history', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns empty history when file is missing', async () => {
    const service = createStorageService();
    const error = Object.assign(new Error('not found'), { code: 'ENOENT' });
    mockedFs.readFile.mockRejectedValueOnce(error);

    const history = await service.getMeetingChatHistory('meeting-1');

    expect(history).toEqual([]);
    expect(mockedFs.readFile).toHaveBeenCalledWith(expect.stringContaining('/chat-history/meeting-1.json'), 'utf-8');
  });

  it('caches history after saving to disk', async () => {
    const service = createStorageService();
    const cacheMissError = Object.assign(new Error('not found'), { code: 'ENOENT' });
    mockedFs.readFile.mockRejectedValueOnce(cacheMissError);

    await service.getMeetingChatHistory('meeting-2');
    expect(mockedFs.readFile).toHaveBeenCalledTimes(1);

    const message = createMessage({ id: 'chat-2', role: 'user', content: 'Hi there' });
    await service.saveMeetingChatHistory('meeting-2', [message]);
    expect(mockedFs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('/chat-history/meeting-2.json'),
      expect.stringContaining('"chat-2"'),
      'utf-8'
    );

    mockedFs.readFile.mockClear();
    const cachedHistory = await service.getMeetingChatHistory('meeting-2');
    expect(cachedHistory).toHaveLength(1);
    expect(cachedHistory[0]).toMatchObject({ id: 'chat-2', role: 'user' });
    expect(mockedFs.readFile).not.toHaveBeenCalled();
  });

  it('clears chat history file and cache', async () => {
    const service = createStorageService();
    await service.saveMeetingChatHistory('meeting-3', [createMessage({ id: 'chat-3' })]);

    await service.clearMeetingChatHistory('meeting-3');
    expect(mockedFs.unlink).toHaveBeenCalledWith(expect.stringContaining('/chat-history/meeting-3.json'));

    const miss = Object.assign(new Error('not found'), { code: 'ENOENT' });
    mockedFs.readFile.mockRejectedValueOnce(miss);
    const historyAfterClear = await service.getMeetingChatHistory('meeting-3');
    expect(historyAfterClear).toEqual([]);
  });
});
