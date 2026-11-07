/* SoMidTN Dashboard: standalone runtime for the public site.
   Provides the small "dash" API the dashboard code (app.js) uses inside Claude:
   data loading, calculations, drawings, county selection and tab links.
   Data comes from the JSON files in data/, rebuilt every day from the Claude dashboard. */
(() => {
  const S = { data: {}, calcs: {}, draws: {}, params: { county: 'Marshall' }, cbs: [], manifest: null };
  const visible = (el) => !el.closest('.sm-page[hidden]');
  const runDraw = (el) => {
    const fn = S.draws[el.dataset.draw];
    if (!fn) return;
    try { fn(el); } catch (e) { console.error('draw ' + el.dataset.draw, e); }
  };
  const drawAll = (onlyVisible = true) => {
    document.querySelectorAll('[data-draw]').forEach((el) => { if (!onlyVisible || visible(el)) runDraw(el); });
    S.cbs.forEach((cb) => { try { cb(); } catch (e) { console.error('onData', e); } });
  };
  window.dash = {
    colors: ['#2a6fdb', '#e07b39', '#3aa676', '#9b59b6', '#c0392b', '#16a085', '#b8860b', '#7f8c8d'],
    loader() {},
    calc(id, def) { S.calcs[id] = def; S.data[id] = { status: 'loading' }; },
    draw(name, fn) {
      if (fn) { S.draws[name] = fn; return; }
      document.querySelectorAll('[data-draw="' + name + '"]').forEach(runDraw);
    },
    data(id) { return S.data[id] || { status: 'idle' }; },
    onData(cb) { S.cbs.push(cb); },
    params() { return S.params; },
    setParams(p) {
      Object.assign(S.params, p);
      try { localStorage.setItem('somidtn.county', S.params.county); } catch (e) {}
      drawAll();
    },
    refresh() {},
    setLink(id) {
      try { history.replaceState(null, '', '#' + id); } catch (e) {}
      requestAnimationFrame(() => document.querySelectorAll('#' + id + ' [data-draw]').forEach(runDraw));
    },
    manifest() { return S.manifest; },
  };
  try { const c = localStorage.getItem('somidtn.county'); if (c) S.params.county = c; } catch (e) {}

  const computeCalcs = () => {
    let left = Object.keys(S.calcs), guard = 0;
    while (left.length && guard++ < 60) {
      left = left.filter((id) => {
        const ins = S.calcs[id].inputs || [];
        const st = ins.map((i) => S.data[i] && S.data[i].status);
        if (st.some((s) => s === 'error' || s === 'idle' || s == null)) { S.data[id] = { status: 'error', message: 'missing input' }; return false; }
        if (st.some((s) => s !== 'ok')) return true;
        try {
          const out = S.calcs[id].fn(...ins.map((i) => S.data[i].data));
          S.data[id] = { status: 'ok', data: Array.isArray(out) ? out : [] };
        } catch (e) { console.error('calc ' + id, e); S.data[id] = { status: 'error', message: String(e) }; }
        return false;
      });
    }
    left.forEach((id) => { S.data[id] = { status: 'error', message: 'unresolved inputs' }; });
  };

  const banner = (m) => {
    const head = document.querySelector('.sm-head');
    if (!head) return;
    const d = new Date(m.generated_at);
    const when = isNaN(d) ? m.generated_at : d.toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' Central';
    const n = document.createElement('p');
    n.className = 'sm-public-note';
    n.textContent = 'Public copy, updated daily (last update ' + when + '). Compiled by Greg Lowe from public sources; not an official TNECD publication. Sources are named in each section.';
    head.insertAdjacentElement('afterend', n);
  };

  window.__dashStart = async () => {
    drawAll();
    let m;
    try { m = await (await fetch('data/manifest.json', { cache: 'no-cache' })).json(); }
    catch (e) { document.body.insertAdjacentHTML('afterbegin', '<p class="sm-public-note">The data could not be loaded. Please refresh the page.</p>'); return; }
    S.manifest = m;
    banner(m);
    m.datasets.forEach((d) => { S.data[d.id] = { status: 'loading' }; });
    drawAll();
    const v = encodeURIComponent(m.generated_at);
    await Promise.all(m.datasets.map(async (d) => {
      try {
        const r = await fetch('data/' + d.id + '.json?v=' + v);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        S.data[d.id] = { status: 'ok', data: await r.json() };
      } catch (e) { console.error('load ' + d.id, e); S.data[d.id] = { status: 'error', message: String(e) }; }
    }));
    computeCalcs();
    drawAll();
    let t;
    window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => drawAll(), 200); });
  };
})();
