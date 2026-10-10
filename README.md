# Freelance Hub

A Windows desktop app that keeps Rohit's freelance work in one place:

- **Waveink**: 3D GLB product models. All 199 Tech catalog products are preloaded from *Tech_Products Designer.xlsx* (284 rows, folded by Jasani code), plus 39 apparel models from the PP Apparel Hub catalogue PDF. Mark status in one click, see which GLBs are already in the shared Drive folder, and **Export Excel** to get the catalog back with *3D Model Status* filled in, the GLB Task Tracker columns, and a ready-made **Daily Update Log** for the Friday mail to Sibi.
- **MetaZtech**: models pulled from the CMS dashboard (cms.metaztech.ai) or pasted from any table, with submitted / rejected / approved status, rejection count and the complexity fee (₹900 to ₹2,400, minus 1% TDS).
- **Skeidar**: generative AI fabric jobs (master photos × fabrics, 5 AED per image). Each subfolder of `D:\Files\Projects\Skediar\genrativeAI` becomes a job: the supplier sheet gives the fabrics, the photos give the angles, and finished images saved in the job's `output` folder tick themselves off. It also writes the prompt for each image for the AI tool.
- **Clients you add**: any new client or engagement, with its start date, weekly target (e.g. 10 models a week), recurring deadlines (a weekly demo, a Friday report) and notes. The app uses them to decide what's urgent.
- **Today**: what to do next. It lists rejections to fix, meetings, the Friday report, payments that should have arrived, renewals and the next models in each queue.
- **Inbox & meetings**: Waveink and MetaZtech mail, Microsoft Teams notification mails (sorted by sender name), and Google Calendar meetings with Join buttons. Invites mailed by Outlook / Teams are picked up too.
- **Earnings**: what you've earned against what you've received and what's still owed, by company and month. Waveink is a 3,000 AED retainer and salary mails are recorded automatically. MetaZtech pays per approved model; Skeidar pays per image.
- **Subscriptions**: software subscriptions found in Gmail receipts (Google Play, Stripe / Link) and in Autodesk, Adobe and Chaos order and renewal mails, read from your software accounts' plans pages, or added by hand, with licence type and seats.
- **Portfolio**: pending work on the portfolio site, with a dated update log.

Everything is stored locally in `%APPDATA%\Freelance Hub\freelance-hub.json`. The app also keeps a daily backup for 14 days.

## Install

1. Open the repository's **Releases** page (<https://github.com/srohit261199-commits/Freelance-app/releases/latest>) and download one of:
   - `FreelanceHub-Setup-1.1.0.exe`, an installer with a Start-menu entry, or
   - `FreelanceHub-Portable-1.1.0.exe`, a single file you can run from anywhere.
2. The app isn't code-signed, so Windows SmartScreen may say *Windows protected your PC*. Click **More info → Run anyway**.
3. Installing a new version over an old one keeps your data: it lives in `%APPDATA%\Freelance Hub`, not in the program folder.

Every push also builds both files; they're under the repository's **Actions** tab → latest **Build Windows app** run → **FreelanceHub-Windows** artifact.

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

## Skeidar job folders

1. Make one folder per job inside the Skeidar folder, e.g. `genrativeAI\Justin stol`.
2. Put the supplier's sheet (`.xlsx` or `.csv`) and the master photos in it. Photo names give the angles: `… - front.jpg`, `… - back.jpg`, `… - 3-4.jpg`.
3. The job appears on the Skeidar page by itself, with every fabric × photo as a tile. Leg or frame options in the sheet don't need their own images.
4. Use **Prompts for the image tool** to copy each prompt, then save the result in the job's `output` folder under the file name shown (the fabric's item number works too, e.g. `1398521_front.jpg`). The tile ticks itself off.

Other clients can link a folder as well; its sheets, briefs, photos and 3D files are listed on the client's page.

## Software accounts

1. On **Subscriptions → Software accounts**, add Autodesk, Adobe, Chaos or any other vendor with a plans page.
2. Click **Open** and sign in on the vendor's own page. Each account has its own saved session in the app; your password never passes through the app.
3. Click **Read plans**. The app reads the plans page and shows the products, prices, renewal dates and licence it found. Correct anything, untick what you don't want, and save.

Order, invoice, trial and renewal mails from these vendors are read on every Gmail sync, so a cancelled auto-renew or a new price shows up without opening the account. Promotional mail is ignored.

## Build from source

```bash
npm ci
npm test               # logic tests
npm run dev            # run with hot reload
npm run dist:win       # on Windows: installer + portable exe in release/
npm run dist:win:linux # on Linux: portable exe without the embedded exe icon
```

`scripts/make_seed.py <catalog.xlsx>` regenerates `src/main/seed/waveink-tech.json` if Waveink sends a new catalog. The client spreadsheet itself is not committed.
