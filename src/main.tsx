import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';

// Registered as early as possible (before React even mounts) and in the capture phase, so
// nothing else can observe/act on the event first: Chrome/Firefox represent both trackpad
// pinch-to-zoom and Ctrl+mouse-wheel as a 'wheel' event with ctrlKey set, and the browser
// zooms the whole page/UI unless that event's default is prevented. The editor has its own
// canvas zoom (mouse wheel, or the Lupa/Z tool) and doesn't need the browser's page zoom.
window.addEventListener('wheel', (e) => {
  if (e.ctrlKey || e.metaKey) e.preventDefault();
}, { passive: false, capture: true });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
