import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[ErrorBoundary] Caught render error:', error, errorInfo);
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          padding: '2rem',
          fontFamily: 'system-ui, sans-serif',
          color: '#374151',
        }}>
          <div style={{
            fontSize: '3rem',
            marginBottom: '1rem',
          }}>⚠</div>
          <h1 style={{
            fontSize: '1.5rem',
            fontWeight: 600,
            marginBottom: '0.5rem',
          }}>
            Something went wrong
          </h1>
          <p style={{
            fontSize: '0.875rem',
            color: '#6b7280',
            marginBottom: '1.5rem',
            textAlign: 'center',
            maxWidth: '400px',
          }}>
            The dashboard encountered an unexpected error. Please try again.
          </p>
          <button
            onClick={this.handleRetry}
            style={{
              padding: '0.5rem 1.25rem',
              fontSize: '0.875rem',
              fontWeight: 500,
              color: '#fff',
              backgroundColor: '#4f46e5',
              border: 'none',
              borderRadius: '0.375rem',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
          {this.state.error && (
            <details style={{
              marginTop: '1.5rem',
              fontSize: '0.75rem',
              color: '#9ca3af',
              maxWidth: '500px',
            }}>
              <summary>Error details</summary>
              <pre style={{
                marginTop: '0.5rem',
                padding: '0.75rem',
                backgroundColor: '#f9fafb',
                borderRadius: '0.25rem',
                overflowX: 'auto',
                whiteSpace: 'pre-wrap',
              }}>
                {this.state.error.message}
                {this.state.error.stack ? `\n\n${this.state.error.stack}` : ''}
              </pre>
            </details>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
