/** The three clients the app was built around; more can be added by hand. */
export type BuiltInCompanyId = 'waveink' | 'metaztech' | 'skeidar';
/** A client ("job"). Built-in ids keep their own screens; any other string is a client added by hand. */
export type CompanyId = BuiltInCompanyId | (string & {});
export type Currency = 'INR' | 'AED' | 'USD';

/** One status vocabulary for every company; each company shows its own labels for it. */
export type ModelStatus =
  | 'todo'
  | 'in_progress'
  | 'review'
  | 'revision'
  | 'done'
  | 'live'
  | 'on_hold'
  | 'skipped';

/** MetaZtech fee tiers, cheapest first. */
export type Complexity = 'simple' | 'complex' | 'super' | 'super1' | 'super2';

export interface StatusEvent {
  at: string;
  from: ModelStatus | null;
  to: ModelStatus;
  note?: string;
  /**
   * 'status' (or missing): a status change Rohit made or a later portal pull found.
   * 'progress': % complete, GLB name or notes changed; from and to are the unchanged status.
   * 'import': the status a model already had when it was first imported; not counted as work.
   */
  kind?: 'status' | 'progress' | 'import';
  field?: 'percent' | 'glb' | 'notes';
}

export interface Model {
  id: string;
  company: CompanyId;
  name: string;
  /** Jasani code for Waveink, job/asset id for MetaZtech. */
  code?: string;
  /** "Tech" or "Apparel" for Waveink, project name for MetaZtech. */
  group?: string;
  subcategories?: string[];
  status: ModelStatus;
  complexity?: Complexity;
  /** How many times MetaZtech sent it back. */
  revisions?: number;
  percent?: number;
  /** % complete before it was marked done, restored if Done is undone. */
  percentBeforeDone?: number;
  glbFile?: string;
  driveFileUrl?: string;
  driveModifiedAt?: string;
  notes?: string;
  description?: string;
  brand?: string;
  colour?: string;
  brandingAreas?: string;
  printMethods?: string;
  variants?: string;
  areas?: string;
  hasPrintArea?: boolean;
  jasaniId?: string;
  templateId?: string;
  sourceUrls?: string[];
  /** Row positions in the Waveink catalog, so the export keeps its order. */
  rows?: number[];
  /** "done (R)" in the catalog: delivered, then revised. */
  revised?: boolean;
  source: 'catalog' | 'apparel-pdf' | 'portal' | 'manual';
  portalRow?: Record<string, string>;
  portalUrl?: string;
  dueDate?: string;
  starred?: boolean;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  /** Imported already approved with no approval date; counted in the month it was imported. */
  completedAtApprox?: boolean;
  history: StatusEvent[];
}

export interface SkeidarJob {
  id: string;
  /** Client the job belongs to; missing means Skeidar. */
  company?: CompanyId;
  name: string;
  receivedAt: string;
  /** Labels of the source images (usually two). */
  images: string[];
  fabrics: string[];
  /** Key `${fabricIndex}:${imageIndex}` is set once that output image is made. */
  done: Record<string, boolean>;
  folder?: string;
  notes?: string;
  status: 'open' | 'delivered';
  deliveredAt?: string;
  createdAt: string;
  /** Set when the job was built from a folder: the product named in the client's sheet. */
  product?: string;
  /** Path of the sheet the fabrics came from. */
  sheet?: string;
  /** Item numbers per fabric (one per leg finish or other option), from the sheet. */
  itemIds?: Record<string, string[]>;
  /** Other options in the sheet that don't need their own images, e.g. leg finishes. */
  options?: string[];
  /** Master photo file for each entry in `images`, same order. */
  imageFiles?: string[];
  /** Finished image found in the output folder for a `${fabricIndex}:${imageIndex}` key. */
  outputs?: Record<string, string>;
  /** What the folder said about photos and fabrics at the last sync; while it says the same, edits made in the app stay. */
  folderSig?: string;
}

export interface Payment {
  id: string;
  company: CompanyId;
  date: string;
  amount: number;
  currency: Currency;
  /** Month the payment is for, e.g. "2026-09". */
  period?: string;
  reference?: string;
  note?: string;
  source: 'email' | 'manual' | 'seed';
  emailId?: string;
  /** Amount in the company's own currency, fixed at the rate on the day it was recorded. */
  settledAmount?: number;
}

export type SubStatus = 'active' | 'trial' | 'cancelling' | 'cancelled';

export interface Subscription {
  id: string;
  name: string;
  vendor: string;
  amount: number | null;
  currency: Currency;
  cycle: 'monthly' | 'yearly' | 'one-off';
  nextRenewal?: string;
  /** Last day of access for a cancelled or cancelling plan. */
  endsOn?: string;
  lastCharged?: string;
  status: SubStatus;
  paymentMethod?: string;
  category: 'work' | 'personal';
  notes?: string;
  source: 'email' | 'manual' | 'seed' | 'account';
  emailId?: string;
  /** Software account (Autodesk, Adobe, Chaos…) this plan was read from or belongs to. */
  accountId?: string;
  /** How the software is licensed; missing means a normal subscription. */
  licence?: 'subscription' | 'perpetual' | 'education' | 'free' | 'trial';
  seats?: number;
}

export type VendorId = 'autodesk' | 'adobe' | 'chaos' | (string & {});

/** A vendor account the app signs in to (in its own window) to read the plans page. */
export interface SoftwareAccount {
  id: string;
  vendor: VendorId;
  label: string;
  email?: string;
  /** Page that lists the account's plans and renewal dates. */
  plansUrl: string;
  lastRead?: string;
  lastError?: string;
  createdAt: string;
}

/** A plan read from a vendor's account page or mail, before it becomes a Subscription. */
export interface FoundPlan {
  product: string;
  plan?: string;
  amount?: number;
  currency?: Currency;
  cycle?: Subscription['cycle'];
  renews?: string;
  ends?: string;
  status?: SubStatus;
  licence?: Subscription['licence'];
  /** The text the plan was read from, shown so Rohit can check it. */
  raw: string;
}

/** A file in a client's or job's folder. */
export interface AssetFile {
  path: string;
  name: string;
  /** Path relative to the folder that was listed. */
  rel: string;
  kind: 'sheet' | 'image' | 'pdf' | 'model' | 'doc' | 'archive' | 'other';
  size: number;
  modified: string;
}

/** One row of a client's product sheet (e.g. Skeidar's supplier template). */
export interface SheetVariant {
  itemId?: string;
  product: string;
  /** Row description, e.g. "Tekstil Kiara 851 Beige med sorte ben". */
  text: string;
  fabric: string;
  /** What else varies, e.g. the leg finish. */
  option?: string;
}

export interface ParsedSheet {
  path: string;
  product?: string;
  variants: SheetVariant[];
  /** Unique fabrics in sheet order with every item number and option they come in. */
  fabrics: { name: string; itemIds: string[]; options: string[] }[];
  warnings: string[];
}

/** What the app found in one job folder. */
export interface JobFolderInfo {
  folder: string;
  name: string;
  files: AssetFile[];
  /** Photos to make variations of (images outside the output folder). */
  masters: AssetFile[];
  /** Finished images (in a subfolder named output, done, final, renders or delivered). */
  outputs: AssetFile[];
  sheet?: ParsedSheet;
}

/** Weekly expectations for a client, used to decide what is urgent. */
export interface Expectations {
  /** e.g. 5 models a week, or 2 files a day. */
  target?: { count: number; per: 'day' | 'week'; unit: string; counts: 'done' | 'submitted' | 'images' };
  /** Recurring deadlines; weekday 0 = Sunday … 6 = Saturday; time "HH:MM" local. */
  deadlines?: { id: string; label: string; weekday: number; time?: string }[];
  /** Days that count as working days when pacing a weekly target (default Monday–Friday). */
  workdays?: number[];
  notes?: string;
}

export type EmailCompany = CompanyId | 'other';

export interface EmailItem {
  id: string;
  threadId: string;
  company: EmailCompany;
  from: string;
  fromName: string;
  subject: string;
  snippet: string;
  date: string;
  unread: boolean;
  url: string;
  kind: 'mail' | 'teams' | 'payment' | 'invite' | 'receipt';
  /** Words that make the mail look like it needs action. */
  attention: string[];
}

export interface Meeting {
  id: string;
  company: EmailCompany;
  title: string;
  start: string;
  end?: string;
  joinUrl?: string;
  link?: string;
  organizer?: string;
  source: 'calendar' | 'email';
}

export interface PortfolioTask {
  id: string;
  title: string;
  detail?: string;
  group: string;
  done: boolean;
  createdAt: string;
  doneAt?: string;
}

export interface LogEntry {
  id: string;
  date: string;
  text: string;
}

export interface Suggestion {
  id: string;
  kind: 'payment' | 'subscription';
  emailId: string;
  emailUrl: string;
  title: string;
  detail: string;
  payment?: Partial<Payment>;
  subscription?: Partial<Subscription>;
  createdAt: string;
}

export type PayRule =
  | { kind: 'retainer'; amount: number; startDate: string; payday: number }
  | { kind: 'tiered'; tiers: Record<Complexity, number>; tdsPercent: number; payoutFrom: number; payoutTo: number }
  | { kind: 'per-item'; rate: number; unit: string };

export interface CompanyConfig {
  id: CompanyId;
  name: string;
  role: string;
  color: string;
  currency: Currency;
  pay: PayRule;
  /** Used to sort mail, Teams notifications and meetings into this company. */
  /** Mail domains, exact addresses (for people who write from personal Gmail), sender names and subject words. */
  match: { domains: string[]; emails?: string[]; names: string[]; keywords: string[] };
  links: { label: string; url: string }[];
  notes: string;
  /** 'models': a list of models with statuses (Waveink, MetaZtech). 'variations': fabric/variation jobs (Skeidar). */
  workflow?: 'models' | 'variations';
  /** When the engagement started (and ended, if it has). */
  startDate?: string;
  endDate?: string;
  expectations?: Expectations;
  /** Watched folder: each subfolder is a job, other files are the client's assets. */
  folder?: string;
  archived?: boolean;
  /** One of the three clients the app ships with; can't be removed. */
  builtIn?: boolean;
}

export interface PortalMapping {
  /** Header row the mapping was made for, joined with "|". */
  signature: string;
  fields: Partial<Record<PortalField, number>>;
}

export type PortalField = 'id' | 'name' | 'status' | 'complexity' | 'revisions' | 'due' | 'approved' | 'project';

export interface Settings {
  google: {
    clientId: string;
    clientSecret: string;
    connected: boolean;
    email?: string;
    lastSync?: string;
    lastError?: string;
  };
  baseCurrency: Currency;
  /** Value of one unit of each currency in the base currency. */
  rates: Record<Currency, number>;
  syncMinutes: number;
  notifications: boolean;
  launchAtStartup: boolean;
  skeidarFolder: string;
  waveinkDriveFolderId: string;
  metaztechPortalUrl: string;
  portfolioUrl: string;
  portalMappings: PortalMapping[];
  theme: 'system' | 'light' | 'dark';
}

export interface AppState {
  version: number;
  companies: CompanyConfig[];
  models: Model[];
  skeidarJobs: SkeidarJob[];
  payments: Payment[];
  subscriptions: Subscription[];
  emails: EmailItem[];
  meetings: Meeting[];
  portfolioTasks: PortfolioTask[];
  portfolioLog: LogEntry[];
  suggestions: Suggestion[];
  /** Email ids already turned into a payment, subscription or dismissed suggestion. */
  handledEmails: string[];
  accounts: SoftwareAccount[];
  settings: Settings;
}

export type Collection =
  | 'models'
  | 'skeidarJobs'
  | 'payments'
  | 'subscriptions'
  | 'portfolioTasks'
  | 'portfolioLog'
  | 'companies'
  | 'accounts';

export interface PortalTable {
  source: string;
  headers: string[];
  rows: string[][];
  links: string[];
}

export interface PortalSnapshot {
  url: string;
  title: string;
  tables: PortalTable[];
}

export interface FolderEntry {
  name: string;
  path: string;
  images: number;
  lastModified: string | null;
  samples: string[];
}

export interface SyncResult {
  ok: boolean;
  error?: string;
  newEmails: number;
  meetings: number;
  driveMatches: number;
  newSuggestions: number;
  newPayments: number;
}
