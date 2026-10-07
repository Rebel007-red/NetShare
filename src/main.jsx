import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './app.css';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Registered in production only: in development a service worker would sit in
// front of Vite's module requests and make changes look stuck.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}
