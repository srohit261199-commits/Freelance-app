import type { AppState, CompanyConfig, Model, PortfolioTask, Subscription } from '../../shared/types';
import catalog from './waveink-tech.json';

interface CatalogProduct {
  name: string;
  code: string;
  jasaniId: string;
  templateId: string;
  brand: string;
  colour: string;
  category: string;
  subcategories: string[];
  description: string;
  printMethods: string;
  brandingAreas: string;
  areas: string;
  variants: string;
  hasPrintArea: boolean;
  catalogStatus: string;
  sourceUrls: string[];
  rows: number[];
}

export const SEED_VERSION = 1;

export const COMPANIES: CompanyConfig[] = [
  {
    id: 'waveink',
    name: 'Waveink',
    role: '3D Product Modeler · GLB for the web customiser',
    color: '#2563eb',
    currency: 'AED',
    pay: { kind: 'retainer', amount: 3000, startDate: '2026-09-01', payday: 1 },
    match: {
      domains: ['waveink.ae'],
      // The Weekly Demo invite comes from the team's personal Gmail addresses.
      emails: ['sibiabin92@gmail.com', 'ahmedjayx@gmail.com', 'danial.aftab.01@gmail.com', 'faisalam.005@gmail.com'],
      names: ['Sibi', 'Ahmed Abudaff'],
      keywords: ['waveink', 'weekly demo'],
    },
    links: [
      { label: 'Tech catalog (Excel)', url: 'https://docs.google.com/spreadsheets/d/1yIwb69mBOttfKM2mpl812XXOKyR9kS0L/edit' },
      { label: 'GLB Task Tracker', url: 'https://docs.google.com/spreadsheets/d/1XfMQxFp7etSaG-8aHMvjEPfE9HGoDlM-2_y7KKtE0hY/edit' },
      { label: 'GLB upload folder', url: 'https://drive.google.com/drive/folders/1CIm-RBi5mBjOwCZbPmCEtsXD7olSrfpP' },
      { label: 'waveink.ae', url: 'https://www.waveink.ae' },
    ],
    notes:
      'Retainer 3,000 AED a month from 1 Sep 2026, paid around the 1st (Sibi mails a transfer reference). ' +
      'Deliver GLB / glTF 2.0, PBR textured, browser-ready; upload to the shared Drive folder named by Jasani code. ' +
      'Fill the Daily Update Log and send it to Sibi every Friday EOD. Weekly Demo on Google Meet, Wednesdays 7:30 PM IST. Contacts: Sibi Iype (co-founder), Ahmed Abudaff.',
  },
  {
    id: 'metaztech',
    name: 'MetaZtech',
    role: 'Freelance L3 3D Artist',
    color: '#7c3aed',
    currency: 'INR',
    pay: {
      kind: 'tiered',
      tiers: { simple: 900, complex: 1200, super: 1500, super1: 1800, super2: 2400 },
      tdsPercent: 1,
      payoutFrom: 3,
      payoutTo: 10,
    },
    match: {
      domains: ['metaztech.ai'],
      names: ['Ritu Agrawal', 'Sharon', 'Divya Kanneganti', 'Pratignya', 'Santhosh Kumar', 'Manikanta', 'Anjali', 'Riyazuddin', 'Dheeraj', 'Janam Praveen', 'Bestha'],
      keywords: ['metaztech', 'core prod team'],
    },
    links: [
      { label: 'CMS dashboard', url: 'https://cms.metaztech.ai/dashboard' },
      { label: 'Microsoft Teams', url: 'https://teams.microsoft.com' },
    ],
    notes:
      'Paid per approved model: ₹900 simple/medium/retexture/secondary, ₹1,200 complex, ₹1,500 super complex, ₹1,800 SC-1, ₹2,400 SC-2+. ' +
      '1% TDS. Paid monthly between the 3rd and 10th. PM: Sharon Rosalia; team lead on Teams: Ritu Agrawal. ' +
      'From Teams: work on rejections first, upload SPP, aim for 1–2 files a day, super complex jobs were put on hold on 27 Sep, ' +
      'and management said it will remove low performers after 10 Oct.',
  },
  {
    id: 'skeidar',
    name: 'Skeidar',
    role: 'Generative AI fabric variations (Teams)',
    color: '#ea580c',
    currency: 'AED',
    pay: { kind: 'per-item', rate: 5, unit: 'image' },
    match: { domains: ['skeidar.no'], names: [], keywords: ['skeidar', 'skediar'] },
    links: [{ label: 'Microsoft Teams', url: 'https://teams.microsoft.com' }],
    notes: 'Each job: 2 source images and a list of fabrics; make every image in every fabric. 5 AED per finished image. Files live in D:\\Files\\Projects\\Skediar\\genrativeAI.',
  },
];

/** Waveink apparel from the PP Apparel Hub catalogue PDF; none of these are in the Tech sheet. */
const APPAREL: [string, string, string][] = [
  ['Premium Cotton T-Shirt 200 GSM', 'T-Shirts', 'Single jersey, 100% cotton. Black, White, Navy. XS–2XL.'],
  ['Cotton T-Shirt 180 GSM', 'T-Shirts', 'Single jersey, 100% cotton. 21 colours. XS–4XL.'],
  ['Premium Polo T-Shirt 220 GSM', 'Polos', '60% cotton / 40% polyester. About 22 colours. XS–4XL.'],
  ['Premium Sweatshirt 320 GSM', 'Sweats & Hoodies', '60/40 cotton-poly. White, Black, Navy, Maroon, Grey, Pink. XS–3XL.'],
  ['Premium Hoodie 320 GSM', 'Sweats & Hoodies', '100% cotton, kangaroo pocket, drawcords. 8 colours. XS–4XL.'],
  ['Premium Kids Hoodie 320 GSM', 'Kids', '60/40 cotton-poly. 7 colours. 6 months–16 years.'],
  ['Premium Kids Polo 220 GSM', 'Kids', '60/40 cotton-poly. 6 colours. 6 months–16 years.'],
  ['Premium Kids T-Shirt 180 GSM', 'Kids', '60/40 cotton-poly. 12 colours. 6 months–16 years.'],
  ['Premium Trousers / Joggers 320 GSM', 'Bottoms & Suits', '60/40 cotton-poly, cuffed. Black, White, Grey, Navy. XS–4XL.'],
  ['Premium Trousers 240 GSM', 'Bottoms & Suits', '100% cotton, straight hem. White, Black, Navy, Grey. XS–4XL.'],
  ['Premium Full Suit / Tracksuit 320 GSM', 'Bottoms & Suits', 'Hoodie + joggers set. White, Black, Navy, Grey. XS–3XL.'],
  ['Dad Hat', 'Headwear', 'Curved visor 6-panel cap.'],
  ['Snapback Cap', 'Headwear', 'Flat visor snapback.'],
  ['Hit Cap', 'Headwear', 'Curved visor cap.'],
  ['Rapper Cotton Trucker Cap', 'Headwear', 'Cotton front, mesh back.'],
  ['Sonic Trucker Cap', 'Headwear', 'Mesh back trucker.'],
  ['Bucket Hat', 'Headwear', 'Many colours.'],
  ['Lab Coat', 'Uniforms', 'Hospital uniform.'],
  ['Medical Scrubs (top + pants)', 'Uniforms', 'Hospital uniform.'],
  ['Apron', 'Uniforms', 'Hotel uniform.'],
  ['Chef Coat', 'Uniforms', 'Hotel uniform, double-breasted with piping.'],
  ['Corporate Shirt (short sleeve)', 'Uniforms', 'Corporate uniform.'],
  ['Corporate Shirt (long sleeve)', 'Uniforms', 'Corporate uniform.'],
  ['Safety Coverall with reflective tape', 'Uniforms', 'Safety uniform.'],
  ['Hi-Vis Safety Vest', 'Uniforms', 'Safety uniform, several colours.'],
  ['School Uniform (shirt, tie, trousers / skirt)', 'Uniforms', 'School uniform.'],
  ['Security Shirt', 'Uniforms', 'Security uniform.'],
  ['Hi-Vis Security Jacket', 'Uniforms', 'Security uniform.'],
  ['Bath Towel', 'Towels', 'Terry towel.'],
  ['Hand Towel', 'Towels', 'Terry towel with border.'],
  ['Corporate Gift Box Set', 'Corporate Gifts', 'Magnetic box with notebook, bottle and accessories.'],
  ['Pen Gift Box', 'Corporate Gifts', ''],
  ['Notebook', 'Corporate Gifts', ''],
  ['Insulated Water Bottle', 'Corporate Gifts', ''],
  ['Travel Cup / Tumbler', 'Corporate Gifts', ''],
  ['Keychain', 'Corporate Gifts', ''],
  ['Retractable Multi-Cable', 'Corporate Gifts', ''],
  ['Canvas Tote Bag', 'Bags', ''],
  ['Jute Bag', 'Bags', ''],
];

const SUBSCRIPTIONS: Omit<Subscription, 'id'>[] = [
  { name: 'Claude Pro', vendor: 'Anthropic (Google Play)', amount: 1999, currency: 'INR', cycle: 'monthly', nextRenewal: '2026-11-06', lastCharged: '2026-10-06', status: 'active', paymentMethod: 'UPI: GPay', category: 'work', source: 'seed', emailId: '1a110ce48908a0f0' },
  { name: 'LinkedIn Premium', vendor: 'LinkedIn (Google Play)', amount: 1850, currency: 'INR', cycle: 'monthly', nextRenewal: '2026-11-04', lastCharged: '2026-10-04', status: 'active', paymentMethod: 'UPI: GPay', category: 'work', notes: 'Trial ended 4 Sep 2026.', source: 'seed', emailId: '1a108302b3d902cf' },
  { name: 'Google AI Pro (5 TB)', vendor: 'Google One (Google Play)', amount: 210, currency: 'INR', cycle: 'monthly', nextRenewal: '2026-10-09', lastCharged: '2026-09-09', status: 'active', paymentMethod: 'UPI: GPay', category: 'work', source: 'seed', emailId: '1a0858ab515a8f6d' },
  { name: 'Tripo AI Starter (annual)', vendor: 'Tripo AI', amount: 1986.6, currency: 'INR', cycle: 'yearly', nextRenewal: '2027-09-16', lastCharged: '2026-09-16', status: 'active', paymentMethod: 'UPI via Link', category: 'work', source: 'seed', emailId: '1a0ae1b08b086c3b' },
  { name: 'Chaos V-Ray (annual)', vendor: 'Chaos', amount: 540, currency: 'USD', cycle: 'yearly', lastCharged: '2026-09-28', endsOn: '2027-09-28', status: 'cancelling', category: 'work', notes: 'Auto-renew turned off on 28 Sep 2026; licence stays active until 28 Sep 2027.', source: 'seed', emailId: '1a0e9674eef72d7a' },
  { name: 'ChatGPT Go', vendor: 'OpenAI (Google Play)', amount: null, currency: 'INR', cycle: 'yearly', endsOn: '2026-11-09', status: 'cancelling', category: 'work', notes: 'Cancelled; access ends 9 Nov 2026.', source: 'seed', emailId: '19d3acb021503880' },
];

/** Gaps found in the portfolio artifact (claude.ai/artifact/CVzrqrT88oH78BFdp9wELz) on 9 Oct 2026. */
const PORTFOLIO: [string, string, string][] = [
  ['Turntables', 'Trapani Rattan turntable model', 'Page shows a clay placeholder; add assets/models/trapani.glb.'],
  ['Turntables', 'MoonShot turntable model', 'Clay placeholder; add assets/models/moonshot.glb.'],
  ['Turntables', 'Casa Copenhagen Pro Gear turntable model', 'Clay placeholder; add assets/models/casa.glb.'],
  ['Turntables', 'Skeidar Room Sets turntable model', 'Clay placeholder; add assets/models/skeidar.glb.'],
  ['Turntables', 'Spaces That Speak turntable model', 'Clay placeholder; add assets/models/events.glb.'],
  ['Turntables', 'Middle East × Scandinavian turntable model', 'Clay placeholder; add assets/models/mideast.glb.'],
  ['Turntables', 'Prop Creation turntable model', 'Clay placeholder; add assets/models/props.glb.'],
  ['Turntables', 'Imperial Hangar turntable model', 'Clay placeholder; add assets/models/hangar.glb.'],
  ['Content', 'Add Behance links to Skeidar Room Sets and Spaces That Speak', 'The other six project pages link to Behance; these two do not.'],
  ['Content', 'Add current freelance work to About and the resume', 'Experience stops at Skeidar (2025–26) and the resume says "updated August 2026". Add Waveink (3D GLB product modeler, Sep 2026–) and MetaZtech (L3 3D artist, Sep 2026–).'],
  ['Content', 'Add a real-time / web GLB project', 'Show browser-ready GLB product models (Waveink style work) with the turntable viewer the site already has.'],
  ['Polish', 'Add a favicon and social share preview', 'No favicon, og:title or og:image tags, so shared links show a blank card.'],
  ['Polish', 'Compress the motion reels', 'About 23 MB of MP4 across 13 reels; smaller files load faster on phones.'],
  ['Launch', 'Publish on your own domain or GitHub Pages', 'It only lives at a claude.ai artifact link right now. The ClaudeUnityTrial GitHub Pages deploy failed on 7 Oct.'],
];

function id(prefix: string, i: number | string): string {
  return `${prefix}-${String(i).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

export function initialState(now: string): AppState {
  const models: Model[] = [];
  for (const p of catalog as CatalogProduct[]) {
    const s = p.catalogStatus;
    const status = s.startsWith('done') ? 'done' : s === 'no' ? 'skipped' : 'todo';
    models.push({
      id: id('wi', p.code),
      company: 'waveink',
      name: p.name,
      code: p.code,
      group: 'Tech',
      subcategories: p.subcategories,
      status,
      revised: s === 'done (r)' || undefined,
      percent: status === 'done' ? 100 : 0,
      description: p.description,
      brand: p.brand,
      colour: p.colour,
      brandingAreas: p.brandingAreas,
      printMethods: p.printMethods,
      variants: p.variants,
      areas: p.areas,
      hasPrintArea: p.hasPrintArea,
      jasaniId: p.jasaniId,
      templateId: p.templateId,
      sourceUrls: p.sourceUrls,
      rows: p.rows,
      source: 'catalog',
      createdAt: now,
      updatedAt: now,
      completedAt: status === 'done' ? '2026-10-05T08:13:09.000Z' : undefined,
      history: [],
    });
  }
  APPAREL.forEach(([name, sub, description], i) => {
    models.push({
      id: id('wa', `${i + 1}-${name}`),
      company: 'waveink',
      name,
      code: `APP-${String(i + 1).padStart(2, '0')}`,
      group: 'Apparel',
      subcategories: [sub],
      status: 'todo',
      percent: 0,
      description: description ? `${description} (PP Apparel Hub catalogue 2025)` : 'PP Apparel Hub catalogue 2025',
      source: 'apparel-pdf',
      createdAt: now,
      updatedAt: now,
      history: [],
    });
  });

  const tasks: PortfolioTask[] = PORTFOLIO.map(([group, title, detail], i) => ({
    id: id('pf', i + 1),
    group,
    title,
    detail,
    done: false,
    createdAt: now,
  }));

  return {
    version: SEED_VERSION,
    companies: COMPANIES,
    models,
    skeidarJobs: [],
    payments: [
      {
        id: 'pay-wi-2026-09',
        company: 'waveink',
        date: '2026-10-01',
        amount: 3000,
        currency: 'AED',
        period: '2026-09',
        reference: '33TF068381319',
        note: 'Salary Transfer Reference – September 2026 (receipt confirmed to Sibi)',
        source: 'seed',
        emailId: '1a0f62fc0db37984',
      },
    ],
    subscriptions: SUBSCRIPTIONS.map((s, i) => ({ ...s, id: id('sub', `${i + 1}-${s.name}`) })),
    emails: [],
    meetings: [],
    portfolioTasks: tasks,
    portfolioLog: [],
    suggestions: [],
    handledEmails: ['1a0f62fc0db37984', ...SUBSCRIPTIONS.map(s => s.emailId!).filter(Boolean)],
    settings: {
      google: { clientId: '', clientSecret: '', connected: false },
      baseCurrency: 'INR',
      rates: { INR: 1, AED: 24, USD: 88 },
      syncMinutes: 15,
      notifications: true,
      launchAtStartup: false,
      skeidarFolder: 'D:\\Files\\Projects\\Skediar\\genrativeAI',
      waveinkDriveFolderId: '1CIm-RBi5mBjOwCZbPmCEtsXD7olSrfpP',
      metaztechPortalUrl: 'https://cms.metaztech.ai/dashboard',
      portfolioUrl: 'https://claude.ai/artifact/CVzrqrT88oH78BFdp9wELz',
      portalMappings: [],
      theme: 'system',
    },
  };
}
