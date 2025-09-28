import { useState, useCallback, useEffect } from 'react';
import { Meeting, AppSettings, UserProfile, SearchOptions } from '../../shared/types';

/**
 * Custom React hooks for Electron API calls
 * Provides consistent error handling, loading states, and retry logic
 */

// Generic API call hook with loading and error states
function useApiCall<T, Args extends any[]>(
  apiFunction: (...args: Args) => Promise<T>
) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const execute = useCallback(async (...args: Args) => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiFunction(...args);
      setData(result);
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [apiFunction]);

  const reset = useCallback(() => {
    setData(null);
    setError(null);
    setLoading(false);
  }, []);

  return { data, loading, error, execute, reset };
}

// Meetings hooks
export function useMeetings() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchMeetings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await window.electronAPI.getMeetings();
      setMeetings(result);
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMeetings();

    // Listen for updates
    const handleUpdate = () => fetchMeetings();
    window.electronAPI.on('meetings-updated', handleUpdate);

    return () => {
      window.electronAPI.removeListener('meetings-updated', handleUpdate);
    };
  }, [fetchMeetings]);

  return { meetings, loading, error, refetch: fetchMeetings };
}

// Settings hook
export function useSettings() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await window.electronAPI.getSettings();
      setSettings(result);
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, []);

  const updateSettings = useCallback(async (updates: Partial<AppSettings>) => {
    setLoading(true);
    setError(null);
    try {
      const result = await window.electronAPI.updateSettings(updates);
      setSettings(result);
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();

    // Listen for updates
    const handleUpdate = () => fetchSettings();
    window.electronAPI.on('settings-updated', handleUpdate);

    return () => {
      window.electronAPI.removeListener('settings-updated', handleUpdate);
    };
  }, [fetchSettings]);

  return { settings, loading, error, updateSettings, refetch: fetchSettings };
}

// Recording hook
export function useRecording() {
  const [isRecording, setIsRecording] = useState(false);
  const [currentMeetingId, setCurrentMeetingId] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const startRecording = useCallback(async (meetingId: string) => {
    setError(null);
    try {
      await window.electronAPI.startRecording(meetingId);
      setIsRecording(true);
      setCurrentMeetingId(meetingId);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    }
  }, []);

  const stopRecording = useCallback(async () => {
    setError(null);
    try {
      await window.electronAPI.stopRecording();
      setIsRecording(false);
      setCurrentMeetingId(null);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    }
  }, []);

  useEffect(() => {
    const handleStarted = () => setIsRecording(true);
    const handleStopped = () => {
      setIsRecording(false);
      setCurrentMeetingId(null);
    };

    window.electronAPI.on('recording-started', handleStarted);
    window.electronAPI.on('recording-stopped', handleStopped);

    return () => {
      window.electronAPI.removeListener('recording-started', handleStarted);
      window.electronAPI.removeListener('recording-stopped', handleStopped);
    };
  }, []);

  return {
    isRecording,
    currentMeetingId,
    error,
    startRecording,
    stopRecording
  };
}

// Search hook
export function useSearch() {
  const { data, loading, error, execute } = useApiCall(
    window.electronAPI.searchMeetings
  );

  const search = useCallback(async (options: SearchOptions) => {
    return execute(options);
  }, [execute]);

  return {
    results: data,
    loading,
    error,
    search
  };
}

// Profile hook
export function useProfile() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchProfile = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await window.electronAPI.getProfile();
      setProfile(result);
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, []);

  const updateProfile = useCallback(async (updates: UserProfile) => {
    setLoading(true);
    setError(null);
    try {
      const result = await window.electronAPI.updateProfile(updates);
      setProfile(result);
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  return { profile, loading, error, updateProfile, refetch: fetchProfile };
}

// Error notification hook
export function useErrorHandler() {
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    const handleError = (error: any) => {
      const message = error?.message || error?.toString() || 'Unknown error';
      setErrors(prev => [...prev, message]);

      // Auto-clear after 5 seconds
      setTimeout(() => {
        setErrors(prev => prev.filter(e => e !== message));
      }, 5000);
    };

    window.electronAPI.on('error-occurred', handleError);

    return () => {
      window.electronAPI.removeListener('error-occurred', handleError);
    };
  }, []);

  const clearError = useCallback((index: number) => {
    setErrors(prev => prev.filter((_, i) => i !== index));
  }, []);

  return { errors, clearError };
}