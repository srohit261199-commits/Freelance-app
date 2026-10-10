import ExcelJS from 'exceljs';
import type { AppState, Model } from '../shared/types';
import { catalogStatusText, COMPLEXITY_LABELS, isComplete, lastWorked, statusLabel, trackerStatusText } from '../shared/status';
import { allEarnings, convert, jobOutputs, monthLabel, rollRenewal, tierFee } from '../shared/money';
import { dailyLog, localDate } from '../shared/planner';

export type ExportScope = 'waveink' | 'metaztech' | 'skeidar' | 'all';

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } } as const;
const FILLS: Record<string, string> = {
  done: 'FFD1FAE5',
  live: 'FFBBF7D0',
  review: 'FFDBEAFE',
  revision: 'FFFEE2E2',
  in_progress: 'FFFEF3C7',
  on_hold: 'FFE5E7EB',
  skipped: 'FFF3F4F6',
};

function sheet(wb: ExcelJS.Workbook, name: string, columns: { header: string; key: string; width: number }[]): ExcelJS.Worksheet {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = columns;
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = HEADER_FILL;
  head.alignment = { vertical: 'middle' };
  head.height = 22;
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  return ws;
}

function paint(ws: ExcelJS.Worksheet, rowNo: number, col: string, status: string): void {
  const argb = FILLS[status];
  if (argb) ws.getRow(rowNo).getCell(col).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

const day = (iso?: string) => (iso ? localDate(iso) : '');

function waveink(wb: ExcelJS.Workbook, state: AppState): void {
  const models = state.models.filter(m => m.company === 'waveink');
  const tech = models.filter(m => m.group === 'Tech');

  // Same columns and row order as "Tech_Products Designer.xlsx", with 3D Model Status filled in.
  const ws = sheet(wb, 'Tech catalog (updated)', [
    { header: 'Product Name', key: 'name', width: 46 },
    { header: 'Jasani Code', key: 'code', width: 14 },
    { header: 'Jasani ID', key: 'jasaniId', width: 10 },
    { header: '3D Model Status', key: 'status', width: 16 },
    { header: 'Template ID (backend files)', key: 'templateId', width: 12 },
    { header: 'Brand', key: 'brand', width: 14 },
    { header: 'Colour', key: 'colour', width: 14 },
    { header: 'Category', key: 'category', width: 10 },
    { header: 'Subcategory', key: 'sub', width: 26 },
    { header: 'Description', key: 'description', width: 50 },
    { header: 'Supplier Methods (real)', key: 'printMethods', width: 24 },
    { header: 'Branding Areas — position · physical size · methods', key: 'brandingAreas', width: 44 },
    { header: '# Areas', key: 'areas', width: 8 },
    { header: 'Colour / Size Variants (code — variant)', key: 'variants', width: 30 },
    { header: 'GLB File Name', key: 'glb', width: 18 },
    { header: 'Last Updated', key: 'updated', width: 12 },
    { header: 'Rohit Notes', key: 'notes', width: 36 },
    { header: 'Source URL 1', key: 'url1', width: 30 },
  ]);
  const lines: { order: number; m: Model; sub: string }[] = [];
  for (const m of tech) {
    const rows = m.rows?.length ? m.rows : [1e6];
    rows.forEach((order, k) => lines.push({ order, m, sub: m.subcategories?.[k] ?? m.subcategories?.[0] ?? '' }));
  }
  lines.sort((a, b) => a.order - b.order || a.m.name.localeCompare(b.m.name));
  for (const { m, sub } of lines) {
    const row = ws.addRow({
      name: m.name,
      code: m.code,
      jasaniId: m.jasaniId,
      status: catalogStatusText(m),
      templateId: m.templateId,
      brand: m.brand,
      colour: m.colour,
      category: 'Tech',
      sub,
      description: m.description,
      printMethods: m.printMethods,
      brandingAreas: m.brandingAreas,
      areas: m.areas ? Number(m.areas) : '',
      variants: m.variants,
      glb: m.glbFile ?? '',
      updated: day(lastWorked(m)),
      notes: m.notes ?? '',
      url1: m.sourceUrls?.[0] ?? '',
    });
    paint(ws, row.number, 'status', m.status);
  }

  // The GLB Task Tracker columns Sibi asked to keep updated.
  const tr = sheet(wb, 'GLB Task Tracker', [
    { header: '#', key: 'n', width: 5 },
    { header: 'Group', key: 'group', width: 9 },
    { header: 'Product Name', key: 'name', width: 46 },
    { header: 'Jasani Code', key: 'code', width: 14 },
    { header: 'Subcategory', key: 'sub', width: 26 },
    { header: 'Status', key: 'status', width: 18 },
    { header: '% Complete', key: 'pct', width: 11 },
    { header: 'GLB File Name', key: 'glb', width: 20 },
    { header: 'On Drive', key: 'drive', width: 10 },
    { header: 'Rohit Update', key: 'notes', width: 40 },
    { header: 'Last Updated', key: 'updated', width: 12 },
  ]);
  const order = [...models].sort(
    (a, b) => (a.group === b.group ? 0 : a.group === 'Tech' ? -1 : 1) || Math.min(...(a.rows ?? [1e6])) - Math.min(...(b.rows ?? [1e6])) || a.name.localeCompare(b.name),
  );
  order.forEach((m, i) => {
    const row = tr.addRow({
      n: i + 1,
      group: m.group,
      name: m.name,
      code: m.code,
      sub: (m.subcategories ?? []).join(', '),
      status: trackerStatusText(m.status),
      pct: (m.percent ?? (isComplete(m.status) ? 100 : 0)) / 100,
      glb: m.glbFile ?? '',
      drive: m.driveFileUrl ? 'Yes' : '',
      notes: m.notes ?? '',
      updated: day(lastWorked(m)),
    });
    row.getCell('pct').numFmt = '0%';
    paint(tr, row.number, 'status', m.status);
  });
  const total = models.filter(m => m.status !== 'skipped').length;
  const done = models.filter(m => isComplete(m.status)).length;
  tr.addRow({});
  tr.addRow({ name: `Overall: ${done} of ${total} done (${total ? Math.round((done / total) * 100) : 0}%)` }).font = { bold: true };

  const log = sheet(wb, 'Daily Update Log', [
    { header: '#', key: 'n', width: 5 },
    { header: 'Date', key: 'date', width: 12 },
    { header: 'Products Worked On', key: 'worked', width: 60 },
    { header: 'No. of GLBs Started', key: 'started', width: 12 },
    { header: 'No. of GLBs Completed', key: 'completed', width: 12 },
    { header: 'No. of GLBs in Review', key: 'review', width: 12 },
    { header: 'Update / Progress Notes', key: 'notes', width: 70 },
    { header: 'Blockers / Issues', key: 'blockers', width: 24 },
    { header: 'Next Day Plan', key: 'plan', width: 30 },
  ]);
  dailyLog(state.models, 'waveink').forEach((d, i) => {
    log.addRow({ n: i + 1, date: d.date, worked: d.worked.join(', '), started: d.started, completed: d.completed, review: d.inReview, notes: d.notes });
  });
}

function metaztech(wb: ExcelJS.Workbook, state: AppState): void {
  const cfg = state.companies.find(c => c.id === 'metaztech')!;
  const tds = cfg.pay.kind === 'tiered' ? cfg.pay.tdsPercent : 0;
  const ws = sheet(wb, 'MetaZtech models', [
    { header: 'Job / ID', key: 'code', width: 16 },
    { header: 'Model', key: 'name', width: 40 },
    { header: 'Project', key: 'group', width: 18 },
    { header: 'Complexity', key: 'cx', width: 22 },
    { header: 'Fee (₹)', key: 'fee', width: 10 },
    { header: 'Net after TDS (₹)', key: 'net', width: 14 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Rejections', key: 'rev', width: 10 },
    { header: 'Started', key: 'started', width: 12 },
    { header: 'Approved', key: 'approved', width: 12 },
    { header: 'Due', key: 'due', width: 12 },
    { header: 'Notes', key: 'notes', width: 40 },
  ]);
  for (const m of state.models.filter(m => m.company === 'metaztech')) {
    const fee = tierFee(cfg, m.complexity);
    const row = ws.addRow({
      code: m.code,
      name: m.name,
      group: m.group,
      cx: m.complexity ? COMPLEXITY_LABELS[m.complexity] : '(not set)',
      fee,
      net: Math.round(fee * (1 - tds / 100) * 100) / 100,
      status: statusLabel(m.status, 'metaztech'),
      rev: m.revisions ?? 0,
      started: day(m.startedAt),
      approved: isComplete(m.status) ? day(m.completedAt) : '',
      due: m.dueDate ?? '',
      notes: m.notes ?? '',
    });
    paint(ws, row.number, 'status', m.status);
  }
}

function skeidar(wb: ExcelJS.Workbook, state: AppState): void {
  const cfg = state.companies.find(c => c.id === 'skeidar')!;
  const rate = cfg.pay.kind === 'per-item' ? cfg.pay.rate : 0;
  const ws = sheet(wb, 'Skeidar jobs', [
    { header: 'Job', key: 'name', width: 34 },
    { header: 'Received', key: 'received', width: 12 },
    { header: 'Source images', key: 'images', width: 12 },
    { header: 'Fabrics', key: 'fabrics', width: 50 },
    { header: 'Outputs done', key: 'done', width: 12 },
    { header: 'Outputs total', key: 'total', width: 12 },
    { header: `Earned (AED, ${rate}/image)`, key: 'earned', width: 18 },
    { header: 'Status', key: 'status', width: 10 },
    { header: 'Folder', key: 'folder', width: 40 },
  ]);
  for (const j of state.skeidarJobs) {
    const { done, total } = jobOutputs(j);
    ws.addRow({ name: j.name, received: j.receivedAt, images: j.images.length, fabrics: j.fabrics.join(', '), done, total, earned: done * rate, status: j.status, folder: j.folder ?? '' });
  }
}

function money(wb: ExcelJS.Workbook, state: AppState): void {
  const now = new Date();
  const rates = state.settings.rates;
  const base = state.settings.baseCurrency;
  const sum = sheet(wb, 'Earnings summary', [
    { header: 'Company', key: 'c', width: 14 },
    { header: 'Currency', key: 'cur', width: 9 },
    { header: 'Earned', key: 'earned', width: 12 },
    { header: 'Received', key: 'received', width: 12 },
    { header: 'Outstanding', key: 'out', width: 12 },
    { header: 'This month', key: 'month', width: 12 },
    { header: 'Open work value', key: 'pipe', width: 15 },
    { header: `Outstanding in ${base}`, key: 'outBase', width: 16 },
  ]);
  for (const e of allEarnings(state, now)) {
    const name = state.companies.find(c => c.id === e.company)!.name;
    sum.addRow({ c: name, cur: e.currency, earned: e.earned, received: e.received, out: e.outstanding, month: e.thisMonth, pipe: e.pipeline, outBase: Math.round(convert(e.outstanding, e.currency, base, rates)) });
    for (const l of e.months) sum.addRow({ c: `  ${monthLabel(l.month)}`, cur: e.currency, earned: l.net, month: `${l.units} unit${l.units === 1 ? '' : 's'}` });
  }
  const pay = sheet(wb, 'Payments received', [
    { header: 'Date', key: 'date', width: 12 },
    { header: 'Company', key: 'c', width: 14 },
    { header: 'Amount', key: 'amount', width: 12 },
    { header: 'Currency', key: 'cur', width: 9 },
    { header: 'For month', key: 'period', width: 11 },
    { header: 'Reference', key: 'ref', width: 20 },
    { header: 'Note', key: 'note', width: 50 },
  ]);
  for (const p of [...state.payments].sort((a, b) => a.date.localeCompare(b.date))) {
    pay.addRow({ date: p.date, c: state.companies.find(c => c.id === p.company)?.name, amount: p.amount, cur: p.currency, period: p.period ?? '', ref: p.reference ?? '', note: p.note ?? '' });
  }
  const subs = sheet(wb, 'Subscriptions', [
    { header: 'Name', key: 'name', width: 28 },
    { header: 'Vendor', key: 'vendor', width: 26 },
    { header: 'Amount', key: 'amount', width: 10 },
    { header: 'Currency', key: 'cur', width: 9 },
    { header: 'Cycle', key: 'cycle', width: 9 },
    { header: 'Status', key: 'status', width: 11 },
    { header: 'Next renewal / ends', key: 'next', width: 16 },
    { header: 'Category', key: 'cat', width: 9 },
    { header: 'Notes', key: 'notes', width: 40 },
  ]);
  for (const s of state.subscriptions) {
    subs.addRow({ name: s.name, vendor: s.vendor, amount: s.amount ?? '', cur: s.currency, cycle: s.cycle, status: s.status, next: s.status === 'cancelling' || s.status === 'cancelled' ? s.endsOn ?? '' : rollRenewal(s, now) ?? '', cat: s.category, notes: s.notes ?? '' });
  }
}

export async function buildWorkbook(state: AppState, scope: ExportScope): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Freelance Hub';
  wb.created = new Date();
  if (scope === 'waveink' || scope === 'all') waveink(wb, state);
  if (scope === 'metaztech' || scope === 'all') metaztech(wb, state);
  if (scope === 'skeidar' || scope === 'all') skeidar(wb, state);
  if (scope === 'all') money(wb, state);
  return wb;
}

export async function exportExcel(state: AppState, scope: ExportScope, file: string): Promise<void> {
  const wb = await buildWorkbook(state, scope);
  await wb.xlsx.writeFile(file);
}
