import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
// Loaded after index.css so the feature styles can override the base layout.
import './styles/features.css';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
