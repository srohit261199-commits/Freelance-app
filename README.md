# Freelance Hub

A Windows desktop app that keeps Rohit's freelance work in one place:

- **Waveink**: 3D GLB product models. All 199 Tech catalog products are preloaded from *Tech_Products Designer.xlsx* (284 rows, folded by Jasani code), plus 39 apparel models from the PP Apparel Hub catalogue PDF. Mark status in one click, see which GLBs are already in the shared Drive folder, and **Export Excel** to get the catalog back with *3D Model Status* filled in, the GLB Task Tracker columns, and a ready-made **Daily Update Log** for the Friday mail to Sibi.
- **MetaZtech**: models pulled from the CMS dashboard (cms.metaztech.ai) or pasted from any table, with submitted / rejected / approved status, rejection count and the complexity fee (₹900 to ₹2,400, minus 1% TDS).
- **Skeidar**: generative AI fabric jobs (2 images × N fabrics, 5 AED per image) with a tick grid and a scan of `D:\Files\Projects\Skediar\genrativeAI`.
- **Today**: what to do next. It lists rejections to fix, meetings, the Friday report, payments that should have arrived, renewals and the next models in each queue.
- **Inbox & meetings**: Waveink and MetaZtech mail, Microsoft Teams notification mails (sorted by sender name), and Google Calendar meetings with Join buttons. Invites mailed by Outlook / Teams are picked up too.
- **Earnings**: what you've earned against what you've received and what's still owed, by company and month. Waveink is a 3,000 AED retainer and salary mails are recorded automatically. MetaZtech pays per approved model; Skeidar pays per image.
- **Subscriptions**: software subscriptions found in Gmail receipts (Google Play, Stripe / Link, Chaos), kept current on every sync, plus manual entries.
- **Portfolio**: pending work on the portfolio site, with a dated update log.

Everything is stored locally in `%APPDATA%\Freelance Hub\freelance-hub.json`. The app also keeps a daily backup for 14 days.

## Install

1. Open the repository's **Actions** tab, then the latest **Build Windows app** run, and download the **FreelanceHub-Windows** artifact. It contains:
   - `FreelanceHub-Setup-1.0.0.exe`, an installer with a Start-menu entry, and
   - `FreelanceHub-Portable-1.0.0.exe`, a single file you can run from anywhere.
2. The app isn't code-signed, so Windows SmartScreen may say *Windows protected your PC*. Click **More info → Run anyway**.

## Connect Google (one time, about 10 minutes)

The app reads Gmail, Calendar and Drive with **read-only** access, through your own Google Cloud OAuth client. The same steps are shown in the app under **Settings → Google account**.

1. Go to <https://console.cloud.google.com/projectcreate> and create a project called **Freelance Hub**.
2. Enable the **Gmail API**, **Google Calendar API** and **Google Drive API** (APIs & Services → Library).
3. Open **Google Auth Platform → Get started**. Set the app name to *Freelance Hub*, the audience to **External**, and use your Gmail as the support and contact email.
4. Under **Audience**, add `s.rohit.261199@gmail.com` as a test user, then click **Publish app → In production**. If you leave it in *Testing*, Google signs you out every 7 days.
5. Under **Clients → Create client**, choose **Desktop app**, then **Download JSON**.
6. In the app, go to **Settings → Load client JSON → Connect**. When Google warns that the app isn't verified (it's your own app), click **Advanced → Go to Freelance Hub** and allow access.

After that, the app syncs every 15 minutes, and you can also click **Sync Gmail & Calendar**.

## MetaZtech dashboard

1. On the MetaZtech page, click **Open portal**. Log in once; the session is saved in the app.
2. Open the page that lists your models, then click **Pull from portal**.
3. Tell it which column is the ID, name, status, complexity and rejections. It remembers this mapping for next time.
4. Pulling again updates existing models instead of duplicating them. Status words are mapped for you (rejected → Rejected, submitted / QC → Submitted, approved → Approved, hold → On hold).

If a page won't pull, select the table in the portal, copy it, and use **Paste a table**.

## Build from source

```bash
npm ci
npm test               # logic tests
npm run dev            # run with hot reload
npm run dist:win       # on Windows: installer + portable exe in release/
npm run dist:win:linux # on Linux: portable exe without the embedded exe icon
```

`scripts/make_seed.py <catalog.xlsx>` regenerates `src/main/seed/waveink-tech.json` if Waveink sends a new catalog. The client spreadsheet itself is not committed.
