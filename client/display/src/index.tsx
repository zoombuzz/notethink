import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './components/base/App';
import reportWebVitals from './reportWebVitals';

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
