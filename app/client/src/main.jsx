import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './lib/AuthContext.jsx';
import './styles.css';
import { installErrorReporting } from './lib/reportError.js';
import { register as registerPwa } from './lib/pwa.js';

// Before anything renders, so a fault during the first render is still heard.
installErrorReporting();

// The service worker and the install offer. Both are listeners and a
// registration — nothing is fetched or prompted here, so this cannot slow the
// first paint. See lib/pwa.js, and public/sw.js for what is and is not cached.
registerPwa();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
