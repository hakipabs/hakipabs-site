/**
 * הדף השבועי ולוחות החגים: ממייל הוועד ישירות לאתר, עם דוח במייל אחרי כל ריצה.
 *
 * רץ בתוך Google Apps Script של תיבת vaad@hakipabs.org, פעם בשעה.
 * מחפש מיילים חדשים מהשולח של הדף השבועי עם PDF:
 *   נושא שמתחיל ב"זמני השבוע" -> weekly/   (הדף השבועי: זמני שבת, מנחה, זמני היום, מזל טוב)
 *   כל PDF אחר                  -> holidays/ (לוח חג: מוצג באתר כתמונה, 45 יום)
 * אחרי ההעלאה ממתין כ-3 דקות לאוטומציה של גיטהאב, בודק מה האתר מציג, ושולח דוח לוועד.
 *
 * התקנה (פעם אחת, מתוך חשבון הוועד):
 *  1. script.google.com -> New project -> להדביק את הקובץ הזה -> לשמור.
 *  2. Project Settings -> Script Properties -> להוסיף:
 *       GITHUB_TOKEN = <fine-grained token: repo hakipabs/hakipabs-site, Contents: Read and write, Actions: Read>
 *  3. להריץ פעם אחת את הפונקציה setup() (יבקש הרשאות ל-Gmail) - יוצרת תווית וטריגר שעתי.
 *  4. בדיקה: להריץ run() ידנית כשיש מייל חדש בתיבה, ולראות את הדוח במייל וב-Executions.
 */

const CONFIG = {
  sender: 'hakipa.zmanim@gmail.com',
  subjectPrefix: 'זמני השבוע',        // נושא שמתחיל כך = הדף השבועי -> weekly/ ; כל PDF אחר -> holidays/
  repo: 'hakipabs/hakipabs-site',
  branch: 'main',
  folder: 'weekly',
  holidayFolder: 'holidays',
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
  const query = `from:${CONFIG.sender} has:attachment filename:pdf newer_than:${CONFIG.lookbackDays}d -label:${CONFIG.label}`;
  const threads = GmailApp.search(query, 0, 10);
  Logger.log('query: %s -> %s thread(s)', query, threads.length);
  const uploads = [];

  threads.forEach(thread => {
    const subject = thread.getFirstMessageSubject();
    try {
      const msgs = thread.getMessages();
      const msg = msgs[msgs.length - 1];
      const subj = (msg.getSubject() || '').replace(/^(re|fwd?|fw)\s*:\s*/i, '').trim();
      const pdf = msg.getAttachments().find(a => /\.pdf$/i.test(a.getName()) || a.getContentType() === 'application/pdf');
      if (!pdf) { Logger.log('no PDF in "%s"', subj); thread.addLabel(label); return; }
      const isWeekly = subj.startsWith(CONFIG.subjectPrefix);
      const folder = isWeekly ? CONFIG.folder : CONFIG.holidayFolder;
      const name = fileNameFor_(subj, msg.getDate());
      const path = `${folder}/${name}`;
      uploadToGitHub_(token, path, pdf.getBytes(), `Sheet from email: ${subj}`);
      thread.addLabel(label);
      uploads.push({ subject: subj, path, name, isWeekly, kb: Math.round(pdf.getSize() / 1024) });
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

/** "זמני השבוע- נח" -> "נח-2026-10-14.pdf";  "לוח זמני סוכות תשפ"ז" -> "לוח-זמני-סוכות-תשפז-2026-09-22.pdf" */
function fileNameFor_(subject, date) {
  let s = (subject || '').replace(/^(re|fwd?|fw)\s*:\s*/i, '').trim();
  if (s.startsWith(CONFIG.subjectPrefix)) s = s.slice(CONFIG.subjectPrefix.length);
  s = s.replace(/^[\s\-:]+/, '').replace(/[\\\/:*?"<>|#%']/g, '').replace(/\s+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
  const stamp = Utilities.formatDate(date, 'Asia/Jerusalem', 'yyyy-MM-dd');
  return (s ? `${s}-${stamp}` : stamp) + '.pdf';
}

function uploadToGitHub_(token, path, bytes, message) {
  const url = `https://api.github.com/repos/${CONFIG.repo}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}`;
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  let sha = null;
  const probe = UrlFetchApp.fetch(`${url}?ref=${CONFIG.branch}`, { headers, muteHttpExceptions: true });
  if (probe.getResponseCode() === 200) sha = JSON.parse(probe.getContentText()).sha;
  const body = { message, branch: CONFIG.branch, content: Utilities.base64Encode(bytes) };
  if (sha) body.sha = sha;
  const res = UrlFetchApp.fetch(url, { method: 'put', headers, contentType: 'application/json', payload: JSON.stringify(body), muteHttpExceptions: true });
  if (res.getResponseCode() >= 300) throw new Error(`GitHub ${res.getResponseCode()}: ${res.getContentText().slice(0, 300)}`);
}

/** בודק מה האתר מציג אחרי ההעלאה ומרכיב את הדוח. מחזיר [נושא, גוף]. */
function buildReport_(token, u) {
  const lines = [`המייל: ${u.subject}`, `הקובץ שהועלה: ${u.path} (${u.kb} KB)`, ''];
  let ok = true;
  const runInfo = latestRun_(token, u.isWeekly ? 'weekly-sheet.yml' : 'holidays.yml');
  if (runInfo) lines.push(`האוטומציה בגיטהאב: ${runInfo.status}${runInfo.conclusion ? ' / ' + runInfo.conclusion : ''}  ${runInfo.url}`);
  if (runInfo && runInfo.conclusion && runInfo.conclusion !== 'success') ok = false;

  if (u.isWeekly) {
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

  lines.push('', `לבדיקה בעין: ${CONFIG.siteUrl}`, '', howToFix_());
  const subject = (ok ? '✅ אתר הכיפה עודכן: ' : '⚠️ אתר הכיפה, דרושה בדיקה: ') + u.subject;
  return [subject, lines.join('\n')];
}

function howToFix_() {
  return [
    'אם משהו לא נכון:',
    '1. שעה או פרשה שגויה: לערוך ידנית את הקובץ data/shabbat.json (עיפרון -> תיקון -> Commit changes):',
    `   https://github.com/${CONFIG.repo}/edit/${CONFIG.branch}/data/shabbat.json`,
    '2. הקובץ הלא נכון עלה: למחוק אותו בגיטהאב (פתיחת הקובץ -> ... -> Delete file) או להעלות PDF מתוקן:',
    `   https://github.com/${CONFIG.repo}/upload/${CONFIG.branch}/${CONFIG.folder}   (דף שבועי)`,
    `   https://github.com/${CONFIG.repo}/upload/${CONFIG.branch}/${CONFIG.holidayFolder}   (לוח חג)`,
    `3. האוטומציה נכשלה: הלוג כאן https://github.com/${CONFIG.repo}/actions ; אפשר להריץ שוב ב-"Run workflow".`,
    '4. לא מסתדר: שמואל טאוב, 052-569-7091.',
    '',
    'האתר מתעדכן תוך כדקה אחרי כל שינוי בגיטהאב.',
  ].join('\n');
}

function latestRun_(token, workflowFile) {
  try {
    const res = UrlFetchApp.fetch(`https://api.github.com/repos/${CONFIG.repo}/actions/workflows/${workflowFile}/runs?per_page=1`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }, muteHttpExceptions: true });
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
