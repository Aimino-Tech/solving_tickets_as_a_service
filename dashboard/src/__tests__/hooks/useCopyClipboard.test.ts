import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCopyClipboard } from '@/hooks/useCopyClipboard';

describe('useCopyClipboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('copies text to clipboard and sets copied state', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    const { result } = renderHook(() => useCopyClipboard());

    await act(async () => {
      const ok = await result.current.copy('https://example.com');
      expect(ok).toBe(true);
    });

    expect(writeText).toHaveBeenCalledWith('https://example.com');
    expect(result.current.copied).toBe(true);
  });

  it('resets copied state after timeout', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    const { result } = renderHook(() => useCopyClipboard());

    await act(async () => {
      await result.current.copy('https://example.com');
    });

    expect(result.current.copied).toBe(true);

    act(() => {
      vi.advanceTimersByTime(2100);
    });

    expect(result.current.copied).toBe(false);
    vi.useRealTimers();
  });

  it('falls back to prompt when clipboard unavailable', async () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue(null);
    Object.assign(navigator, { clipboard: { writeText: undefined } });

    const { result } = renderHook(() => useCopyClipboard());

    await act(async () => {
      const ok = await result.current.copy('https://example.com');
      expect(ok).toBe(false);
    });

    expect(promptSpy).toHaveBeenCalledWith('Copy your referral link:', 'https://example.com');
    expect(result.current.copied).toBe(false);
  });
});
