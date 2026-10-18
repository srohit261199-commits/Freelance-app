import { useEffect, useState } from 'react';
import type { AppState, AssetFile, CompanyId } from '../../shared/types';
import { clientFolder, withFolder } from '../../shared/assets';
import { hub, useNow } from '../hub';
import { Icon, relTime, useApp, type IconName } from '../ui';
import './AssetsPanel.css';

const GROUPS: { kind: AssetFile['kind']; label: string; icon: IconName }[] = [
  { kind: 'sheet', label: 'Sheets', icon: 'table' },
  { kind: 'image', label: 'Photos & images', icon: 'image' },
  { kind: 'pdf', label: 'PDFs', icon: 'filePdf' },
  { kind: 'model', label: '3D files', icon: 'cube' },
  { kind: 'doc', label: 'Documents', icon: 'clipboard' },
  { kind: 'archive', label: 'Archives', icon: 'folder' },
  { kind: 'other', label: 'Other', icon: 'dots' },
];

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/** A local image's preview, loaded through the main process (the window can't read files directly). */
export function LocalThumb({ path, alt = '', className = '' }: { path?: string; alt?: string; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!path) return;
    let live = true;
    void hub.thumbnail(path, 256).then(url => live && setSrc(url));
    return () => {
      live = false;
    };
  }, [path]);
  return src ? <img className={className} src={src} alt={alt} /> : <span className={`${className} ph`} aria-hidden="true"><Icon name="image" size={18} /></span>;
}

/**
 * Files in the client's watched folder (or one job's folder), grouped by type, each opening in its own app.
 * bare drops the panel box, for a section inside another panel.
 */
export function AssetsPanel({ state, company, folder, title = 'Files', bare }: { state: AppState; company: CompanyId; folder?: string; title?: string; bare?: boolean }) {
  const { toast } = useApp();
  const now = useNow();
  const cfg = state.companies.find(c => c.id === company);
  const root = folder ?? clientFolder(state, company);
  const [files, setFiles] = useState<AssetFile[] | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!root) return;
    let live = true;
    setError('');
    void hub.listAssets(root).then(r => {
      if (!live) return;
      if ('error' in r) {
        setFiles(null);
        setError(r.error);
      } else setFiles(r.sort((a, b) => b.modified.localeCompare(a.modified)));
    });
    return () => {
      live = false;
    };
  }, [root, tick]);

  const link = async () => {
    if (!cfg) return;
    const p = await hub.pickFolder(cfg.folder || undefined);
    if (!p) return;
    await hub.upsert('companies', { ...withFolder(cfg, p) });
    if (company === 'skeidar') await hub.patchSettings({ skeidarFolder: p });
    toast(`${cfg.name} now reads files from ${p}`);
  };

  const box = `ap ${bare ? 'ap-bare' : 'panel'}`;
  if (!root) {
    return (
      <section className={box} aria-label={title}>
        <h3>{title}</h3>
        <p className="ap-empty">Link the folder with {cfg?.name ?? 'this client'}’s sheets, briefs, photos and 3D files to list them here.</p>
        <button type="button" className="mini ap-link" onClick={link}>
          <Icon name="folder" size={14} /> Link a folder
        </button>
      </section>
    );
  }

  const groups = GROUPS.map(g => ({ ...g, files: (files ?? []).filter(f => f.kind === g.kind) })).filter(g => g.files.length);
  return (
    <section className={box} aria-label={title}>
      <div className="ap-head">
        <div className="grow">
          <h3>{title}</h3>
          <button type="button" className="link-btn ap-path" title="Open the folder" onClick={() => hub.openPath(root)}>
            {root}
          </button>
        </div>
        <button type="button" className="icon-btn mini ghost" aria-label="Refresh the file list" title="Refresh" onClick={() => setTick(t => t + 1)}>
          <Icon name="sync" size={16} />
        </button>
        {!folder && (
          <button type="button" className="mini" onClick={link}>
            Change
          </button>
        )}
      </div>
      {error && <p className="small warn-text">{error}</p>}
      {files && !files.length && !error && <p className="small muted">The folder is empty.</p>}
      {groups.map(g => {
        const all = open[g.kind] || g.files.length <= 6;
        return (
          <div key={g.kind} className="ap-group">
            <h4>
              {g.label} <span className="ap-n">{g.files.length}</span>
            </h4>
            <ul>
              {(all ? g.files : g.files.slice(0, 5)).map(f => (
                <li key={f.path}>
                  <button type="button" className="ap-file" title={`Open ${f.rel}`} onClick={() => hub.openPath(f.path)}>
                    {g.kind === 'image' ? (
                      <LocalThumb path={f.path} className="ap-thumb" />
                    ) : (
                      <span className={`ap-ic k-${g.kind}`} aria-hidden="true">
                        <Icon name={g.icon} size={15} />
                      </span>
                    )}
                    <span className="ap-txt">
                      <b className="ellipsis">{f.name}</b>
                      <small className="ellipsis">
                        {f.rel.includes('\\') || f.rel.includes('/') ? `${f.rel.split(/[\\/]/).slice(0, -1).join('/')} · ` : ''}
                        {size(f.size)} · {relTime(f.modified, now)}
                      </small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {!all && (
              <button type="button" className="ghost mini" onClick={() => setOpen(o => ({ ...o, [g.kind]: true }))}>
                Show all {g.files.length}
              </button>
            )}
          </div>
        );
      })}
    </section>
  );
}
