import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import { requestPersistentStorage } from './storage/opfs';
import './index.css';

// Register the PWA service worker so the app launches 100% offline from the iPad Home Screen
registerSW({ immediate: true });

// Ask iPadOS / Safari to protect our local IndexedDB & OPFS data from automatic cleanup
void requestPersistentStorage();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
