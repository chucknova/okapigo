// @ts-check
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';
import { EngineContext } from './lib/engine.jsx';
import { createSyncEngine } from './lib/sync.js';
import { createIdbStore } from './lib/store.js';
import { request } from './lib/api.js';
import { listenForInstall } from './lib/install.js';
import './styles/tokens.css';
import './styles/base.css';
import './styles/app.css';

listenForInstall();

// The service worker makes the app open with no signal (public/sw.js). Only in a build:
// in development it would serve stale files while you edit.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('/app/sw.js', { scope: '/app/' }).catch(() => {});
}

const engine = createSyncEngine({ request, store: createIdbStore() });
engine.load().then(() => engine.sync());

createRoot(/** @type {HTMLElement} */ (document.getElementById('root'))).render(
  <StrictMode>
    <EngineContext.Provider value={engine}>
      <App />
    </EngineContext.Provider>
  </StrictMode>,
);
