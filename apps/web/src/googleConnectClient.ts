export const GOOGLE_CONNECT_CLIENT_JS = String.raw`
(function () {
  if (!document.body || document.body.dataset.googleConnect !== '1') return;
  var root = document.getElementById('mr-root');
  if (!root || !root.dataset.roomId) return;
  var ownRoom = root.dataset.roomId;
  var ownRoot = root;
  var gen = 0;
  var dead = false;
  var ac = new AbortController();
  var pending = false;
  function isCurrent() {
    if (dead) return false;
    var r = document.getElementById('mr-root');
    return !!r && r === ownRoot && r.dataset.roomId === ownRoom;
  }
  function setBtnState(d) {
    var ids = ['mr-google-calendar','mr-google-gmail-draft','mr-google-docs','mr-google-disconnect'];
    for (var i = 0; i < ids.length; i++) { var b = document.getElementById(ids[i]); if (b) b.disabled = d; }
  }
  var allowed = { 'calendar-read': 1, 'gmail-draft': 1, 'docs-create': 1 };
  var btnMap = { 'calendar-read': 'mr-google-calendar', 'gmail-draft': 'mr-google-gmail-draft', 'docs-create': 'mr-google-docs' };
  function failClosed() {
    if (!isCurrent()) return;
    var spans = document.querySelectorAll('.mr-google-purpose-status');
    for (var i = 0; i < spans.length; i++) spans[i].textContent = 'Status unavailable';
    var s = document.getElementById('mr-google-status');
    if (s) s.textContent = 'Google connection is unavailable. Please try again.';
  }
  function apply(connections) {
    if (!Array.isArray(connections)) { failClosed(); return; }
    if (connections.length > 3) { failClosed(); return; }
    var seen = {};
    var map = {};
    for (var i = 0; i < connections.length; i++) {
      var c = connections[i];
      if (!c || typeof c !== 'object' || Array.isArray(c) || Object.keys(c).length !== 2 || !Object.prototype.hasOwnProperty.call(c, 'purpose') || !Object.prototype.hasOwnProperty.call(c, 'expiresAt')) { failClosed(); return; }
      if (typeof c.purpose !== 'string' || !Object.prototype.hasOwnProperty.call(allowed, c.purpose) || Object.prototype.hasOwnProperty.call(seen, c.purpose)) { failClosed(); return; }
      if (typeof c.expiresAt !== 'number' || !isFinite(c.expiresAt) || c.expiresAt <= 0) { failClosed(); return; }
      seen[c.purpose] = 1;
      map[c.purpose] = c.expiresAt;
    }
    var now = Date.now();
    for (var p in allowed) {
      var row = document.querySelector('[data-purpose="' + p + '"]');
      if (!row) continue;
      var st = row.querySelector('.mr-google-purpose-status');
      if (!st) continue;
      if (map[p] && map[p] > now) st.textContent = 'Connected for this session';
      else st.textContent = 'Not connected for this session';
    }
  }
  function doFetch(url, opts) {
    if (pending) return Promise.reject(0);
    if (!isCurrent()) return Promise.reject(0);
    pending = true;
    setBtnState(true);
    return fetch(url, opts).then(function (r) {
      if (!isCurrent()) throw 0;
      if (!r.ok) throw new Error('Google connection unavailable');
      return r.json().then(function (j) { if (!isCurrent()) throw 0; return j; });
    }).finally(function () { pending = false; if (!isCurrent()) return; setBtnState(false); });
  }
  function status() {
    doFetch('/api/google/status', { credentials: 'same-origin', redirect: 'error', signal: ac.signal }).then(function (j) {
      if (!isCurrent()) return;
      if (!j || !Array.isArray(j.connections)) { failClosed(); return; }
      apply(j.connections);
    }).catch(function (e) { if (!isCurrent()) return; if (e === 0) return; failClosed(); });
  }
  function isSafeAuth(u) {
    try { var x = new URL(u); if (x.protocol !== 'https:') return false; if (x.host !== 'accounts.google.com') return false; if (x.pathname !== '/o/oauth2/v2/auth') return false; if (x.username || x.password) return false; if (x.port) return false; if (x.hash) return false; return true; } catch (e) { return false; }
  }
  function connect(purpose) {
    doFetch('/api/google/connect', { method: 'POST', credentials: 'same-origin', redirect: 'error', signal: ac.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ purpose: purpose }) }).then(function (j) {
      if (!isCurrent()) return;
      if (!j || typeof j.authorizationUrl !== 'string' || !isSafeAuth(j.authorizationUrl)) { var s = document.getElementById('mr-google-status'); if (s) s.textContent = 'Google connection is unavailable. Please try again.'; return; }
      if (!isCurrent()) return;
      window.location.assign(j.authorizationUrl);
    }).catch(function (e) { if (!isCurrent()) return; if (e === 0) return; var s = document.getElementById('mr-google-status'); if (s) s.textContent = 'Google connection is unavailable. Please try again.'; });
  }
  function disconnect() {
    doFetch('/api/google/disconnect', { method: 'POST', credentials: 'same-origin', redirect: 'error', signal: ac.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) }).then(function (j) {
      if (!isCurrent()) return;
      if (!j || j.disconnected !== true) { var s = document.getElementById('mr-google-status'); if (s) s.textContent = 'Google connection is unavailable. Please try again.'; return; }
      apply([]);
    }).catch(function (e) { if (!isCurrent()) return; if (e === 0) return; var s = document.getElementById('mr-google-status'); if (s) s.textContent = 'Google connection is unavailable. Please try again.'; });
  }
  function getHost(){var h=document.getElementById('mr-integration-plugins');if(h)return h;h=document.createElement('section');h.id='mr-integration-plugins';h.style.cssText='display:flex;flex-wrap:wrap;gap:0.5rem;margin:0.5rem 0';var t=document.createElement('h2');t.textContent='Integration plugins';t.style.cssText='width:100%;font-size:1rem;margin:0 0 0.25rem';h.appendChild(t);ownRoot.parentNode.insertBefore(h,ownRoot);return h;}
  var sec = document.createElement('section');
  sec.id = 'mr-google-connect';sec.style.cssText='padding:0.5rem;border:1px solid #ddd;border-radius:6px;flex:1 1 280px;min-width:240px';
  var h = document.createElement('h2'); h.textContent = 'Google Connect';h.style.cssText='font-size:1rem;margin:0 0 0.25rem';sec.appendChild(h);
  var wrap=document.createElement('div');wrap.style.cssText='display:flex;flex-wrap:wrap;gap:0.4rem;margin:0.25rem 0';sec.appendChild(wrap);
  var purposes = [
    { p: 'calendar-read', b: 'mr-google-calendar', l: 'Connect Calendar' },
    { p: 'gmail-draft', b: 'mr-google-gmail-draft', l: 'Connect Gmail drafts' },
    { p: 'docs-create', b: 'mr-google-docs', l: 'Connect Docs' }
  ];
  for (var i = 0; i < purposes.length; i++) (function (it) {
    var row = document.createElement('div'); row.dataset.purpose = it.p;row.style.cssText='border:1px solid #e0e0e0;border-radius:4px;padding:0.3rem;flex:1 1 120px';var btn = document.createElement('button'); btn.type = 'button'; btn.id = it.b; btn.textContent = it.l; btn.addEventListener('click', function () { if (!isCurrent()) return; connect(it.p); }); row.appendChild(btn);
    var st = document.createElement('span'); st.className = 'mr-google-purpose-status'; st.textContent = 'Not connected for this session'; row.appendChild(st); wrap.appendChild(row);
  })(purposes[i]);
  var det=document.createElement('details');var sum=document.createElement('summary');sum.textContent='Google permissions and session details';det.appendChild(sum);
  var desc = document.createElement('p'); desc.textContent = 'Choose access for this session. Google will ask you to sign in and consent. No email is sent automatically.'; det.appendChild(desc);
  var note = document.createElement('p'); note.textContent = 'Disconnect clears this session only; it does not revoke your Google grant.'; det.appendChild(note);
  sec.appendChild(det);
  var disc = document.createElement('button'); disc.type = 'button'; disc.id = 'mr-google-disconnect'; disc.textContent = 'Disconnect this session'; disc.addEventListener('click', function () { if (!isCurrent()) return; disconnect(); }); sec.appendChild(disc);
  var live = document.createElement('div'); live.id = 'mr-google-status'; live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite'); sec.appendChild(live);
  getHost().appendChild(sec);
  status();
  window.addEventListener('pagehide', function () { dead = true; gen++; ac.abort(); });
  new MutationObserver(function () {
    var r = document.getElementById('mr-root');
    if (!r || r !== ownRoot || r.dataset.roomId !== ownRoom) { dead = true; gen++; ac.abort(); var s = document.getElementById('mr-google-connect'); if (s) s.remove(); }
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-room-id'] });
})();
`;
