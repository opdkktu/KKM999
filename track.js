/* KKM999 — location tracking. Starts by itself when "En route" is logged, stops by itself at "At base".
   Works on Android Chrome and iPhone Safari / Home Screen app. Replaces the old track.js completely. */
(function () {
  const $ = id => document.getElementById(id);
  const LS = { st: "trk_state", buf: "trk_buf" };
  const MAX_HOURS = 12;                                   // safety: never track longer than this
  let map, line, dot, watchId = null, wake = null, timer = null, flushT = null, dogT = null;
  let pts = [], buf = [], runUid = "", t0 = 0, dist = 0, lastFix = 0, badge = null;

  /* ---------- little helpers ---------- */
  const lsGet = k => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const lsDel = k => { try { localStorage.removeItem(k); } catch (e) {} };
  const toast = m => { try { showToast(m); } catch (e) {} };
  const saveState = () => lsSet(LS.st, { runUid: runUid, t0: t0, dist: dist });
  const saveBuf = () => lsSet(LS.buf, buf.slice(-3000));

  function ensureMap() {
    if (map || !window.L || !$("trk-map")) return;
    map = L.map("trk-map", { zoomControl: false }).setView([6.240404, 100.246714], 16);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(map);
    line = L.polyline(pts.map(p => [p.lat, p.lng]), { color: "#0F5C56", weight: 6 }).addTo(map);
    dot = L.circleMarker([0, 0], { radius: 9, color: "#fff", weight: 3, fillColor: "#1C8F84", fillOpacity: 1 });
  }
  function hav(a, b) {
    const r = Math.PI / 180, dLa = (b.lat - a.lat) * r, dLo = (b.lng - a.lng) * r;
    const x = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) ** 2;
    return 2 * 6371000 * Math.asin(Math.sqrt(x));
  }

  /* ---------- "Tracking ON" badge (always visible while running) ---------- */
  function makeBadge() {
    if (badge) return;
    const css = document.createElement("style");
    css.textContent =
      "#trk-badge{position:fixed;left:12px;bottom:calc(12px + env(safe-area-inset-bottom));z-index:9999;display:none;align-items:center;gap:8px;" +
      "padding:9px 14px;border-radius:999px;background:#0F5C56;color:#fff;font:600 13px system-ui,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.3);border:0;cursor:pointer}" +
      "#trk-badge.on{display:flex}#trk-badge.warn{background:#B45309}" +
      "#trk-badge i{width:10px;height:10px;border-radius:50%;background:#ff5a50;animation:trkp 1.2s infinite}" +
      "@keyframes trkp{0%,100%{opacity:1}50%{opacity:.25}}";
    document.head.appendChild(css);
    badge = document.createElement("button"); badge.id = "trk-badge"; badge.type = "button";
    badge.innerHTML = "<i></i><span>Tracking ON</span>";
    badge.addEventListener("click", () => { $("trk").hidden = false; ensureMap(); setTimeout(() => map && map.invalidateSize(), 50); });
    document.body.appendChild(badge);
  }
  function setBadge(on, warn, text) {
    makeBadge();
    badge.classList.toggle("on", !!on); badge.classList.toggle("warn", !!warn);
    badge.querySelector("span").textContent = text || "Tracking ON";
    if ($("btn-track")) $("btn-track").textContent = on ? "📍●" : "📍";
    if ($("trk-toggle")) $("trk-toggle").textContent = on ? "■ Stop" : "▶ Start";
  }

  /* ---------- drawing + sending ---------- */
  function render() {
    if (!$("trk-dist")) return;
    const s = Math.max(0, Math.floor((Date.now() - t0) / 1000)), km = dist / 1000, hrs = s / 3600;
    $("trk-dist").textContent = km.toFixed(2) + " km";
    $("trk-time").textContent = String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
    $("trk-spd").textContent = (hrs > 0 ? km / hrs : 0).toFixed(1) + " km/h";
  }
  function onPos(p) {
    lastFix = Date.now();
    const c = p.coords;
    if (c.accuracy > 60) return;                                    // ignore poor GPS fixes
    const pt = { lat: c.latitude, lng: c.longitude, acc: Math.round(c.accuracy), spd: c.speed, t: Date.now() };
    const last = pts[pts.length - 1];
    if (last) { const d = hav(last, pt); if (d < 8 && Date.now() - last.t < 60000) return; dist += d; }   // skip jitter, but keep a point every minute
    pts.push(pt); buf.push(pt); saveBuf(); saveState();
    setBadge(true, false, "Tracking ON");
    if (map && line) {
      const ll = [pt.lat, pt.lng];
      line.addLatLng(ll); dot.setLatLng(ll); if (!map.hasLayer(dot)) dot.addTo(map);
      if (!$("trk").hidden) map.panTo(ll);
    }
    render();
  }
  function onErr(e) {
    if (e && e.code === 1) {                                        // permission denied
      setBadge(true, true, "Aktifkan Lokasi!");
      toast(/iPhone|iPad|iPod/i.test(navigator.userAgent)
        ? "Lokasi ditolak. iPhone: Tetapan → Privasi → Perkhidmatan Lokasi → Safari/Web App → Semasa Menggunakan."
        : "Lokasi ditolak. Android: ketik ikon kunci di bar alamat → Kebenaran → Lokasi → Benarkan.");
    } else setBadge(true, true, "GPS lemah");
  }
  async function flush() {
    if (!buf.length || !runUid) return;
    const batch = buf.splice(0, 500);
    try {
      const r = await callBackend("saveTrack", { runUid: runUid, points: batch });
      if (!r || r.status !== "ok") throw new Error(r && r.message);
      saveBuf();
    } catch (e) { buf = batch.concat(buf); saveBuf(); }             // keep and retry next time
  }

  /* ---------- keep the screen / GPS alive ---------- */
  async function keepAwake() {
    try { if (navigator.wakeLock && !wake) { wake = await navigator.wakeLock.request("screen"); wake.addEventListener("release", () => { wake = null; }); } } catch (e) { wake = null; }
  }
  function startWatch() {
    if (!navigator.geolocation) { toast("Peranti ini tidak menyokong GPS."); return; }
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = navigator.geolocation.watchPosition(onPos, onErr, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
    lastFix = Date.now();
  }
  document.addEventListener("visibilitychange", () => {            // screen back on: GPS often froze while hidden (iPhone) → restart it
    if (watchId === null) return;
    if (!document.hidden) { keepAwake(); startWatch(); flush(); }
  });
  window.addEventListener("online", () => { if (watchId !== null) flush(); });

  /* ---------- start / stop ---------- */
  function begin(resume, caseUid) {
    if (watchId !== null) return;                                   // already running
    makeBadge(); ensureMap();
    if (!resume) {
      pts = []; buf = lsGet(LS.buf) || []; dist = 0; t0 = Date.now();
      runUid = (caseUid ? String(caseUid) : "RUN") + "-" + t0;
      if (line) line.setLatLngs([]);
    }
    saveState();
    startWatch();
    timer = setInterval(render, 1000);
    flushT = setInterval(flush, 20000);
    dogT = setInterval(() => {                                      // watchdog
      if (Date.now() - t0 > MAX_HOURS * 3600000) { stop(true); return; }
      if (!document.hidden && Date.now() - lastFix > 45000) { setBadge(true, true, "GPS lemah"); startWatch(); }
    }, 15000);
    keepAwake(); setBadge(true, false, "Tracking ON"); render();
  }
  async function stop(auto) {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = null; clearInterval(timer); clearInterval(flushT); clearInterval(dogT);
    if (wake) { try { wake.release(); } catch (e) {} wake = null; }
    await flush();
    lsDel(LS.st); if (!buf.length) lsDel(LS.buf);
    setBadge(false);
    if (auto) toast("Penjejakan lokasi dihentikan.");
  }

  /* ---------- public API used by app.js ---------- */
  window.Trk = {
    running: () => watchId !== null,
    /* call from inside the "En route" tap (iPhone only asks for GPS permission after a tap) */
    autoStart: function (caseUid) {
      if (watchId !== null) return;
      if (!HR_TOKEN()) { toast("Buka dari SIAGA supaya lokasi direkod."); return; }
      begin(false, caseUid);
      toast("📍 Penjejakan lokasi AKTIF — jangan tutup aplikasi. Kekalkan skrin menyala.");
    },
    autoStop: function () { if (watchId !== null) return stop(true); }
  };

  /* manual button still works */
  if ($("btn-track")) $("btn-track").addEventListener("click", () => { $("trk").hidden = false; ensureMap(); setTimeout(() => map && map.invalidateSize(), 50); });
  if ($("trk-close")) $("trk-close").addEventListener("click", () => { $("trk").hidden = true; });
  if ($("trk-toggle")) $("trk-toggle").addEventListener("click", () => { watchId === null ? (HR_TOKEN() ? begin(false, "") : toast("Buka dari SIAGA supaya lokasi direkod.")) : stop(false); });

  /* page reloaded / app reopened while a trip was running → carry on with the same trail */
  window.addEventListener("load", () => {
    const s = lsGet(LS.st);
    if (s && s.runUid && Date.now() - s.t0 < MAX_HOURS * 3600000) {
      runUid = s.runUid; t0 = s.t0; dist = s.dist || 0; buf = lsGet(LS.buf) || [];
      setTimeout(() => begin(true), 600);
    } else if (s) { lsDel(LS.st); }
  });
})();
