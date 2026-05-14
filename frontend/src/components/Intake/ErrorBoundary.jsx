import React from 'react';

/**
 * Error Boundary for SubmitWillPage
 * 
 * Catches JavaScript errors in child components and displays a fallback UI.
 * Also catches network errors and displays appropriate user feedback.
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    // Update state so the next render will show the fallback UI.
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // Log the error to an error reporting service
    console.error('SubmitWillPage Error Boundary caught an error:', error, errorInfo);
    this.setState({ error, errorInfo });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      const isNetworkError = this.state.error?.message?.includes('Failed to fetch') ||
                          this.state.error?.message?.includes('Network Error') ||
                          this.state.error?.name === 'TypeError';

      return (
        <div className="page" style={{ maxWidth: 600, margin: '0 auto', padding: '2rem' }}>
          <div className="state err">⚠ Document submission failed</div>
          
          <div style={{ 
            fontFamily: 'monospace', 
            fontSize: '0.85rem', 
            color: '#e0e0e0', 
            marginTop: '1.5rem',
            padding: '1rem',
            backgroundColor: 'rgba(255, 0, 0, 0.1)',
            border: '1px solid rgba(255, 0, 0, 0.3)',
            borderRadius: '4px'
          }}>
            {isNetworkError ? (
              <div>
                <p><strong>Network Error</strong></p>
                <p>Unable to connect to the server. Please check your internet connection and try again.</p>
                <p style={{ color: '#888', fontSize: '0.75rem', marginTop: '0.5rem' }}>
                  Error: {this.state.error.message}
                </p>
              </div>
            ) : (
              <div>
                <p><strong>Application Error</strong></p>
                <p>An unexpected error occurred while processing your document.</p>
                <p style={{ color: '#888', fontSize: '0.75rem', marginTop: '0.5rem' }}>
                  {this.state.error?.message || 'Unknown error'}
                </p>
              </div>
            )}
          </div>

          <div style={{ marginTop: '2rem', display: 'flex', gap: '1rem' }}>
            <button 
              className="btn" 
              onClick={handleReset}
            >
              Try Again
            </button>
            <Link to="/" className="btn" style={{ textDecoration: 'none' }}>
              ← Back to Search
            </Link>
          </div>

          {process.env.NODE_ENV === 'development' && (
            <details style={{ 
              marginTop: '2rem', 
              fontFamily: 'monospace', 
              fontSize: '0.75rem', 
              color: '#888' 
            }}>
              <summary style={{ cursor: 'pointer', color: '#e0e0e0' }}>
                Error Details (Development Mode)
              </summary>
              <pre style={{ 
                whiteSpace: 'pre-wrap', 
                wordBreak: 'break-all',
                marginTop: '0.5rem',
                padding: '0.5rem',
                backgroundColor: 'rgba(0, 0, 0, 0.3)',
                borderRadius: '4px',
                overflow: 'auto'
              }}>
                {this.state.error?.stack}
                {this.state.errorInfo?.componentStack}
              </pre>
            </details>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;