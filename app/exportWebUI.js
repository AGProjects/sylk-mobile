/*
 * exportWebUI.js
 *
 * The single self-contained HTML page the phone serves to the browser: login,
 * a raw summary, and a Kind (Contacts / Messages / Files) + Category +
 * Year/Month/Day explorer that mirrors the app's filter. Selecting a slice
 * lists browseable download links plus a "Download all (.zip)" of that slice.
 *
 * No external assets / CDN — works on a LAN with no internet. Plain CommonJS
 * string module shared by app/ExportServer.js and tools/export-mock-server.js
 * so what we test is what ships.
 */

const BLINK_LOGO ='data:image/png;base64,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';

const PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Blink data export</title>
<style>
  :root {
    --bg:#0e1320; --card:#161d2e; --line:#28324a; --fg:#e8edf6; --muted:#8a97b0;
    --accent:#4f7cff; --accent-2:#2bd9a4; --danger:#ff5d6c;
  }
  * { box-sizing:border-box; }
  body { margin:0; min-height:100vh; background:var(--bg); color:var(--fg);
    font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    display:flex; align-items:flex-start; justify-content:center; }
  .wrap { width:100%; max-width:860px; padding:28px 18px 64px; }
  header.brand { display:flex; align-items:center; gap:12px; margin-bottom:22px; }
  header.brand .logo { width:40px; height:40px; object-fit:contain; }
  header.brand h1 { font-size:18px; margin:0; font-weight:650; }
  header.brand small { color:var(--muted); display:block; font-weight:400; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:22px; margin-bottom:18px; }
  h2 { font-size:15px; margin:0 0 14px; font-weight:600; }
  label { display:block; font-size:13px; color:var(--muted); margin-bottom:6px; }
  input[type=text] { width:100%; padding:12px 14px; font-size:16px; letter-spacing:2px;
    background:#0c1220; border:1px solid var(--line); border-radius:10px; color:var(--fg); outline:none; text-transform:uppercase; }
  input:focus { border-color:var(--accent); }
  button { margin-top:14px; width:100%; padding:12px 14px; font-size:15px; font-weight:600;
    background:var(--accent); color:#fff; border:0; border-radius:10px; cursor:pointer; }
  button.secondary { background:transparent; border:1px solid var(--line); color:var(--muted); }
  .err { color:var(--danger); font-size:13px; min-height:18px; margin-top:10px; }
  .hidden { display:none !important; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:12px; }
  .stat { background:#0c1220; border:1px solid var(--line); border-radius:12px; padding:14px 16px; }
  .stat .n { font-size:24px; font-weight:700; }
  .stat .k { color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.6px; margin-top:4px; }
  .stat.clickable { cursor:pointer; }
  .stat.active { border-color:var(--accent-2); background:#0e2a22; }
  .stat.active .k { color:var(--accent-2); }
  .meta { color:var(--muted); font-size:13px; margin-bottom:16px; }
  .meta b { color:var(--fg); font-weight:600; }
  .row-top { display:flex; align-items:center; justify-content:space-between; margin-bottom:4px; }
  .rowlabel { font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:.6px; margin:14px 0 2px; }
  .pills { display:flex; gap:8px; overflow-x:auto; padding:6px 0 8px; -webkit-overflow-scrolling:touch; }
  .pills::-webkit-scrollbar { height:6px; } .pills::-webkit-scrollbar-thumb { background:var(--line); border-radius:3px; }
  .pill { flex:0 0 auto; padding:7px 13px; border:1px solid var(--line); border-radius:999px; background:#0c1220; color:var(--fg); cursor:pointer; font-size:13px; white-space:nowrap; }
  .pill .c { color:var(--muted); font-size:11px; margin-left:7px; font-variant-numeric:tabular-nums; }
  .pill.active { background:var(--accent); border-color:var(--accent); color:#fff; }
  .pill.active .c { color:rgba(255,255,255,.85); }
  .pill.kind.active, .pill.cat.active, .pill.fmt.active { background:var(--accent-2); border-color:var(--accent-2); color:#06281f; }
  .pill.kind.active .c, .pill.cat.active .c { color:rgba(6,40,31,.7); }
  .headline { margin-top:16px; font-size:16px; font-weight:650; display:flex; align-items:center; flex-wrap:wrap; gap:10px; }
  .headline .sub { color:var(--muted); font-weight:400; font-size:13px; }
  .dl { background:var(--accent); color:#fff; text-decoration:none; font-size:13px; font-weight:600; padding:8px 14px; border-radius:10px; }
  .reset { color:var(--accent); font-size:12px; cursor:pointer; }
  .items { margin-top:14px; border-top:1px solid var(--line); }
  .item { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:10px 2px; border-bottom:1px solid var(--line); font-size:13px; }
  .item .label { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .item .label b { font-weight:600; } .item .label span { color:var(--muted); }
  .item .acts { flex:0 0 auto; display:flex; gap:10px; }
  .item a { color:var(--accent); text-decoration:none; font-size:12px; }
  .item a.muted { color:var(--muted); }
  .note { color:var(--muted); font-size:12px; margin-top:14px; }
  .hint { color:var(--muted); font-size:12px; }
</style>
</head>
<body>
<div class="wrap">
  <header class="brand"><img class="logo" src="${BLINK_LOGO}" alt="Blink" /><div><h1>Blink data export<small id="host"></small></h1></div></header>

  <section id="login" class="card">
    <h2>Authentication required</h2>
    <label for="token">Enter the auth key shown on your phone</label>
    <input id="token" type="text" inputmode="latin" autocomplete="off" placeholder="XXXX-XXXX" maxlength="9" />
    <button id="loginBtn">Unlock</button>
    <div id="loginErr" class="err"></div>
  </section>

  <section id="summary" class="card hidden">
    <div class="row-top"><h2>Available data</h2>
      <button id="logoutBtn" class="secondary" style="width:auto;margin:0;padding:7px 14px;">Lock</button></div>
    <div id="meta" class="meta"></div>
    <div id="stats" class="grid"></div>

    <div id="catLabel" class="rowlabel hidden">Category</div>
    <div id="catRow" class="pills"></div>

    <div id="contactLabel" class="rowlabel hidden">Contact</div>
    <div id="contactRow" class="pills"></div>

    <div id="fmtLabel" class="rowlabel hidden">Message format</div>
    <div id="fmtRow" class="pills"></div>

    <div id="yearLabel" class="rowlabel hidden">Year</div>
    <div id="yearRow" class="pills"></div>
    <div id="monthLabel" class="rowlabel hidden">Month</div>
    <div id="monthRow" class="pills"></div>
    <div id="dayLabel" class="rowlabel hidden">Day</div>
    <div id="dayRow" class="pills"></div>

    <div id="headline" class="headline"></div>
    <div id="items" class="items"></div>
    <p class="note">Contacts always export in full. Messages and files can be
      narrowed by category and date. Each export keeps the app's
      account / contact / … folder structure.</p>
  </section>
</div>

<script>
(function () {
  var $ = function (id) { return document.getElementById(id); };
  $('host').textContent = location.host;

  var KINDS = [{ id: 'contacts', label: 'Contacts' }, { id: 'messages', label: 'Messages' }, { id: 'files', label: 'Files' }];
  var MSG_CATS = [{ id: 'all', label: 'All messages' }, { id: 'text', label: 'Text' }, { id: 'links', label: 'Links' }, { id: 'location', label: 'Location' }];
  var FILE_CATS = [{ id: 'all', label: 'All files' }, { id: 'image', label: 'Images' }, { id: 'audio', label: 'Audio' }, { id: 'video', label: 'Video' }, { id: 'other', label: 'Other' }];
  var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  var S = { kind: 'messages', cat: 'all', contact: null, fmt: 'story', year: null, month: null, day: null, index: {}, summary: null, token: '' };

  // Download links carry the auth token in the URL so they don't depend on the
  // SameSite httpOnly session cookie being attached to download navigations.
  function withToken(u) { if (!u) return u; return u + (u.indexOf('?') >= 0 ? '&' : '?') + 'token=' + encodeURIComponent(S.token || ''); }

  function fmtNum(n) { return (n || 0).toLocaleString(); }
  function fmtBytes(b) { if (!b) return '0 B'; var u=['B','KB','MB','GB','TB'],i=0; while(b>=1024&&i<u.length-1){b/=1024;i++;} return (i===0?b:b.toFixed(1))+' '+u[i]; }

  function catsForKind() { return S.kind === 'files' ? FILE_CATS : MSG_CATS; }

  // Merge the per-category day index into the active kind+category series.
  function activeIndex() {
    var idx = S.index || {};
    function merge(keys) {
      var m = {};
      keys.forEach(function (k) { (idx[k] || []).forEach(function (e) { m[e.day] = (m[e.day] || 0) + e.count; }); });
      return Object.keys(m).sort(function (a, b) { return a < b ? 1 : -1; }).map(function (d) { return { day: d, count: m[d] }; });
    }
    if (S.kind === 'messages') {
      if (S.cat === 'all') return merge(['text', 'location']);
      return idx[S.cat] || [];
    }
    if (S.kind === 'files') {
      if (S.cat === 'all') return merge(['image', 'audio', 'video', 'other']);
      return idx[S.cat] || [];
    }
    return [];
  }

  function pill(cls, label, count, active, onClick) {
    var el = document.createElement('div');
    el.className = 'pill ' + cls + (active ? ' active' : '');
    el.innerHTML = label + (count != null ? '<span class="c">' + fmtNum(count) + '</span>' : '');
    el.addEventListener('click', onClick);
    return el;
  }

  function agg(list, keyFn, filterFn) {
    var m = {}; list.forEach(function (e) { if (filterFn && !filterFn(e.day)) return; var k = keyFn(e.day); m[k] = (m[k] || 0) + e.count; }); return m;
  }

  function renderCats() {
    var label = $('catLabel'), row = $('catRow');
    if (S.kind === 'contacts') { label.classList.add('hidden'); row.innerHTML = ''; return; }
    label.classList.remove('hidden'); row.innerHTML = '';
    var idx = S.index || {};
    catsForKind().forEach(function (c) {
      var total;
      if (c.id === 'all') total = activeIndexFor(c.id).reduce(function (s, e) { return s + e.count; }, 0);
      else total = (idx[c.id] || []).reduce(function (s, e) { return s + e.count; }, 0);
      row.appendChild(pill('cat', c.label, total, S.cat === c.id, function () {
        S.cat = c.id; S.contact = null; S.year = null; S.month = null; S.day = null; refetchCalendar().then(renderAll);
      }));
    });
  }

  function activeIndexFor(catId) {
    var saved = S.cat; S.cat = catId; var r = activeIndex(); S.cat = saved; return r;
  }

  // Contact "train" — only contacts that have media in the current
  // kind/category/period, ordered by count desc. Filters the export.
  var contactsSeq = 0;
  function shortUri(u) { return String(u || ''); }
  function renderContacts() {
    var label = $('contactLabel'), row = $('contactRow');
    if (S.kind === 'contacts') { label.classList.add('hidden'); row.innerHTML = ''; S.contactsList = null; return; }
    var seq = ++contactsSeq;
    label.classList.remove('hidden');
    row.innerHTML = '<span class="hint">loading contacts…</span>';
    fetch('/api/contacts-counts?' + 'kind=' + S.kind + '&category=' + S.cat + '&period=' + encodeURIComponent(period()) + '&token=' + encodeURIComponent(S.token || ''), { credentials: 'same-origin' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) {
        if (seq !== contactsSeq) return;
        var contacts = (d && d.contacts) || [];
        S.contactsList = contacts;
        row.innerHTML = '';
        if (!contacts.length) { row.innerHTML = '<span class="hint">no contacts with this media</span>'; renderHeadlineOnly(); return; }
        var total = contacts.reduce(function (s, c) { return s + c.count; }, 0);
        row.appendChild(pill('cat', 'All', total, S.contact === null, function () { S.contact = null; refetchCalendar().then(renderAll); }));
        contacts.forEach(function (c) {
          row.appendChild(pill('', shortUri(c.contact), c.count, S.contact === c.contact, function () { S.contact = (S.contact === c.contact ? null : c.contact); refetchCalendar().then(renderAll); }));
        });
        renderHeadlineOnly();
      })
      .catch(function (e) { if (seq === contactsSeq) row.innerHTML = '<span class="hint">contacts error: ' + (e.message || e) + '</span>'; });
  }

  function renderFmt() {
    var label = $('fmtLabel'), row = $('fmtRow');
    if (S.kind !== 'messages') { label.classList.add('hidden'); row.innerHTML = ''; return; }
    label.classList.remove('hidden'); row.innerHTML = '';
    [{ id: 'story', label: 'Story (chat.txt)' }, { id: 'html', label: 'HTML (chat.html)' }, { id: 'json', label: 'JSON' }].forEach(function (f) {
      row.appendChild(pill('fmt', f.label, null, S.fmt === f.id, function () { S.fmt = f.id; renderAll(); }));
    });
  }

  function renderCalendar() {
    var list = activeIndex();
    var hide = S.kind === 'contacts';
    ['yearLabel', 'monthLabel', 'dayLabel'].forEach(function (id) { $(id).classList.toggle('hidden', true); });
    ['yearRow', 'monthRow', 'dayRow'].forEach(function (id) { $(id).innerHTML = ''; });
    if (hide) return;

    $('yearLabel').classList.remove('hidden');
    var yAgg = agg(list, function (d) { return d.substring(0, 4); });
    var years = Object.keys(yAgg).sort(function (a, b) { return b - a; });
    years.forEach(function (y) { $('yearRow').appendChild(pill('', y, yAgg[y], S.year === y, function () { S.year = (S.year === y ? null : y); S.month = null; S.day = null; renderAll(); })); });
    if (!years.length) $('yearRow').innerHTML = '<span class="hint">No dated items in this category.</span>';

    if (S.year) {
      $('monthLabel').classList.remove('hidden');
      var mAgg = agg(list, function (d) { return d.substring(0, 7); }, function (d) { return d.substring(0, 4) === S.year; });
      Object.keys(mAgg).sort(function (a, b) { return a < b ? 1 : -1; }).forEach(function (m) {
        var mn = parseInt(m.substring(5, 7), 10);
        $('monthRow').appendChild(pill('', MONTHS[mn - 1] + ' ' + S.year, mAgg[m], S.month === m, function () { S.month = (S.month === m ? null : m); S.day = null; renderAll(); }));
      });
    }
    if (S.month) {
      $('dayLabel').classList.remove('hidden');
      var dAgg = agg(list, function (d) { return d; }, function (d) { return d.substring(0, 7) === S.month; });
      Object.keys(dAgg).sort(function (a, b) { return a < b ? 1 : -1; }).forEach(function (d) {
        var dn = parseInt(d.substring(8, 10), 10), mn = parseInt(d.substring(5, 7), 10);
        $('dayRow').appendChild(pill('', dn + ' ' + MONTHS[mn - 1], dAgg[d], S.day === d, function () { S.day = (S.day === d ? null : d); renderAll(); }));
      });
    }
  }

  function period() { return S.day || S.month || S.year || 'all'; }
  function periodLabel() {
    if (S.day) { var p = S.day.split('-'); return parseInt(p[2], 10) + ' ' + MONTHS[parseInt(p[1], 10) - 1] + ' ' + p[0]; }
    if (S.month) { var q = S.month.split('-'); return MONTHS[parseInt(q[1], 10) - 1] + ' ' + q[0]; }
    if (S.year) return S.year;
    return 'All time';
  }
  function selQuery() {
    var q = 'kind=' + S.kind;
    if (S.kind !== 'contacts') q += '&category=' + S.cat + '&period=' + encodeURIComponent(period());
    if (S.kind !== 'contacts' && S.contact) q += '&contact=' + encodeURIComponent(S.contact);
    if (S.kind === 'messages') q += '&format=' + S.fmt;
    return q;
  }

  function renderStats() {
    var d = S.summary; if (!d) return;
    var m = d.messages || {}, f = (d.files && d.files.total) || {};
    // The three kind cards double as the Contacts/Messages/Files selector;
    // "Total size" is informational only.
    var cards = [
      { kind: 'contacts', k: 'Contacts', n: fmtNum(d.contacts && d.contacts.total) },
      { kind: 'messages', k: 'Messages', n: fmtNum((m.text || 0) + (m.location || 0)) },
      { kind: 'files', k: 'Files', n: fmtNum(f.count) },
      { k: 'Total size', n: fmtBytes(f.bytes) },
    ];
    var grid = $('stats'); grid.innerHTML = '';
    cards.forEach(function (c) {
      var el = document.createElement('div');
      el.className = 'stat' + (c.kind ? ' clickable' : '') + (c.kind && S.kind === c.kind ? ' active' : '');
      el.innerHTML = '<div class="n">' + c.n + '</div><div class="k">' + c.k + '</div>';
      if (c.kind) el.addEventListener('click', function () {
        S.kind = c.kind; S.cat = 'all'; S.contact = null; S.year = null; S.month = null; S.day = null; refetchCalendar().then(renderAll);
      });
      grid.appendChild(el);
    });
    var when = new Date(d.generated_at);
    var ua = ((d.device && d.device.useragent) || '').replace(/[<>&]/g, '');
    $('meta').innerHTML = 'Account <b>' + (d.account || '—') + '</b>'
      + (ua ? ' on <b>' + ua + '</b>' : '') + ' · as of ' + when.toLocaleString();
  }

  // Count for the current selection. When a contact is picked we use the
  // server-computed per-contact count (accurate for kind+category+period);
  // otherwise we sum the calendar index for the period.
  function periodCount() {
    if (S.kind === 'contacts') return (S.summary && S.summary.contacts && S.summary.contacts.total) || 0;
    if (S.contact && S.contactsList) {
      var e = S.contactsList.filter(function (c) { return c.contact === S.contact; })[0];
      return e ? e.count : 0;
    }
    var per = period();
    return activeIndex()
      .filter(function (e2) { return per === 'all' || e2.day.indexOf(per) === 0; })
      .reduce(function (s, e2) { return s + e2.count; }, 0);
  }

  function renderHeadlineOnly() { renderManifest(); }

  // When embedded in the Import modal's WebView, post the current selection up
  // to React Native so it can run the add-only diff/copy for this slice.
  function postSelection() {
    if (typeof window !== 'undefined' && window.ReactNativeWebView) {
      try {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'selection', kind: S.kind, category: S.cat, period: period(), format: S.fmt,
        }));
      } catch (e) { /* ignore */ }
    }
  }

  var manifestSeq = 0;
  function renderManifest() {
    postSelection();
    var headline = $('headline'), items = $('items');
    var catLabel = S.kind === 'contacts' ? 'All contacts'
      : catsForKind().filter(function (c) { return c.id === S.cat; })[0].label + ' · ' + periodLabel()
        + (S.contact ? ' · ' + S.contact : '');
    var count = periodCount();
    headline.innerHTML = '<span>' + catLabel + '</span><span class="sub">' + fmtNum(count) + ' item' + (count === 1 ? '' : 's') + '</span>';

    // Download-all for the current selection (any level) — direct zip link;
    // the server names it Blink-<sel>-<period>.zip via Content-Disposition.
    if (count > 0 || S.kind === 'contacts') {
      var a = document.createElement('a');
      a.className = 'dl'; a.href = withToken('/api/export.zip?' + selQuery());
      a.textContent = 'Download all · .zip';
      headline.appendChild(a);
    }

    // Individual entries are listed ONLY at day level (contacts has no calendar,
    // so it shows its single item directly). Higher levels stay light.
    if (S.kind !== 'contacts' && !S.day) {
      items.innerHTML = '<div class="hint" style="padding:10px 0;">Pick a day to list individual items — or use “Download all”.</div>';
      return;
    }

    items.innerHTML = '<div class="hint" style="padding:10px 0;">Loading…</div>';
    var seq = ++manifestSeq;
    fetch('/api/selection?' + selQuery(), { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (mf) {
        if (seq !== manifestSeq) return;
        items.innerHTML = '';
        (mf.items || []).forEach(function (it) { items.appendChild(renderItem(it)); });
        if (!(mf.items || []).length) items.innerHTML = '<div class="hint" style="padding:10px 0;">Nothing in this selection.</div>';
      })
      .catch(function () { if (seq === manifestSeq) items.innerHTML = '<div class="hint" style="padding:10px 0;">Could not load selection.</div>'; });
  }

  function row(labelHtml, actsHtml) {
    var el = document.createElement('div'); el.className = 'item';
    el.innerHTML = '<div class="label">' + labelHtml + '</div><div class="acts">' + actsHtml + '</div>';
    return el;
  }
  function renderItem(it) {
    if (it.type === 'file') {
      var lbl = '<b>' + it.filename + '</b> <span>· ' + it.contact + (it.filesize ? ' · ' + fmtBytes(it.filesize) : '') + (it.present ? '' : ' · not on device') + '</span>';
      var acts = (it.present ? '<a href="' + withToken(it.blob_url) + '" download="' + it.filename + '">Download</a>' : '') + '<a class="muted" href="' + withToken(it.meta_url) + '">.metadata</a>';
      return row(lbl, acts);
    }
    if (it.type === 'chat') {
      var fn = it.file || 'chat.txt';
      return row('<b>' + it.day + '</b> <span>· ' + it.contact + ' · ' + fmtNum(it.count) + ' msgs</span>', '<a href="' + withToken(it.url) + '" download="' + fn + '">' + fn + '</a>');
    }
    if (it.type === 'messages_json') {
      return row('<b>' + it.contact + '</b> <span>· ' + fmtNum(it.count) + ' msgs</span>', '<a href="' + withToken(it.url) + '" download="messages.json">messages.json</a>');
    }
    if (it.type === 'contacts_json') {
      return row('<b>All contacts</b> <span>· ' + fmtNum(it.count) + '</span>', '<a href="' + withToken(it.url) + '" download="contacts.json">contacts.json</a>');
    }
    return row(JSON.stringify(it), '');
  }

  function renderAll() { renderStats(); renderCats(); renderContacts(); renderFmt(); renderCalendar(); renderManifest(); }

  function showSummary() { $('login').classList.add('hidden'); $('summary').classList.remove('hidden'); renderAll(); }

  function authedJson(p) { return fetch(p, { credentials: 'same-origin' }).then(function (r) { if (r.status === 401) throw new Error('unauth'); if (!r.ok) throw new Error('http ' + r.status); return r.json(); }); }
  function loadAll() { return Promise.all([authedJson('/api/summary'), authedJson('/api/calendar')]).then(function (res) { S.summary = res[0]; S.index = (res[1] && res[1].index) || {}; S.calContact = null; showSummary(); }); }

  // Refetch the calendar index scoped to the selected contact (so Year/Month/Day
  // counts reflect that contact). Guarded so we only fetch when it changed.
  function refetchCalendar() {
    if (S.calContact === S.contact && S.index) return Promise.resolve();
    return authedJson('/api/calendar' + (S.contact ? '?contact=' + encodeURIComponent(S.contact) : ''))
      .then(function (d) { S.index = (d && d.index) || {}; S.calContact = S.contact; })
      .catch(function () {});
  }

  function doLogin() {
    var btn = $('loginBtn'), err = $('loginErr');
    // Strip the display hyphen / spaces so a pasted "XNNM-NE8M" matches the
    // server's "XNNMNE8M".
    var token = ($('token').value || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
    if (!token) { err.textContent = 'Enter the auth key.'; return; }
    S.token = token;
    btn.disabled = true; err.textContent = '';
    fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ token: token }) })
      .then(function (r) { if (r.status === 401) throw new Error('Wrong auth key.'); if (!r.ok) throw new Error('Login failed (' + r.status + ').'); return loadAll(); })
      .catch(function (e) { err.textContent = e.message || 'Login failed.'; })
      .finally(function () { btn.disabled = false; });
  }
  function doLogout() { fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }).finally(function () { $('summary').classList.add('hidden'); $('login').classList.remove('hidden'); $('token').value = ''; }); }

  $('loginBtn').addEventListener('click', doLogin);
  $('token').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
  $('logoutBtn').addEventListener('click', doLogout);

  // QR / deep-link auto-login: another phone scans http://ip:port/?token=KEY
  // and lands here already signed in.
  function tokenFromUrl() {
    var m = (location.search || '').match(/[?&]token=([^&]+)/);
    return m ? decodeURIComponent(m[1]).toUpperCase().replace(/[^0-9A-Z]/g, '') : '';
  }
  function autoLogin() {
    var t = tokenFromUrl();
    if (!t) return false;
    S.token = t;
    $('token').value = t;
    fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ token: t }) })
      .then(function (r) { if (!r.ok) throw new Error('login'); return loadAll(); })
      .then(function () { try { history.replaceState({}, '', location.pathname); } catch (e) {} })
      .catch(function () { $('loginErr').textContent = 'Auto sign-in failed — tap Unlock.'; });
    return true;
  }

  if (!autoLogin()) loadAll().catch(function () {});
})();
</script>
</body>
</html>`;

module.exports = { PAGE: PAGE };
