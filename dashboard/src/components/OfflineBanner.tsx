import { useState, useEffect } from 'react';

interface OfflineBannerProps {
  readonly isOffline: boolean;
}

export function OfflineBanner({ isOffline }: OfflineBannerProps) {
  const [visible, setVisible] = useState(isOffline);

  useEffect(() => {
    setVisible(isOffline);
  }, [isOffline]);

  if (!visible) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-yellow-500 dark:bg-yellow-600 text-white px-4 py-2 text-center text-sm font-medium shadow-md transition-all duration-300">
      <div className="flex items-center justify-center gap-2">
        <svg
          className="w-4 h-4 flex-shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
          />
        </svg>
        <span>You are offline. Showing cached data.</span>
        <button
          onClick={() => setVisible(false)}
          className="ml-2 text-yellow-100 hover:text-white transition-colors"
          aria-label="Dismiss offline notification"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
