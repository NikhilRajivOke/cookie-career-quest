# Cookie's Career Quest 🍪✨

A tiny job-application tracker: paste a job posting link, it pulls in the
company, title, location, and salary, you glance it over, and it's saved to
your Google Sheet. The page also shows quick stats and a log of everything
you've applied to.

**Two parts, both free:**
- `index.html` — the site itself, hosted on GitHub Pages
- `Code.gs` + `appsscript.json` — a Google Apps Script backend bound to your
  sheet, which does the actual fetching/parsing/writing

## 1. Set up the backend (5 min)

1. Open your sheet: [Cookie's Career Quest 🍪✨](https://docs.google.com/spreadsheets/d/15b2HlPIlJ_vGS_3lhoRiZ5IJ6EuIsb_b66gXb0Erbos/edit)
2. **Extensions → Apps Script**. This opens a script editor already tied to
   this sheet.
3. Delete whatever's in the default `Code.gs` and paste in the contents of
   this project's `Code.gs`.
4. Click the `+` next to **Files**, choose **appsscript.json** isn't
   available directly — instead click the gear icon (⚙ Project Settings) and
   check **"Show appsscript.json manifest file in editor"**. A manifest
   file will appear; replace its contents with this project's
   `appsscript.json`.
5. Save (Ctrl/Cmd+S).
6. Click **Deploy → New deployment**.
   - Click the gear next to "Select type" → **Web app**.
   - Description: anything, e.g. "Career quest API"
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Click **Deploy**.
7. Google will ask you to authorize the script (it needs permission to read/
   write the sheet and fetch job pages). Click through the consent screen —
   you may see an "unverified app" warning since this is your own script;
   click **Advanced → Go to (project name)** to proceed.
8. Copy the **Web app URL** it gives you (ends in `/exec`). You'll need this
   in step 2.

Keep the script editor tab open — if you ever edit `Code.gs` again, you need
to **Deploy → Manage deployments → edit (pencil) → New version** for changes
to go live. Saving alone isn't enough.

## 2. Set up the frontend (2 min)

1. Open `index.html` in a text editor.
2. Find this line near the top of the `<script>` block:
   ```js
   const APPS_SCRIPT_URL = 'PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE';
   ```
3. Replace the placeholder with the Web app URL you copied in step 1.8.
4. Save.

## 3. Publish to GitHub Pages (5 min)

1. Create a new GitHub repository (public, or private if you're on a paid
   plan — Pages needs Pro for private repos).
2. Upload `index.html` to the repo root (drag-and-drop on github.com works
   fine, or `git add / commit / push`).
3. In the repo: **Settings → Pages**.
4. Under **Build and deployment → Source**, choose **Deploy from a branch**.
5. Branch: `main`, folder: `/ (root)`. Save.
6. Wait ~1 minute, then your site is live at
   `https://<your-username>.github.io/<repo-name>/`.

## How it works

- Pasting a link calls the Apps Script backend with `action=parse`, which
  fetches the page server-side and looks for the site's embedded structured
  job data (`JobPosting` schema) — this is what most ATS platforms
  (Greenhouse, Lever, Workday, Ashby, direct company career pages) publish.
  Where that's missing, it falls back to the page's title/meta tags.
- You get a review step before anything is saved, since scraped data is
  never 100% reliable — LinkedIn and Indeed in particular often block
  automated fetches outright, in which case you'll see a note asking you to
  fill fields in by hand.
- Saving calls `action=add`, which appends a row to your sheet.
- The stats and log at the bottom pull from `action=list` on page load and
  after every change.
- Changing an application's status dropdown calls `action=updateStatus`.
- Requests go out as `<script>` tag loads (JSONP), not `fetch()` — this is
  what lets a static GitHub Pages site talk to Apps Script without hitting
  CORS errors, which are otherwise the most common failure mode in this kind
  of setup.

## If something doesn't work

- **"Backend not connected" banner won't go away** — double-check
  `APPS_SCRIPT_URL` in `index.html` was saved and pushed to GitHub.
- **Parsing comes back mostly empty** — the site likely blocked the fetch or
  doesn't publish structured job data. Fill the review form in by hand; it
  still saves normally.
- **Nothing loads / silent failure** — open your deployed Apps Script URL
  directly in a browser with `?action=list` appended
  (`https://script.google.com/.../exec?action=list`). You should see raw
  JSON. If you see an error instead, the deployment or sheet permissions are
  the place to look.
- **Changes to Code.gs don't show up** — remember to create a **new
  deployment version**, not just save the file.

## Sheet columns

The backend will create these headers automatically the first time it runs,
if the sheet is empty:

`ID | Date Added | Company | Job Title | Location | Salary | Status | Source | Job URL | Notes | Last Updated`

You can edit rows directly in the sheet any time — the site just re-reads it
on every load.

## Job scraper (daily matches from your target companies)

A separate part of `Code.gs` scans specific companies' job boards once a day
and drops anything posted in the last 24 hours that matches your profile
into a new **Job Feed** tab. It runs entirely inside Apps Script — no changes
to the deployed web app URL, so the tracker site isn't affected.

**One-time setup:**

1. Update `Code.gs` in the Apps Script editor with the latest version from
   [GitHub](https://github.com/NikhilRajivOke/cookie-career-quest/blob/main/Code.gs)
   (this now includes the scraper functions at the bottom — the tracker code
   above it is unchanged). Save.
2. Reload the Google Sheet in your browser (a full page refresh, not just
   switching tabs). You should see a new **Job Scraper** menu appear next to
   Help.
3. Three new tabs get created automatically: **Companies**, **Match
   Profile**, **Job Feed**.
4. In the **Companies** tab, replace the example rows with real ones:
   | Company | ATS | Board ID / API URL | Active |
   |---|---|---|---|
   | Airbnb | greenhouse | `airbnb` | TRUE |
   | Netflix | lever | `netflix` | TRUE |

   - **Greenhouse board ID**: the slug in their careers URL, e.g.
     `job-boards.greenhouse.io/airbnb` → board ID is `airbnb`.
   - **Lever company slug**: the slug in `jobs.lever.co/{slug}`.
   - **Workday**: there's no standard public API — you have to find each
     tenant's endpoint manually. Open the company's Workday careers page,
     open browser devtools → Network tab, search for a job, and look for a
     POST request to a URL containing `/wday/cxs/`. Copy that full URL as
     the Board ID. Workday's list view only gives relative dates ("Posted
     Today"), so matching is less precise there than Greenhouse/Lever.
5. In the **Match Profile** tab, edit the pre-filled skills, title keywords,
   preferred locations, and minimum match score to taste. This is what
   scoring is based on — no code changes needed to adjust it.
6. From the **Job Scraper** menu: click **"Set up daily trigger (run
   once)"**. You'll be asked to authorize the script the first time — same
   consent flow as the web app deployment. This makes it run automatically
   every day around 7am from then on.
7. To test immediately instead of waiting for tomorrow: **Job Scraper → Run
   scan now**.

**How matching works:** each job gets a 0–100 score — 50 points if the title
contains any of your Title Keywords, up to 40 points scaled by how many
Must-Have Skills appear in the title/description, 10 points if the location
matches one of your Preferred Locations. Only jobs at or above your Minimum
Match Score, posted within the last 24 hours, get added — and each is only
added once (duplicates are skipped on repeat scans).

**Adding a match to your tracker:** copy the Job URL from a Job Feed row and
paste it into the tracker site like any other job link — same parse/review/
save flow.

**Menu missing?** Simple triggers like `onOpen` only fire on a real page
load, not a tab switch — refresh the sheet in your browser.
