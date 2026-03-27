import Debug from 'debug';
import React from 'react';
import ReactDOM from 'react-dom/client';
import './vscode-mantine-bridge.css';
import './index.css';
import App from './components/base/App';
import reportWebVitals from './reportWebVitals';

declare const NOTETHINK_DEV: boolean | undefined;

// enable debug logging in dev mode; the webview iframe has its own localStorage
// so setting localStorage.debug in the VS Code dev tools 'top' frame has no effect
if (typeof NOTETHINK_DEV !== 'undefined' && NOTETHINK_DEV) {
    Debug.enable('nodejs:*');
}

// This is a placeholder file only
// The actual HTML is generated dynamically in the client/extension/src/extension.ts file

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
