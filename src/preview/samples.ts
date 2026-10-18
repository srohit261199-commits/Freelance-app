// Made-up samples the preview shows where the app reads the MetaZtech portal or a folder on disk.
import type { PortalSnapshot, FolderEntry } from '../shared/types';

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
