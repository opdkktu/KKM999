/* KKM999 — admin: trip list + map replay (bird's-eye / satellite), ambulance icon, Strava-style speed trail. */
const BACKEND_URL = "https://script.google.com/macros/s/AKfycbz-vpBAMA4nzRY11QsACuRMq8D6nmnBEni-a5_BNAUIsjJyTk1y8p2P6lDTcOgvTM7D/exec";
const $ = id => document.getElementById(id);
let pin = "", map, street, sat, isSat = false, casing, progress = [], amb, startM, endM;
let run = null, P = [], T = [], cum = [], D = [], total = 0, head = 0, playing = false, speedX = 0, rafId = 0, last = 0, drawnTo = 0, liveT = 0, maxKmh = 0, hd = 0;
const GAP_MS = 90000, GAP_PLAY = 3000;                   // a pause / lost signal > 90 s is skipped quickly in the replay

async function call(action, body) {
  const r = await fetch(BACKEND_URL, { method: "POST", body: JSON.stringify(Object.assign({ action: action, adminPin: pin }, body)) });
  return r.json();
}
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pad = n => String(n).padStart(2, "0");
const fmtDur = ms => { const s = Math.round(ms / 1000); return (s >= 3600 ? Math.floor(s / 3600) + ":" : "") + pad(Math.floor(s % 3600 / 60)) + ":" + pad(s % 60); };
const fmtClock = ms => { const d = new Date(ms); return d.toLocaleDateString("ms-MY", { day: "2-digit", month: "short" }) + " · " + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds()); };

/* ---------- gate + list ---------- */
$("go").onclick = unlock; $("pin").addEventListener("keydown", e => { if (e.key === "Enter") unlock(); });
async function unlock() {
  const p = $("pin").value.trim(); $("perr").textContent = "Menyemak…";
  try {
    const r = await fetch(BACKEND_URL, { method: "POST", body: JSON.stringify({ action: "checkAdminPin", adminPin: p }) }).then(x => x.json());
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
}
function seekUi() { showAt(head); }

/* ---------- playback loop ---------- */
function setPlaying(on) {
  playing = on; $("play").textContent = on ? "❚❚" : "▶"; cancelAnimationFrame(rafId);
  if (on) { if (head >= total && !(run && run.live)) { head = 0; clearProgress(); } last = performance.now(); rafId = requestAnimationFrame(loop); }
}
function loop(now) {
  const dt = now - last; last = now; head = Math.min(total, head + dt * speedX); showAt(head);
  if (head >= total) { if (run && run.live) { rafId = requestAnimationFrame(loop); return; } setPlaying(false); return; }
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
function stopAll() { playing = false; cancelAnimationFrame(rafId); clearInterval(liveT); if (amb) { amb.remove(); amb = null; } if (map) { progress.forEach(l => map.removeLayer(l)); progress = []; if (casing) map.removeLayer(casing); if (startM) map.removeLayer(startM); if (endM) map.removeLayer(endM); casing = startM = endM = null; } run = null; drawnTo = 0; }
