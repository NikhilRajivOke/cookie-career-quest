/**
 * Cookie's Career Quest — backend
 * Bind this to your Google Sheet (Extensions > Apps Script), deploy as a
 * Web App, and paste the deployment URL into index.html.
 *
 * Every request is a GET so it can be transported as JSONP — this makes it
 * work from GitHub Pages with zero CORS configuration, which is the most
 * reliable way to call Apps Script from a static site.
 *
 * Actions (all via ?action=... query params):
 *   list                                -> all applications
 *   parse&url=...                       -> scrape a job posting, don't save
 *   add&company=&title=&...             -> save a new application
 *   updateStatus&id=&status=            -> change status of a row
 *   delete&id=                          -> remove a row
 */

const SHEET_ID = '15b2HlPIlJ_vGS_3lhoRiZ5IJ6EuIsb_b66gXb0Erbos';
const SHEET_NAME = 'Sheet1';
const HEADERS = ['ID', 'Date Added', 'Company', 'Job Title', 'Location',
  'Salary', 'Status', 'Source', 'Job URL', 'Notes', 'Last Updated'];

function getSheet_() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function doGet(e) {
  const params = e.parameter || {};
  const action = params.action || 'list';
  let result;
  try {
    switch (action) {
      case 'list':
        result = { success: true, data: listApplications_() };
        break;
      case 'feed':
        result = { success: true, data: listJobMatches_() };
        break;
      case 'parse':
        result = { success: true, data: parseJobUrl_(params.url) };
        break;
      case 'add':
        result = { success: true, data: addApplication_(params) };
        break;
      case 'updateStatus':
        result = { success: true, data: updateStatus_(params.id, params.status) };
        break;
      case 'delete':
        result = { success: true, data: deleteApplication_(params.id) };
        break;
      default:
        result = { success: false, error: 'Unknown action: ' + action };
    }
  } catch (err) {
    result = { success: false, error: String(err) };
  }

  const body = JSON.stringify(result);
  if (params.callback) {
    return ContentService
      .createTextOutput(params.callback + '(' + body + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(body)
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------- Sheet operations ----------

function listApplications_() {
  const sheet = getSheet_();
  const values = sheet.getDataRange().getValues();
  const rows = values.slice(1); // drop header
  return rows
    .filter(r => r[0]) // has an ID
    .map(rowToObject_)
    .sort((a, b) => new Date(b.dateAdded) - new Date(a.dateAdded));
}

function rowToObject_(r) {
  return {
    id: r[0],
    dateAdded: formatDate_(r[1]),
    company: r[2],
    title: r[3],
    location: r[4],
    salary: r[5],
    status: r[6],
    source: r[7],
    url: r[8],
    notes: r[9],
    lastUpdated: formatDate_(r[10]),
  };
}

function formatDate_(d) {
  if (!d) return '';
  if (Object.prototype.toString.call(d) === '[object Date]') {
    return Utilities.formatDate(d, Session.getScriptTimeZone() || 'America/New_York', 'yyyy-MM-dd');
  }
  return String(d);
}

function addApplication_(p) {
  const sheet = getSheet_();
  const id = Utilities.getUuid().slice(0, 8);
  const now = new Date();
  const row = [
    id,
    now,
    p.company || 'Unknown company',
    p.title || 'Unknown role',
    p.location || '',
    p.salary || '',
    p.status || 'Applied',
    p.source || '',
    p.url || '',
    p.notes || '',
    now,
  ];
  sheet.appendRow(row);
  return rowToObject_(row);
}

function findRow_(sheet, id) {
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(id)) return i + 1; // 1-indexed sheet row
  }
  return -1;
}

function updateStatus_(id, status) {
  const sheet = getSheet_();
  const rowIdx = findRow_(sheet, id);
  if (rowIdx === -1) throw new Error('Application not found: ' + id);
  sheet.getRange(rowIdx, 7).setValue(status); // Status column
  sheet.getRange(rowIdx, 11).setValue(new Date()); // Last Updated column
  const row = sheet.getRange(rowIdx, 1, 1, HEADERS.length).getValues()[0];
  return rowToObject_(row);
}

function deleteApplication_(id) {
  const sheet = getSheet_();
  const rowIdx = findRow_(sheet, id);
  if (rowIdx === -1) throw new Error('Application not found: ' + id);
  sheet.deleteRow(rowIdx);
  return { id };
}

// ---------- Job posting parser ----------

function parseJobUrl_(url) {
  if (!url) throw new Error('No URL provided');

  const response = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    followRedirects: true,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    },
  });

  const code = response.getResponseCode();
  const html = response.getContentText();
  const host = getHostname_(url);

  if (code >= 400) {
    return {
      url, source: host, blocked: true,
      company: '', title: '', location: '', salary: '', datePosted: '',
      note: 'Site returned HTTP ' + code + ' — it likely blocks automated ' +
        'fetches (common on LinkedIn/Indeed). Fill the fields in manually.',
    };
  }

  const fromLd = extractJsonLdJobPosting_(html);
  const fromMeta = extractMetaFallback_(html, host);

  const merged = {
    url,
    source: host,
    blocked: false,
    company: fromLd.company || fromMeta.company || '',
    title: fromLd.title || fromMeta.title || '',
    location: fromLd.location || fromMeta.location || '',
    salary: fromLd.salary || '',
    datePosted: fromLd.datePosted || '',
    note: fromLd.title ? '' : 'Could not find structured job data on this ' +
      'page — some fields may be blank or approximate. Please double check.',
  };
  return merged;
}

function getHostname_(url) {
  try {
    const m = url.match(/^https?:\/\/([^/]+)/i);
    let host = m ? m[1].replace(/^www\./, '') : url;
    const known = {
      'linkedin.com': 'LinkedIn', 'indeed.com': 'Indeed',
      'greenhouse.io': 'Greenhouse', 'lever.co': 'Lever',
      'myworkdayjobs.com': 'Workday', 'ashbyhq.com': 'Ashby',
      'smartrecruiters.com': 'SmartRecruiters',
    };
    for (const key in known) {
      if (host.indexOf(key) !== -1) return known[key];
    }
    return host;
  } catch (e) {
    return url;
  }
}

function extractJsonLdJobPosting_(html) {
  const out = { company: '', title: '', location: '', salary: '', datePosted: '' };
  const blocks = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  if (!blocks) return out;

  for (const block of blocks) {
    const jsonText = block.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, '');
    let data;
    try { data = JSON.parse(jsonText); } catch (e) { continue; }

    const candidates = [];
    if (Array.isArray(data)) candidates.push(...data);
    else if (data['@graph']) candidates.push(...data['@graph']);
    else candidates.push(data);

    const posting = candidates.find(c => {
      const t = c && c['@type'];
      return t === 'JobPosting' || (Array.isArray(t) && t.indexOf('JobPosting') !== -1);
    });
    if (!posting) continue;

    out.title = posting.title || '';
    out.company = (posting.hiringOrganization && posting.hiringOrganization.name) || '';
    out.datePosted = posting.datePosted || '';

    out.location = extractLocation_(posting);
    out.salary = extractSalary_(posting);
    break;
  }
  return out;
}

function extractLocation_(posting) {
  try {
    if (posting.jobLocationType === 'TELECOMMUTE' && !posting.jobLocation) return 'Remote';
    let loc = posting.jobLocation;
    if (Array.isArray(loc)) loc = loc[0];
    const addr = loc && loc.address;
    if (!addr) return posting.applicantLocationRequirements ? 'Remote' : '';
    const parts = [addr.addressLocality, addr.addressRegion, addr.addressCountry]
      .filter(Boolean);
    return parts.join(', ');
  } catch (e) {
    return '';
  }
}

function extractSalary_(posting) {
  try {
    const base = posting.baseSalary;
    if (!base) return '';
    const val = base.value;
    if (!val) return '';
    const currency = base.currency || 'USD';
    if (val.minValue && val.maxValue) {
      return currency + ' ' + Math.round(val.minValue).toLocaleString() +
        '–' + Math.round(val.maxValue).toLocaleString() +
        (val.unitText ? '/' + val.unitText.toLowerCase() : '');
    }
    if (val.value) {
      return currency + ' ' + Math.round(val.value).toLocaleString() +
        (val.unitText ? '/' + val.unitText.toLowerCase() : '');
    }
    return '';
  } catch (e) {
    return '';
  }
}

function extractMetaFallback_(html, host) {
  const out = { company: '', title: '', location: '' };
  const ogTitle = matchAttr_(html, 'og:title');
  const titleTag = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
  let raw = ogTitle || titleTag || '';
  raw = raw.replace(/&amp;/g, '&').trim();

  // LinkedIn pattern: "Company hiring Job Title in Location | LinkedIn"
  let m = raw.match(/^(.*?)\s+hiring\s+(.*?)\s+in\s+(.*?)\s*(\||$)/i);
  if (m) {
    out.company = m[1].trim();
    out.title = m[2].trim();
    out.location = m[3].trim();
    return out;
  }
  // Common pattern: "Job Title at Company" or "Job Title - Company"
  m = raw.match(/^(.*?)\s+(?:at|@|-|\|)\s+(.*)$/);
  if (m) {
    out.title = m[1].trim();
    out.company = m[2].replace(/\s*\|.*$/, '').trim();
    return out;
  }
  out.title = raw.replace(/\s*\|.*$/, '').trim();
  return out;
}

function matchAttr_(html, property) {
  const re = new RegExp(
    '<meta[^>]+property=["\']' + property + '["\'][^>]+content=["\']([^"\']*)["\']', 'i');
  const m = html.match(re) ||
    html.match(new RegExp('<meta[^>]+content=["\']([^"\']*)["\'][^>]+property=["\']' + property + '["\']', 'i'));
  return m ? m[1] : '';
}

// =====================================================================
// JOB SCRAPER — daily scan of target companies' ATS boards for matches
// =====================================================================

const COMPANIES_SHEET = 'Companies';
const PROFILE_SHEET = 'Match Profile';
const FEED_SHEET = 'Job Feed';
const SCAN_FUNCTION = 'dailyJobScan_';

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Job Scraper')
    .addItem('Run scan now', 'runScanNow')
    .addItem('Set up daily trigger (run once)', 'setupDailyTrigger')
    .addItem('Remove daily trigger', 'removeDailyTrigger')
    .addToUi();
  ensureScraperSheets_();
}

function ensureScraperSheets_() {
  const ss = SpreadsheetApp.openById(SHEET_ID);

  let companies = ss.getSheetByName(COMPANIES_SHEET);
  if (!companies) {
    companies = ss.insertSheet(COMPANIES_SHEET);
    companies.appendRow(['Company', 'ATS', 'Board ID / API URL', 'Active']);
    companies.appendRow(['DoorDash', 'greenhouse', 'doordashusa', true]);
    companies.appendRow(['Coinbase', 'greenhouse', 'coinbase', true]);
    companies.appendRow(['Robinhood', 'greenhouse', 'robinhood', true]);
    companies.appendRow(['Affirm', 'greenhouse', 'affirm', true]);
    companies.appendRow(['Airbnb', 'greenhouse', 'airbnb', true]);
    companies.appendRow(['Plaid', 'lever', 'plaid', true]);
    companies.appendRow(['HubSpot', 'greenhouse', 'hubspotjobs', true]);
    companies.appendRow(['Klaviyo', 'greenhouse', 'klaviyojobs', true]);
    companies.appendRow(['Toast', 'greenhouse', 'toast', true]);
    companies.appendRow(['Stripe', 'greenhouse', 'stripe', true]);
    companies.appendRow(['Instacart', 'greenhouse', 'instacart', true]);
    companies.appendRow(['Databricks', 'greenhouse', 'databricks', true]);
    companies.appendRow(['Oscar Health', 'greenhouse', 'oscar', true]);
    companies.appendRow(['Earnest', 'greenhouse', 'earnest', true]);
    companies.appendRow(['Alma', 'greenhouse', 'alma', true]);
    companies.setFrozenRows(1);
    companies.getRange(1, 1, 1, 4).setFontWeight('bold');
  }

  let profile = ss.getSheetByName(PROFILE_SHEET);
  if (!profile) {
    profile = ss.insertSheet(PROFILE_SHEET);
    profile.appendRow(['Field', 'Value']);
    profile.appendRow(['Must-Have Skills', 'Business Analysis, Agile, Scrum, JIRA, Confluence, BRD, FRD, Requirements Gathering, Stakeholder Management, UAT, Change Management, Risk Management, MS Project, Power BI, CSM']);
    profile.appendRow(['Title Keywords', 'Business Analyst, Business Systems Analyst, Scrum Master, Agile Business Analyst, IT Business Analyst, Technical Business Analyst, Project Coordinator, Associate Business Analyst']);
    profile.appendRow(['Preferred Locations', '']);
    profile.appendRow(['Minimum Match Score', '40']);
    profile.setFrozenRows(1);
    profile.getRange(1, 1, 1, 2).setFontWeight('bold');
    profile.setColumnWidth(2, 420);
  }

  let feed = ss.getSheetByName(FEED_SHEET);
  if (!feed) {
    feed = ss.insertSheet(FEED_SHEET);
    feed.appendRow(['Date Found', 'Company', 'Job Title', 'Location', 'Posted', 'Match Score', 'Job URL', 'Source', 'Added to Tracker']);
    feed.setFrozenRows(1);
    feed.getRange(1, 1, 1, 9).setFontWeight('bold');
  }
  return { companies, profile, feed };
}

// ---------- Menu-triggered wrappers (safe to show UI alerts) ----------

function runScanNow() {
  ensureScraperSheets_();
  try {
    const count = dailyJobScan_();
    SpreadsheetApp.getUi().alert('Scan complete', count + ' new matching job(s) added to the Job Feed tab.', SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (err) {
    SpreadsheetApp.getUi().alert('Scan failed', String(err), SpreadsheetApp.getUi().ButtonSet.OK);
  }
}

function setupDailyTrigger() {
  removeDailyTrigger();
  ScriptApp.newTrigger(SCAN_FUNCTION)
    .timeBased()
    .atHour(7)
    .everyDays(1)
    .create();
  SpreadsheetApp.getUi().alert('Daily trigger set', 'The scan will now run automatically every day around 7am.', SpreadsheetApp.getUi().ButtonSet.OK);
}

function removeDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === SCAN_FUNCTION) ScriptApp.deleteTrigger(t);
  });
}

// ---------- Core scan (no UI calls — safe for time-driven triggers) ----------

function dailyJobScan_() {
  const { feed } = ensureScraperSheets_();
  const companies = getCompanies_();
  const profile = getMatchProfile_();
  const existingUrls = getExistingFeedUrls_(feed);

  const matches = [];
  companies.forEach(c => {
    if (!c.active) return;
    let jobs = [];
    try {
      if (c.ats === 'greenhouse') jobs = fetchGreenhouseJobs_(c.boardId);
      else if (c.ats === 'lever') jobs = fetchLeverJobs_(c.boardId);
      else if (c.ats === 'workday') jobs = fetchWorkdayJobs_(c.boardId);
    } catch (e) {
      jobs = [];
    }
    jobs.forEach(j => {
      if (!j.url || existingUrls.has(j.url)) return;
      if (!isWithin24h_(j.postedAt)) return;
      const score = scoreJob_(j, profile);
      if (score >= profile.minScore) {
        matches.push(Object.assign({}, j, { company: c.name, ats: c.ats, score }));
      }
    });
  });

  matches.sort((a, b) => b.score - a.score);
  appendToFeed_(feed, matches);
  return matches.length;
}

// ---------- Config readers ----------

function getCompanies_() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(COMPANIES_SHEET);
  if (!sheet) return [];
  const rows = sheet.getDataRange().getValues().slice(1);
  return rows
    .filter(r => r[0] && r[1])
    .map(r => ({
      name: String(r[0]).trim(),
      ats: String(r[1]).trim().toLowerCase(),
      boardId: String(r[2]).trim(),
      active: r[3] === true || String(r[3]).toLowerCase() === 'true',
    }));
}

function getMatchProfile_() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(PROFILE_SHEET);
  const rows = sheet.getDataRange().getValues().slice(1);
  const map = {};
  rows.forEach(r => { map[String(r[0]).trim()] = r[1]; });
  const splitList = v => String(v || '').split(',').map(s => s.trim()).filter(Boolean);
  return {
    skills: splitList(map['Must-Have Skills']),
    titleKeywords: splitList(map['Title Keywords']),
    locations: splitList(map['Preferred Locations']),
    minScore: Number(map['Minimum Match Score']) || 40,
  };
}

function getExistingFeedUrls_(feedSheet) {
  const values = feedSheet.getDataRange().getValues().slice(1);
  return new Set(values.map(r => r[6]).filter(Boolean));
}

function listJobMatches_() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(FEED_SHEET);
  if (!sheet) return [];
  const rows = sheet.getDataRange().getValues().slice(1);
  return rows
    .filter(r => r[6]) // has a Job URL
    .map(r => ({
      dateFound: formatDate_(r[0]),
      company: r[1],
      title: r[2],
      location: r[3],
      posted: r[4],
      score: r[5],
      url: r[6],
      source: r[7],
    }))
    .sort((a, b) => b.score - a.score);
}

// ---------- Scoring ----------

function scoreJob_(job, profile) {
  const titleLower = (job.title || '').toLowerCase();
  const bodyText = ((job.title || '') + ' ' + (job.description || '')).toLowerCase();
  const locLower = (job.location || '').toLowerCase();

  let titleScore = 0;
  if (profile.titleKeywords.length) {
    titleScore = profile.titleKeywords.some(k => titleLower.includes(k.toLowerCase())) ? 1 : 0;
  }

  let skillScore = 0;
  if (profile.skills.length) {
    const hits = profile.skills.filter(s => bodyText.includes(s.toLowerCase())).length;
    skillScore = hits / profile.skills.length;
  }

  let locationScore = 0;
  if (profile.locations.length) {
    locationScore = profile.locations.some(l => locLower.includes(l.toLowerCase())) ? 1 : 0;
  }

  return Math.round(titleScore * 50 + skillScore * 40 + locationScore * 10);
}

function isWithin24h_(date) {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) return false;
  const diff = Date.now() - date.getTime();
  return diff >= 0 && diff <= 24 * 60 * 60 * 1000;
}

// ---------- ATS fetchers ----------

function fetchGreenhouseJobs_(boardToken) {
  const url = 'https://boards-api.greenhouse.io/v1/boards/' + encodeURIComponent(boardToken) + '/jobs?content=true';
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() >= 400) return [];
  const data = JSON.parse(res.getContentText());
  return (data.jobs || []).map(j => ({
    title: j.title || '',
    url: j.absolute_url || '',
    location: (j.location && j.location.name) || '',
    postedAt: j.updated_at ? new Date(j.updated_at) : null,
    description: stripHtml_(j.content || ''),
  }));
}

function fetchLeverJobs_(companySlug) {
  const url = 'https://api.lever.co/v0/postings/' + encodeURIComponent(companySlug) + '?mode=json';
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() >= 400) return [];
  const data = JSON.parse(res.getContentText());
  return (Array.isArray(data) ? data : []).map(j => ({
    title: j.text || '',
    url: j.hostedUrl || '',
    location: (j.categories && j.categories.location) || '',
    postedAt: j.createdAt ? new Date(Number(j.createdAt)) : null,
    description: stripHtml_(j.descriptionPlain || j.description || ''),
  }));
}

// Workday has no standard public API — each tenant's endpoint must be found
// manually (browser devtools → Network tab on the company's careers page,
// look for a POST request to a URL containing "/wday/cxs/"). Paste that full
// URL as the Board ID for workday rows. Workday's list view only exposes
// relative posted dates ("Posted Today", "Posted Yesterday", etc.), so this
// is treated as within-24h only when it says "Posted Today" — less precise
// than Greenhouse/Lever, which give exact timestamps.
function fetchWorkdayJobs_(apiUrl) {
  if (!apiUrl) return [];
  const base = apiUrl.match(/^https?:\/\/[^/]+/)[0];
  const res = UrlFetchApp.fetch(apiUrl, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: '' }),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() >= 400) return [];
  const data = JSON.parse(res.getContentText());
  return (data.jobPostings || []).map(j => {
    const posted = (j.postedOn || '').toLowerCase();
    const postedAt = posted.indexOf('today') !== -1 ? new Date() : null;
    return {
      title: j.title || '',
      url: j.externalPath ? base + j.externalPath : '',
      location: j.locationsText || '',
      postedAt,
      description: '',
    };
  });
}

function stripHtml_(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2000);
}

function appendToFeed_(feedSheet, matches) {
  if (!matches.length) return;
  const now = new Date();
  const rows = matches.map(m => [
    now, m.company, m.title, m.location || '', formatDate_(m.postedAt),
    m.score, m.url, m.ats, false,
  ]);
  feedSheet.getRange(feedSheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}
