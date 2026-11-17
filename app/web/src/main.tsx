import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './mvp/mvp.css';
import './v2/v2.css';
import './v2/controls.css';
import './v2/workspace.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
