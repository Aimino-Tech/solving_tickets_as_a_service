import { Component, type ErrorInfo, type ReactNode, createRef } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  retryKey: number;
}

function logError(error: Error, errorInfo: ErrorInfo): void {
  const timestamp = new Date().toISOString();
  const entry = {
    timestamp,
    message: error.message,
    stack: error.stack,
    componentStack: errorInfo.componentStack,
  };

  console.groupCollapsed(`%c[ErrorBoundary] ${timestamp}`, 'color: #ef4444; font-weight: bold');
  console.error('Error:', error.message);
  console.error('Stack:', error.stack);
  console.error('Component stack:', errorInfo.componentStack);
  console.groupEnd();

  try {
    const LOG_KEY = 'stas:error-boundary-log';
    const existing: unknown[] = JSON.parse(localStorage.getItem(LOG_KEY) ?? '[]');
    existing.push(entry);
    localStorage.setItem(LOG_KEY, JSON.stringify(existing.slice(-20)));
  } catch {
  }
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, retryKey: 0 };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error, retryKey: 0 };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    logError(error, errorInfo);
  }

  handleRetry = (): void => {
    this.setState((prev) => ({ hasError: false, error: null, retryKey: prev.retryKey + 1 }));
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 dark:bg-gray-900 p-6">
          <div className="w-full max-w-md rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-8 shadow-sm text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
              <svg
                className="h-7 w-7 text-red-600 dark:text-red-400"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
                />
              </svg>
            </div>

            <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">
              Something went wrong
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 max-w-xs mx-auto">
              The dashboard encountered an unexpected error. You can try again or check the details below.
            </p>

            <button
              onClick={this.handleRetry}
              className="btn-primary"
            >
              <svg
                className="mr-2 h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182"
                />
              </svg>
              Try again
            </button>

            {this.state.error && (
              <details className="mt-6 text-left group">
                <summary className="cursor-pointer text-xs font-medium text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 select-none">
                  Error details
                </summary>
                <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-3 text-xs text-gray-600 dark:text-gray-400 whitespace-pre-wrap break-words">
                  {this.state.error.message}
                  {this.state.error.stack ? `\n\n${this.state.error.stack}` : ''}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }

    return <div key={this.state.retryKey}>{this.props.children}</div>;
  }
}
