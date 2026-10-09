export type CompanyId = 'waveink' | 'metaztech' | 'skeidar';
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
  history: StatusEvent[];
}

export interface SkeidarJob {
  id: string;
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
  source: 'email' | 'manual' | 'seed';
  emailId?: string;
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
}

export interface PortalMapping {
  /** Header row the mapping was made for, joined with "|". */
  signature: string;
  fields: Partial<Record<PortalField, number>>;
}

export type PortalField = 'id' | 'name' | 'status' | 'complexity' | 'revisions' | 'due' | 'project';

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
  settings: Settings;
}

export type Collection =
  | 'models'
  | 'skeidarJobs'
  | 'payments'
  | 'subscriptions'
  | 'portfolioTasks'
  | 'portfolioLog'
  | 'companies';

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
