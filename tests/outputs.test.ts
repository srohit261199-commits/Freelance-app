import { describe, expect, it } from 'vitest';
import { initialState } from '../src/main/seed/initial';
import { applySppFolders, imageExt, jobIdOf, modelFolderName, recordPull, referenceStem, safeName, type SppFolder } from '../src/shared/outputs';
import type { AppState, Model } from '../src/shared/types';

const NOW = '2026-10-18T10:00:00.000Z';

describe('Waveink reference folders', () => {
  it('names the folder "Code - Name", safe for Windows', () => {
    expect(modelFolderName({ code: 'ITCC 701', name: 'FYCAR - @memorii Car Charger With Bluetooth Earbud' })).toBe('ITCC 701 - FYCAR - @memorii Car Charger With Bluetooth Earbud');
    expect(modelFolderName({ code: 'ITCC 7', name: 'ITCC 7 Speaker' })).toBe('ITCC 7 Speaker');
    expect(modelFolderName({ name: 'Tote: "Big"/Small?' })).toBe('Tote- -Big-Small-');
    expect(safeName('CON')).toBe('CON_');
    expect(safeName('name. . ')).toBe('name');
    expect(modelFolderName({ code: 'X1', name: 'a'.repeat(300) }).length).toBeLessThanOrEqual(120);
  });

  it('numbers the images and keeps their real type', () => {
    expect(referenceStem({ code: 'ITCC 701', name: 'FYCAR' }, 0)).toBe('ITCC 701 - 01');
    expect(referenceStem({ name: 'Mug' }, 11)).toBe('Mug - 12');
    expect(imageExt('image/png', 'https://x/y')).toBe('.png');
    expect(imageExt('image/jpeg; charset=binary', 'https://x/y')).toBe('.jpg');
    expect(imageExt(null, 'https://www.jasani.ae/web/image/product.image/435/image_1920?unique=4df3bd0')).toBe('.jpg');
    expect(imageExt('', 'https://cdn.x/a/photo.WEBP?v=2')).toBe('.webp');
  });
});

describe('MetaZtech job folders', () => {
  it('reads the job ID a folder starts with', () => {
    expect(jobIdOf('MZ-2318 Ergonomic mesh office chair', ['MZ-23', 'MZ-2318'])).toBe('MZ-2318');
    expect(jobIdOf('12345 - Office chair')).toBe('12345');
    expect(jobIdOf('A-77_sofa')).toBe('A-77');
    expect(jobIdOf('Office chair')).toBeUndefined();
  });

  const state = (): AppState => {
    const s = initialState(NOW);
    s.models = s.models.filter(m => m.company !== 'metaztech');
    const mz = (code: string, name: string, status: Model['status']): Model => ({
      id: `m-${code}`,
      company: 'metaztech',
      code,
      name,
      status,
      complexity: 'simple',
      source: 'portal',
      createdAt: NOW,
      updatedAt: NOW,
      history: [],
    });
    s.models.push(mz('MZ-2318', 'Ergonomic mesh office chair', 'review'), mz('MZ-2325', 'Rattan lounge chair', 'review'), mz('MZ-2330', 'Bar stool', 'in_progress'));
    s.settings.portalLastPull = { at: '2026-10-17T09:00:00.000Z', codes: ['MZ-2325', 'MZ-2330'] };
    return s;
  };
  const folder = (name: string, spp = true): SppFolder => ({ name, path: `E:\\MZ\\${name}`, ...(spp ? { spp: `E:\\MZ\\${name}\\${name.split(' ')[0]}.spp`, sppModified: NOW } : {}) });

  it('approves a job that left the dashboard when its .spp is in the output folder', () => {
    const s = state();
    const r = applySppFolders(s, [folder('MZ-2318 Ergonomic mesh office chair'), folder('MZ-2325 Rattan lounge chair'), folder('MZ-2330 Bar stool', false)], NOW);
    expect(r).toMatchObject({ approved: ['Ergonomic mesh office chair'], created: [], onDashboard: 1 });
    const m = s.models.find(x => x.code === 'MZ-2318')!;
    expect(m).toMatchObject({ status: 'done', completedAt: '2026-10-17T09:00:00.000Z', completedAtApprox: true, outputFolder: 'E:\\MZ\\MZ-2318 Ergonomic mesh office chair' });
    expect(m.history?.at(-1)?.note).toMatch(/Not on the MetaZtech dashboard/);
    expect(s.models.find(x => x.code === 'MZ-2325')!.status).toBe('review');
    // Running it again changes nothing.
    expect(applySppFolders(s, [folder('MZ-2318 Ergonomic mesh office chair')], NOW).approved).toEqual([]);
  });

  it('adds a delivered job the app never had', () => {
    const s = state();
    const r = applySppFolders(s, [folder('MZ-2290 - Walnut side table')], NOW);
    expect(r.created).toEqual(['Walnut side table']);
    expect(s.models.find(x => x.code === 'MZ-2290')).toMatchObject({ company: 'metaztech', name: 'Walnut side table', status: 'done', source: 'folder' });
  });

  it('decides nothing before the first full dashboard pull', () => {
    const s = state();
    delete s.settings.portalLastPull;
    expect(applySppFolders(s, [folder('MZ-2318 Ergonomic mesh office chair')], NOW)).toMatchObject({ needsPull: true, approved: [] });
    expect(s.models.find(x => x.code === 'MZ-2318')!.status).toBe('review');
  });
});

describe('recording a dashboard pull', () => {
  it('keeps the job IDs of a full pull', () => {
    const s = initialState(NOW);
    expect(recordPull(s, [{ code: 'MZ-1' }, { code: 'MZ-2' }, { code: ' MZ-3 ' }], NOW)).toBe(true);
    expect(s.settings.portalLastPull).toEqual({ at: NOW, codes: ['MZ-1', 'MZ-2', 'MZ-3'] });
  });
  it('ignores a table without job IDs, so nothing is approved by mistake', () => {
    const s = initialState(NOW);
    expect(recordPull(s, [{ code: 'MZ-1' }, {}, {}], NOW)).toBe(false);
    expect(recordPull(s, [], NOW)).toBe(false);
    expect(s.settings.portalLastPull).toBeUndefined();
  });
});
