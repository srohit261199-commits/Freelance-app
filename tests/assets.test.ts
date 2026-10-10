import { describe, expect, it } from 'vitest';
import { initialState } from '../src/main/seed/initial';
import {
  applyJobFolders,
  classifyJobFiles,
  fileKind,
  jobFromFolder,
  masterLabel,
  matchOutput,
  parseCsv,
  parseProductSheet,
  promptFor,
  promptList,
  sortMasters,
  suggestedFileName,
} from '../src/shared/assets';
import { jobOutputs } from '../src/shared/money';
import { JUSTIN_SHEET } from '../src/preview/sampleJob';
import type { AssetFile, JobFolderInfo, SkeidarJob } from '../src/shared/types';

const NOW = '2026-10-10T10:00:00.000Z';
const DIR = 'D:\\Files\\Projects\\Skediar\\genrativeAI\\Justin stol';

const file = (rel: string, size = 1000): AssetFile => {
  const name = rel.split('\\').pop()!;
  return { path: `${DIR}\\${rel}`, name, rel, kind: fileKind(name), size, modified: NOW };
};

/** Mirrors the supplier template: header, two instruction rows, then one row per fabric × leg finish. */
const SYNTHETIC = [
  ['ItemId', 'ItemName', 'Txt', 'ExternalItemId', 'ExternalItemTxt', 'itemBarCode'],
  ['Supplier do NOT  fill grey or purple maked colomns - only yellow!', 'Do not fill\n\nItemname', 'Do not fill\n\nItem desciption', 'Suppliers complete item number', 'Suppliers item description', null],
  ['Varenummer', 'Varenavn', 'Beskrivende tekst for varen.', 'Eksternt varenummer.', 'Leverandørs varebeskrivelse', null],
  ['1398517', 'Justin stol', 'Tekstil Kiara 851 Beige med sortre ben', '6JST1S000BP1P', 'Justin 1s - A12+70+A12 Kiara 851 Beige W31 black wood legs ', null],
  [1398518, 'Justin stol', 'Tekstil Kiara 862 Grønn  med sortre ben', '6JST1S000BP1P', 'Justin 1s - A12+70+A12 Kiara 862 Grønn W31 black wood legs ', null],
  ['1398556', 'Justin stol', 'Tekstil Kiara 851 Beige med hvite eikeben', '6JST1S000BP1P', 'Justin 1s - A12+70+A12 Kiara 851 Beige W31 white oak wood legs', null],
  ['1398559', 'Justin stol', 'Tekstil Kiara 862 Grønn  med hvite eikeben', '6JST1S000BP1P', 'Justin 1s - A12+70+A12 Kiara 862 Grønn W31 white oak wood legs', null],
  ['1398595', 'Justin stol', 'Tekstil Kiara 851 Beige med røkt eikeben', '6JST1S000BP1P', 'Justin 1s - A12+70+A12 Kiara 851 Beige W31 Smoked oak wood legs ', null],
  ['1398598', 'Justin stol', 'Tekstil Kiara 862 Grønn  med røkt eikeben', '6JST1S000BP1P', 'Justin 1s - A12+70+A12 Kiara 862 Grønn W31 Smoked oak wood legs', null],
  [null, null, null, null, null, null],
];

const MASTERS = ['Justin stol - front.jpg', 'Justin stol - back.jpg', 'Justin stol - 3-4.jpg'];

function info(outputs: string[] = [], rows: (string | number | null)[][] = JUSTIN_SHEET): JobFolderInfo {
  const files = [file('Justin_stol.xlsx'), ...MASTERS.map(m => file(m)), ...outputs.map(o => file(`output\\${o}`))];
  const { masters, outputs: out } = classifyJobFiles(files);
  return { folder: DIR, name: 'Justin stol', files, masters, outputs: out, sheet: parseProductSheet(rows, `${DIR}\\Justin_stol.xlsx`) };
}

const justin = (): SkeidarJob => ({ id: 'sk-1', receivedAt: '2026-10-08', status: 'open', createdAt: NOW, folder: DIR, ...jobFromFolder(info()) });

describe('product sheet', () => {
  it('reads the supplier template: fabrics with every item number, leg finishes as options', () => {
    const s = parseProductSheet(SYNTHETIC, 'x.xlsx');
    expect(s.product).toBe('Justin stol');
    expect(s.variants).toHaveLength(6);
    expect(s.fabrics).toEqual([
      { name: 'Kiara 851 Beige', itemIds: ['1398517', '1398556', '1398595'], options: ['black wood legs', 'white oak wood legs', 'Smoked oak wood legs'] },
      { name: 'Kiara 862 Grønn', itemIds: ['1398518', '1398559', '1398598'], options: ['black wood legs', 'white oak wood legs', 'Smoked oak wood legs'] },
    ]);
    expect(s.warnings).toEqual([]);
  });

  it('falls back to the Norwegian option without the supplier text, and reads Norwegian headers', () => {
    const rows = [
      ['Varenummer', 'Varenavn', 'Beskrivende tekst for varen.'],
      ['1398517', 'Justin stol', 'Tekstil Kiara 851 Beige med sortre ben'],
      ['1398556', 'Justin stol', 'Tekstil Kiara 851 Beige med hvite eikeben'],
      ['1398595', 'Justin stol', 'Tekstil  Kiara 851  Beige med røkt eikeben'],
    ];
    const s = parseProductSheet(rows, 'x.xlsx');
    expect(s.fabrics).toEqual([{ name: 'Kiara 851 Beige', itemIds: ['1398517', '1398556', '1398595'], options: ['sortre ben', 'hvite eikeben', 'røkt eikeben'] }]);
  });

  it('reads the real Justin stol sheet: 117 rows = 39 fabrics × 3 leg finishes', () => {
    const s = parseProductSheet(JUSTIN_SHEET, 'Justin_stol.xlsx');
    expect(s.variants).toHaveLength(117);
    expect(s.fabrics).toHaveLength(39);
    expect(s.fabrics.every(f => f.itemIds.length === 3 && f.options.length === 3)).toBe(true);
    expect(s.fabrics[0]).toEqual({ name: 'Kiara 851 Beige', itemIds: ['1398517', '1398556', '1398595'], options: ['black wood legs', 'white oak wood legs', 'Smoked oak wood legs'] });
    expect(s.fabrics.map(f => f.name)).toContain('Kiara 862 Grønn');
    expect(s.fabrics.map(f => f.name)).toContain('Genesis 10 Golden yellow');
    expect(s.fabrics.flatMap(f => f.itemIds).sort()[116]).toBe('1398633');
  });

  it('reads a plain fabric list, with or without a header', () => {
    const csv = parseCsv('Fabric;Item no\r\n"Bouclé Cream";1001\r\nVelvet Moss;1002\r\n');
    expect(csv).toEqual([['Fabric', 'Item no'], ['Bouclé Cream', '1001'], ['Velvet Moss', '1002']]);
    expect(parseProductSheet(csv, 'f.csv').fabrics).toEqual([
      { name: 'Bouclé Cream', itemIds: ['1001'], options: [] },
      { name: 'Velvet Moss', itemIds: ['1002'], options: [] },
    ]);
    const bare = parseProductSheet(parseCsv('Linen Sand\nChenille Grey\n'), 'f.csv');
    expect(bare.fabrics.map(f => f.name)).toEqual(['Linen Sand', 'Chenille Grey']);
    expect(bare.warnings).toHaveLength(1);
  });
});

describe('job folder files', () => {
  it('sorts files into kinds, masters, outputs and the sheet', () => {
    expect(['a.xlsx', 'b.JPG', 'c.pdf', 'd.glb', 'e.spp', 'f.docx', 'g.zip', 'h.xyz'].map(fileKind)).toEqual(['sheet', 'image', 'pdf', 'model', 'model', 'doc', 'archive', 'other']);
    const files = [file('notes.csv'), file('Justin_stol.xlsx'), file('~$Justin_stol.xlsx'), file('Justin stol - front.jpg'), file('source\\Justin stol - back.png'), file('old\\draft.jpg'), file('Output\\x.png'), file('final\\sub\\y.webp')];
    const c = classifyJobFiles(files);
    expect(c.sheetFile?.name).toBe('Justin_stol.xlsx');
    expect(c.masters.map(f => f.name)).toEqual(['Justin stol - front.jpg', 'Justin stol - back.png']);
    expect(c.outputs.map(f => f.name)).toEqual(['x.png', 'y.webp']);
  });

  it('labels and orders master photos by angle', () => {
    expect(MASTERS.map(m => masterLabel(m, 'Justin stol'))).toEqual(['Front', 'Back', '3/4']);
    expect(masterLabel('Justin_stol_2.jpg', 'Justin stol')).toBe('Photo 2');
    expect(masterLabel('Justin stol studio.jpg', 'Justin stol')).toBe('Studio');
    expect(sortMasters(['c - 3-4.jpg', 'a - back.jpg', 'b - front.jpg'].map(name => ({ name }))).map(f => f.name)).toEqual(['b - front.jpg', 'a - back.jpg', 'c - 3-4.jpg']);
  });
});

describe('matching finished images', () => {
  const job = justin();

  it('builds the job: 39 fabrics × 3 photos = 117 images, legs need no images of their own', () => {
    expect(job.product).toBe('Justin stol');
    expect(job.images).toEqual(['Front', 'Back', '3/4']);
    expect(job.fabrics).toHaveLength(39);
    expect(job.options).toEqual(['black wood legs', 'white oak wood legs', 'Smoked oak wood legs']);
    expect(job.itemIds?.['Kiara 851 Beige']).toEqual(['1398517', '1398556', '1398595']);
    expect(jobOutputs(job)).toEqual({ total: 117, done: 0 });
  });

  it('matches by fabric name in any spelling', () => {
    expect(matchOutput('Justin stol - Kiara 851 Beige - front.jpg', job)).toEqual({ fabricIndex: 0, imageIndex: 0 });
    expect(matchOutput('kiara-851-beige_back.png', job)).toEqual({ fabricIndex: 0, imageIndex: 1 });
    expect(matchOutput('KIARA851 3-4.webp', job)).toEqual({ fabricIndex: 0, imageIndex: 2 });
    expect(matchOutput('Raven 78 Gronn front.png', job)?.fabricIndex).toBe(job.fabrics.indexOf('Raven 78 Grønn'));
    expect(matchOutput('sorella1-ivory front.jpg', job)?.fabricIndex).toBe(job.fabrics.indexOf('Sorella 01 Ivory'));
  });

  it('tells Genesis 1 from Genesis 10', () => {
    expect(matchOutput('genesis 1 ivory front.jpg', job)?.fabricIndex).toBe(job.fabrics.indexOf('Genesis 1 Ivory'));
    expect(matchOutput('genesis-10-golden-yellow front.jpg', job)?.fabricIndex).toBe(job.fabrics.indexOf('Genesis 10 Golden yellow'));
  });

  it('matches by item number, whatever the leg finish', () => {
    expect(matchOutput('1398595_front.png', job)).toEqual({ fabricIndex: 0, imageIndex: 0 });
    expect(matchOutput('1398633 back.jpg', job)).toEqual({ fabricIndex: job.fabrics.indexOf('Genesis 1 Ivory'), imageIndex: 1 });
  });

  it('matches the photo by angle words or the master name', () => {
    const i = (n: string) => matchOutput(`Kiara 855 Taupe ${n}.png`, job)?.imageIndex;
    expect([i('front'), i('rear'), i('three-quarter'), i('34'), i('angle'), i('persp'), i('side'), i('¾')]).toEqual([0, 1, 2, 2, 2, 2, 2, 2]);
    expect(matchOutput('Kiara 855 Taupe.png', job)).toBeNull();
    expect(matchOutput('Justin stol front.png', job)).toBeNull();
    expect(matchOutput('IMG_2041.png', job)).toBeNull();
  });

  it('round-trips every suggested file name', () => {
    expect(suggestedFileName(job, 0, 0)).toBe('Justin stol - Kiara 851 Beige - front.jpg');
    expect(suggestedFileName(job, 0, 2)).toBe('Justin stol - Kiara 851 Beige - 3-4.jpg');
    for (let fi = 0; fi < job.fabrics.length; fi++) for (let ii = 0; ii < 3; ii++) expect(matchOutput(suggestedFileName(job, fi, ii), job)).toEqual({ fabricIndex: fi, imageIndex: ii });
  });

  it('works for jobs made by hand with numbered images', () => {
    const hand = { name: 'Oslo sofa', fabrics: ['Bouclé Cream', 'Velvet Moss'], images: ['Image 1', 'Image 2'] };
    expect(suggestedFileName(hand, 1, 1)).toBe('Oslo sofa - Velvet Moss - image 2.jpg');
    expect(matchOutput('Oslo sofa - Velvet Moss - image 2.jpg', hand)).toEqual({ fabricIndex: 1, imageIndex: 1 });
    expect(matchOutput('boucle cream image1.png', hand)).toEqual({ fabricIndex: 0, imageIndex: 0 });
  });
});

describe('jobs from folders', () => {
  it('ticks images found in the output folder and keeps ticks made by hand', () => {
    const before = justin();
    before.done = { '5:1': true };
    const next = jobFromFolder(info(['Justin stol - Kiara 851 Beige - front.jpg', '1398518 back.png', 'random.png']), before);
    expect(next.done).toEqual({ '0:0': true, '1:1': true, '5:1': true });
    expect(next.outputs).toEqual({ '0:0': `${DIR}\\output\\Justin stol - Kiara 851 Beige - front.jpg`, '1:1': `${DIR}\\output\\1398518 back.png` });
    // The file goes away: the tick stays, only the "from file" mark goes.
    const later = jobFromFolder(info([]), { ...before, ...next });
    expect(later.done).toEqual(next.done);
    expect(later.outputs).toEqual({});
  });

  it('keeps ticks aligned when the sheet reorders fabrics or a photo is added', () => {
    const before = justin();
    before.done = { '0:0': true, '1:2': true };
    const rows = [JUSTIN_SHEET[0], JUSTIN_SHEET[1], JUSTIN_SHEET[2], ...JUSTIN_SHEET.slice(3).reverse()];
    const i = info([], rows);
    i.masters.push(file('Justin stol - side.jpg'));
    const next = jobFromFolder(i, before);
    expect(next.images).toEqual(['Front', 'Back', '3/4', 'Side']);
    const k = (f: string, img: string) => `${next.fabrics.indexOf(f)}:${next.images.indexOf(img)}`;
    expect(Object.keys(next.done).sort()).toEqual([k('Kiara 851 Beige', 'Front'), k('Kiara 854 Light Grey', '3/4')].sort());
  });

  it('treats loose photos named after a fabric as finished images', () => {
    const i = info();
    i.masters.push(file('Justin stol - Kiara 851 Beige - back.jpg'));
    const next = jobFromFolder(i);
    expect(next.images).toEqual(['Front', 'Back', '3/4']);
    expect(next.done).toEqual({ '0:1': true });
  });

  it('creates one job per folder and updates it in place', () => {
    const s = initialState(NOW);
    const r1 = applyJobFolders(s, 'skeidar', [{ info: info(['Justin stol - Kiara 851 Beige - front.jpg']), created: '2026-10-08' }], NOW);
    expect(r1).toEqual({ created: 1, updated: 0, ticked: 1, folders: 1 });
    expect(s.skeidarJobs[0]).toMatchObject({ name: 'Justin stol', status: 'open', receivedAt: '2026-10-08', folder: DIR });
    expect(s.skeidarJobs[0].company).toBeUndefined();
    const again = applyJobFolders(s, 'skeidar', [{ info: info(['Justin stol - Kiara 851 Beige - front.jpg']), created: '2026-10-08' }], NOW);
    expect(again).toEqual({ created: 0, updated: 0, ticked: 0, folders: 1 });
    const two = ['Justin stol - Kiara 851 Beige - front.jpg', 'Justin stol - Kiara 854 Light Grey - back.jpg', 'Justin stol - Kiara 851 Beige - back.jpg'];
    const more = applyJobFolders(s, 'skeidar', [{ info: info(two), created: '2026-10-08' }], NOW);
    expect(more).toEqual({ created: 0, updated: 1, ticked: 2, folders: 1 });
    // The same files again, ticks carried over in a different order: nothing to report.
    expect(applyJobFolders(s, 'skeidar', [{ info: info(two), created: '2026-10-08' }], NOW)).toEqual({ created: 0, updated: 0, ticked: 0, folders: 1 });
    expect(s.skeidarJobs).toHaveLength(1);
    // Another client's folder makes a job of its own, tagged with the client.
    applyJobFolders(s, 'nordic', [{ info: info(), created: '2026-10-09' }], NOW);
    expect(s.skeidarJobs.map(j => j.company)).toEqual([undefined, 'nordic']);
    // Empty folders don't become jobs.
    const empty: JobFolderInfo = { folder: `${DIR}2`, name: 'New', files: [], masters: [], outputs: [] };
    expect(applyJobFolders(s, 'skeidar', [{ info: empty, created: '2026-10-10' }], NOW).created).toBe(0);
  });

  it('keeps fabrics and photo names edited in the app until the folder itself changes', () => {
    const s = initialState(NOW);
    applyJobFolders(s, 'skeidar', [{ info: info(), created: '2026-10-08' }], NOW);
    const job = s.skeidarJobs[0];
    job.fabrics = job.fabrics.slice(0, 5);
    job.images = ['Front', 'Back', 'Three-quarter'];
    expect(applyJobFolders(s, 'skeidar', [{ info: info(['Justin stol - Kiara 851 Beige - front.jpg']), created: '2026-10-08' }], NOW)).toMatchObject({ updated: 1, ticked: 1 });
    expect(job.fabrics).toHaveLength(5);
    expect(job.images).toEqual(['Front', 'Back', 'Three-quarter']);
    expect(job.done).toEqual({ '0:0': true });
    // A new photo in the folder: the folder wins again.
    const i = info();
    i.masters.push(file('Justin stol - side.jpg'));
    applyJobFolders(s, 'skeidar', [{ info: i, created: '2026-10-08' }], NOW);
    expect(job.fabrics).toHaveLength(39);
    expect(job.images).toHaveLength(4);
  });
});

describe('prompts', () => {
  const job = justin();

  it('asks to change only the upholstery, keeping the photo, angle and legs', () => {
    const p = promptFor(job, 0, 2);
    expect(p).toContain('three-quarter view of the Justin stol');
    expect(p).toContain('"Kiara 851 Beige"');
    expect(p).toContain('woven textile in beige');
    expect(p).toMatch(/Change ONLY the upholstery/);
    expect(p).toMatch(/legs/);
    expect(p).toMatch(/same resolution/);
    expect(p).toMatch(/plain white background/);
    expect(promptFor(job, job.fabrics.indexOf('Raven 78 Grønn'), 0)).toContain('front view');
    expect(promptFor(job, job.fabrics.indexOf('Raven 78 Grønn'), 0)).toContain('in green');
    expect(promptFor(job, job.fabrics.indexOf('Rosario 462 Mole'), 1)).toContain('mole (a warm grey-brown)');
    expect(promptFor({ name: 'Oslo', fabrics: ['Velvet Moss'], images: ['Image 1'] }, 0, 0)).toContain('a velvet in moss');
  });

  it('lists prompts for one photo or the whole job, with file names', () => {
    const list = promptList({ ...job, done: { '0:0': true } }, { image: 0, onlyMissing: true });
    expect(list.count).toBe(38);
    expect(list.text.startsWith('1. Save as: Justin stol - Kiara 854 Light Grey - front.jpg\nEdit the attached front view')).toBe(true);
    expect(promptList(job).count).toBe(117);
  });
});
