/* KKM999 — admin: trip list + map replay (bird's-eye / satellite), ambulance icon, Strava-style speed trail. */
const BACKEND_URL = "https://script.google.com/macros/s/AKfycbz-vpBAMA4nzRY11QsACuRMq8D6nmnBEni-a5_BNAUIsjJyTk1y8p2P6lDTcOgvTM7D/exec";
const $ = id => document.getElementById(id);
const HR_TOKEN = () => { try { return sessionStorage.getItem("kkah_session_token") || ""; } catch (e) { return ""; } };
let pin = "", map, street, sat, isSat = false, casing, progress = [], amb, startM, endM;
let CASE = null, stages = [], pauseUntil = 0, noteTimer = 0, notePhase = -2, sumShown = false;
let run = null, P = [], T = [], cum = [], D = [], total = 0, head = 0, playing = false, speedX = 0, rafId = 0, last = 0, drawnTo = 0, liveT = 0, maxKmh = 0, hd = 0;
const STG = [["enRoute", "Bertolak (En route)", "🚑", "#2FAE98", "🚑 Dalam perjalanan ke lokasi"], ["atScene", "Tiba di lokasi", "📍", "#F2A93B", "📍 Di lokasi kejadian"],
  ["depart", "Bawa pesakit ke hospital", "🛏️", "#1d7fd1", "🛏️ Mengangkut pesakit ke hospital"], ["atHospital", "Tiba di hospital", "🏥", "#E6483F", "🏥 Di hospital"], ["atBase", "Tiba di pangkalan", "🏁", "#8E5BD6", "🏁 Kembali ke pangkalan"]];
const GAP_MS = 90000, GAP_PLAY = 3000;                   // a pause / lost signal > 90 s is skipped quickly in the replay

async function call(action, body) {
  const r = await fetch(BACKEND_URL, { method: "POST", body: JSON.stringify(Object.assign({ action: action, adminPin: pin, hrToken: HR_TOKEN() }, body)) });
  return r.json();
}
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pad = n => String(n).padStart(2, "0");
const fmtDur = ms => { const s = Math.round(ms / 1000); return (s >= 3600 ? Math.floor(s / 3600) + ":" : "") + pad(Math.floor(s % 3600 / 60)) + ":" + pad(s % 60); };
const fmtClock = ms => { const d = new Date(ms); return d.toLocaleDateString("ms-MY", { day: "2-digit", month: "short" }) + " · " + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds()); };

/* ---------- gate + list ---------- */
(async function autoUnlock() {            // superadmin opened this from SIAGA → straight in, no PIN
  if (!HR_TOKEN()) return;
  try { const r = await call("checkAdminPin", {}); if (r.status === "ok") { $("gate").style.display = "none"; $("list").hidden = false; loadList(); } } catch (e) {}
})();
$("go").onclick = unlock; $("pin").addEventListener("keydown", e => { if (e.key === "Enter") unlock(); });
async function unlock() {
  const p = $("pin").value.trim(); $("perr").textContent = "Menyemak…";
  try {
    const r = await fetch(BACKEND_URL, { method: "POST", body: JSON.stringify({ action: "checkAdminPin", adminPin: p, hrToken: HR_TOKEN() }) }).then(x => x.json());
    if (r.status === "ok") { pin = p; $("gate").style.display = "none"; $("list").hidden = false; loadList(); } else $("perr").textContent = r.message || "PIN salah";
  } catch (e) { $("perr").textContent = "Tiada sambungan."; }
}
$("reload").onclick = loadList; $("days").onchange = loadList;
async function loadList() {
  $("runs").innerHTML = '<div class="empty">Memuatkan…</div>';
  let r; try { r = await call("listRuns", { days: Number($("days").value) }); } catch (e) { r = null; }
  if (!r || r.status !== "ok") { $("runs").innerHTML = '<div class="empty">' + esc((r && r.message) || "Tidak dapat memuatkan.") + "</div>"; return; }
  if (!r.runs.length) { $("runs").innerHTML = '<div class="empty">Tiada rekod lokasi dalam tempoh ini.<br>Rekod bermula bila responder tekan <b>En route</b> dari SIAGA.</div>'; return; }
  $("runs").innerHTML = r.runs.map(x =>
    '<div class="run" data-id="' + esc(x.runUid) + '" data-live="' + (x.live ? 1 : 0) + '" data-t="' + esc(fmtClock(x.start)) + '"><div class="ic">🚑</div><div class="m"><div class="t">' + esc(fmtClock(x.start)) + (x.live ? ' <span class="live">LIVE</span>' : "") +
    '</div><div class="s">' + esc(x.name || "Responder") + " · " + fmtDur(x.end - x.start) + " · " + x.km + " km · " + x.n + " titik</div></div><div style=\"color:var(--mut)\">›</div></div>").join("");
}
$("runs").addEventListener("click", e => { const r = e.target.closest(".run"); if (r) openRun(r.dataset.id, r.dataset.t, r.dataset.live === "1"); });

/* ---------- map ---------- */
function ensureMap() {
  if (map) return;
  map = L.map("map", { zoomControl: false, zoomSnap: 0.5 }).setView([6.2404, 100.2467], 15);
  street = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(map);
  sat = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, attribution: "Esri" });
  map.on("dragstart", () => { if (amb) { amb.follow(false); $("follow").style.opacity = ".6"; } });
}
$("layer").onclick = () => { isSat = !isSat; if (isSat) { map.addLayer(sat); map.removeLayer(street); } else { map.addLayer(street); map.removeLayer(sat); } $("layer").textContent = isSat ? "🗺" : "🛰"; };
$("follow").onclick = () => { amb.follow(!amb.isFollowing()); $("follow").style.opacity = amb.isFollowing() ? "1" : ".6"; };
$("back").onclick = () => { stopAll(); $("mapView").classList.remove("on"); $("list").hidden = false; loadList(); };

/* ---------- build a run ---------- */
async function openRun(id, label, live) {
  $("list").hidden = true; $("mapView").classList.add("on"); $("ov").classList.add("on"); ensureMap(); setTimeout(() => map.invalidateSize(), 60);
  $("ttl").textContent = label || id; stopAll();
  let r; try { r = await call("getRun", { runUid: id }); } catch (e) { r = null; }
  $("ov").classList.remove("on");
  if (!r || r.status !== "ok" || r.pts.length < 2) { $("clock").textContent = (r && r.message) || "Trail kosong / terlalu pendek."; return; }
  run = { id: id, live: !!live };
  setPts(r.pts); drawBase();
  CASE = null; try { const cr = await call("getRunCase", { runUid: id }); if (cr && cr.status === "ok") CASE = cr.c; } catch (e) {}
  buildStages(); sumShown = false; $("sum").classList.remove("on"); notePhase = -2; $("notes").style.display = "none";
  head = 0; drawnTo = 0; maxKmh = 0; hd = bearingAt(0);
  amb = Amb.create(map, { follow: true }); amb.place(P[0][0], P[0][1], hd); $("follow").style.opacity = "1";
  const autoX = Math.max(1, Math.ceil(total / 45000)); buildSpeedButtons(live ? 1 : autoX);
  map.fitBounds(casing.getBounds(), { padding: [50, 50] });
  setTimeout(() => { if (amb) amb.follow(true); }, 1200);
  if (live) { head = total; drawnTo = P.length - 1; paintProgress(P.length - 1); showAt(total); liveT = setInterval(pollLive, 8000); }
  setPlaying(!live);
  seekUi();
}
function setPts(pts) {
  P = pts; T = pts.map(p => p[2]); cum = [0]; D = [0];
  for (let i = 1; i < P.length; i++) { const dt = T[i] - T[i - 1]; cum[i] = cum[i - 1] + (dt > GAP_MS ? GAP_PLAY : dt); D[i] = D[i - 1] + L.latLng(P[i - 1][0], P[i - 1][1]).distanceTo(L.latLng(P[i][0], P[i][1])); }
  total = cum[cum.length - 1];
}
function segKmh(i) { if (i < 1) return 0; const dt = (T[i] - T[i - 1]) / 1000, d = D[i] - D[i - 1]; if (dt <= 0 || dt > 90) return 0; const v = P[i][3] != null && P[i][3] >= 0 ? P[i][3] * 3.6 : d / dt * 3.6; return v; }
function drawBase() {
  if (casing) { map.removeLayer(casing); progress.forEach(l => map.removeLayer(l)); } progress = [];
  if (startM) map.removeLayer(startM); if (endM) map.removeLayer(endM);
  const ll = P.map(p => [p[0], p[1]]);
  casing = L.polyline(ll, { color: "#fff", weight: 11, opacity: .55, lineCap: "round", lineJoin: "round" }).addTo(map);   // the whole route, pale, so you can see where it is going
  const dotIc = (c, t) => L.divIcon({ className: "", html: '<div style="width:26px;height:26px;border-radius:50%;background:' + c + ';border:3px solid #fff;color:#fff;font:800 12px/20px system-ui;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.4)">' + t + "</div>", iconSize: [26, 26], iconAnchor: [13, 13] });
  startM = L.marker(ll[0], { icon: dotIc("#2FAE98", "S"), interactive: false }).addTo(map); endM = L.marker(ll[ll.length - 1], { icon: dotIc("#E6483F", "E"), interactive: false }).addTo(map);
}
function paintProgress(upTo) {            // coloured by speed, green (slow) → red (fast)
  for (let i = drawnTo + 1; i <= upTo; i++) {
    if (T[i] - T[i - 1] > GAP_MS) continue;
    progress.push(L.polyline([[P[i - 1][0], P[i - 1][1]], [P[i][0], P[i][1]]], { color: Amb.speedColor(segKmh(i)), weight: 6, lineCap: "round" }).addTo(map));
    if (segKmh(i) > maxKmh && segKmh(i) < 220) maxKmh = segKmh(i);
  }
  drawnTo = Math.max(drawnTo, upTo);
}
function clearProgress() { progress.forEach(l => map.removeLayer(l)); progress = []; drawnTo = 0; maxKmh = 0; }

/* ---------- position at play-time ---------- */
function idxAt(t) { let lo = 0, hi = cum.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (cum[m] <= t) lo = m; else hi = m - 1; } return lo; }
function bearingAt(i) { const a = Math.max(0, i - 3), b = Math.min(P.length - 1, i + 3); return a === b ? 0 : Amb.bearing([P[a][0], P[a][1]], [P[b][0], P[b][1]]); }
function showAt(t) {
  const i = idxAt(t), j = Math.min(P.length - 1, i + 1), seg = cum[j] - cum[i], k = seg > 0 ? (t - cum[i]) / seg : 0;
  const lat = P[i][0] + (P[j][0] - P[i][0]) * k, lng = P[i][1] + (P[j][1] - P[i][1]) * k;
  const target = bearingAt(i), df = ((target - hd + 540) % 360) - 180; hd = (hd + df * 0.18 + 360) % 360;     // smooth turning
  amb.place(lat, lng, hd);
  if (i > drawnTo) paintProgress(i); else if (i < drawnTo - 1) { clearProgress(); paintProgress(i); }
  const km = (D[i] + (D[j] - D[i]) * k) / 1000, real = T[i] + (T[j] - T[i]) * Math.min(1, k) * (T[j] - T[i] > GAP_MS ? 0 : 1);
  $("sKm").textContent = km.toFixed(1); $("sTime").textContent = fmtDur(real - T[0]); $("sSpd").textContent = Math.round(segKmh(j)); $("sMax").textContent = Math.round(maxKmh);
  $("clock").textContent = fmtClock(real) + (run && run.live && t >= total - 50 ? "  ·  LIVE" : "");
  $("seek").value = total ? Math.round(t / total * 1000) : 0;
  updateStages(t);
}
function seekUi() { showAt(head); }

/* ---------- playback loop ---------- */
function setPlaying(on) {
  if (on) { $("sum").classList.remove("on"); }
  playing = on; $("play").textContent = on ? "❚❚" : "▶"; cancelAnimationFrame(rafId);
  if (on) { if (head >= total && !(run && run.live)) { head = 0; clearProgress(); } last = performance.now(); rafId = requestAnimationFrame(loop); }
}
function loop(now) {
  const dt = now - last; last = now;
  if (now < pauseUntil) { rafId = requestAnimationFrame(loop); return; }                       // linger a moment at each stage, like a recap video
  const prev = head; head = Math.min(total, head + dt * speedX);
  const hit = stages.find(s => !s.fired && s.cum > prev && s.cum <= head && s.key !== "enRoute");
  if (hit) { head = hit.cum; pauseUntil = now + 1700; }
  showAt(head);
  if (head >= total) { if (run && run.live) { rafId = requestAnimationFrame(loop); return; } setPlaying(false); setTimeout(showSummary, 900); return; }
  rafId = requestAnimationFrame(loop);
}
$("play").onclick = () => setPlaying(!playing);
$("seek").addEventListener("input", e => { head = Number(e.target.value) / 1000 * total; if (!playing) showAt(head); else showAt(head); });
function buildSpeedButtons(def) {
  const opts = [1, 5, 10, 30, 60, 120]; if (opts.indexOf(def) < 0) { opts.push(def); opts.sort((a, b) => a - b); }
  speedX = def;
  $("spd").innerHTML = opts.map(x => '<button data-x="' + x + '" class="' + (x === def ? "on" : "") + '">' + x + "×</button>").join("");
}
$("spd").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; speedX = Number(b.dataset.x); [].forEach.call($("spd").children, c => c.classList.toggle("on", c === b)); });

/* ---------- live: poll new points while the ambulance is still moving ---------- */
async function pollLive() {
  if (!run || !run.live || document.hidden) return;
  let r; try { r = await call("getRun", { runUid: run.id, after: T[T.length - 1] }); } catch (e) { return; }
  if (!r || r.status !== "ok" || !r.pts.length) { if (r && r.now && r.now - T[T.length - 1] > 180000) { run.live = false; clearInterval(liveT); $("clock").textContent = "Perjalanan tamat."; } return; }
  const atEnd = head >= total - 50, add = r.pts;
  const keep = P.length; setPts(P.concat(add)); drawBase_keepProgress(keep);
  if (atEnd) head = cum[keep - 1];            // stay at the old end and glide along the new points at real speed
  if (!playing) setPlaying(true);
}
function drawBase_keepProgress() { casing.setLatLngs(P.map(p => [p[0], p[1]])); if (endM) endM.setLatLng([P[P.length - 1][0], P[P.length - 1][1]]); }
function stopAll() { playing = false; cancelAnimationFrame(rafId); clearInterval(liveT); if (amb) { amb.remove(); amb = null; } if (map) { progress.forEach(l => map.removeLayer(l)); progress = []; if (casing) map.removeLayer(casing); if (startM) map.removeLayer(startM); if (endM) map.removeLayer(endM); casing = startM = endM = null; } run = null; drawnTo = 0; clearStages(); $("sum").classList.remove("on"); $("notes").style.display = "none"; $("phase").style.display = "none"; }


/* ================= recap: stages, phase chip, notes, summary ================= */
function clearStages() { stages.forEach(s => { if (s.m) map.removeLayer(s.m); }); stages = []; clearInterval(noteTimer); }
function stageMs(hm, base) {                         // "HH:mm" on the trip's date (or the next day if the trip crossed midnight)
  const m = /(\d{1,2}):(\d{2})/.exec(hm || ""); if (!m) return 0;
  const d = new Date(T[0]); d.setHours(+m[1], +m[2], 0, 0); let ms = d.getTime();
  if (ms < T[0] - 45 * 60000) ms += 86400000; return ms;
}
function nearestIdx(ms) { let b = 0, bd = 1e18; for (let i = 0; i < T.length; i++) { const d = Math.abs(T[i] - ms); if (d < bd) { bd = d; b = i; } } return b; }
function buildStages() {
  clearStages(); if (!CASE) return;
  let lastIdx = 0;
  STG.forEach(def => {
    const hm = CASE[def[0]]; if (!hm) return;
    let idx = def[0] === "enRoute" ? 0 : nearestIdx(stageMs(hm)); if (idx < lastIdx) idx = lastIdx; lastIdx = idx;
    stages.push({ key: def[0], label: def[1], icon: def[2], color: def[3], phase: def[4], hm: hm, idx: idx, cum: cum[idx], fired: false, m: null });
  });
  stages.forEach(s => {
    const ic = L.divIcon({ className: "", iconSize: [1, 1], iconAnchor: [0, 0], html: '<div class="stg" style="--c:' + s.color + '"><b>' + s.icon + "</b><div><span>" + esc(s.label) + "</span><em>" + esc(s.hm) + "</em></div></div>" });
    s.ic = ic; s.m = L.marker([P[s.idx][0], P[s.idx][1]], { icon: ic, interactive: false, zIndexOffset: 500 });
  });
}
function updateStages(t) {
  if (!stages.length) { $("phase").style.display = "none"; return; }
  let cur = -1;
  stages.forEach((s, i) => {
    const pass = t >= s.cum - 0.5;
    if (pass && !s.fired) { s.fired = true; s.m.addTo(map); }
    else if (!pass && s.fired) { s.fired = false; map.removeLayer(s.m); }
    if (pass) cur = i;
    const el = s.m.getElement(); if (el) { const b = el.querySelector(".stg"); if (b) b.classList.toggle("old", pass && i < cur); }
  });
  stages.forEach((s, i) => { const el = s.m.getElement(); if (el) { const b = el.querySelector(".stg"); if (b) b.classList.toggle("old", i < cur); } });
  const ph = $("phase"); ph.style.display = "";
  const txt = cur < 0 ? "🚑 Menunggu bertolak" : stages[cur].phase;
  if (ph.textContent !== txt) { ph.textContent = txt; ph.classList.remove("sw"); void ph.offsetWidth; ph.classList.add("sw"); }
  updateNotes(cur);
}
function transportRange() {                           // phase index whose notes we show: from "depart" (or scene) until "at hospital"
  const iD = stages.findIndex(s => s.key === "depart"), iS = stages.findIndex(s => s.key === "atScene"), iH = stages.findIndex(s => s.key === "atHospital");
  return { from: iD >= 0 ? iD : iS, to: iH };
}
function updateNotes(cur) {
  const box = $("notes"), r = transportRange(); if (r.from < 0) { box.style.display = "none"; return; }
  const inTr = cur >= r.from && (r.to < 0 || cur < r.to), key = inTr ? r.from : -1;
  if (key === notePhase) return; notePhase = key; clearInterval(noteTimer);
  if (!inTr) { box.style.display = "none"; return; }
  const parts = []; if (CASE.notes) parts.push(CASE.notes); (CASE.casualties || []).forEach((c, i) => parts.push("Pesakit " + (i + 1) + ": " + c));
  const full = parts.join("\n").trim();
  box.style.display = ""; box.style.animation = "none"; void box.offsetWidth; box.style.animation = "";
  if (!full) { box.innerHTML = '<h4>🎙 Suara → teks</h4><div class="mut">Tiada nota / rakaman suara untuk perjalanan ini.</div>'; return; }
  let i = 0; box.innerHTML = '<h4>🎙 Suara → teks</h4><div id="nt" class="cur"></div>';
  const nt = $("nt"); noteTimer = setInterval(() => { i += 2; nt.textContent = full.slice(0, i); box.scrollTop = box.scrollHeight; if (i >= full.length) { clearInterval(noteTimer); nt.classList.remove("cur"); } }, 28);
}
function countUp(el, to, dec, ms, fmt) {
  const t0 = performance.now(); const f = k => { const e = 1 - Math.pow(1 - k, 3); el.textContent = fmt ? fmt(to * e) : (to * e).toFixed(dec); if (k < 1) requestAnimationFrame(n => f(Math.min(1, (n - t0) / ms))); };
  requestAnimationFrame(n => f(Math.min(1, (n - t0) / ms)));
}
function showSummary() {
  if (!run || run.live || playing) return;
  const km = D[D.length - 1] / 1000, ms = T[T.length - 1] - T[0];
  const st = k => stages.find(s => s.key === k), resp = st("enRoute") && st("atScene") ? T[st("atScene").idx] - T[st("enRoute").idx] : 0, trn = st("depart") && st("atHospital") ? T[st("atHospital").idx] - T[st("depart").idx] : 0;
  const avg = ms > 0 ? km / (ms / 3600000) : 0;
  $("sum").innerHTML = '<div class="in"><h2>Perjalanan selesai 🏁</h2><div class="sub">' + esc($("ttl").textContent) + (CASE && CASE.hospital ? " · " + esc(CASE.hospital) : "") + '</div>' +
    '<div class="big"><div class="box a"><b id="sumKm">0.0</b><span>Jumlah jarak (km)</span></div><div class="box b"><b id="sumT">00:00</b><span>Jumlah masa</span></div></div>' +
    '<div class="row3"><div class="mini"><b>' + (resp ? fmtDur(resp) : "—") + '</b><span>Respon ke lokasi</span></div><div class="mini"><b>' + (trn ? fmtDur(trn) : "—") + '</b><span>Ke hospital</span></div><div class="mini"><b>' + Math.round(maxKmh) + '</b><span>Laju maks km/j</span></div></div>' +
    '<div class="acts"><button class="btn ghost" id="sumClose">Tutup</button><button class="btn" id="sumAgain">↻ Main semula</button></div></div>';
  $("sum").classList.add("on");
  setTimeout(() => countUp($("sumKm"), km, 1, 1400), 450);
  setTimeout(() => countUp($("sumT"), ms, 0, 1400, v => fmtDur(v)), 750);
  $("sumClose").onclick = () => $("sum").classList.remove("on");
  $("sumAgain").onclick = () => { head = 0; clearProgress(); notePhase = -2; stages.forEach(s => { if (s.fired) { s.fired = false; map.removeLayer(s.m); } }); pauseUntil = 0; setPlaying(true); };
}


/* ================= KML export (Google Maps "My Maps" / Google Earth) ================= */
const kx = t => String(t == null ? "" : t).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const iso = ms => new Date(ms).toISOString();
const coords = pts => pts.map(p => p[1].toFixed(6) + "," + p[0].toFixed(6) + ",0").join(" ");
const KML_HEAD = '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document>\n';
function kmlStyles() { return '<Style id="route"><LineStyle><color>ffd17f1d</color><width>4</width></LineStyle></Style><Style id="stage"><IconStyle><scale>1.1</scale><Icon><href>https://maps.google.com/mapfiles/kml/paddle/red-circle.png</href></Icon></IconStyle></Style>\n'; }
function kmlLine(name, pts, desc, color) {
  const st = color ? '<Style><LineStyle><color>' + color + '</color><width>4</width></LineStyle></Style>' : '<styleUrl>#route</styleUrl>';
  return '<Placemark><name>' + kx(name) + '</name><description>' + kx(desc) + '</description><TimeSpan><begin>' + iso(pts[0][2]) + '</begin><end>' + iso(pts[pts.length - 1][2]) + '</end></TimeSpan>' + st + '<LineString><tessellate>1</tessellate><coordinates>' + coords(pts) + '</coordinates></LineString></Placemark>\n';
}
function saveKml(file, body) {
  const blob = new Blob([KML_HEAD + body + "</Document></kml>"], { type: "application/vnd.google-earth.kml+xml" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = file; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
function hsl2kml(h) { const c = (n, k = (n + h / 30) % 12) => Math.round(255 * (0.5 - 0.4 * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); return "ff" + [c(4), c(8), c(0)].map(v => v.toString(16).padStart(2, "0")).join(""); }   // aabbggrr
$("kmlOne").onclick = () => {
  if (!P.length) return;
  const label = $("ttl").textContent, km = (D[D.length - 1] / 1000).toFixed(1);
  let body = kmlStyles() + kmlLine("Perjalanan " + label, P, (CASE && CASE.hospital ? "Hospital: " + CASE.hospital + ". " : "") + km + " km, " + fmtDur(T[T.length - 1] - T[0]));
  stages.forEach(s => { body += '<Placemark><name>' + kx(s.label + " " + s.hm) + '</name><TimeStamp><when>' + iso(T[s.idx]) + '</when></TimeStamp><styleUrl>#stage</styleUrl><Point><coordinates>' + P[s.idx][1].toFixed(6) + "," + P[s.idx][0].toFixed(6) + ',0</coordinates></Point></Placemark>\n'; });
  saveKml("ambulans-" + new Date(T[0]).toISOString().slice(0, 16).replace(/[:T]/g, "") + ".kml", body);
};

/* ================= Monthly map: every response line on one map, filter by date ================= */
let mmap, mStreet, mSat, mIsSat = false, mLayers = [], mRuns = [];
const ymd = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
function ensureMMap() {
  if (mmap) return;
  mmap = L.map("mmap", { zoomControl: false }).setView([6.2404, 100.2467], 11);
  mStreet = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(mmap);
  mSat = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, attribution: "Esri" });
}
$("tabMonth").onclick = () => { $("list").hidden = true; $("monthView").classList.add("on"); ensureMMap(); setTimeout(() => mmap.invalidateSize(), 60); if (!$("dFrom").value) setQuick("month"); else loadMonthMap(); };
$("tabList").onclick = () => {};
$("mBack").onclick = () => { $("monthView").classList.remove("on"); $("list").hidden = false; };
$("mLayer").onclick = () => { mIsSat = !mIsSat; if (mIsSat) { mmap.addLayer(mSat); mmap.removeLayer(mStreet); } else { mmap.addLayer(mStreet); mmap.removeLayer(mSat); } $("mLayer").textContent = mIsSat ? "🗺" : "🛰"; };
function setQuick(q) {
  const n = new Date(); let a = new Date(n), b = new Date(n);
  if (q === "7") a.setDate(n.getDate() - 6); else if (q === "90") a.setDate(n.getDate() - 89);
  else if (q === "month") a = new Date(n.getFullYear(), n.getMonth(), 1);
  else if (q === "prev") { a = new Date(n.getFullYear(), n.getMonth() - 1, 1); b = new Date(n.getFullYear(), n.getMonth(), 0); }
  $("dFrom").value = ymd(a); $("dTo").value = ymd(b);
  [].forEach.call($("quick").children, c => c.classList.toggle("on", c.dataset.q === q));
  loadMonthMap();
}
$("quick").addEventListener("click", e => { const b = e.target.closest("button"); if (b) setQuick(b.dataset.q); });
$("dFrom").onchange = $("dTo").onchange = () => { [].forEach.call($("quick").children, c => c.classList.remove("on")); loadMonthMap(); };
async function loadMonthMap() {
  const from = $("dFrom").value, to = $("dTo").value || from; if (!from) return;
  $("mov").classList.add("on"); mLayers.forEach(l => mmap.removeLayer(l)); mLayers = [];
  let r; try { r = await call("getRunsMap", { from: from, to: to }); } catch (e) { r = null; }
  $("mov").classList.remove("on");
  if (!r || r.status !== "ok") { $("mstat").textContent = (r && r.message) || "Tidak dapat memuatkan."; mRuns = []; return; }
  mRuns = r.runs; if (!mRuns.length) { $("mstat").textContent = "Tiada perjalanan dalam tempoh ini."; return; }
  const all = [];
  mRuns.forEach((x, i) => {
    const ll = x.pts.map(p => [p[0], p[1]]); all.push.apply(all, ll);
    const hue = (i * 47) % 360, col = "hsl(" + hue + ",85%,55%)";
    const casing = L.polyline(ll, { color: "#fff", weight: 7, opacity: .35 }).addTo(mmap);
    const line = L.polyline(ll, { color: col, weight: 4, opacity: .8, lineCap: "round", lineJoin: "round" }).addTo(mmap);
    line.bindPopup('<b>' + kx(fmtClock(x.start)) + '</b><br>' + kx(x.name || "Responder") + '<br>' + x.km + ' km · ' + fmtDur(x.end - x.start) + '<br><button data-open="' + i + '">▶ Main semula</button>');
    line.on("mouseover", () => line.setStyle({ weight: 7, opacity: 1 })); line.on("mouseout", () => line.setStyle({ weight: 4, opacity: .8 }));
    mLayers.push(casing, line);
    mLayers.push(L.circleMarker(ll[0], { radius: 4, color: "#fff", weight: 1.5, fillColor: "#2FAE98", fillOpacity: 1 }).addTo(mmap));
    mLayers.push(L.circleMarker(ll[ll.length - 1], { radius: 4, color: "#fff", weight: 1.5, fillColor: "#E6483F", fillOpacity: 1 }).addTo(mmap));
  });
  mmap.fitBounds(L.latLngBounds(all), { padding: [40, 40] });
  const km = mRuns.reduce((a, x) => a + x.km, 0), ms = mRuns.reduce((a, x) => a + (x.end - x.start), 0);
  $("mstat").innerHTML = "<b>" + mRuns.length + "</b> perjalanan · <b>" + km.toFixed(1) + "</b> km · <b>" + fmtDur(ms) + "</b> jumlah masa";
}
document.addEventListener("click", e => { const b = e.target.closest("[data-open]"); if (!b) return; const x = mRuns[Number(b.dataset.open)]; if (!x) return; mmap.closePopup(); $("monthView").classList.remove("on"); openRun(x.runUid, fmtClock(x.start), false); });
$("mKml").onclick = () => {
  if (!mRuns.length) return;
  const byDay = {}; mRuns.forEach((x, i) => { const d = ymd(new Date(x.start)); (byDay[d] = byDay[d] || []).push([x, i]); });
  let body = kmlStyles();
  Object.keys(byDay).sort().forEach(d => { body += "<Folder><name>" + d + "</name>\n"; byDay[d].forEach(a => { const x = a[0]; body += kmlLine(fmtClock(x.start) + " · " + (x.name || "Responder"), x.pts, x.km + " km, " + fmtDur(x.end - x.start), hsl2kml((a[1] * 47) % 360)); }); body += "</Folder>\n"; });
  saveKml("ambulans-" + $("dFrom").value + "_" + $("dTo").value + ".kml", body);
};
