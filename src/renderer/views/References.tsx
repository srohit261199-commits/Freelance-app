import { useState } from 'react';
import type { AppState, CompanyId, Model } from '../../shared/types';
import type { ReferenceResult } from '../../shared/api';
import { clientFolder, withFolder } from '../../shared/assets';
import { hub } from '../hub';
import { Icon, useApp } from '../ui';

/** The client's output folder, asking for one the first time. */
export async function outputFolder(state: AppState, company: CompanyId): Promise<string | null> {
  const have = clientFolder(state, company);
  if (have) return have;
  const cfg = state.companies.find(c => c.id === company);
  const p = await hub.pickFolder();
  if (!p || !cfg) return null;
  await hub.upsert('companies', { ...withFolder(cfg, p) });
  return p;
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** One line about a download: what was saved, what was already there, what failed and why. */
export function downloadSummary(results: ReferenceResult[], errors: string[]): { text: string; bad: boolean } {
  const saved = results.reduce((t, r) => t + r.saved, 0);
  const skipped = results.reduce((t, r) => t + r.skipped, 0);
  const failed = results.flatMap(r => r.failed);
  const where = results.length === 1 ? ` to ${results[0].folder.split(/[\\/]/).pop()}` : results.length ? ` for ${plural(results.length, 'model')}` : '';
  const bits = [
    saved && `Saved ${plural(saved, 'image')}${where}`,
    skipped && `${skipped} already there`,
    failed.length && `${failed.length} couldn't be downloaded (${[...new Set(failed.map(f => f.error))].slice(0, 2).join(', ')})`,
    ...errors,
  ].filter(Boolean);
  return { text: bits.join(' · ') || 'Nothing to download', bad: !saved && (failed.length > 0 || errors.length > 0) };
}

/**
 * Download images for one or more models, one after another, into "<output folder>/<Code - Name>/". Returns a runner
 * and the progress ("3 of 10") while it works.
 */
export function useReferenceDownload(state: AppState) {
  const { toast } = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (models: Pick<Model, 'id' | 'company' | 'code' | 'name' | 'sourceUrls'>[]) => {
    const withLinks = models.filter(m => m.sourceUrls?.length);
    if (!withLinks.length) return toast(models.length === 1 ? 'This model has no image links in the catalog.' : 'None of these models have image links in the catalog.', 'error');
    if (!(await outputFolder(state, withLinks[0].company))) return;
    const results: ReferenceResult[] = [];
    const errors: string[] = [];
    for (const [i, m] of withLinks.entries()) {
      setBusy(withLinks.length > 1 ? `${i + 1} of ${withLinks.length}` : 'Downloading…');
      const r = await hub.downloadReferences(m.id);
      if ('error' in r) errors.push(`${m.code ?? m.name}: ${r.error}`);
      else results.push(r);
    }
    setBusy(null);
    const s = downloadSummary(results, errors.slice(0, 2));
    toast(s.text, s.bad ? 'error' : 'ok');
  };
  return { run, busy };
}

/** The model panel's image buttons: download the catalog images, then open the model's folder. */
export function ReferenceButtons({ m, state }: { m: Model; state: AppState }) {
  const { run, busy } = useReferenceDownload(state);
  const n = m.sourceUrls?.length ?? 0;
  return (
    <>
      <button
        type="button"
        disabled={!n || !!busy}
        onClick={() => run([m])}
        title={n ? `Save the ${plural(n, 'catalog image')} into the output folder, in a folder named after this model` : 'No image links in the catalog for this model'}
      >
        <Icon name="download" size={16} />
        {busy ?? `Download images${n ? ` (${n})` : ''}`}
      </button>
      {m.outputFolder && (
        <button type="button" className="icon-btn" aria-label="Open the model's folder" title={m.outputFolder} onClick={() => hub.openPath(m.outputFolder!)}>
          <Icon name="folderOpen" size={16} />
        </button>
      )}
    </>
  );
}
