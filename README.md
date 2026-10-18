# Freelance Hub

A Windows desktop app that keeps Rohit's freelance work in one place:

- **Waveink**: 3D GLB product models. All 199 Tech catalog products are preloaded from *Tech_Products Designer.xlsx* (284 rows, folded by Jasani code), plus 39 apparel models from the PP Apparel Hub catalogue PDF. **Download images** saves each model's catalog photos into your output folder, in a folder named "Code - Name". Set the status from one dropdown and **Export to Excel** to get the catalog back with *3D Model Status* filled in, the GLB Task Tracker columns, and a ready-made **Daily Update Log** for the Friday report to Sibi.
- **MetaZtech**: models pulled from the CMS dashboard (cms.metaztech.ai) or pasted from any table, with submitted / rejected / approved status, rejection count and the complexity fee (₹900 to ₹2,400, minus 1% TDS). Approved jobs drop off the dashboard, so the app also reads your MetaZtech output folder: a job folder with its `.spp` file whose job is no longer on the dashboard counts as approved.
- **Skeidar**: generative AI fabric jobs (master photos × fabrics, 5 AED per image). Each subfolder of `D:\Files\Projects\Skediar\genrativeAI` becomes a job: the supplier sheet gives the fabrics, the photos give the angles, and finished images saved in the job's `output` folder tick themselves off. It also writes the prompt for each image for the AI tool.
- **Clients you add**: any new client or engagement, with its start date, weekly target (e.g. 10 models a week), recurring deadlines (a weekly demo, a Friday report) and notes. The app uses them to decide what's urgent.
- **Today**: what to do next. It lists rejections to fix, each client's recurring deadlines (the weekly demo, the Friday report), payments that should have arrived, renewals and the next models in each queue, with a calendar of deadlines, paydays and trial ends.
- **Earnings**: what you've earned against what you've received and what's still owed, by company and month. Waveink is a 3,000 AED retainer, MetaZtech pays per approved model and Skeidar pays per image; record each payment when it lands.
- **Subscriptions**: software subscriptions read from your software accounts' plans pages (Autodesk, Adobe, Chaos or any vendor with a plans page) or added by hand, with licence type and seats, and a desktop reminder the day before each renewal.
- **Portfolio**: pending work on the portfolio site, with a dated update log.

Everything is stored locally in `%APPDATA%\Freelance Hub\freelance-hub.json`. The app also keeps a daily backup for 14 days.

## Install

1. Open the repository's **Releases** page (<https://github.com/srohit261199-commits/Freelance-app/releases/latest>) and download one of:
   - `FreelanceHub-Setup-1.2.0.exe`, an installer with a Start-menu entry, or
   - `FreelanceHub-Portable-1.2.0.exe`, a single file you can run from anywhere.
2. The app isn't code-signed, so Windows SmartScreen may say *Windows protected your PC*. Click **More info → Run anyway**.
3. Installing a new version over an old one keeps your data: it lives in `%APPDATA%\Freelance Hub`, not in the program folder.

Every push also builds both files; they're under the repository's **Actions** tab → latest **Build Windows app** run → **FreelanceHub-Windows** artifact.

## MetaZtech dashboard

1. On the MetaZtech page, open **⋯ → Open CMS**. Log in once; the session is saved in the app.
2. Open the page that lists your models, then click **Pull from portal**.
3. Tell it which column is the ID, name, status, complexity and rejections. It remembers this mapping for next time.
4. Pulling again updates existing models instead of duplicating them. Status words are mapped for you (rejected → Rejected, submitted / QC → Submitted, approved → Approved, hold → On hold).

If a page won't pull, select the table in the portal, copy it, and use **⋯ → Paste a table** (tick **My whole dashboard list** if it is).

### Approved jobs from the output folder

1. Choose the output folder: **⋯ → Choose output folder** on the MetaZtech page, or **Settings → Folders and links**.
2. Keep one folder per job, named starting with its job ID (e.g. `MZ-2318 Office chair`), with the `.spp` file inside.
3. After each **Pull from portal**, and whenever the app starts, jobs that are no longer on the dashboard but have a `.spp` in their folder are marked **Approved** (with the date of that pull) and count towards income. A job the app never had is added; set its complexity so its fee counts.

## Waveink reference images

1. Choose the output folder: **⋯ → Choose output folder** on the Waveink page, or **Settings → Folders and links**.
2. Open a model and click **Download images**. The app makes `<output folder>\<Code> - <Name>\` and saves the catalog's photos there as `<Code> - 01.jpg`, `<Code> - 02.jpg`… Clicking again only fetches what's missing; the folder button opens it.
3. To get several at once, click **Select** in the list, tick the models and use **Download images** in the bar.

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

Read plans again after renewing, cancelling or changing a plan to bring the new dates and price in.

## Build from source

```bash
npm ci
npm test               # logic tests
npm run dev            # run with hot reload
npm run dist:win       # on Windows: installer + portable exe in release/
npm run dist:win:linux # on Linux: portable exe without the embedded exe icon
```

`scripts/make_seed.py <catalog.xlsx>` regenerates `src/main/seed/waveink-tech.json` if Waveink sends a new catalog. The client spreadsheet itself is not committed.
