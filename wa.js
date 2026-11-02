// כפתור וואטסאפ צף (פינה שמאלית תחתונה): תפריט קטן עם הבוט והמספר העסקי של בית הכנסת.
// נטען בכל דף עם <script src="wa.js" defer>. כל ה-CSS וה-HTML כאן, כדי שהדפים לא ישכפלו אותו.
(function(){
  const BOT = 'https://wa.me/97288609056?text=' + encodeURIComponent('תפריט');
  const VAAD = 'https://wa.me/97286433865';
  const GLYPH = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>';

  const css = `
.wa-fab{position:fixed;left:max(16px,env(safe-area-inset-left));bottom:max(16px,env(safe-area-inset-bottom));z-index:40;direction:rtl;font-family:inherit}
.wa-fab-btn{width:56px;height:56px;border-radius:50%;border:2px solid var(--sand,#c9a86a);background:var(--navy,#1e3a5f);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 6px 18px rgba(20,30,50,.28);padding:0;transition:transform .15s,background .15s}
.wa-fab-btn:hover{background:var(--navy-2,#2b5283);transform:translateY(-2px)}
.wa-fab-btn svg{width:28px;height:28px}
.wa-fab-btn:focus-visible,.wa-fab-menu a:focus-visible{outline:3px solid var(--sand,#c9a86a);outline-offset:3px}
.wa-fab-menu{position:absolute;left:0;bottom:68px;width:max-content;max-width:calc(100vw - 32px);background:#fff;border:1px solid #e4d4ab;border-radius:14px;box-shadow:0 10px 30px rgba(20,30,50,.22);padding:6px;display:none}
.wa-fab.open .wa-fab-menu{display:block}
.wa-fab-menu a{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:10px;text-decoration:none;color:var(--navy,#1e3a5f);line-height:1.35}
.wa-fab-menu a:hover{background:var(--sand-2,#f1e7cf)}
.wa-fab-menu a svg{width:22px;height:22px;flex:none;color:var(--sand,#c9a86a)}
.wa-fab-menu b{display:block;font-size:16px}
.wa-fab-menu small{display:block;font-size:13px;color:#5b6474}
@media (max-width:760px){footer{padding-bottom:88px}}
@media print{.wa-fab{display:none}}`;

  function init(){
    const st = document.createElement('style');
    st.textContent = css;
    document.head.appendChild(st);

    const box = document.createElement('div');
    box.className = 'wa-fab';
    box.innerHTML =
      '<div class="wa-fab-menu" id="wa-fab-menu" role="menu" aria-label="וואטסאפ">' +
        '<a role="menuitem" href="' + BOT + '" target="_blank" rel="noopener">' + GLYPH +
          '<span><b>שאלו את הבוט</b><small>זמני תפילה, שיעורים ועוד. תשובה מיידית</small></span></a>' +
        '<a role="menuitem" href="' + VAAD + '" target="_blank" rel="noopener">' + GLYPH +
          '<span><b>וואטסאפ בית הכנסת</b><small dir="rtl">הודעה אישית לוועד · <span dir="ltr">08-643-3865</span></small></span></a>' +
      '</div>' +
      '<button type="button" class="wa-fab-btn" aria-label="וואטסאפ: הבוט או הוועד" aria-haspopup="true" aria-expanded="false" aria-controls="wa-fab-menu">' + GLYPH + '</button>';
    document.body.appendChild(box);

    const btn = box.querySelector('.wa-fab-btn');
    const items = box.querySelectorAll('.wa-fab-menu a');
    function setOpen(open, focusBtn){
      box.classList.toggle('open', open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if(open) items[0].focus(); else if(focusBtn) btn.focus();
    }
    btn.addEventListener('click', () => setOpen(!box.classList.contains('open')));
    items.forEach(a => a.addEventListener('click', () => setOpen(false)));
    document.addEventListener('click', e => { if(!box.contains(e.target)) setOpen(false); });
    box.addEventListener('keydown', e => {
      if(e.key === 'Escape' && box.classList.contains('open')){ setOpen(false, true); return; }
      if(e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      if(!box.classList.contains('open')) return;
      e.preventDefault();
      const i = [...items].indexOf(document.activeElement);
      items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
    });
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
