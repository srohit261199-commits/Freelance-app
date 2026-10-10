// Job folders and client assets: sheet parsing, output matching and AI prompts. Pure, so the app, the preview and the tests share it.
import type { FolderSyncResult } from './api';
import type { AppState, AssetFile, CompanyConfig, CompanyId, JobFolderInfo, ParsedSheet, SheetVariant, SkeidarJob } from './types';
import { uid } from './ops';

export type Cell = string | number | null | undefined;

const KINDS: [AssetFile['kind'], RegExp][] = [
  ['sheet', /\.(xlsx|xlsm|xls|csv|tsv|ods|numbers)$/i],
  ['image', /\.(jpe?g|png|webp|tiff?|bmp|gif|heic|heif|avif|psd|exr|hdr|tga)$/i],
  ['pdf', /\.pdf$/i],
  ['model', /\.(glb|gltf|fbx|obj|blend|max|mb|ma|c4d|3ds|usdz?|usd[ac]|stl|ply|dae|skp|3dm|spp|sbsar|ztl|zpr|abc)$/i],
  ['doc', /\.(docx?|txt|md|rtf|odt|pages|pptx?|key|json|html?)$/i],
  ['archive', /\.(zip|rar|7z|tar|gz|tgz)$/i],
];

export function fileKind(name: string): AssetFile['kind'] {
  return KINDS.find(([, re]) => re.test(name))?.[0] ?? 'other';
}

/** Photos the app shows and matches: what an image-AI tool reads and writes. */
export const PHOTO = /\.(jpe?g|png|webp|tiff?|bmp|heic|heif|avif)$/i;
/** Subfolders that hold finished images. */
export const OUTPUT_DIR = /^(outputs?|done|finals?|renders?|delivered|generated|results?|exports?|ferdig)$/i;
/** Subfolders that hold the master photos, when they are not loose in the job folder. */
export const MASTER_DIR = /^(source|sources|masters?|inputs?|originals?|refs?|reference)$/i;
/** Hidden, temporary and system entries a folder listing skips. */
export const SKIP_ENTRY = /^(\.|~\$|node_modules$|thumbs\.db$|desktop\.ini$|\$recycle\.bin$|system volume information$)/i;

const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;
const stem = (name: string) => baseName(name).replace(/\.[a-z0-9]{1,5}$/i, '');
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Same folder, ignoring case, slash direction and a trailing slash (Windows paths). */
export function samePath(a?: string, b?: string): boolean {
  const n = (p?: string) => (p ?? '').replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
  return !!a && !!b && n(a) === n(b);
}

export function workflowOf(cfg: CompanyConfig): 'models' | 'variations' {
  return cfg.workflow ?? (cfg.id === 'skeidar' ? 'variations' : 'models');
}

/** The client's watched folder (Skeidar falls back to the older setting). */
export function clientFolder(state: AppState, company: CompanyId): string | undefined {
  const cfg = state.companies.find(c => c.id === company);
  return cfg?.folder || (company === 'skeidar' ? state.settings.skeidarFolder : undefined) || undefined;
}

/** Master photos (loose in the job folder or in source/), finished images (in output/ and the like) and the sheet. */
export function classifyJobFiles(files: AssetFile[]): { masters: AssetFile[]; outputs: AssetFile[]; sheetFile?: AssetFile } {
  const masters: AssetFile[] = [];
  const outputs: AssetFile[] = [];
  const sheets: AssetFile[] = [];
  for (const f of files) {
    const dirs = f.rel.split(/[\\/]/).slice(0, -1);
    const inOutput = dirs.some(d => OUTPUT_DIR.test(d));
    if (PHOTO.test(f.name)) {
      if (inOutput) outputs.push(f);
      else if (!dirs.length || (dirs.length === 1 && MASTER_DIR.test(dirs[0]))) masters.push(f);
    } else if (f.kind === 'sheet' && !inOutput && !/^~\$/.test(f.name)) sheets.push(f);
  }
  const rank = (f: AssetFile) => f.rel.split(/[\\/]/).length * 10 + (/\.xlsx$/i.test(f.name) ? 0 : /\.(csv|tsv|xlsm)$/i.test(f.name) ? 1 : 2);
  sheets.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  return { masters, outputs, sheetFile: sheets[0] };
}

/** Rows of a CSV or TSV export; works out the separator (Norwegian Excel writes semicolons). */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const first = src.split(/\r?\n/, 1)[0] ?? '';
  const count = (ch: string) => first.split(ch).length - 1;
  const sep = ['\t', ';', ','].reduce((best, ch) => (count(ch) > count(best) ? ch : best), ',');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && !cell) quoted = true;
    else if (ch === sep) row.push(cell), (cell = '');
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell || row.length) rows.push([...row, cell]);
  return rows;
}

const cellText = (c: Cell) => (c == null ? '' : typeof c === 'number' ? String(c) : clean(c));
/** First line of a header cell, lower case, without trailing punctuation. */
const headerText = (c: Cell) => (c == null ? '' : String(c).split(/\r?\n/)[0].replace(/\s+/g, ' ').trim().replace(/[.:]+$/, '').toLowerCase());
const itemId = (c: Cell): string | undefined => {
  if (typeof c === 'number') return Number.isInteger(c) && c >= 100 ? String(c) : undefined;
  const t = cellText(c);
  return /^\d{3,}$/.test(t) ? t : undefined;
};

const HEAD = {
  id: ['itemid', 'item id', 'varenummer', 'varenr', 'item no', 'item number', 'artikkelnummer', 'artnr', 'sku'],
  name: ['itemname', 'item name', 'varenavn', 'product', 'produkt', 'product name', 'produktnavn'],
  txt: ['txt', 'text', 'beskrivende tekst', 'description', 'beskrivelse', 'varetekst'],
  ext: ['externalitemtxt', 'external item txt', 'leverandørs varebeskrivelse', 'supplier description', 'supplier item description'],
  fabric: ['fabric', 'fabrics', 'fabric name', 'stoff', 'tekstil', 'textile', 'material', 'colour', 'color', 'farge', 'kvalitet', 'trekk'],
};
type HeadKey = keyof typeof HEAD;

function findColumns(row: Cell[]): Partial<Record<HeadKey, number>> {
  const cols: Partial<Record<HeadKey, number>> = {};
  row.forEach((c, i) => {
    const h = headerText(c);
    if (!h) return;
    for (const key of Object.keys(HEAD) as HeadKey[]) {
      if (cols[key] !== undefined) continue;
      if (HEAD[key].some(a => h === a || (a.includes(' ') && h.startsWith(a + ' ')))) cols[key] = i;
    }
  });
  return cols;
}

const TXT_PREFIX = /^(tekstil|stoff|trekk|skinn|lær|kunstlær|fløyel|velour|fabric|textile|leather|velvet fabric)\s+/i;
const INSTRUCTION = /do not fill|fylles|velges|supplier|leverandør|beskrivende tekst|choose from/i;

/** "Tekstil Kiara 851 Beige med sorte ben" → fabric "Kiara 851 Beige", option "sorte ben". */
function splitTxt(txt: string, product?: string): { fabric: string; option?: string } {
  let t = clean(txt);
  if (product && t.toLowerCase().startsWith(product.toLowerCase() + ' ')) t = t.slice(product.length + 1);
  const m = t.match(/^(.*?)\s+(?:med|with|m\/)\s+(.+)$/i);
  return { fabric: clean((m ? m[1] : t).replace(TXT_PREFIX, '')), option: m ? clean(m[2]) : undefined };
}

/** The English option after the style code in the supplier's text: "… Kiara 851 Beige W31 black wood legs" → "black wood legs". */
function englishOption(ext: string, fabric: string): string | undefined {
  const t = clean(ext);
  const at = fabric ? t.toLowerCase().indexOf(fabric.toLowerCase()) : -1;
  const after = at >= 0 ? t.slice(at + fabric.length) : (t.match(/\b[A-Z]{1,2}\d{1,3}\s+([^\d+]+?)\s*$/)?.[0] ?? '');
  const opt = clean(after.replace(/^\s*[A-Z]{1,3}\d{1,4}\b/, ''));
  return opt && /[a-z]/i.test(opt) ? opt : undefined;
}

/** Fabric from the supplier text when there is no Txt column: the part after " - ", minus size codes and the option. */
function fabricFromExt(ext: string, option?: string): string {
  let t = clean(ext);
  if (t.includes(' - ')) t = t.slice(t.lastIndexOf(' - ') + 3);
  if (option && t.toLowerCase().endsWith(option.toLowerCase())) t = t.slice(0, -option.length);
  t = t.replace(/\s+[A-Z]{1,3}\d{1,4}\s*$/, '');
  return clean(t.split(' ').filter(w => !w.includes('+')).join(' '));
}

function groupFabrics(variants: SheetVariant[]): ParsedSheet['fabrics'] {
  const out: ParsedSheet['fabrics'] = [];
  for (const v of variants) {
    if (!v.fabric) continue;
    let f = out.find(x => x.name.toLowerCase() === v.fabric.toLowerCase());
    if (!f) out.push((f = { name: v.fabric, itemIds: [], options: [] }));
    if (v.itemId && !f.itemIds.includes(v.itemId)) f.itemIds.push(v.itemId);
    if (v.option && !f.options.some(o => o.toLowerCase() === v.option!.toLowerCase())) f.options.push(v.option);
  }
  return out;
}

const mostCommon = (xs: string[]) => {
  const n = new Map<string, number>();
  for (const x of xs) if (x) n.set(x, (n.get(x) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
};

/**
 * Reads a client's product sheet: the supplier template (ItemId / ItemName / Txt / ExternalItemTxt, or the Norwegian
 * Varenummer / Varenavn headers) with one row per fabric × option, or a plain list of fabrics as a fallback.
 */
export function parseProductSheet(rows: Cell[][], path: string): ParsedSheet {
  const warnings: string[] = [];
  const top = rows.slice(0, 40);
  const h = top.findIndex(r => {
    const c = findColumns(r);
    return c.id !== undefined && (c.name !== undefined || c.txt !== undefined || c.ext !== undefined);
  });
  if (h >= 0) {
    const cols = findColumns(rows[h]);
    const body = rows.slice(h + 1);
    const get = (r: Cell[], k: HeadKey) => (cols[k] === undefined ? '' : cellText(r[cols[k]!]));
    let picked = body.filter(r => itemId(r[cols.id!]));
    if (!picked.length) {
      picked = body.filter(r => {
        const t = get(r, 'txt') || get(r, 'ext');
        return t && !INSTRUCTION.test(t) && !String(r[cols.txt ?? cols.ext ?? 0] ?? '').includes('\n');
      });
      if (picked.length) warnings.push(`No item numbers in the sheet; read ${picked.length} rows by their description.`);
    }
    const product = mostCommon(picked.map(r => get(r, 'name')));
    const variants: SheetVariant[] = picked.map(r => {
      const txt = get(r, 'txt');
      const ext = get(r, 'ext');
      const fromTxt = txt ? splitTxt(txt, get(r, 'name') || product) : undefined;
      const fabric = fromTxt?.fabric || fabricFromExt(ext, englishOption(ext, ''));
      const option = (ext && englishOption(ext, fabric)) || fromTxt?.option;
      return { itemId: itemId(r[cols.id!]), product: get(r, 'name') || product || '', text: txt || ext, fabric, option };
    });
    if (!variants.length) warnings.push('Found the header row but no product rows under it.');
    return { path, product, variants, fabrics: groupFabrics(variants), warnings };
  }
  // A plain list: a "Fabric" column (with an optional item number), or one fabric per line.
  const fh = top.findIndex(r => findColumns(r).fabric !== undefined);
  const cols = fh >= 0 ? findColumns(rows[fh]) : {};
  const body = rows.slice(fh + 1);
  if (fh < 0) warnings.push('No header row found; read each line as a fabric.');
  const variants: SheetVariant[] = [];
  for (const r of body) {
    const fabric = fh >= 0 ? cellText(r[cols.fabric!]) : cellText(r.find(c => cellText(c) && !itemId(c)));
    if (!fabric || INSTRUCTION.test(fabric)) continue;
    const id = cols.id !== undefined ? itemId(r[cols.id]) : r.map(itemId).find(Boolean);
    const product = cols.name !== undefined ? cellText(r[cols.name]) : '';
    variants.push({ itemId: id, product, text: fabric, fabric });
  }
  const product = mostCommon(variants.map(v => v.product));
  return { path, product, variants, fabrics: groupFabrics(variants), warnings };
}

/* ---------- matching file names ---------- */

function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ø/g, 'o')
    .replace(/æ/g, 'ae')
    .replace(/ß/g, 'ss')
    .replace(/¾/g, ' 3 4 ')
    .replace(/½/g, ' 1 2 ');
}

/** Lower-case words and numbers; "Kiara851-Beige" → kiara, 851, beige. Leading zeros dropped so "01" matches "1". */
export function tokens(s: string): string[] {
  return fold(s)
    .split(/[^a-z0-9]+/)
    .flatMap(t => t.match(/[a-z]+|\d+/g) ?? [])
    .map(t => (/^\d+$/.test(t) ? String(Number(t)) : t));
}

/** Where `key` (tokens joined) starts and ends in `hay`, matching whole tokens only. */
function spanOf(hay: string[], key: string, skip?: Set<number>): [number, number] | null {
  if (!key) return null;
  for (let i = 0; i < hay.length; i++) {
    let acc = '';
    for (let j = i; j < hay.length && !skip?.has(j); j++) {
      acc += hay[j];
      if (acc === key) return [i, j];
      if (!key.startsWith(acc)) break;
    }
  }
  return null;
}

type Angle = 'front' | 'back' | 'three' | 'side' | 'top' | 'detail';
const ANGLES: [Angle, string[]][] = [
  ['front', ['front', 'forfra', 'foran', 'fremside', 'framside']],
  ['back', ['back', 'rear', 'bak', 'bakfra', 'bakside', 'behind']],
  ['three', ['34', 'threequarter', 'threequarters', 'quarter', 'angle', 'angled', 'persp', 'perspective', 'skra', 'skraa', 'diagonal', '45']],
  ['side', ['side', 'profile', 'siden']],
  ['top', ['top', 'ovenfra']],
  ['detail', ['detail', 'details', 'closeup', 'naerbilde']],
];
const ANGLE_LABEL: Record<Angle, string> = { front: 'Front', back: 'Back', three: '3/4', side: 'Side', top: 'Top', detail: 'Detail' };
const ANGLE_WORDS: Record<Angle, string> = { front: 'front view', back: 'back view', three: 'three-quarter view', side: 'side view', top: 'top view', detail: 'detail shot' };

function angleOf(t: string[], skip?: Set<number>): Angle | undefined {
  return ANGLES.find(([, words]) => words.some(w => spanOf(t, w, skip)))?.[0];
}

function fabricKeys(name: string): string[] {
  const t = tokens(name);
  const full = t.join('');
  const n = t.findIndex(x => /^\d+$/.test(x));
  const short = n > 0 ? t.slice(0, n + 1).join('') : '';
  return short && short !== full ? [full, short] : [full];
}

function matchFabric(t: string[], job: Pick<SkeidarJob, 'fabrics' | 'itemIds'>): { fi: number; span: [number, number] } | null {
  let best: { fi: number; span: [number, number]; score: number } | null = null;
  job.fabrics.forEach((f, fi) => {
    for (const id of job.itemIds?.[f] ?? []) {
      const at = t.indexOf(String(Number(id)));
      if (at >= 0 && (!best || best.score < 1000)) best = { fi, span: [at, at], score: 1000 };
    }
    for (const key of fabricKeys(f)) {
      const span = spanOf(t, key);
      if (span && (!best || key.length > best.score)) best = { fi, span, score: key.length };
    }
  });
  return best;
}

/** Words that tell each master photo apart: its label, and its file name minus the product and words every master shares. */
function masterKeys(job: Pick<SkeidarJob, 'images' | 'imageFiles' | 'product'>): string[][] {
  const files = (job.imageFiles ?? []).map(f => tokens(stem(f)));
  const shared = new Set([...(job.product ? tokens(job.product) : []), ...(files.length > 1 ? files[0].filter(x => files.every(t => t.includes(x))) : [])]);
  return job.images.map((label, ii) => {
    const own = (files[ii] ?? []).filter(x => !shared.has(x)).join('');
    return [tokens(label).join(''), own].filter((k, i, all) => k && all.indexOf(k) === i && !/^(photo|image|bilde|foto|master)$/.test(k));
  });
}

/** Which fabric and master photo a finished image is, from its file name (fabric name, item number, photo name or angle). */
export function matchOutput(fileName: string, job: Pick<SkeidarJob, 'fabrics' | 'images' | 'itemIds' | 'imageFiles' | 'product'>): { fabricIndex: number; imageIndex: number } | null {
  if (!job.images.length) return null;
  const t = tokens(stem(fileName));
  const fab = matchFabric(t, job);
  if (!fab) return null;
  const skip = new Set<number>();
  for (let i = fab.span[0]; i <= fab.span[1]; i++) skip.add(i);
  if (job.images.length === 1) return { fabricIndex: fab.fi, imageIndex: 0 };
  const keys = masterKeys(job);
  const named = keys.map(ks => Math.max(0, ...ks.map(k => (spanOf(t, k, skip) ? k.length : 0))));
  const top = Math.max(...named);
  if (top > 0 && named.filter(n => n === top).length === 1) return { fabricIndex: fab.fi, imageIndex: named.indexOf(top) };
  const want = angleOf(t, skip);
  if (!want) return null;
  const angles = job.images.map((label, ii) => angleOf(tokens(`${label} ${stem(job.imageFiles?.[ii] ?? '')}`)));
  let hits = angles.flatMap((a, ii) => (a === want ? [ii] : []));
  // A "side" file for a job whose photo is labelled 3/4, or the other way round.
  if (!hits.length && (want === 'side' || want === 'three')) hits = angles.flatMap((a, ii) => (a === (want === 'side' ? 'three' : 'side') ? [ii] : []));
  return hits.length === 1 ? { fabricIndex: fab.fi, imageIndex: hits[0] } : null;
}

/** Label for a master photo from its file name: "Justin stol - 3-4.jpg" → "3/4". */
export function masterLabel(fileName: string, product?: string, index = 0): string {
  const a = angleOf(tokens(stem(fileName)));
  if (a) return ANGLE_LABEL[a];
  let s = stem(fileName).replace(/[_]+/g, ' ');
  if (product) s = s.replace(new RegExp(product.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s_-]+'), 'i'), '');
  s = clean(s.replace(/^[\s\-–·.,]+|[\s\-–·.,]+$/g, ''));
  return !s ? `Photo ${index + 1}` : /^\d+$/.test(s) ? `Photo ${s}` : s[0].toUpperCase() + s.slice(1);
}

const ANGLE_ORDER: (Angle | undefined)[] = ['front', 'back', 'three', 'side', 'top', 'detail', undefined];

/** Master photos in a stable order: front, back, 3/4, side, then the rest by name. */
export function sortMasters<T extends { name: string }>(files: T[]): T[] {
  const rank = (f: T) => ANGLE_ORDER.indexOf(angleOf(tokens(stem(f.name))));
  return [...files].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** File name to save a finished image under so the app ticks it off: "Justin stol - Kiara 851 Beige - front.jpg". */
export function suggestedFileName(job: Pick<SkeidarJob, 'name' | 'product' | 'fabrics' | 'images' | 'imageFiles'>, fi: number, ii: number): string {
  const safe = (s: string) => clean(s.replace(/[\\/:*?"<>|]+/g, '-'));
  const ext = (job.imageFiles?.[ii]?.match(/\.(jpe?g|png|webp)$/i)?.[0] ?? '.jpg').toLowerCase();
  return `${safe(job.product || job.name)} - ${safe(job.fabrics[fi])} - ${safe(job.images[ii].toLowerCase())}${ext}`;
}

/* ---------- prompts ---------- */

/** Fabric families in Skeidar's range that are woven textiles. */
const WOVEN = new Set(['kiara', 'rosario', 'massimo', 'riva', 'sorella', 'raven', 'genesis']);
const MATERIALS: [RegExp, string][] = [
  [/boucl/i, 'bouclé'],
  [/velvet|velour|fløyel|flojel/i, 'velvet'],
  [/chenille/i, 'chenille'],
  [/cord(uroy)?|kord/i, 'corduroy'],
  [/linen|lin\b/i, 'linen'],
  [/leather|skinn|lær|laer/i, 'leather'],
  [/wool|ull\b/i, 'wool'],
  [/tweed/i, 'tweed'],
  [/cotton|bomull/i, 'cotton'],
  [/jacquard/i, 'jacquard'],
];
/** Norwegian colour words in fabric names, and a hint for colour names an image tool may not know. */
const COLOUR_WORDS: Record<string, string> = {
  grønn: 'green', gronn: 'green', grå: 'grey', gra: 'grey', blå: 'blue', bla: 'blue', rød: 'red', rod: 'red', hvit: 'white', sort: 'black', svart: 'black',
  brun: 'brown', gul: 'yellow', rosa: 'pink', oransje: 'orange', lilla: 'purple', lys: 'light', mørk: 'dark', mork: 'dark', natur: 'natural',
};
const COLOUR_HINTS: Record<string, string> = {
  mole: 'a warm grey-brown',
  mink: 'a soft greyish brown',
  iron: 'a dark iron grey',
  taupe: 'a greyish brown',
  stone: 'a light warm grey',
  terra: 'a terracotta red-brown',
  ivory: 'a warm off-white',
  cream: 'a soft creamy white',
  rust: 'a rusty orange-brown',
  mustard: 'a mustard yellow',
};

function fabricParts(name: string): { family?: string; colour: string; material: string } {
  const words = clean(name).split(' ');
  const n = words.findIndex(w => /^\d+$/.test(w));
  const family = n > 0 ? words.slice(0, n).join(' ') : undefined;
  const colourWords = n >= 0 ? words.slice(n + 1) : words.slice(1);
  const colour = colourWords.map(w => COLOUR_WORDS[w.toLowerCase()] ?? w.toLowerCase()).join(' ');
  const material = MATERIALS.find(([re]) => re.test(name))?.[1] ?? (family && WOVEN.has(family.toLowerCase()) ? 'woven textile' : 'upholstery fabric');
  return { family, colour, material };
}

/** A ready prompt for an image-AI tool: this master photo, re-upholstered in this fabric, everything else unchanged. */
export function promptFor(job: Pick<SkeidarJob, 'name' | 'product' | 'fabrics' | 'images' | 'imageFiles'>, fi: number, ii: number): string {
  const product = job.product || job.name;
  const fabric = job.fabrics[fi];
  const label = job.images[ii] ?? '';
  const angle = angleOf(tokens(`${label} ${stem(job.imageFiles?.[ii] ?? '')}`));
  const view = angle ? ANGLE_WORDS[angle] : `photo "${label}"`;
  const { colour, material } = fabricParts(fabric);
  const hint = COLOUR_HINTS[colour.split(' ').pop() ?? ''];
  const colourText = colour ? ` in ${colour}${hint ? ` (${hint})` : ''}` : '';
  const texture = material === 'leather' ? 'a natural leather grain' : material === 'velvet' ? 'a soft velvet pile and sheen' : `a realistic ${material === 'woven textile' ? 'woven' : material} texture`;
  return [
    `Edit the attached ${view} of the ${product}.`,
    `Change ONLY the upholstery to the fabric "${fabric}": a ${material}${colourText}, with ${texture} that follows every seam, fold and cushion of the original.`,
    `Keep everything else exactly as in the photo: the ${product}'s shape and proportions, the camera angle and framing, the lighting and shadows, the legs (same colour and wood finish) and the plain white background.`,
    'Output a photorealistic product photo at the same resolution and aspect ratio as the input, on a plain white background. No text, logos or watermark.',
  ].join('\n');
}

/** Every prompt for one master photo (or the whole job) as a numbered list with the file name to save each result under. */
export function promptList(job: SkeidarJob, opts: { image?: number; onlyMissing?: boolean } = {}): { text: string; count: number } {
  const lines: string[] = [];
  let n = 0;
  job.images.forEach((_, ii) => {
    if (opts.image !== undefined && opts.image !== ii) return;
    job.fabrics.forEach((_, fi) => {
      if (opts.onlyMissing && job.done[`${fi}:${ii}`]) return;
      n++;
      lines.push(`${n}. Save as: ${suggestedFileName(job, fi, ii)}\n${promptFor(job, fi, ii)}`);
    });
  });
  return { text: lines.join('\n\n'), count: n };
}

/* ---------- jobs from folders ---------- */

export type FolderJob = Pick<SkeidarJob, 'name' | 'images' | 'fabrics' | 'done' | 'product' | 'sheet' | 'itemIds' | 'options' | 'imageFiles' | 'outputs' | 'folderSig'>;

/** Ticks of an existing job carried over to a new fabric and photo list (matched by fabric name, then photo file, label or position). */
function carryTicks(existing: SkeidarJob | undefined, fabrics: string[], images: string[], imageFiles?: string[]): Record<string, boolean> {
  const done: Record<string, boolean> = {};
  if (!existing) return done;
  const key = (s: string) => tokens(s).join('');
  const fIdx = fabrics.map(f => existing.fabrics.findIndex(x => key(x) === key(f)));
  const iIdx0 = images.map((label, ii) => {
    const file = imageFiles?.[ii] ? baseName(imageFiles[ii]).toLowerCase() : '';
    const byFile = file ? (existing.imageFiles ?? []).findIndex(x => baseName(x).toLowerCase() === file) : -1;
    return byFile >= 0 ? byFile : existing.images.findIndex(x => x.toLowerCase() === label.toLowerCase());
  });
  // Photos that can't be matched by name keep the ticks of the photo in the same position.
  const iIdx = iIdx0.map((oi, ii) => (oi < 0 && ii < existing.images.length && !iIdx0.includes(ii) ? ii : oi));
  fIdx.forEach((of, fi) => {
    if (of < 0) return;
    iIdx.forEach((oi, ii) => {
      if (oi >= 0 && existing.done[`${of}:${oi}`]) done[`${fi}:${ii}`] = true;
    });
  });
  return done;
}

function buildFromFolder(info: JobFolderInfo, existing?: SkeidarJob): { job: FolderJob; ticked: number } {
  const sheet = info.sheet?.fabrics.length ? info.sheet : undefined;
  // While the sheet and photos are what they were at the last sync, fabrics and photos edited in the app are kept.
  const sig = JSON.stringify([sheet?.fabrics.map(f => [f.name, f.itemIds]) ?? null, info.masters.map(f => f.path).sort()]);
  const kept = !!existing?.folderSig && existing.folderSig === sig ? existing : undefined;
  const product = kept ? kept.product : sheet?.product || existing?.product;
  const fabrics = kept ? kept.fabrics : sheet ? sheet.fabrics.map(f => f.name) : (existing?.fabrics ?? []);
  const itemIds = kept ? kept.itemIds : sheet ? Object.fromEntries(sheet.fabrics.filter(f => f.itemIds.length).map(f => [f.name, f.itemIds])) : existing?.itemIds;
  const options = kept ? kept.options : sheet ? [...new Map(sheet.fabrics.flatMap(f => f.options).map(o => [o.toLowerCase(), o])).values()] : existing?.options;
  // Loose photos named after a fabric are finished images saved next to the masters, unless every photo is.
  const named = (f: AssetFile) => !!matchFabric(tokens(stem(f.name)), { fabrics, itemIds });
  const stray = info.masters.filter(named);
  let masters = stray.length < info.masters.length ? info.masters.filter(f => !named(f)) : info.masters;
  if (masters.length > 8) masters = [];
  const sorted = sortMasters(masters);
  const images = kept ? [...kept.images] : sorted.length ? sorted.map((f, i) => masterLabel(f.name, product, i)) : (existing?.images ?? []);
  images.forEach((l, i) => {
    const dup = images.slice(0, i).filter(x => x === l).length;
    if (dup) images[i] = `${l} ${dup + 1}`;
  });
  const imageFiles = kept ? kept.imageFiles : sorted.length ? sorted.map(f => f.path) : existing?.imageFiles;
  const done = carryTicks(existing, fabrics, images, imageFiles);
  const outputs: Record<string, string> = {};
  const shape = { name: existing?.name ?? info.name, product, fabrics, images, imageFiles, itemIds };
  let ticked = 0;
  for (const f of [...info.outputs, ...(masters === info.masters ? [] : stray)].sort((a, b) => a.rel.localeCompare(b.rel))) {
    const m = matchOutput(f.name, shape);
    if (!m) continue;
    const k = `${m.fabricIndex}:${m.imageIndex}`;
    outputs[k] ??= f.path;
    if (!done[k]) ticked++;
    done[k] = true;
  }
  return { job: { ...shape, sheet: sheet?.path ?? existing?.sheet, options, done, outputs, folderSig: sig }, ticked };
}

/**
 * The job fields a folder gives: product, fabrics and item numbers from the sheet, photos from the masters, and ticks for
 * finished images found in the output folder. Ticks already set (by hand or earlier) are kept, never removed.
 */
export function jobFromFolder(info: JobFolderInfo, existing?: SkeidarJob): FolderJob {
  return buildFromFolder(info, existing).job;
}

const FIELDS = ['images', 'fabrics', 'done', 'product', 'sheet', 'itemIds', 'options', 'imageFiles', 'outputs', 'folderSig'] as const;

/** Creates or updates one job per job folder of a client, in place on a draft state. `created` is each folder's local creation date. */
export function applyJobFolders(draft: AppState, company: CompanyId, folders: { info: JobFolderInfo; created: string }[], now: string): FolderSyncResult {
  const result: FolderSyncResult = { created: 0, updated: 0, ticked: 0, folders: folders.length };
  for (const { info, created } of folders) {
    const existing = draft.skeidarJobs.find(j => (j.company ?? 'skeidar') === company && samePath(j.folder, info.folder));
    if (!existing && !info.masters.length && !info.sheet?.fabrics.length) continue;
    const { job, ticked } = buildFromFolder(info, existing);
    if (existing) {
      // The folder signature alone changing isn't an update worth reporting.
      // Keys sorted, so ticks carried over in another order don't count as a change.
      const seen = () =>
        JSON.stringify(
          FIELDS.filter(k => k !== 'folderSig').map(k => existing[k]),
          (_k, v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([x], [y]) => x.localeCompare(y))) : v),
        );
      const before = seen();
      for (const k of FIELDS) (existing as unknown as Record<string, unknown>)[k] = job[k];
      if (seen() !== before) result.updated++;
    } else {
      draft.skeidarJobs.push({
        id: uid('sk'),
        ...(company === 'skeidar' ? {} : { company }),
        status: 'open',
        receivedAt: created,
        createdAt: now,
        folder: info.folder,
        ...job,
      });
      result.created++;
    }
    result.ticked += ticked;
  }
  return result;
}
