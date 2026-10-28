import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

async function start() {
  // Fictional fixtures for documentation and UI tests; never enabled in production builds.
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('demo')) {
    const { setupDemo } = await import('./demo');
    setupDemo();
  }
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void start();
