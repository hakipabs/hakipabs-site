/**
 * מהמייל של הוועד ישירות לאתר: הדף השבועי, לוחות חגים ואירועים, עם דוח במייל אחרי כל ריצה.
 *
 * רץ בתוך Google Apps Script של תיבת vaad@hakipabs.org, פעם בשעה, על מיילים מהשולחים המורשים (CONFIG.senders):
 *   נושא שמתחיל ב"זמני השבוע" + PDF  -> weekly/        (זמני שבת, מנחה, זמני היום, מזל טוב מתעדכנים באתר)
 *   נושא שמתחיל ב"אירוע" + תמונה     -> images/events/ (כרטיס בבלוק "אירועים קרובים": פוסטר, כותרת, תאריך, טקסט)
 *   נושא שמכיל "אורייתא" + תמונה      -> אירוע של אותו יום (הפוסטר השבועי שמגיע מהקבוצה)
 *   כל PDF אחר                        -> holidays/      (לוח חג: מוצג באתר כתמונה, 45 יום)
 * אחרי ההעלאה ממתין כ-3 דקות לאוטומציה של גיטהאב, בודק מה האתר מציג, ושולח דוח לוועד.
 *
 * מייל של אירוע, דוגמה:
 *   נושא:  אירוע: מסיבת חתנים 17.10
 *   גוף:   מוצאי שבת פרשת נח, 20:30, בית המדרש. חתן תורה: ברק רוזנברג. כל הקהילה מוזמנת.
 *   מצורף: הפוסטר (JPG/PNG). התאריך מהנושא קובע עד מתי האירוע מוצג; בלי תאריך: 14 יום.
 *   השורה הראשונה בגוף = "מתי ואיפה", השאר = טקסט. אפשר גם "אירוע: אורייתא 23.10" כל שבוע.
 *
 * התקנה (פעם אחת, מתוך חשבון הוועד):
 *  1. script.google.com -> New project -> להדביק את הקובץ הזה -> לשמור.
 *  2. Project Settings -> Script Properties -> להוסיף:
 *       GITHUB_TOKEN = <fine-grained token: repo hakipabs/hakipabs-site, Contents: Read and write, Actions: Read>
 *  3. להריץ פעם אחת את הפונקציה setup() (יבקש הרשאות ל-Gmail) - יוצרת תווית וטריגר שעתי.
 *  4. בדיקה: להריץ run() ידנית כשיש מייל חדש בתיבה, ולראות את הדוח במייל וב-Executions.
 */

const CONFIG = {
  senders: ['hakipa.zmanim@gmail.com', 'shmueltaub@gmail.com', 'reinerav@gmail.com'],   // מי רשאי לשלוח לאתר (זמנים, הוועד, אורייתא)
  subjectPrefix: 'זמני השבוע',        // הדף השבועי -> weekly/
  eventPrefix: 'אירוע',               // אירוע -> images/events/ + data/events.json
  eventKeywords: ['אורייתא'],         // נושא שמכיל מילה כזו = אירוע של אותו יום, גם בלי 'אירוע' בנושא (הפוסטר השבועי של אורייתא)
  repo: 'hakipabs/hakipabs-site',
  branch: 'main',
  folder: 'weekly',
  holidayFolder: 'holidays',
  eventsFolder: 'images/events',
  eventsJson: 'data/events.json',
  eventDefaultDays: 14,                // אירוע בלי תאריך בנושא מוצג כך וכך ימים
  label: 'hakipa-site-uploaded',
  lookbackDays: 10,
  reportTo: 'vaad@hakipabs.org',       // הדוח אחרי כל ריצה. אפשר כמה כתובות מופרדות בפסיק
  siteUrl: 'https://hakipabs.org',
  waitForSiteMs: 180000,               // כמה לחכות לאוטומציה של גיטהאב לפני הבדיקה (3 דקות)
};

function setup() {
  GmailApp.createLabel(CONFIG.label);
  ScriptApp.getProjectTriggers().forEach(t => { if (t.getHandlerFunction() === 'run') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('run').timeBased().everyHours(1).create();
  Logger.log('setup done: label "%s", hourly trigger on run()', CONFIG.label);
}

function run() {
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) throw new Error('GITHUB_TOKEN is missing in Script Properties');
  const label = GmailApp.getUserLabelByName(CONFIG.label) || GmailApp.createLabel(CONFIG.label);
  const query = `from:(${CONFIG.senders.join(' OR ')}) has:attachment newer_than:${CONFIG.lookbackDays}d -label:${CONFIG.label}`;
  const threads = GmailApp.search(query, 0, 10);
  Logger.log('query: %s -> %s thread(s)', query, threads.length);
  const uploads = [];

  threads.forEach(thread => {
    const subject = thread.getFirstMessageSubject();
    try {
      const msgs = thread.getMessages();
      const msg = msgs[msgs.length - 1];
      const subj = cleanSubject_(msg.getSubject());
      const atts = msg.getAttachments();
      const pdf = atts.find(a => /\.pdf$/i.test(a.getName()) || a.getContentType() === 'application/pdf');
      const img = atts.find(a => /^image\/(jpeg|png|webp)$/i.test(a.getContentType()));

      const isEvent = subj.startsWith(CONFIG.eventPrefix) || CONFIG.eventKeywords.some(k => subj.includes(k));
      if (isEvent) {
        if (!img) { Logger.log('event without a poster image: "%s"', subj); thread.addLabel(label); return; }
        const ev = addEvent_(token, subj, msg.getPlainBody(), msg.getDate(), img);
        thread.addLabel(label);
        uploads.push({ kind: 'event', subject: subj, path: ev.poster, event: ev, kb: Math.round(img.getSize() / 1024) });
        Logger.log('event added: %s (%s)', ev.title, ev.date);
        return;
      }

      if (!pdf) { Logger.log('no PDF in "%s"', subj); thread.addLabel(label); return; }
      const isWeekly = subj.startsWith(CONFIG.subjectPrefix);
      const folder = isWeekly ? CONFIG.folder : CONFIG.holidayFolder;
      const name = fileNameFor_(subj, msg.getDate());
      const path = `${folder}/${name}`;
      uploadToGitHub_(token, path, pdf.getBytes(), `Sheet from email: ${subj}`);
      thread.addLabel(label);
      uploads.push({ kind: isWeekly ? 'weekly' : 'holiday', subject: subj, path, name, kb: Math.round(pdf.getSize() / 1024) });
      Logger.log('uploaded %s (%s KB)', path, Math.round(pdf.getSize() / 1024));
    } catch (e) {
      Logger.log('ERROR on "%s": %s', subject, e);
      sendReport_(`❌ אתר הכיפה: ההעלאה של "${subject}" נכשלה`,
        `המייל: ${subject}\nשגיאה: ${e}\n\n${howToFix_()}`);
    }
  });

  if (uploads.length) {
    Utilities.sleep(CONFIG.waitForSiteMs);
    uploads.forEach(u => sendReport_(...buildReport_(token, u)));
  }
}

function cleanSubject_(subject) {
  return (subject || '').replace(/^(re|fwd?|fw)\s*:\s*/i, '').trim();
}

/** "זמני השבוע- נח" -> "נח-2026-10-14.pdf";  "לוח זמני סוכות תשפ"ז" -> "לוח-זמני-סוכות-תשפז-2026-09-22.pdf" */
function fileNameFor_(subject, date) {
  let s = cleanSubject_(subject);
  if (s.startsWith(CONFIG.subjectPrefix)) s = s.slice(CONFIG.subjectPrefix.length);
  s = slug_(s);
  const stamp = Utilities.formatDate(date, 'Asia/Jerusalem', 'yyyy-MM-dd');
  return (s ? `${s}-${stamp}` : stamp) + '.pdf';
}

function slug_(s) {
  return (s || '').replace(/^[\s\-:]+/, '').replace(/[\\\/:*?"<>|#%']/g, '').replace(/\s+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
}

/** אירוע: מעלה את הפוסטר ומוסיף רשומה ל-data/events.json. מחזיר את הרשומה. */
function addEvent_(token, subj, body, mailDate, img) {
  const byKeyword = !subj.startsWith(CONFIG.eventPrefix);
  let rest = (byKeyword ? subj : subj.slice(CONFIG.eventPrefix.length)).replace(/^[\s:\-]+/, '').trim();
  // תאריך בנושא: 17.10 / 17/10 / 17.10.2026 / 2026-10-17
  let date = null;
  const m = rest.match(/(\d{4})-(\d{1,2})-(\d{1,2})/) || rest.match(/(\d{1,2})[.\/](\d{1,2})(?:[.\/](\d{2,4}))?/);
  if (m) {
    if (m[0].includes('-') && m[1].length === 4) date = new Date(+m[1], +m[2] - 1, +m[3]);
    else {
      let y = m[3] ? +m[3] : mailDate.getFullYear(); if (y < 100) y += 2000;
      date = new Date(y, +m[2] - 1, +m[1]);
      if (!m[3] && date < new Date(mailDate.getFullYear(), mailDate.getMonth(), mailDate.getDate() - 7)) date.setFullYear(y + 1); // תאריך שכבר עבר השנה -> שנה הבאה
    }
    rest = rest.replace(m[0], '').replace(/\s{2,}/g, ' ').trim();
  }
  if (!date || isNaN(date)) { date = new Date(mailDate); if (!byKeyword) date.setDate(date.getDate() + CONFIG.eventDefaultDays); }   // אורייתא וכדומה: אותו יום
  const title = rest.replace(/[\s,\-:]+$/, '') || 'אירוע';
  const lines = (body || '').split(/\r?\n/).map(l => l.trim()).filter(l => l && !/^(>|On .* wrote:|-{2,}|From:|Sent:|To:|Subject:|מאת:|נשלח:|אל:|נושא:)/.test(l));
  const start = (lines[0] && lines[0].replace(/\s+/g,' ') === title) ? 1 : 0;   // שורה ראשונה שחוזרת על הכותרת מדולגת
  const when = lines[start] || '';
  const text = lines.slice(start + 1, start + 6).join(' ').slice(0, 400);
  const ext = img.getContentType().includes('png') ? 'png' : img.getContentType().includes('webp') ? 'webp' : 'jpg';
  const dateStr = Utilities.formatDate(date, 'Asia/Jerusalem', 'yyyy-MM-dd');
  const poster = `${CONFIG.eventsFolder}/${slug_(title) || 'event'}-${dateStr}.${ext}`;
  uploadToGitHub_(token, poster, img.getBytes(), `Event poster from email: ${subj}`);

  const file = getFile_(token, CONFIG.eventsJson);
  let events = [];
  try { events = JSON.parse(file.text); } catch (e) { events = []; }
  if (!Array.isArray(events)) events = [];
  events = events.filter(e => e.poster !== poster);
  const entry = { title, date: dateStr, when, place: '', text, poster };
  events.push(entry);
  events.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  putFile_(token, CONFIG.eventsJson, JSON.stringify(events, null, 2) + '\n', `Event from email: ${subj}`, file.sha);
  return entry;
}

function ghHeaders_(token) {
  return { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
}

function ghUrl_(path) {
  return `https://api.github.com/repos/${CONFIG.repo}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}`;
}

function getFile_(token, path) {
  const res = UrlFetchApp.fetch(`${ghUrl_(path)}?ref=${CONFIG.branch}`, { headers: ghHeaders_(token), muteHttpExceptions: true });
  if (res.getResponseCode() === 404) return { text: '', sha: null };
  if (res.getResponseCode() !== 200) throw new Error(`GitHub GET ${path}: ${res.getResponseCode()}`);
  const j = JSON.parse(res.getContentText());
  return { text: Utilities.newBlob(Utilities.base64Decode(j.content.replace(/\n/g, ''))).getDataAsString('UTF-8'), sha: j.sha };
}

function putFile_(token, path, text, message, sha) {
  const body = { message, branch: CONFIG.branch, content: Utilities.base64Encode(text, Utilities.Charset.UTF_8) };
  if (sha) body.sha = sha;
  const res = UrlFetchApp.fetch(ghUrl_(path), { method: 'put', headers: ghHeaders_(token), contentType: 'application/json', payload: JSON.stringify(body), muteHttpExceptions: true });
  if (res.getResponseCode() >= 300) throw new Error(`GitHub PUT ${path}: ${res.getResponseCode()} ${res.getContentText().slice(0, 300)}`);
}

function uploadToGitHub_(token, path, bytes, message) {
  const probe = UrlFetchApp.fetch(`${ghUrl_(path)}?ref=${CONFIG.branch}`, { headers: ghHeaders_(token), muteHttpExceptions: true });
  const sha = probe.getResponseCode() === 200 ? JSON.parse(probe.getContentText()).sha : null;
  const body = { message, branch: CONFIG.branch, content: Utilities.base64Encode(bytes) };
  if (sha) body.sha = sha;
  const res = UrlFetchApp.fetch(ghUrl_(path), { method: 'put', headers: ghHeaders_(token), contentType: 'application/json', payload: JSON.stringify(body), muteHttpExceptions: true });
  if (res.getResponseCode() >= 300) throw new Error(`GitHub ${res.getResponseCode()}: ${res.getContentText().slice(0, 300)}`);
}

/** בודק מה האתר מציג אחרי ההעלאה ומרכיב את הדוח. מחזיר [נושא, גוף]. */
function buildReport_(token, u) {
  const lines = [`המייל: ${u.subject}`, `הקובץ שהועלה: ${u.path} (${u.kb} KB)`, ''];
  let ok = true;

  if (u.kind === 'event') {
    const list = fetchJson_(`${CONFIG.siteUrl}/${CONFIG.eventsJson}`);
    const item = Array.isArray(list) && list.find(e => e.poster === u.path);
    if (!item) { ok = false; lines.push('⚠️ האירוע עדיין לא מופיע באתר. ייתכן שהאתר עוד נבנה; לבדוק שוב בעוד כמה דקות.'); }
    else lines.push('מה האתר מציג:', `• ${item.title}`, `• מתי: ${item.when || '(לא צוין)'}`, `• טקסט: ${item.text || '(ללא)'}`, `• יוצג עד: ${item.date}`);
  } else {
    const runInfo = latestRun_(token, u.kind === 'weekly' ? 'weekly-sheet.yml' : 'holidays.yml');
    if (runInfo) lines.push(`האוטומציה בגיטהאב: ${runInfo.status}${runInfo.conclusion ? ' / ' + runInfo.conclusion : ''}  ${runInfo.url}`);
    if (runInfo && runInfo.conclusion && runInfo.conclusion !== 'success') ok = false;
    if (u.kind === 'weekly') {
      const d = fetchJson_(`${CONFIG.siteUrl}/data/shabbat.json`);
      if (!d) { ok = false; lines.push('לא הצלחתי לקרוא את נתוני השבת מהאתר.'); }
      else {
        if (d.source_pdf !== u.name) { ok = false; lines.push(`⚠️ האתר עדיין מציג נתונים מקובץ אחר (${d.source_pdf}). ייתכן שהאוטומציה עוד רצה; לבדוק שוב בעוד כמה דקות.`); }
        lines.push('', 'מה האתר מציג עכשיו:',
          `• ${d.parasha || '(פרשה לא נמצאה)'} · ${d.hebrew_date || ''}`,
          `• הדלקת נרות ${d.candles || '?'} · צאת השבת ${d.havdala || '?'} · ר"ת ${d.rabbeinu_tam || '?'}`,
          `• מנחה בחול ${d.weekday_mincha || '?'} · תפילת ילדים ${d.kids_tefila || '?'}`,
          `• זמני תפילה בשבת: ${(d.friday || []).length + (d.shabbat || []).length} שורות`,
          `• מזל טוב: ${((d.mazal_tov && d.mazal_tov.items) || []).length} · תנחומים: ${((d.nichumim && d.nichumim.items) || []).length}`);
        const missing = ['parasha', 'candles', 'havdala', 'friday', 'shabbat'].filter(k => !d[k] || (Array.isArray(d[k]) && !d[k].length));
        if (missing.length) { ok = false; lines.push('', `⚠️ שדות שלא נקראו מה-PDF: ${missing.join(', ')} (נשארו ערכי השבוע הקודם)`); }
      }
    } else {
      const h = fetchJson_(`${CONFIG.siteUrl}/data/holidays.json`);
      const item = h && (h.items || []).find(e => e.pdf === u.path);
      if (!item) { ok = false; lines.push('⚠️ הלוח עדיין לא מופיע ברשימת לוחות החגים באתר. ייתכן שהאוטומציה עוד רצה.'); }
      else lines.push(`הלוח מופיע באתר בכותרת "${item.title}" ויוצג עד ${item.until || (item.added + ' + 45 יום')}.`);
    }
  }

  lines.push('', `לבדיקה בעין: ${CONFIG.siteUrl}`, '', howToFix_());
  const subject = (ok ? '✅ אתר הכיפה עודכן: ' : '⚠️ אתר הכיפה, דרושה בדיקה: ') + u.subject;
  return [subject, lines.join('\n')];
}

function howToFix_() {
  return [
    'אם משהו לא נכון:',
    '1. שעה או פרשה שגויה: לערוך ידנית את הקובץ data/shabbat.json (עיפרון -> תיקון -> Commit changes):',
    `   https://github.com/${CONFIG.repo}/edit/${CONFIG.branch}/data/shabbat.json`,
    '2. אירוע: לתקן כותרת/תאריך/טקסט או למחוק רשומה בקובץ data/events.json:',
    `   https://github.com/${CONFIG.repo}/edit/${CONFIG.branch}/${CONFIG.eventsJson}`,
    '3. הקובץ הלא נכון עלה: למחוק אותו בגיטהאב (פתיחת הקובץ -> ... -> Delete file) או להעלות מתוקן:',
    `   https://github.com/${CONFIG.repo}/upload/${CONFIG.branch}/${CONFIG.folder}   (דף שבועי)`,
    `   https://github.com/${CONFIG.repo}/upload/${CONFIG.branch}/${CONFIG.holidayFolder}   (לוח חג)`,
    `4. האוטומציה נכשלה: הלוג כאן https://github.com/${CONFIG.repo}/actions ; אפשר להריץ שוב ב-"Run workflow".`,
    '5. לא מסתדר: שמואל טאוב, 052-569-7091.',
    '',
    'האתר מתעדכן תוך כדקה אחרי כל שינוי בגיטהאב.',
  ].join('\n');
}

function latestRun_(token, workflowFile) {
  try {
    const res = UrlFetchApp.fetch(`https://api.github.com/repos/${CONFIG.repo}/actions/workflows/${workflowFile}/runs?per_page=1`,
      { headers: ghHeaders_(token), muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return null;      // הטוקן בלי הרשאת Actions: מדלגים
    const r = JSON.parse(res.getContentText()).workflow_runs[0];
    return r ? { status: r.status, conclusion: r.conclusion, url: r.html_url } : null;
  } catch (e) { return null; }
}

function fetchJson_(url) {
  try {
    const res = UrlFetchApp.fetch(url + '?t=' + Date.now(), { muteHttpExceptions: true });
    return res.getResponseCode() === 200 ? JSON.parse(res.getContentText()) : null;
  } catch (e) { return null; }
}

function sendReport_(subject, body) {
  if (!CONFIG.reportTo) return;
  MailApp.sendEmail({ to: CONFIG.reportTo, subject, body, name: 'אתר בית הכנסת הכיפה' });
}
