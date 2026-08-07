import { useState, useCallback, useRef } from 'react';

const COPIED_TIMEOUT_MS = 2000;

interface UseCopyClipboardReturn {
  copied: boolean;
  copy: (text: string) => Promise<boolean>;
}

export function useCopyClipboard(): UseCopyClipboardReturn {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = useCallback(async (text: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), COPIED_TIMEOUT_MS);
      return true;
    } catch {
      // Clipboard API unavailable (non-secure context) — fall back to prompt
      window.prompt('Copy your referral link:', text);
      return false;
    }
  }, []);

  return { copied, copy };
}
