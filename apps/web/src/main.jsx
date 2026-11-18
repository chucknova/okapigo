// @ts-check
/**
 * Entry point: loads the styles (tokens first, so components can use them) and mounts the
 * app into <div id="root">.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/screens.css';
import './styles/checkout.css';
import './styles/after.css';
import './styles/trip.css';
import './styles/site.css';
import { App } from './App.jsx';
import { startPreview } from './lib/look.js';

// ?style=earth&mode=dark on any address previews another website style (lib/look.js).
startPreview(location.search);

const root = /** @type {HTMLElement} */ (document.getElementById('root'));
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
