import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import pearLogoUrl from '../assets/favicon.png';

const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]') ?? document.createElement('link');
favicon.rel = 'icon';
favicon.type = 'image/png';
favicon.href = pearLogoUrl;
document.head.appendChild(favicon);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
