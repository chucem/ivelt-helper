// Video overlay: a Yiddish caption bar, click/highlight markers and a title card, drawn in the page
window.__v = (() => {
  const css = `
  #__vcap{position:fixed;left:50%;transform:translateX(-50%);bottom:38px;z-index:2147483646;max-width:900px;
    padding:12px 26px;border-radius:12px;background:rgba(16,32,58,.92);color:#fff;direction:rtl;text-align:center;
    font:600 26px/1.45 Arial,"Segoe UI",sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.35)}
  #__vcap small{display:block;font-weight:400;font-size:18px;opacity:.85}
  .__vmark{position:absolute;z-index:2147483645;pointer-events:none;border:4px solid #ff8a00;border-radius:12px;
    box-shadow:0 0 0 6px rgba(255,138,0,.25)}
  .__vdot{position:absolute;z-index:2147483645;pointer-events:none;width:34px;height:34px;margin:-17px 0 0 -17px;
    border-radius:50%;background:rgba(255,138,0,.55);border:3px solid #ff8a00}
  #__vcard{position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;align-items:center;justify-content:center;
    background:linear-gradient(135deg,#0f2d52,#1d5fa0);color:#fff;direction:rtl;font-family:Arial,"Segoe UI",sans-serif;text-align:center}
  #__vcard h1{font-size:60px;margin:0 0 14px}#__vcard p{font-size:30px;margin:6px;opacity:.9}`;
  if (!document.getElementById('__vcss')) {
    const s = document.createElement('style'); s.id = '__vcss'; s.textContent = css; document.head.appendChild(s);
  }
  const box = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height }; };
  return {
    cap(text, sub) {
      let c = document.getElementById('__vcap');
      if (!c) { c = document.createElement('div'); c.id = '__vcap'; document.body.appendChild(c); }
      c.textContent = text;
      if (sub) { const s = document.createElement('small'); s.textContent = sub; c.appendChild(s); }
    },
    // a frame around an element (selector or element)
    mark(target, pad = 6) {
      const el = typeof target === 'string' ? document.querySelector(target) : target;
      if (!el) return 'not found';
      const b = box(el), m = document.createElement('div');
      m.className = '__vmark';
      Object.assign(m.style, { left: b.x - pad + 'px', top: b.y - pad + 'px', width: b.w + pad * 2 + 'px', height: b.h + pad * 2 + 'px' });
      document.body.appendChild(m); return 'ok';
    },
    // a round dot where a click happens (page coordinates of the element's point)
    dot(target, fx = .5, fy = .5) {
      const el = typeof target === 'string' ? document.querySelector(target) : target;
      if (!el) return 'not found';
      const b = box(el), d = document.createElement('div');
      d.className = '__vdot';
      Object.assign(d.style, { left: b.x + b.w * fx + 'px', top: b.y + b.h * fy + 'px' });
      document.body.appendChild(d); return 'ok';
    },
    card(title, ...lines) {
      this.uncard();
      const c = document.createElement('div'); c.id = '__vcard';
      const h = document.createElement('h1'); h.textContent = title; c.appendChild(h);
      lines.forEach((l) => { const p = document.createElement('p'); p.textContent = l; c.appendChild(p); });
      document.body.appendChild(c);
    },
    uncard() { document.getElementById('__vcard')?.remove(); },
    clear() { document.querySelectorAll('.__vmark,.__vdot,#__vcap').forEach((e) => e.remove()); this.uncard(); },
  };
})();
'overlay ready';
