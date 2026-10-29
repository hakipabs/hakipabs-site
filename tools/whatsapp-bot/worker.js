// בוט הוואטסאפ של בית הכנסת הכיפה: Cloudflare Worker.
// מקבל הודעות ממטא (WhatsApp Cloud API), עונה מתוך הנתונים שבאתר (data/*.json),
// ומעביר לוועד שאלה שאין לו תשובה עליה.
//
// סודות (Workers > Settings > Variables and Secrets):
//   VERIFY_TOKEN     סיסמה שממציאים; אותה מקלידים ב-Verify token במסך ה-Webhooks של מטא
//   WA_TOKEN         טוקן הגישה ממטא (System User, קבוע)
//   PHONE_NUMBER_ID  המזהה של מספר הטלפון (מסך API Setup)
//   APP_SECRET       App secret של האפליקציה (App settings > Basic): מוודא שההודעה באמת ממטא
//   FORWARD_URL      (רשות) כתובת ה-Web App של ה-Apps Script עם ?key=... : שאלות לא מוכרות נשלחות משם במייל לוועד
// משתנה רגיל (לא סוד): GRAPH_VERSION, ברירת מחדל v23.0

const SITE = 'https://hakipabs.org';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'GET') {
      // אימות חד-פעמי של מטא בעת שמירת ה-Webhook
      if (url.searchParams.has('hub.mode')) {
        const ok = url.searchParams.get('hub.mode') === 'subscribe' && url.searchParams.get('hub.verify_token') === env.VERIFY_TOKEN;
        return new Response(ok ? url.searchParams.get('hub.challenge') || '' : 'wrong verify token', { status: ok ? 200 : 403 });
      }
      return new Response('בוט הוואטסאפ של בית הכנסת הכיפה', { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
    if (request.method !== 'POST') return new Response('', { status: 405 });
    const raw = await request.text();
    if (!(await signatureOk_(raw, request.headers.get('x-hub-signature-256'), env.APP_SECRET))) return new Response('bad signature', { status: 401 });
    let body; try { body = JSON.parse(raw); } catch (e) { return new Response('', { status: 400 }); }
    // עונים למטא מיד; הטיפול בהודעה נמשך ברקע (אחרת מטא שולחת שוב)
    ctx.waitUntil(handleUpdate_(body, env).catch(err => console.log('handle failed', err && err.stack || err)));
    return new Response('ok', { status: 200 });
  },
};

async function signatureOk_(raw, header, secret) {
  if (!secret) return true;   // בלי APP_SECRET אין בדיקה (רק לבדיקות ראשונות)
  if (!header || !header.startsWith('sha256=')) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw));
  const hex = [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
  const got = header.slice(7);
  if (got.length !== hex.length) return false;
  let diff = 0; for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}

async function handleUpdate_(body, env) {
  for (const entry of body.entry || []) for (const change of entry.changes || []) {
    const v = change.value || {};
    const names = Object.fromEntries((v.contacts || []).map(c => [c.wa_id, (c.profile || {}).name || '']));
    for (const m of v.messages || []) {
      if (await seen_(m.id)) continue;   // מטא לפעמים שולחת את אותה הודעה פעמיים
      const text = m.type === 'text' ? (m.text || {}).body || ''
        : m.type === 'interactive' ? ((m.interactive || {}).button_reply || (m.interactive || {}).list_reply || {}).title || ''
        : '';
      const reply = text ? await answer_(text, { from: m.from, name: names[m.from] || '' }, env)
        : 'אני יודע לענות רק על הודעות כתובות. כתבו "תפריט" כדי לראות מה אפשר לשאול.';
      await send_(env, m.from, reply);
    }
  }
}

async function seen_(id) {
  if (!id || typeof caches === 'undefined' || !caches.default) return false;
  const key = new Request('https://dedupe.hakipabs.invalid/' + encodeURIComponent(id));
  if (await caches.default.match(key)) return true;
  await caches.default.put(key, new Response('1', { headers: { 'cache-control': 'max-age=86400' } }));
  return false;
}

async function send_(env, to, text) {
  const ver = env.GRAPH_VERSION || 'v23.0';
  const r = await fetch(`https://graph.facebook.com/${ver}/${env.PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: { 'authorization': 'Bearer ' + env.WA_TOKEN, 'content-type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text.slice(0, 4000), preview_url: false } }),
  });
  if (!r.ok) console.log('send failed', r.status, await r.text());
}

async function data_(name) {
  const r = await fetch(`${SITE}/data/${name}.json`, { cf: { cacheTtl: 300, cacheEverything: true } });
  if (!r.ok) throw new Error(`${name}.json: ${r.status}`);
  return r.json();
}

// ---------- הבנת השאלה ----------

const FIN = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
const norm = t => (t || '').toLowerCase().replace(/[֑-ׇ]/g, '').replace(/['"`״׳]/g, '')
  .replace(/[ךםןףץ]/g, c => FIN[c]).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const thin = t => t.split(' ').map(w => w.length > 2 ? w[0] + w.slice(1).replace(/[וי]/g, '') : w).join(' ');
// מילה בתחילת מילה בשאלה, גם עם אותיות שימוש לפניה ("בשבת", "לשיעור", "והספר")
const esc_ = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const has = (q, ...words) => words.some(w => new RegExp('(^| )[ובהלמשכ]{0,2}' + esc_(norm(w))).test(q));

const MENU = [
  'שלום! אני הבוט של בית הכנסת הכיפה. אפשר לשאול למשל:',
  '• *שבת*: זמני התפילות והדלקת נרות',
  '• *חול*: מנייני שחרית, מנחה וערבית',
  '• *זמנים*: הנץ, סוף זמן ק"ש, שקיעה',
  '• *שיעורים*',
  '• *אירועים*',
  '• *ספר* ושם הספר: אם הוא בספרייה ובאיזה מדף (למשל "ספר משנה ברורה")',
  '• *דבר תורה* לפרשת השבוע',
  '• *ועד*: אנשי קשר',
  '• *תרומה*',
  'כל שאלה אחרת מועברת לוועד, ונחזור אליכם.',
  `האתר: ${SITE}`,
].join('\n');

async function answer_(text, who, env) {
  const q = norm(text);
  if (!q || has(q, 'תפריט', 'עזרה', 'שלום', 'היי', 'הי', 'בוקר טוב', 'ערב טוב', 'menu', 'help', 'hi', 'hello') && q.split(' ').length <= 3) return MENU;
  try {
    if (has(q, 'דבר תורה', 'דברי תורה', 'דבת')) return await dvar_();
    if (has(q, 'שיעור', 'שיעורים', 'לימוד', 'דף יומי')) return await shiurim_();
    if (has(q, 'אירוע', 'אירועים', 'אורייתא', 'מה קורה')) return await events_();
    if (has(q, 'ספר', 'ספרים', 'ספרייה', 'ספריה', 'ספריית', 'מדף')) return await library_(q);
    if (has(q, 'תרומה', 'לתרום', 'תרומות')) return `אפשר לתרום לבית הכנסת דרך האתר: ${SITE}/#truma\nתודה רבה!`;
    if (has(q, 'ועד', 'גבאי', 'אנשי קשר', 'טלפון', 'יצירת קשר', 'השאלת ציוד', 'ציוד')) return await board_();
    if (has(q, 'הנץ', 'זריחה', 'שקיעה', 'קש', 'קריאת שמע', 'סוף זמן', 'חצות', 'עלות', 'זמנים', 'זמני היום', 'טלית')) return await zmanim_();
    const sh = await data_('shabbat');
    if (has(q, 'חול', 'יום חול', 'שחרית', 'ערבית', 'מניין', 'מנין', 'מניינים') && !has(q, 'שבת', 'שישי', 'ליל שבת')) return weekday_(sh);
    if (has(q, 'מנחה') && !has(q, 'שבת', 'שישי')) return weekday_(sh);
    if (has(q, 'שבת', 'שישי', 'נרות', 'הדלקת', 'כניסת', 'יציאת', 'הבדלה', 'צאת', 'פרשה', 'פרשת', 'קבלת שבת', 'רבנו תם')) return shabbat_(sh);
  } catch (e) {
    console.log('answer failed', e && e.stack || e);
    return `מצטער, לא הצלחתי לקרוא את הנתונים כרגע. אפשר לראות הכול באתר: ${SITE}`;
  }
  await forward_(env, who, text);
  return 'תודה! את השאלה הזו העברתי לוועד בית הכנסת, ונחזור אליכם בהקדם.\nכתבו "תפריט" כדי לראות על מה אני יודע לענות מיד.';
}

// ---------- התשובות ----------

const lines = (arr, f) => (arr || []).map(f).join('\n');

function shabbat_(sh) {
  const p = (sh.parasha || '').replace(/^פרשו?ת\s+/, '');
  return [
    `*שבת פרשת ${p}*${sh.hebrew_date ? ` (${sh.hebrew_date})` : ''}`,
    `הדלקת נרות: *${sh.candles || '?'}*`, '',
    '*ערב שבת*', lines(sh.friday, ([n, t]) => `${n}: ${t}`), '',
    '*שבת*', lines(sh.shabbat, ([n, t]) => `${n}: ${t}`), '',
    `צאת השבת: *${sh.havdala || '?'}*${sh.rabbeinu_tam ? ` · ר"ת: ${sh.rabbeinu_tam}` : ''}`,
    ...(sh.note ? ['', sh.note] : []),
    '', `לפי הדף השבועי. הכול באתר: ${SITE}/#tefila`,
  ].join('\n');
}

function weekday_(sh) {
  return [
    '*מניינים ביום חול*', '', '*שחרית*',
    lines(sh.weekday_shacharit, r => `${r.name}: ${r.time}${r.note ? ` (${r.note})` : ''}`), '',
    `*מנחה*: ${sh.weekday_mincha || '?'} (מתעדכן לפי השקיעה)`, '',
    '*ערבית*', lines(sh.weekday_arvit, r => `${r.name}: ${r.time}`),
    `\nלפי הדף השבועי של פרשת ${(sh.parasha || '').replace(/^פרשו?ת\s+/, '')}. ${SITE}/#tefila`,
    'לזמני השבת כתבו "שבת".',
  ].join('\n');
}

async function zmanim_() {
  const sh = await data_('shabbat');
  const z = sh.zmanim || {};
  const day = (sh.zmanim_dates || [])[0];
  return [`*זמני היום*${day ? ` (יום שישי ${day})` : ''}`, ...Object.entries(z).map(([k, v]) => `${k}: ${v}`),
    '\nהזמנים משתנים מעט מיום ליום. מתוך הדף השבועי.'].join('\n');
}

async function shiurim_() {
  const s = await data_('shiurim');
  const out = ['*שיעורים קבועים*', '', '*כל יום*'];
  (s.daily || []).forEach(x => out.push(`• ${x.title}: ${x.when} (${x.days}) · ${x.who} · ${x.place}`));
  (s.weekly || []).forEach(d => {
    out.push('', `*יום ${d.day}*${d.label ? ` · ${d.label}` : ''}`);
    (d.items || []).forEach(x => out.push(`• ${x.title}: ${x.when} · ${x.who} · ${x.place}`));
  });
  out.push('', `${SITE}/#shiurim`);
  return out.join('\n');
}

async function events_() {
  const ev = await data_('events');
  const today = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);   // בערך שעון ישראל
  const up = (ev || []).filter(e => (e.date || '') >= today).sort((a, b) => a.date.localeCompare(b.date));
  if (!up.length) return `אין כרגע אירועים קרובים באתר. ${SITE}`;
  return ['*אירועים קרובים*', ...up.slice(0, 5).map(e => `\n*${e.title}*\n${[e.when, e.place].filter(Boolean).join(' · ')}${e.text ? '\n' + e.text : ''}`), `\n${SITE}`].join('\n');
}

async function board_() {
  const b = await data_('board');
  return ['*ועד בית הכנסת*', ...(b.members || []).map(m => `${m.role}: ${m.name}${m.phone ? ' · ' + m.phone : ''}`), '', `מייל: ${b.email || 'vaad@hakipabs.org'}`].join('\n');
}

const shortKey = id => { let h = 2166136261; for (const c of (id || '')) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); } return 't-' + (h >>> 0).toString(36); };

async function dvar_() {
  const [sh, list] = await Promise.all([data_('shabbat'), data_('divrei-torah')]);
  const key = t => norm((t || '').replace(/^פרשו?ת\s+/, '')).replace(/ /g, '');
  const cur = key(sh.parasha);
  const mine = (list || []).filter(e => key(e.parasha) === cur)
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.added || '').localeCompare(a.added || ''));
  const p = (sh.parasha || '').replace(/^פרשו?ת\s+/, '');
  if (!mine.length) return `עדיין אין דבר תורה לפרשת ${p}. רוצים לכתוב? כל הפרטים כאן: ${SITE}/divrei-torah.html#send`;
  return [`*דבר תורה קהילתי · פרשת ${p}*`, ...mine.map(e => `\n*${e.title || 'דבר תורה'}*\n${e.author || ''}\n${SITE}/divrei-torah.html?d=${shortKey(e.id)}`)].join('\n');
}

// מילים שאינן חלק משם הספר
const STOP = new Set(['ספר', 'ספרים', 'ספרייה', 'ספריה', 'ספריית', 'בספרייה', 'בספריה', 'יש', 'האם', 'את', 'של', 'לכם', 'אצלכם', 'בבית', 'הכנסת', 'כנסת', 'איפה', 'איפוא', 'נמצא', 'מחפש', 'מחפשת', 'רוצה', 'מדף', 'הספר', 'בבקשה', 'תודה'].map(norm));

async function library_(q) {
  const d = await data_('library');
  const LOC = d.locations || {};
  const toks = q.split(' ').filter(w => w && !STOP.has(w));
  const shelf = q.match(/(?:^| )[בהל]?מדפ (\d+)/);   // "מדף 14", "מה יש במדף 14" (אחרי norm האות ף היא פ)
  if (shelf) {
    const on = (d.books || []).filter(b => String(b.s) === shelf[1]);
    if (!on.length) return `לא מצאתי ספרים במדף ${shelf[1]}.`;
    return [`*מדף ${shelf[1]}* (${on.length} ספרים)`, ...on.slice(0, 25).map(b => `• ${b.t}${b.a ? ' · ' + b.a : ''}`), on.length > 25 ? `ועוד ${on.length - 25}: ${SITE}/library.html?shelf=${encodeURIComponent((on[0].l || '') + ':' + shelf[1])}` : ''].filter(Boolean).join('\n');
  }
  if (!toks.length) return `אפשר לחפש ספר כך: "ספר משנה ברורה". או בדף הספרייה: ${SITE}/library.html`;
  const scored = (d.books || []).map(b => {
    const T = norm([b.t, b.st].join(' ')), A = norm(b.a), N = norm(b.n);
    let sc = 0;
    for (const w of toks) {
      const tw = thin(w); let s = 0;
      if (T.startsWith(w)) s = 6; else if ((' ' + T).includes(' ' + w)) s = 5; else if (T.includes(w)) s = 4;
      else if (A.includes(w)) s = 3; else if (thin(T).includes(tw)) s = 3; else if (thin(A).includes(tw)) s = 2;
      else if (N.includes(w) || thin(N).includes(tw)) s = 1;
      if (!s) return [b, 0];
      sc += s;
    }
    return [b, sc];
  }).filter(x => x[1] > 0).sort((x, y) => y[1] - x[1] || (y[0].s != null) - (x[0].s != null)).map(x => x[0]);
  const link = `${SITE}/library.html?q=${encodeURIComponent(toks.join(' '))}`;
  if (!scored.length) return `לא מצאתי "${toks.join(' ')}" ברשימת הספרייה. ייתכן שהספר נמצא ועוד לא נרשם (הרשימה מתעדכנת). אפשר לשאול את הוועד: כתבו את השאלה במילים אחרות, בלי המילה "ספר".`;
  const where = b => b.s != null ? `${LOC[b.l] || 'מקום לא רשום'}, מדף ${b.s}` : b.l ? `${LOC[b.l]}, מדף לא רשום` : 'מיקום לא רשום';
  return [`מצאתי ${scored.length} ${scored.length === 1 ? 'ספר' : 'ספרים'}:`, ...scored.slice(0, 6).map(b => `\n*${b.t}*${b.st ? ' · ' + b.st : ''}${b.a ? '\n' + b.a : ''}\n📍 ${where(b)}`),
    scored.length > 6 ? `\nכל התוצאות: ${link}` : '', '\n(לפי קטלוג הספרייה, שמתעדכן בימים אלה)'].filter(Boolean).join('\n');
}

async function forward_(env, who, text) {
  if (!env.FORWARD_URL) return;
  try {
    await fetch(env.FORWARD_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'whatsapp', from: who.from, name: who.name, text }) });
  } catch (e) { console.log('forward failed', e); }
}
