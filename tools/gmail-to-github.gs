/**
 * הדף השבועי: ממייל הוועד ישירות לאתר.
 *
 * רץ בתוך Google Apps Script של תיבת vaad@hakipabs.org, פעם בשעה.
 * מחפש מיילים חדשים מהשולח של הדף השבועי עם PDF. נושא שמתחיל ב"זמני השבוע" -> weekly/ (הדף השבועי);
 * כל PDF אחר (לוח חג, פורים, יום העצמאות) -> holidays/ (מוצג באתר כתמונה). המייל מסומן בתווית.
 * משם ה-Action הקיים בגיטהאב קורא את ה-PDF ומעדכן את האתר.
 *
 * התקנה (פעם אחת, מתוך חשבון הוועד):
 *  1. script.google.com -> New project -> להדביק את הקובץ הזה -> לשמור.
 *  2. Project Settings -> Script Properties -> להוסיף:
 *       GITHUB_TOKEN = <fine-grained token: repo hakipabs/hakipabs-site, Contents: Read and write>
 *  3. להריץ פעם אחת את הפונקציה setup() (יבקש הרשאות ל-Gmail) - היא יוצרת את התווית ואת הטריגר השעתי.
 *  4. בדיקה: להריץ run() ידנית כשיש מייל חדש בתיבה, ולבדוק ב-Executions את הלוג.
 */

const CONFIG = {
  sender: 'hakipa.zmanim@gmail.com',
  subjectPrefix: 'זמני השבוע',        // נושא שמתחיל כך = הדף השבועי -> weekly/ ; כל PDF אחר -> holidays/
  repo: 'hakipabs/hakipabs-site',
  branch: 'main',
  folder: 'weekly',
  holidayFolder: 'holidays',           // כל PDF אחר מאותו שולח (לוח חג, פורים, יום העצמאות)
  label: 'hakipa-site-uploaded',
  lookbackDays: 10,
  notifyOnError: 'vaad@hakipabs.org',  // '' כדי לכבות
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

  threads.forEach(thread => {
    try {
      const msgs = thread.getMessages();
      const msg = msgs[msgs.length - 1];
      const subj = (msg.getSubject() || '').replace(/^(re|fwd?|fw)\s*:\s*/i, '').trim();
      const isWeekly = subj.startsWith(CONFIG.subjectPrefix);
      const folder = isWeekly ? CONFIG.folder : CONFIG.holidayFolder;   // לוחות חגים ושאר דפי זמנים -> holidays/
      const pdf = msg.getAttachments().find(a => /\.pdf$/i.test(a.getName()) || a.getContentType() === 'application/pdf');
      if (!pdf) { Logger.log('no PDF in "%s"', msg.getSubject()); return; }
      const name = fileNameFor_(msg.getSubject(), msg.getDate());
      const path = `${folder}/${name}`;
      uploadToGitHub_(token, path, pdf.getBytes(), `Weekly sheet from email: ${msg.getSubject()}`);
      thread.addLabel(label);
      Logger.log('uploaded %s (%s KB)', path, Math.round(pdf.getSize() / 1024));
    } catch (e) {
      Logger.log('ERROR on thread "%s": %s', thread.getFirstMessageSubject(), e);
      if (CONFIG.notifyOnError) {
        MailApp.sendEmail(CONFIG.notifyOnError, 'אתר הכיפה: העלאת הדף השבועי נכשלה',
          `הנושא: ${thread.getFirstMessageSubject()}\nשגיאה: ${e}\n\nאפשר להעלות ידנית: https://github.com/${CONFIG.repo}/upload/${CONFIG.branch}/${CONFIG.folder}`);
      }
    }
  });
}

/** "זמני השבוע- נח" -> "נח.pdf"; בלי נושא ברור -> "2026-10-16.pdf" */
function fileNameFor_(subject, date) {
  let s = (subject || '').replace(/^(re|fwd?|fw)\s*:\s*/i, '').trim();
  const idx = s.indexOf('-');
  if (idx >= 0) s = s.slice(idx + 1);
  s = s.replace(CONFIG.subjectPrefix, '').replace(/[\\\/:*?"<>|#%]/g, '').replace(/\s+/g, '-').replace(/^-+|-+$/g, '');
  const stamp = Utilities.formatDate(date, 'Asia/Jerusalem', 'yyyy-MM-dd');
  return (s ? `${s}-${stamp}` : stamp) + '.pdf';
}

function uploadToGitHub_(token, path, bytes, message) {
  const url = `https://api.github.com/repos/${CONFIG.repo}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}`;
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  // אם הקובץ כבר קיים צריך את ה-sha שלו כדי לדרוס
  let sha = null;
  const probe = UrlFetchApp.fetch(`${url}?ref=${CONFIG.branch}`, { headers, muteHttpExceptions: true });
  if (probe.getResponseCode() === 200) sha = JSON.parse(probe.getContentText()).sha;
  const body = { message, branch: CONFIG.branch, content: Utilities.base64Encode(bytes) };
  if (sha) body.sha = sha;
  const res = UrlFetchApp.fetch(url, { method: 'put', headers, contentType: 'application/json', payload: JSON.stringify(body), muteHttpExceptions: true });
  if (res.getResponseCode() >= 300) throw new Error(`GitHub ${res.getResponseCode()}: ${res.getContentText().slice(0, 300)}`);
}
