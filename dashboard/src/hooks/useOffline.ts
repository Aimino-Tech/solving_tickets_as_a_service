import { useState, useEffect, useCallback } from 'react';
import { getCache, isCacheStale, processRetryQueue } from '@/services/offlineService';

export interface OfflineState {
  readonly isOffline: boolean;
  readonly cachedData: <T>(key: string) => T | null;
  readonly isStale: (key: string) => boolean;
}

export function useOffline(): OfflineState {
  const [isOffline, setIsOffline] = useState(() => !navigator.onLine);

  useEffect(() => {
    const handleOnline = () => {
      setIsOffline(false);
      processRetryQueue();
    };

    const handleOffline = () => {
      setIsOffline(true);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const cachedData = useCallback(<T,>(key: string): T | null => {
    return getCache<T>(key);
  }, []);

  const isStale = useCallback((key: string): boolean => {
    return isCacheStale(key);
  }, []);

  return { isOffline, cachedData, isStale };
}
