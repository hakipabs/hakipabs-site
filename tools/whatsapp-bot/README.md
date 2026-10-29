# בוט הוואטסאפ של בית הכנסת

`worker.js` הוא Cloudflare Worker. הוא מקבל הודעות מ-WhatsApp Cloud API של מטא, עונה מתוך `data/*.json` שבאתר, ומעביר שאלה שאין לו עליה תשובה ל-Apps Script, שמשם היא נשלחת במייל לוועד.

על מה הבוט עונה: שבת, מנייני חול, זמני היום, שיעורים, אירועים, ספר בספרייה (גם "מדף 14"), דבר התורה של השבוע, אנשי הוועד, תרומה. כל שאלה אחרת עוברת לוועד.

## הקמה

1. **מספר הטלפון במטא:** Step 2 > Register your WhatsApp phone number. בקו קווי בוחרים אימות ב-**Phone call** ועונים לשיחה כדי לשמוע את הקוד. המספר לא יכול להיות רשום בוואטסאפ רגיל או בוואטסאפ ביזנס.
2. **Cloudflare:** Workers & Pages > Create > Worker > Hello World, נותנים שם (למשל `hakipa-wa`) > Deploy > Edit code. מדביקים את כל `worker.js` במקום הקוד ושומרים (Deploy).
3. **סודות:** בעמוד ה-Worker > Settings > Variables and Secrets > Add, מסוג Secret:
   - `VERIFY_TOKEN`: סיסמה שממציאים.
   - `WA_TOKEN`: טוקן קבוע של System User (Business Settings > Users > System users), עם הרשאות `whatsapp_business_messaging` ו-`whatsapp_business_management`.
   - `PHONE_NUMBER_ID`: ממסך API Setup במטא.
   - `APP_SECRET`: App settings > Basic > App secret.
   - `FORWARD_URL`: כתובת ה-Web App של ה-Apps Script, עם `?key=` והמפתח של `makeRunKey` (אותו קישור של ההרצה מהטלפון).
4. **Webhook במטא:** Callback URL = כתובת ה-Worker (`https://hakipa-wa.<החשבון>.workers.dev`), Verify token = אותה סיסמה > Verify and save. אחר כך ב-Webhook fields מסמנים **Subscribe** ליד `messages`.
5. **מדיניות פרטיות:** `https://hakipabs.org/privacy.html` (App settings > Basic > Privacy policy URL).
6. **Publish** לאפליקציה. עד אז מגיעות רק הודעות בדיקה.

## בדיקה

שולחים "שלום" למספר. אמור לחזור התפריט. אם לא: Worker > Logs (Begin log stream) ושולחים שוב.

אחרי שינוי בקוד: מדביקים מחדש ב-Edit code ו-Deploy. אחרי שינוי ב-`gmail-to-github.gs`: Deploy > Manage deployments > עריכה > New version, כדי שהקישור יישאר.
