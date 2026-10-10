// mockHub installs window.hub, so it must load before anything that imports the app.
import { onNotice, resetPreview } from './mockHub';
import '../renderer/fonts.css';
import '../renderer/styles.css';
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../renderer/App';
import { ConfirmButton } from '../renderer/ui';
import './preview.css';

function PreviewBar() {
  const [note, setNote] = useState<{ text: string; link?: string } | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => onNotice((text, link) => setNote({ text, link })), []);
  // Dialogs dim the app below this banner, so tell the app's CSS how tall it is.
  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    const set = () => document.documentElement.style.setProperty('--app-top', `${el.offsetHeight}px`);
    const ro = new ResizeObserver(set);
    ro.observe(el);
    set();
    return () => ro.disconnect();
  }, []);
  return (
    <div className="preview-bar" ref={bar}>
      <div className="pv-main">
        <strong>Browser preview</strong>
        <span>
          Your Waveink catalog, pay terms and subscriptions are real. Google sign-in, the MetaZtech portal and folder scans are simulated; sign-in loads a snapshot of your mail and calendar from
          9 Oct. Changes stay in this browser.
        </span>
        <ConfirmButton className="mini" label="Reset preview" confirmLabel="Click again to reset" onConfirm={resetPreview} />
      </div>
      {note && (
        <div className="pv-note" role="status">
          <span>
            {note.text}{' '}
            {note.link && (
              <a href={note.link} target="_blank" rel="noopener noreferrer">
                {note.link}
              </a>
            )}
          </span>
          <button type="button" className="mini ghost" onClick={() => setNote(null)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <>
    <PreviewBar />
    <div className="preview-app">
      <App />
    </div>
  </>,
);
