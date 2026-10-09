/**
 * What the preview's simulated Google sync "finds": a snapshot of Rohit's own Gmail, Calendar and
 * Drive taken on 9 Oct 2026. The desktop app fetches the live versions of these.
 */
import type { RawMail } from '../shared/mail';
import type { CalEventLike } from '../shared/ingest';
import type { PortalSnapshot, FolderEntry } from '../shared/types';

const ME = 's.rohit.261199@gmail.com';
const TEAMS = 'Microsoft Teams <no-reply@teams.mail.microsoft>';
const SIBI = 'Sibi Iype <sibi@waveink.ae>';

const mail = (id: string, date: string, from: string, subject: string, snippet: string, unread = false, extra: Partial<RawMail> = {}): RawMail => ({
  id,
  threadId: id,
  from,
  to: ME,
  subject,
  snippet,
  date,
  labelIds: unread ? ['UNREAD', 'INBOX'] : ['INBOX'],
  ...extra,
});

export const SNAPSHOT_MAIL: RawMail[] = [
  // MetaZtech team lead on Teams
  mail('1a11f9cdce06c42f', '2026-10-09T07:42:13Z', TEAMS, 'Ritu Agrawal sent a message', '[Image] Hi, Ritu', true),
  mail('1a11c21dd00bdd72', '2026-10-08T15:28:50Z', TEAMS, 'Ritu Agrawal sent a message', 'please work on rejection'),
  mail('1a1144caa7a762ef', '2026-10-07T02:58:48Z', TEAMS, 'Ritu Agrawal sent a message', 'After 10th of this month Management is removing low performers', true),
  mail('1a10f73c3e431f61', '2026-10-06T04:23:22Z', TEAMS, 'Ritu Agrawal sent 2 messages to your chat', 'EOD all complexity will upgrade', true),
  mail('1a109f1bea03cc25', '2026-10-05T02:43:15Z', TEAMS, 'Santhosh Kumar P sent a message', 'Hi Good morning', true),
  mail('1a105b5e7a0e3a56', '2026-10-04T06:59:22Z', TEAMS, 'Ritu Agrawal sent a message', 'upload Spp Hi,'),
  mail('1a1057effe2fe76f', '2026-10-04T05:59:25Z', TEAMS, 'Ritu Agrawal sent a message', 'please work on rejections'),
  mail('1a0f0b473ac7389d', '2026-09-30T05:05:48Z', TEAMS, 'Ritu Agrawal sent a message', "Hi, Rohit please complete 1-2 files per day if u dont want to work on weekends, to achieve the target, thanks ..."),
  mail('1a0e6808323598ca', '2026-09-28T05:32:43Z', TEAMS, 'Ritu Agrawal sent a message', 'Management is going to ask question about zero approval'),
  mail('1a0e11bfc8e08e68', '2026-09-27T04:24:59Z', TEAMS, 'Ritu Agrawal sent 2 messages to your chat', 'please HOLD Super Complex jobs'),
  // MetaZtech mail
  mail('1a0c788a9a8c80d6', '2026-09-22T05:13:33Z', 'Divya Kanneganti <divya_kanneganti@metaztech.ai>', 'Production Pipeline Training', 'Microsoft Teams meeting Join: https://teams.microsoft.com/meet/296237542693771 Meeting ID: 296 237'),
  mail('1a0c35b98e787a14', '2026-09-21T09:45:54Z', 'MetaZtech <info@cms.metaztech.ai>', 'Your MetaZtech password was changed', 'Hello Rohit Sharma! This is a confirmation that your password was successfully changed.'),
  mail('1a0afbbf1af02c25', '2026-09-17T14:18:34Z', 'Sharon (PM) <sharon_pm@metaztech.ai>', 'Welcome to Metaztech!', 'Dear Team, Welcome to Metaztech! My name is Sharon Rosalia, and I am the Project Manager at Metaztech.'),
  mail('1a0af4214fbe9f8c', '2026-09-17T12:05:32Z', 'Pratignya Ravi Battula <rb.pratignya@metaztech.ai>', 'Re: Freelance Artist Onboarding – Information Required L3 Artist', 'Thank you for sharing the details. Next Step: You will receive an email from one of our team members regarding the next steps.'),
  // Waveink
  mail('1a0f6befe12424b2', '2026-10-01T09:14:54Z', SIBI, 'Re: Salary Transfer Reference – Rohit - September 2026', 'Dear Rohit, Thank you for the confirmation. Glad to hear it was received.'),
  mail('1a0f62fc0db37984', '2026-10-01T06:38:27Z', SIBI, 'Salary Transfer Reference – Rohit - September 2026', 'Dear Rohit Please find below the transfer reference for your salary payment for September 2026 Transfer reference: 33TF068381319 Kindly confirm receipt of the payment.'),
  mail('1a0622b89636e533', '2026-09-02T12:50:14Z', 'Google Drive <drive-shares-dm-noreply@google.com>', 'Folder shared with you: "Waveink 3D JLB Models"', 'Sibi Iype (sibi@waveink.ae) has invited you to contribute to the following shared folder: Waveink 3D JLB Models'),
  mail('1a05bd5805cdb449', '2026-09-01T07:18:21Z', SIBI, 'Re: Freelance Offer Letter & NDA — 3D Product Modeler | Waveink', 'Dear Rohit, Thank you for your prompt response and for sharing all the details — everything is in order from our end.'),
  mail('1a05bcc1683db267', '2026-09-01T07:08:16Z', 'Google Sheets <drive-shares-dm-noreply@google.com>', 'Spreadsheet shared with you: "WAVEINK.AE — 3D GLB PRODUCT TASK TRACKER"', 'Sibi Iype (sibi@waveink.ae) has invited you to edit the following spreadsheet.'),
  // Receipts
  mail('1a110ce48908a0f0', '2026-10-06T10:41:56Z', 'Google Play <googleplay-noreply@google.com>', 'Your Google Play Order Receipt from 6 Oct 2026', 'Your subscription from Anthropic, PBC on Google Play has renewed.', true, {
    body: 'Your subscription from Anthropic, PBC on Google Play has renewed.\nClaude Pro Subscription (Claude by Anthropic) ₹1,999.00/month\nPayment method:\nUPI: GPay\n',
  }),
  mail('1a108302b3d902cf', '2026-10-04T18:32:16Z', 'Google Play <googleplay-noreply@google.com>', 'Your Google Play Order Receipt from 4 Oct 2026', 'Your subscription from LinkedIn Corporation on Google Play has renewed.', true),
  mail('1a0e93f426706de8', '2026-09-28T18:20:31Z', 'Chaos <no-reply@chaos.com>', 'Your invoice #INV12441647 is ready', 'You can also view your invoices in your account', false, {
    body: 'Hello Rohit,\nWe wanted to let you know that your invoice INV12441647 is available:\nInvoice Due Date: 09/28/2026Account Balance: 540.00 USD\n',
  }),
  mail('1a0ae1b08b086c3b', '2026-09-17T06:43:21Z', 'Link <notifications@link.com>', 'Your Tripo AI receipt', 'Your receipt from Tripo AI #2604-2418', true, { body: 'Tripo AI\n₹1,986.60\nManage subscription' }),
];

/** Ids the real sync would find through the client queries rather than the receipt query. */
export const RECEIPT_IDS = new Set(['1a110ce48908a0f0', '1a108302b3d902cf', '1a0e93f426706de8', '1a0ae1b08b086c3b']);

const MEET = 'https://meet.google.com/emh-yjnj-xmi';
const demo = (day: string, startIst: string, endIst: string): CalEventLike => ({
  id: `weekly-demo-${day}`,
  summary: 'Weekly Demo',
  start: { dateTime: `${day}T${startIst}:00+05:30` },
  end: { dateTime: `${day}T${endIst}:00+05:30` },
  organizer: { email: 'danial.aftab.01@gmail.com' },
  attendees: [{ email: 'sibiabin92@gmail.com' }, { email: 'ahmedjayx@gmail.com' }, { email: 'faisalam.005@gmail.com' }, { email: ME }],
  conferenceData: { entryPoints: [{ entryPointType: 'video', uri: MEET }] },
  htmlLink: 'https://calendar.google.com/calendar/r',
});

export const SNAPSHOT_EVENTS: CalEventLike[] = [
  demo('2026-09-30', '18:30', '19:30'),
  demo('2026-10-14', '19:30', '20:30'),
  demo('2026-10-21', '19:30', '20:30'),
  demo('2026-10-28', '19:30', '20:30'),
];

export const SNAPSHOT_DRIVE = [
  { name: 'ITWC 1203.glb', webViewLink: 'https://drive.google.com/file/d/1ZcJeDeSUkI2kikFv3t_aKf9cUWreMowg/view', modifiedTime: '2026-10-03T19:57:58.039Z' },
  { name: 'ITWC 1202.glb', webViewLink: 'https://drive.google.com/file/d/1Vpgxc9UuBUY1dHOExZOhtIh7lzkYu4Rr/view', modifiedTime: '2026-10-03T19:26:07.221Z' },
  { name: 'TAMP 9113.glb', webViewLink: 'https://drive.google.com/file/d/1CRgkZQYfTYCZoqy2Ra5kL_Vtan-zgj60/view', modifiedTime: '2026-10-02T11:53:28.778Z' },
];

/** Made-up rows standing in for the MetaZtech CMS, which the preview cannot open. */
export const SAMPLE_PORTAL: PortalSnapshot = {
  url: 'https://cms.metaztech.ai/dashboard (sample page)',
  title: 'Sample portal table, not your real MetaZtech data',
  tables: [
    {
      source: 'Table 1',
      headers: ['Job ID', 'Asset name', 'Project', 'Complexity', 'Status', 'Revisions', 'Assigned on'],
      rows: [
        ['SAMPLE-101', 'Sample: lounge armchair', 'Sample project A', 'Complex', 'Rejected', '2', '2026-09-24'],
        ['SAMPLE-102', 'Sample: bar stool', 'Sample project A', 'Simple', 'Approved', '0', '2026-09-24'],
        ['SAMPLE-103', 'Sample: side table', 'Sample project A', 'Medium', 'Submitted for QC', '0', '2026-09-29'],
        ['SAMPLE-104', 'Sample: sectional sofa', 'Sample project B', 'Super Complex-1', 'On Hold', '0', '2026-09-27'],
        ['SAMPLE-105', 'Sample: floor lamp', 'Sample project B', 'Retexture', 'In Progress', '0', '2026-10-06'],
        ['SAMPLE-106', 'Sample: dining chair', 'Sample project B', 'Complex', 'Assigned', '0', '2026-10-08'],
      ],
      links: ['', '', '', '', '', ''],
    },
  ],
};

export const SAMPLE_FOLDER: FolderEntry[] = [
  { name: 'Sample job: sofa fabrics', path: 'D:\\Files\\Projects\\Skediar\\genrativeAI\\Sample job: sofa fabrics', images: 8, lastModified: '2026-10-08T12:00:00.000Z', samples: ['sofa_boucle_cream_1.png'] },
  { name: 'Sample job: armchair fabrics', path: 'D:\\Files\\Projects\\Skediar\\genrativeAI\\Sample job: armchair fabrics', images: 4, lastModified: '2026-10-06T09:30:00.000Z', samples: ['armchair_linen_1.png'] },
];
