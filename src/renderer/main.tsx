// Global styles first, so each screen's own stylesheet can override them.
import './fonts.css';
import './styles.css';
import { createRoot } from 'react-dom/client';
import { App } from './App';

createRoot(document.getElementById('root')!).render(<App />);
