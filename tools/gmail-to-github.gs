/**
 * מהמייל של הוועד ישירות לאתר: הדף השבועי, לוחות חגים ואירועים, עם דוח במייל אחרי כל ריצה.
 *
 * רץ בתוך Google Apps Script של תיבת vaad@hakipabs.org, פעם בשעה, על מיילים מהשולחים המורשים (CONFIG.senders):
 *   נושא שמתחיל ב"זמני השבוע" + PDF  -> weekly/        (זמני שבת, מנחה, זמני היום, מזל טוב מתעדכנים באתר)
 *   נושא שמתחיל ב"אירוע" + תמונה     -> images/events/ (כרטיס בבלוק "אירועים קרובים": פוסטר, כותרת, תאריך, טקסט)
 *   נושא שמכיל "אורייתא" + תמונה      -> אירוע של אותו יום (הפוסטר השבועי שמגיע מהקבוצה)
 *   נושא שמתחיל ב"אלבום" + תמונות    -> gallery/<שם האלבום>/ (דף הגלריה; כמה מיילים עם אותו נושא = אותו אלבום)
 *   נושא שמתחיל ב"ארכיון" + קישור יוטיוב בגוף -> פריט וידאו באוסף (הסרטון עצמו יושב בערוץ היוטיוב של בית הכנסת, @HakipaBS)
 *   כל PDF אחר                        -> holidays/      (לוח חג: מוצג באתר כתמונה, 45 יום)
 *   נושא שמתחיל ב"דבר תורה"          -> data/divrei-torah.json (מכל שולח; מתפרסם רק אחרי שחבר ועדה מעביר או עונה על המייל)
 * אחרי ההעלאה ממתין כ-3 דקות לאוטומציה של גיטהאב, בודק מה האתר מציג, ושולח דוח לוועד.
 * כל ריצה (גם בלי מיילים, גם כשנכשלת) נרשמת כשורה בגיליון "אתר הכיפה: יומן ריצות" בדרייב של הוועד.
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
  archivePrefix: 'ארכיון',            // ארכיון: <שם האוסף> + תמונות/PDF -> archive/<שם>/ (נכנס כלא-מאושר עד אישור הוועד)
  archiveFolder: 'archive',
  albumPrefix: 'אלבום',               // אלבום: <שם> + תמונות -> gallery/<שם>/ (דף הגלריה)
  galleryFolder: 'gallery',
  eventPrefix: 'אירוע',               // אירוע -> images/events/ + data/events.json
  eventKeywords: ['אורייתא'],         // נושא שמכיל מילה כזו = אירוע של אותו יום, גם בלי 'אירוע' בנושא (הפוסטר השבועי של אורייתא)
  repo: 'hakipabs/hakipabs-site',
  branch: 'main',
  folder: 'weekly',
  holidayFolder: 'holidays',
  eventsFolder: 'images/events',
  eventsJson: 'data/events.json',
  eventDefaultDays: 14,                // אירוע בלי תאריך בנושא מוצג כך וכך ימים
  dvarPrefix: 'דבר תורה',             // דבר תורה: <פרשה> / <שם הכותב> -> data/divrei-torah.json (מתפרסם רק אחרי שחבר ועדה מעביר את המייל)
  dvarReviewers: ['vaad@hakipabs.org', 'shmueltaub@gmail.com', 'hakipa.zmanim@gmail.com'],   // מי מאשר דברי תורה: הטקסט עולה רק כשהוא מגיע (או מועבר, או נענה) מכתובת ברשימה
  dvarMaxWords: 200,                  // היעד לאורך דבר תורה כפי שמופיע באתר (2-3 דקות קריאה)
  dvarWarnWords: 250,                 // מעל זה ההודעה לוועד מסמנת ⚠️; אף פעם לא חוסם
  dvarJson: 'data/divrei-torah.json',
  dvarFiles: 'divrei-torah',          // קבצים שצורפו לדבר תורה (PDF/Word)
  dvarPendingLabel: 'hakipa-dvar-torah-pending',
  label: 'hakipa-site-uploaded',
  lookbackDays: 10,
  ackSenders: ['hakipa.zmanim@gmail.com'],   // מי מקבל תשובה אוטומטית על דף שבועי/לוח חג ששלח (עלה / יש מה לבדוק / נכשל). לא להוסיף קבוצות גוגל
  reportTo: 'vaad@hakipabs.org',       // הדוח אחרי כל ריצה. אפשר כמה כתובות מופרדות בפסיק
  siteUrl: 'https://hakipabs.org',
  logSheetName: 'אתר הכיפה: יומן ריצות',   // גיליון בדרייב של הוועד, שורה לכל ריצה (נוצר לבד בריצה הראשונה)
  logKeepRows: 9000,                   // כשנה של ריצות שעתיות; שורות ישנות יותר נמחקות מהגיליון
  waitForSiteMs: 90000,                // בדיקה ראשונה של האתר דקה וחצי אחרי ההעלאה
  recheckMs: 30000,                    // אם האתר עוד לא התעדכן: בודקים שוב כל חצי דקה
  reportDeadlineMs: 300000,            // עד 5 דקות מתחילת הריצה (גוגל עוצר ריצה אחרי 6); אחר כך הדוח יוצא כ'האתר עוד מתעדכן'
};

function setup() {
  GmailApp.createLabel(CONFIG.label);
  ScriptApp.getProjectTriggers().forEach(t => { if (t.getHandlerFunction() === 'run') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('run').timeBased().everyHours(1).create();
  Logger.log('setup done: label "%s", hourly trigger on run()', CONFIG.label);
}

/** הריצה השעתית. עוטפת את העבודה כדי שכל ריצה, גם כזו שקורסת, תכתוב שורה ביומן הריצות. */
let RUNLOG_ = null;
let RUN_STARTED_ = Date.now();
function run() {
  const started = new Date(); RUN_STARTED_ = started.getTime();
  RUNLOG_ = { found: 0, dvar: 0, uploads: [], notes: [], errors: [] };
  try { runMain_(); }
  catch (e) { RUNLOG_.errors.push(String(e)); throw e; }
  finally { try { writeRunLog_(started, RUNLOG_); } catch (e2) { Logger.log('run log failed: %s', e2); } }
}
function note_(text) { if (RUNLOG_) RUNLOG_.notes.push(text); }
function noteError_(subject, e) { if (RUNLOG_) RUNLOG_.errors.push(`${subject}: ${e}`); }

/** יומן הריצות: גיליון גוגל אחד, שורה לכל ריצה. המזהה נשמר ב-Script Properties (LOG_SHEET_ID). */
function writeRunLog_(started, log) {
  const props = PropertiesService.getScriptProperties();
  let ss = null; const id = props.getProperty('LOG_SHEET_ID');
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; } }
  if (!ss) {
    ss = SpreadsheetApp.create(CONFIG.logSheetName); props.setProperty('LOG_SHEET_ID', ss.getId());
    const first = ss.getSheets()[0]; first.setName('ריצות'); first.setRightToLeft(true);
    first.appendRow(['זמן', 'משך (שניות)', 'מיילים חדשים', 'דברי תורה', 'מה עלה לאתר', 'הערות', 'שגיאות']); first.setFrozenRows(1);
    first.getRange(1, 1, 1, 7).setFontWeight('bold');
    Logger.log('run log created: %s', ss.getUrl());
  }
  const sh = ss.getSheets()[0];
  sh.appendRow([Utilities.formatDate(started, 'Asia/Jerusalem', 'yyyy-MM-dd HH:mm'), Math.round((new Date() - started) / 1000),
    log.found, log.dvar, log.uploads.map(u => `${u.kind}: ${u.subject}`).join(' | '), log.notes.join(' | '), log.errors.join(' | ')]);
  if (log.errors.length) sh.getRange(sh.getLastRow(), 1, 1, 7).setBackground('#fde2e1');
  const extra = sh.getLastRow() - 1 - CONFIG.logKeepRows; if (extra > 0) sh.deleteRows(2, extra);
}

function runMain_() {
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) throw new Error('GITHUB_TOKEN is missing in Script Properties');
  const label = GmailApp.getUserLabelByName(CONFIG.label) || GmailApp.createLabel(CONFIG.label);
  const query = `from:(${CONFIG.senders.join(' OR ')}) newer_than:${CONFIG.lookbackDays}d -label:${CONFIG.label} (has:attachment OR subject:"${CONFIG.archivePrefix}" OR subject:"${CONFIG.albumPrefix}")`;
  const threads = GmailApp.search(query, 0, 10);
  Logger.log('query: %s -> %s thread(s)', query, threads.length);
  const uploads = [];
  if (RUNLOG_) { RUNLOG_.found = threads.length; RUNLOG_.uploads = uploads; }
  runDivreiTorah_(token, label, uploads);

  threads.forEach(thread => {
    const subject = thread.getFirstMessageSubject();
    let msgRef = null;
    try {
      const msgs = thread.getMessages();
      const msg = msgs[msgs.length - 1]; msgRef = msg;
      const subj = cleanSubject_(msg.getSubject());
      if (subj.startsWith(CONFIG.dvarPrefix)) return;   // דברי תורה מטופלים ב-runDivreiTorah_
      const atts = msg.getAttachments();
      const pdf = atts.find(a => /\.pdf$/i.test(a.getName()) || a.getContentType() === 'application/pdf');
      const img = atts.find(a => /^image\/(jpeg|png|webp)$/i.test(a.getContentType()));

      const isArchive = subj.startsWith(CONFIG.archivePrefix);
      if (subj.startsWith(CONFIG.albumPrefix) || isArchive) {
        const prefix = isArchive ? CONFIG.archivePrefix : CONFIG.albumPrefix;
        const baseFolder = isArchive ? CONFIG.archiveFolder : CONFIG.galleryFolder;
        const imgs = atts.filter(a => /^image\/(jpeg|png|webp)$/i.test(a.getContentType()) || a.getContentType() === 'application/pdf');
        const vids = isArchive ? youtubeIds_(msg.getPlainBody()) : [];
        if (!imgs.length && !vids.length) { Logger.log('album mail without images or videos: "%s"', subj); note_(`אלבום בלי תמונות: ${subj}`); thread.addLabel(label); return; }
        const albumTitle = subj.slice(prefix.length).replace(/^[\s:\-]+/, '').trim() || 'אלבום';
        const albumSlug = slug_(albumTitle) || 'album';
        const stamp = Utilities.formatDate(msg.getDate(), 'Asia/Jerusalem', 'yyyyMMdd-HHmm');
        imgs.forEach((a, i) => {
          const ext = a.getContentType() === 'application/pdf' ? 'pdf' : a.getContentType().includes('png') ? 'png' : a.getContentType().includes('webp') ? 'webp' : 'jpg';
          uploadToGitHub_(token, `${baseFolder}/${albumSlug}/${stamp}-${String(i + 1).padStart(2, '0')}.${ext}`, a.getBytes(), `Album photos from email: ${subj}`);
        });
        thread.addLabel(label);
        if (isArchive) {
          const mf = getFile_(token, `${baseFolder}/${albumSlug}/album.json`);
          let meta = null; try { meta = mf.sha ? JSON.parse(mf.text) : null; } catch (e) { meta = null; }
          const fresh = !meta;
          if (!meta) meta = { title: albumTitle, period: '', year_sort: 9999, description: cleanBody_(msg.getPlainBody()).filter(l => !/youtu\.?be/i.test(l)).slice(0, 3).join(' '), contributor: msg.getFrom().replace(/<.*>/, '').trim(), approved: false, items: {} };
          if (!meta.items) meta.items = {};
          vids.forEach((id, i) => { meta.items[`${stamp}-v${String(i + 1).padStart(2, '0')}.video`] = { video: id, caption: cleanBody_(msg.getPlainBody()).filter(l => !/youtu\.?be/i.test(l))[0] || albumTitle, year: '' }; });
          if (fresh || vids.length) putFile_(token, `${baseFolder}/${albumSlug}/album.json`, JSON.stringify(meta, null, 2) + '\n', `Archive collection from email: ${subj}`, mf.sha);
        }
        uploads.push({ kind: isArchive ? 'archive' : 'album', subject: subj, path: `${baseFolder}/${albumSlug}`, album: albumSlug, albumTitle, count: imgs.length + vids.length, kb: Math.round(imgs.reduce((s, a) => s + a.getSize(), 0) / 1024) });
        Logger.log('album "%s": %s photo(s) uploaded', albumTitle, imgs.length);
        return;
      }

      const isEvent = subj.startsWith(CONFIG.eventPrefix) || CONFIG.eventKeywords.some(k => subj.includes(k));
      if (isEvent) {
        if (!img) { Logger.log('event without a poster image: "%s"', subj); note_(`אירוע בלי פוסטר: ${subj}`); thread.addLabel(label); return; }
        const ev = addEvent_(token, subj, msg.getPlainBody(), msg.getDate(), img);
        thread.addLabel(label);
        uploads.push({ kind: 'event', subject: subj, path: ev.poster, event: ev, kb: Math.round(img.getSize() / 1024) });
        Logger.log('event added: %s (%s)', ev.title, ev.date);
        return;
      }

      if (!pdf) {
        Logger.log('no PDF in "%s"', subj); note_(`בלי PDF: ${subj}`); thread.addLabel(label);
        if (subj.startsWith(CONFIG.subjectPrefix)) ackSender_(msg, `שלום,\nהמייל "${subj}" התקבל, אבל לא נמצא בו קובץ PDF, ולכן הדף לא עלה לאתר.\nכדי שיעלה, צריך לשלוח מייל חדש עם הדף מצורף כ-PDF.`);
        return;
      }
      const isWeekly = subj.startsWith(CONFIG.subjectPrefix);
      const folder = isWeekly ? CONFIG.folder : CONFIG.holidayFolder;
      const name = fileNameFor_(subj, msg.getDate());
      const path = `${folder}/${name}`;
      uploadToGitHub_(token, path, pdf.getBytes(), `Sheet from email: ${subj}`);
      thread.addLabel(label);
      uploads.push({ kind: isWeekly ? 'weekly' : 'holiday', subject: subj, path, name, kb: Math.round(pdf.getSize() / 1024), msg });
      Logger.log('uploaded %s (%s KB)', path, Math.round(pdf.getSize() / 1024));
    } catch (e) {
      Logger.log('ERROR on "%s": %s', subject, e);
      noteError_(subject, e);
      sendReport_(`❌ אתר הכיפה: ההעלאה של "${subject}" נכשלה`,
        `המייל: ${subject}\nשגיאה: ${e}\n\n${howToFix_()}`);
      if (msgRef) ackSender_(msgRef, `שלום,\nהמייל "${cleanSubject_(subject)}" התקבל, אבל ההעלאה לאתר נכשלה. הוועד קיבל הודעה על כך ויטפל בזה.`);
    }
  });

  if (uploads.length) {
    // גיטהאב לפעמים מעדכן את האתר תוך דקה ולפעמים תוך כמה דקות: בודקים שוב ושוב עד הדדליין, ורק אז שולחים דוח "עוד מתעדכן".
    const deadline = RUN_STARTED_ + CONFIG.reportDeadlineMs;
    Utilities.sleep(Math.max(0, Math.min(CONFIG.waitForSiteMs, deadline - Date.now())));
    let left = uploads.slice();
    while (left.length) {
      const still = [];
      left.forEach(u => {
        const [subject, body, pending] = buildReport_(token, u);
        if (pending && Date.now() + CONFIG.recheckMs < deadline) still.push(u);
        else { sendReport_(subject, body); if (u.msg) ackSender_(u.msg, ackText_(u, subject)); }
      });
      if (!still.length) break;
      Utilities.sleep(CONFIG.recheckMs); left = still;
    }
  }
}

/** דברי תורה: כל אחד יכול לשלוח; מתפרסם רק אחרי שחבר ועדה (CONFIG.dvarReviewers) מעביר את המייל (Forward) או עונה עליו (Reply all). */
function runDivreiTorah_(token, label, uploads) {
  const pending = GmailApp.getUserLabelByName(CONFIG.dvarPendingLabel) || GmailApp.createLabel(CONFIG.dvarPendingLabel);
  const query = `subject:"${CONFIG.dvarPrefix}" newer_than:${CONFIG.lookbackDays}d -label:${CONFIG.label}`;
  const threads = GmailApp.search(query, 0, 20);
  Logger.log('dvar query: %s -> %s thread(s)', query, threads.length);
  if (RUNLOG_) RUNLOG_.dvar = threads.length;
  const isDvar = m => cleanSubject_(m.getSubject()).startsWith(CONFIG.dvarPrefix);
  const isReviewer = m => CONFIG.dvarReviewers.some(r => (m.getFrom() || '').toLowerCase().includes(r.toLowerCase()));
  threads.forEach(thread => {
    const subject = thread.getFirstMessageSubject();
    try {
      const msgs = thread.getMessages().filter(isDvar);
      if (!msgs.length) { thread.addLabel(label); return; }                      // הדוחות של הסקריפט עצמו וכדומה
      const approved = msgs.slice().reverse().find(isReviewer);
      if (!approved) {
        if (!thread.getLabels().some(l => l.getName() === CONFIG.dvarPendingLabel)) {
          thread.addLabel(pending);
          note_(`דבר תורה ממתין לאישור: ${cleanSubject_(subject)}`);
          const from = msgs[0].getFrom();
          const words = cleanBody_(msgs[0].getPlainBody()).join(' ').split(/\s+/).filter(Boolean).length;
          const lengthLine = words > CONFIG.dvarWarnWords
            ? `⚠️ אורך: ${words} מילים, ארוך מהיעד של ${CONFIG.dvarMaxWords}. אפשר לבקש מהכותב לקצר, או לאשר כמו שהוא.`
            : `אורך: ${words} מילים (היעד: עד ${CONFIG.dvarMaxWords}).`;
          sendReport_(`📝 דבר תורה ממתין לאישור: ${cleanSubject_(subject)}`, [
            `התקבל דבר תורה מאת ${from}.`, `נושא: ${cleanSubject_(msgs[0].getSubject())}`, lengthLine, '',
            'הוא יתפרסם באתר רק אחרי שחבר ועדה יאשר: לפתוח את המייל, לקרוא, ואז להעביר אותו (Forward) ל-vaad@hakipabs.org או להשיב עליו (Reply all) מתוך תיבת הוועד. הריצה הבאה (עד שעה) תפרסם.',
            `כדאי לוודא לפני: שם הכותב בנושא (${CONFIG.dvarPrefix}: <פרשה> / <שם>), עד ${CONFIG.dvarMaxWords} מילים, בלי פרטים אישיים של אחרים.`, '',
            `מי רשאי לאשר: ${CONFIG.dvarReviewers.join(', ')}`,
          ].join('\n'));
        }
        return;
      }
      if (!dvarParasha_(dvarSubject_(approved, msgs[0]))) {
        thread.addLabel(label); thread.removeLabel(pending);
        note_(`דבר תורה בלי שם פרשה: ${cleanSubject_(subject)}`);
        sendReport_(`⚠️ דבר תורה לא פורסם: חסר שם הפרשה בנושא`, [
          `המייל "${cleanSubject_(subject)}" אושר, אבל בנושא שלו אין שם פרשה, ולכן הוא לא פורסם.`,
          `כדי לפרסם: לשלוח אותו שוב במייל חדש עם הנושא: ${CONFIG.dvarPrefix}: <פרשה> / <שם הכותב> / <כותרת>`,
        ].join('\n'));
        return;
      }
      const entry = addDvar_(token, approved, msgs[0]);
      thread.addLabel(label); thread.removeLabel(pending);
      uploads.push({ kind: 'dvar', subject: cleanSubject_(approved.getSubject()), path: CONFIG.dvarJson, entry, kb: 0 });
      Logger.log('dvar torah added: %s / %s', entry.parasha, entry.author);
    } catch (e) {
      Logger.log('ERROR on dvar "%s": %s', subject, e);
      noteError_(subject, e);
      sendReport_(`❌ אתר הכיפה: דבר התורה "${subject}" לא עלה`, `המייל: ${subject}\nשגיאה: ${e}\n\n${howToFix_()}`);
    }
  });
}

/** מוסיף רשומה ל-data/divrei-torah.json מתוך המייל המאושר (הטקסט מגוף המייל, קבצים מצורפים נשמרים ומקושרים). מחזיר את הרשומה. */
/** הנושא שממנו נקראים פרשה / כותב / כותרת: הנושא של המייל, או - כשהוא רק "דבר תורה" - הנושא המקורי בתוך מייל שהועבר. */
function dvarSubject_(msg, firstMsg) {
  const own = cleanSubject_(msg.getSubject());
  const rest = own.slice(CONFIG.dvarPrefix.length).replace(/^[\s:\-]+/, '');
  if (rest.split(/\s*[\/|]\s*/)[0].trim()) return own;
  for (const m of [msg, firstMsg]) {
    const body = (m.getPlainBody() || '').replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '');
    const hit = body.match(/^\s*(?:Subject|נושא)\s*:\s*(.+)$/m);
    if (hit && cleanSubject_(hit[1]).startsWith(CONFIG.dvarPrefix)) return cleanSubject_(hit[1]);
  }
  return own;
}
function dvarParasha_(subj) {
  const parts = subj.slice(CONFIG.dvarPrefix.length).replace(/^[\s:\-]+/, '').split(/\s*[\/|]\s*/).map(s => s.trim()).filter(Boolean);
  return (parts[0] || '').replace(/^פרשת\s+/, '').replace(/[\s,]+$/, '');
}

function addDvar_(token, msg, firstMsg) {
  const subj = dvarSubject_(msg, firstMsg);
  const parts = subj.slice(CONFIG.dvarPrefix.length).replace(/^[\s:\-]+/, '').split(/\s*[\/|]\s*/).map(s => s.trim()).filter(Boolean);
  const parasha = dvarParasha_(subj);
  if (!parasha) throw new Error('NO_PARASHA');
  let author = parts[1] || '';
  const title = parts[2] || '';
  const raw = msg.getPlainBody() || '';
  if (!author) { const m = raw.match(/^\s*(?:מאת|כותב|כתב|כתבה)\s*:\s*(.+)$/m); if (m && !/@/.test(m[1])) author = m[1].trim(); }
  if (!author) { const m = raw.match(/^\s*(?:From|מאת)\s*:\s*(.+?)\s*<[^>]+>/m); if (m) author = m[1].replace(/^["']|["']$/g, '').trim(); }
  if (!author) author = firstMsg.getFrom().replace(/<.*>/, '').replace(/^["']|["']$/g, '').trim() || 'חבר קהילה';
  const paragraphs = paragraphs_(raw);
  if (!paragraphs.length) throw new Error('לא נמצא טקסט בגוף המייל (דבר התורה צריך להיות כתוב בגוף ההודעה)');
  const dateStr = Utilities.formatDate(msg.getDate(), 'Asia/Jerusalem', 'yyyy-MM-dd');
  const base = `${slug_(parasha) || 'parasha'}-${dateStr}-${slug_(author) || 'x'}`;
  const files = [];
  msg.getAttachments().forEach((a, i) => {
    const ext = ((a.getName() || '').match(/\.(pdf|docx?)$/i) || [])[1];
    if (!ext) return;
    const path = `${CONFIG.dvarFiles}/${base}${i ? '-' + (i + 1) : ''}.${ext.toLowerCase()}`;
    uploadToGitHub_(token, path, a.getBytes(), `Dvar Torah file from email: ${subj}`);
    files.push(path);
  });
  const file = getFile_(token, CONFIG.dvarJson);
  let list = [];
  try { list = JSON.parse(file.text); } catch (e) { list = []; }
  if (!Array.isArray(list)) list = [];
  list = list.filter(e => e.id !== base);
  const added = Utilities.formatDate(new Date(), 'Asia/Jerusalem', "yyyy-MM-dd'T'HH:mm:ss");   // שעת ההעלאה: קובעת מי "החדש" כשיש כמה באותו יום
  const entry = { id: base, parasha, author, title, date: dateStr, added, paragraphs, files };
  list.push(entry);
  list.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.added || '').localeCompare(a.added || ''));
  putFile_(token, CONFIG.dvarJson, JSON.stringify(list, null, 2) + '\n', `Dvar Torah from email: ${subj}`, file.sha);
  return entry;
}

/** גוף המייל כפסקאות: בלי כותרות העברה, ציטוטים וחתימות; שורות סמוכות מתחברות לפסקה, שורה ריקה מפרידה. */
function paragraphs_(body) {
  const HEADER = /^(from|date|subject|to|cc|sent|מאת|תאריך|נושא|אל|עותק|כותב|כתב|כתבה)\s*:/i;
  const out = []; let cur = [];
  const flush = () => { if (cur.length) out.push(cur.join(' ').replace(/\s{2,}/g, ' ')); cur = []; };
  (body || '').split(/\r?\n/).forEach(line => {
    const l = line.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').trim();   // סימני כיוון בלתי נראים מסתירים שורות כמו "Subject:"
    if (!l) { flush(); return; }
    if (/^>/.test(l) || /^-{2,}/.test(l) || /wrote:$/.test(l) || /כתב\/ה:$/.test(l)) { flush(); return; }
    if (/forwarded message|הודעה שהועברה|begin forwarded/i.test(l)) { flush(); return; }
    if (/^(sent from my|נשלח מה-|נשלח מן ה)/i.test(l)) { flush(); return; }
    if (HEADER.test(l)) { flush(); return; }
    if (/(^|\s)(subject|to|cc|date|from)\s*:\s/i.test(l) && /@|\d{4}|<|>/.test(l)) { flush(); return; }
    cur.push(l);
  });
  flush();
  return out;
}

/** גוף המייל בלי כותרות של העברה (Forwarded message, From/Date/Subject/To, גם בעברית) ובלי ציטוטים. */
function cleanBody_(body) {
  const HEADER = /^(from|date|subject|to|cc|sent|מאת|תאריך|נושא|אל|עותק)\s*:/i;
  const FOOTER = /קיבלת הודעה זו|you received this message|googlegroups\.com|לביטול הרישום|unsubscribe/i;   // מכאן והלאה: שוליים של קבוצת גוגל
  const raw = (body || '').split(/\r?\n/).map(l => l.replace(/[\u200e\u200f]/g, '').trim());
  const cut = raw.findIndex(l => FOOTER.test(l));
  const kept = cut >= 0 ? raw.slice(0, cut).concat([raw[cut].slice(0, raw[cut].search(FOOTER)).trim()]) : raw;   // מה שלפני השוליים באותה שורה נשמר
  return kept.filter(l => {
    if (!l) return false;
    if (/^\[(image|תמונה|cid)[^\]]*\]$/i.test(l)) return false;        // [image: image.png] של תמונה בגוף המייל
    if (/^>/.test(l) || /^-{2,}/.test(l) || /wrote:$/.test(l) || /כתב\/ה:$/.test(l)) return false;
    if (/forwarded message|הודעה שהועברה|begin forwarded/i.test(l)) return false;
    if (HEADER.test(l)) return false;
    if (/(^|\s)(subject|to|cc|date|from)\s*:\s/i.test(l) && /@|\d{4}|<|>/.test(l)) return false;   // כותרות שהודבקו לשורה אחת
    return true;
  });
}

/** מזהי יוטיוב מתוך גוף המייל: youtu.be/ID, youtube.com/watch?v=ID, youtube.com/shorts/ID, youtube.com/live/ID */
function youtubeIds_(body) {
  const out = [];
  const re = /(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:[^\s]*&)?v=|shorts\/|live\/|embed\/))([A-Za-z0-9_-]{11})/g;
  let m; while ((m = re.exec(body || ''))) { if (!out.includes(m[1])) out.push(m[1]); }
  return out;
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
  // בלי תאריך בנושא: "מחר" = יום אחרי המייל; "הערב"/"היום" (וכל אורייתא בלי מילה כזו) = יום המייל; אירוע רגיל = 14 יום
  const relTomorrow = /(^|\s)מחר(\s|$)/.test(rest);
  if (!date || isNaN(date)) { date = new Date(mailDate); if (relTomorrow) date.setDate(date.getDate() + 1); else if (!byKeyword) date.setDate(date.getDate() + CONFIG.eventDefaultDays); }
  const subjRest = rest.replace(/[\s,\-:]+$/, '');
  let title = subjRest.replace(/^(?:מחר|הערב|היום)\s+/, '');          // "מחר באורייתא" -> "באורייתא" -> "אורייתא"
  CONFIG.eventKeywords.forEach(k => { title = title.replace(new RegExp('^ב(?=' + k + ')'), ''); });
  title = title || 'אירוע';
  const lines = cleanBody_(body);
  const norm = t => (t || '').replace(/\s+/g, ' ').trim();
  const start = (lines[0] && (norm(lines[0]) === title || norm(lines[0]) === subjRest)) ? 1 : 0;   // שורה ראשונה שחוזרת על הנושא מדולגת
  let when = lines[start] || '';
  const more = lines.slice(start + 1, start + 6);
  if (when.length > 70) { more.unshift(when); when = ''; }             // שורה ארוכה היא תיאור, לא "מתי ואיפה"
  let text = more.join(' ');
  if (subjRest && text.startsWith(subjRest)) text = text.slice(subjRest.length).trim();   // "מחר באורייתא הרב..." -> "הרב..."
  text = text.slice(0, 400);
  const ext = img.getContentType().includes('png') ? 'png' : img.getContentType().includes('webp') ? 'webp' : 'jpg';
  const dateStr = Utilities.formatDate(date, 'Asia/Jerusalem', 'yyyy-MM-dd');
  const poster = `${CONFIG.eventsFolder}/${slug_(title) || 'event'}-${dateStr}.${ext}`;
  uploadToGitHub_(token, poster, img.getBytes(), `Event poster from email: ${subj}`);

  const file = getFile_(token, CONFIG.eventsJson);
  let events = [];
  try { events = JSON.parse(file.text); } catch (e) { events = []; }
  if (!Array.isArray(events)) events = [];
  events = events.filter(e => e.poster !== poster);
  // אורייתא וכדומה: פוסטר שהועלה מוקדם (מוואטסאפ) והמייל הרגיל של אותו יום = אותו אירוע. החדש מחליף, לא מתווסף.
  const sameKw = e => e.date === dateStr && CONFIG.eventKeywords.some(k => (e.title || '').includes(k) || (e.poster || '').includes(k));
  const prev = byKeyword ? events.find(sameKw) : null;               // מה שהועלה מוקדם (שעה/מקום שנכתבו ידנית) נשמר אם המייל החדש לא מביא אותם
  if (byKeyword) events = events.filter(e => !sameKw(e));
  const entry = { title, date: dateStr, when: when || (prev && prev.when) || '', place: (prev && prev.place) || '', text: text || (prev && prev.text) || '', poster };
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
  let ok = true, pending = false;   // pending = ההעלאה הצליחה אבל האתר עוד לא מראה אותה; ok=false = בעיה אמיתית

  if (u.kind === 'archive') {
    lines.push(`האוסף נשמר ב-${u.path} עם ${u.count} פריטים, כטיוטה. הוא יופיע באתר אחרי שחבר ועד יאשר: לפתוח את ${u.path}/album.json, לשנות "approved": false ל-true, להוסיף כיתובים ותקופה, ו-Commit.`);
    lines.push(`https://github.com/${CONFIG.repo}/edit/${CONFIG.branch}/${u.path}/album.json`);
  } else if (u.kind === 'album') {
    const gal = fetchJson_(`${CONFIG.siteUrl}/data/gallery.json`);
    const al = gal && (gal.albums || []).find(a => a.slug === u.album);
    if (!al) { pending = true; lines.push('⏳ האלבום עדיין לא מופיע בגלריה. ייתכן שהאוטומציה (הקטנת תמונות) עוד רצה; לבדוק שוב בעוד כמה דקות.'); }
    else lines.push(`האלבום "${al.title}" מופיע בגלריה עם ${al.count} תמונות: ${CONFIG.siteUrl}/gallery.html?album=${encodeURIComponent(al.slug)}`);
  } else if (u.kind === 'event') {
    const list = fetchJson_(`${CONFIG.siteUrl}/${CONFIG.eventsJson}`);
    const item = Array.isArray(list) && list.find(e => e.poster === u.path);
    if (!item) { pending = true; lines.push('⏳ האירוע עדיין לא מופיע באתר. ייתכן שהאתר עוד נבנה; לבדוק שוב בעוד כמה דקות.'); }
    else lines.push('מה האתר מציג:', `• ${item.title}`, `• מתי: ${item.when || '(לא צוין)'}`, `• טקסט: ${item.text || '(ללא)'}`, `• יוצג עד: ${item.date}`);
  } else if (u.kind === 'dvar') {
    const list = fetchJson_(`${CONFIG.siteUrl}/${CONFIG.dvarJson}`);
    const item = Array.isArray(list) && list.find(e => e.id === u.entry.id);
    if (!item) { pending = true; lines.push('⏳ דבר התורה עדיין לא מופיע באתר. ייתכן שהאתר עוד נבנה; לבדוק שוב בעוד כמה דקות.'); }
    else lines.push('מה האתר מציג:', `• פרשת ${item.parasha} · ${item.author}${item.title ? ' · ' + item.title : ''}`,
      `• פסקת הפתיחה (מופיעה בדף הבית כשזו פרשת השבוע): ${(item.paragraphs[0] || '').slice(0, 220)}`,
      `• ${item.paragraphs.length} פסקאות${item.files.length ? ', ' + item.files.length + ' קבצים מצורפים' : ''}`,
      `• ${CONFIG.siteUrl}/divrei-torah.html#${encodeURIComponent(item.id)}`);
  } else {
    const runInfo = latestRun_(token, u.kind === 'weekly' ? 'weekly-sheet.yml' : 'holidays.yml');
    if (runInfo) lines.push(`האוטומציה בגיטהאב: ${runInfo.status}${runInfo.conclusion ? ' / ' + runInfo.conclusion : ''}  ${runInfo.url}`);
    if (runInfo && runInfo.conclusion && runInfo.conclusion !== 'success') ok = false;
    if (runInfo && !runInfo.conclusion) pending = true;
    if (u.kind === 'weekly') {
      const d = fetchJson_(`${CONFIG.siteUrl}/data/shabbat.json`);
      if (!d) { pending = true; lines.push('לא הצלחתי לקרוא את נתוני השבת מהאתר.'); }
      else {
        if (d.source_pdf !== u.name) { pending = true; lines.push(`⏳ האתר עדיין מציג נתונים מקובץ אחר (${d.source_pdf}). ייתכן שהאוטומציה עוד רצה; לבדוק שוב בעוד כמה דקות.`); }
        lines.push('', 'מה האתר מציג עכשיו:',
          `• ${d.parasha || '(פרשה לא נמצאה)'} · ${d.hebrew_date || ''}`,
          `• הדלקת נרות ${d.candles || '?'} · צאת השבת ${d.havdala || '?'} · ר"ת ${d.rabbeinu_tam || '?'}`,
          `• מנחה בחול ${d.weekday_mincha || '?'} · תפילת ילדים ${d.kids_tefila || '?'}`,
          `• זמני תפילה בשבת: ${(d.friday || []).length + (d.shabbat || []).length} שורות`,
          `• מזל טוב: ${((d.mazal_tov && d.mazal_tov.items) || []).length} · תנחומים: ${((d.nichumim && d.nichumim.items) || []).length}`);
        const missing = ['parasha', 'candles', 'havdala', 'friday', 'shabbat'].filter(k => !d[k] || (Array.isArray(d[k]) && !d[k].length));
        if (missing.length) { ok = false; lines.push('', `⚠️ שדות שלא נקראו מה-PDF: ${missing.join(', ')} (נשארו ערכי השבוע הקודם)`); }
        // בדיקות שהאוטומציה עושה מול הדף עצמו ומול הלוח השנתי (scripts/update_shabbat.py, sanity_checks)
        if (d.source_pdf === u.name && Array.isArray(d.checks) && d.checks.length) {
          ok = false; lines.push('', '⚠️ בדיקות שלא עברו (כדאי לבדוק מול מי שהכין את הדף):', ...d.checks.map(c => `• ${c}`));
        }
      }
    } else {
      const h = fetchJson_(`${CONFIG.siteUrl}/data/holidays.json`);
      const item = h && (h.items || []).find(e => e.pdf === u.path);
      if (!item) { pending = true; lines.push('⏳ הלוח עדיין לא מופיע ברשימת לוחות החגים באתר. ייתכן שהאוטומציה עוד רצה.'); }
      else lines.push(`הלוח מופיע באתר בכותרת "${item.title}" ויוצג עד ${item.until || (item.added + ' + 45 יום')}.`);
    }
  }

  lines.push('', `לבדיקה בעין: ${CONFIG.siteUrl}`, '', howToFix_());
  if (pending && ok) lines.unshift('ההעלאה לגיטהאב הצליחה, אבל האתר עוד לא הראה אותה בזמן הבדיקה. זה קורה כשגיטהאב איטי, ובדרך כלל מסתדר לבד תוך כמה דקות.', '');
  const subject = (!ok ? '⚠️ אתר הכיפה, דרושה בדיקה: ' : pending ? '⏳ אתר הכיפה, נשמר והאתר עוד מתעדכן: ' : '✅ אתר הכיפה עודכן: ') + u.subject;
  return [subject, lines.join('\n'), pending && ok];
}

function howToFix_() {
  return [
    'אם משהו לא נכון:',
    '1. שעה או פרשה שגויה: לערוך ידנית את הקובץ data/shabbat.json (עיפרון -> תיקון -> Commit changes):',
    `   https://github.com/${CONFIG.repo}/edit/${CONFIG.branch}/data/shabbat.json`,
    '2. אירוע: לתקן כותרת/תאריך/טקסט או למחוק רשומה בקובץ data/events.json:',
    `   https://github.com/${CONFIG.repo}/edit/${CONFIG.branch}/${CONFIG.eventsJson}`,
    '2ב. דבר תורה: לתקן שם/פרשה/טקסט או למחוק רשומה בקובץ data/divrei-torah.json:',
    `   https://github.com/${CONFIG.repo}/edit/${CONFIG.branch}/${CONFIG.dvarJson}`,
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

/** תשובה קצרה לשולח (רק לכתובות ב-CONFIG.ackSenders, ורק לשולח עצמו, לא "השב לכולם"). */
function ackSender_(msg, text) {
  try {
    const from = (msg.getFrom() || '').toLowerCase();
    if (!(CONFIG.ackSenders || []).some(a => from.includes(a.toLowerCase()))) return;
    msg.reply(`${text}\n\nאתר בית הכנסת הכיפה (הודעה אוטומטית)\n${CONFIG.siteUrl}`, { name: 'אתר בית הכנסת הכיפה' });
  } catch (e) { Logger.log('ack failed: %s', e); }
}

/** נוסח התשובה לשולח, לפי תוצאת הדוח לוועד (✅ / ⏳ / ⚠️) ולפי מה שהאתר מציג. */
function ackText_(u, reportSubject) {
  const what = u.kind === 'weekly' ? 'הדף' : 'הלוח';
  if (reportSubject.startsWith('⏳')) return `שלום,\n${what} "${u.subject}" התקבל ונשמר. האתר יתעדכן בעוד כמה דקות.\nתודה!`;
  if (u.kind !== 'weekly') return reportSubject.startsWith('✅')
    ? `שלום,\n${what} "${u.subject}" עלה לאתר ויוצג בעמוד הבית.\nתודה!`
    : `שלום,\n${what} "${u.subject}" התקבל, אבל משהו בעיבוד לא הסתדר. הוועד קיבל הודעה ויבדוק.`;
  const d = fetchJson_(`${CONFIG.siteUrl}/data/shabbat.json`) || {};
  const shown = [d.parasha, d.hebrew_date, d.candles && `הדלקת נרות ${d.candles}`, d.havdala && `צאת השבת ${d.havdala}`].filter(Boolean).join(' · ');
  const lines = ['שלום,', `הדף "${u.subject}" עלה לאתר.`];
  if (shown) lines.push(`באתר מוצג עכשיו: ${shown}.`);
  const checks = d.source_pdf === u.name && Array.isArray(d.checks) ? d.checks : [];
  const missing = ['parasha', 'candles', 'havdala', 'friday', 'shabbat'].filter(k => !d[k] || (Array.isArray(d[k]) && !d[k].length));
  if (checks.length || missing.length) {
    lines.push('', 'הבדיקה האוטומטית מצאה משהו שכדאי לבדוק:');
    checks.forEach(c => lines.push(`• ${c}`));
    if (missing.length) lines.push('• חלק מהפרטים לא נקראו מהדף, והאתר ממשיך להציג את ערכי השבוע הקודם בשדות האלה.');
    lines.push('', 'אם צריך לתקן, אפשר לשלוח את הדף המתוקן במייל חדש, באותו נושא (לא כתשובה למייל הזה).');
  } else if (!reportSubject.startsWith('✅')) {
    lines.push('', 'משהו בעיבוד באתר לא הסתדר. הוועד קיבל הודעה ויבדוק.');
  }
  lines.push('', 'תודה!');
  return lines.join('\n');
}

function sendReport_(subject, body) {
  if (!CONFIG.reportTo) return;
  MailApp.sendEmail({ to: CONFIG.reportTo, subject, body, name: 'אתר בית הכנסת הכיפה' });
}
