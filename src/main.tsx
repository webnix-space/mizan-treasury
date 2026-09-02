import { Buffer } from 'buffer';

// Expose Buffer globally for Midnight ledger codecs & indexer serializers
if (typeof window !== 'undefined') {
  (window as any).Buffer = Buffer;
  (window as any).global = window;
}
if (typeof globalThis !== 'undefined') {
  (globalThis as any).Buffer = Buffer;
}

import React from 'react';
import ReactDOM from 'react-dom/client';
import DeployPage from './DeployPage';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <DeployPage />
  </React.StrictMode>
);
