import { type ReactNode } from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '@/i18n/I18nProvider';

interface WrapperOptions {
  initialEntries?: string[];
}

function AllTheProviders({ children, initialEntries }: { children: ReactNode; initialEntries?: string[] }) {
  return (
    <MemoryRouter initialEntries={initialEntries}>
      <I18nProvider>
        {children}
      </I18nProvider>
    </MemoryRouter>
  );
}

export function renderWithProviders(
  ui: ReactNode,
  options?: WrapperOptions & Omit<RenderOptions, 'wrapper'>,
) {
  const { initialEntries, ...renderOptions } = options ?? {};
  return render(ui, {
    wrapper: ({ children }) => (
      <AllTheProviders initialEntries={initialEntries}>
        {children}
      </AllTheProviders>
    ),
    ...renderOptions,
  });
}

export function deferredPromise<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}
