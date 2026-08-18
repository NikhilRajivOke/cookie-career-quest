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
