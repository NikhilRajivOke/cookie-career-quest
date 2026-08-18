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
