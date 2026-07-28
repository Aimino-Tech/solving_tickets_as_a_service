import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from '@/context/AuthContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { I18nProvider } from '@/i18n/I18nProvider';
import { OfflineBanner } from '@/components/OfflineBanner';
import { useOffline } from '@/hooks/useOffline';
import App from '@/App';
import '@/styles/index.css';

function OfflineWrapper() {
  const { isOffline } = useOffline();

  return (
    <>
      <OfflineBanner isOffline={isOffline} />
      <App />
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <BrowserRouter basename="/dashboard">
        <I18nProvider>
          <AuthProvider>
            <OfflineWrapper />
          </AuthProvider>
        </I18nProvider>
      </BrowserRouter>
    </ThemeProvider>
  </React.StrictMode>,
);
