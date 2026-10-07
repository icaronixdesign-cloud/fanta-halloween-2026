import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/archivo/wdth.css';
import '@fontsource-variable/jetbrains-mono/index.css';
import './styles/base.css';
import './styles/media.css';
import './styles/sections.css';
import './styles/jack-hero.css';
import './styles/final-shelf.css';
import { App } from './App';

const root = document.getElementById('root');
if (!root) throw new Error('Elemento #root ausente');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
