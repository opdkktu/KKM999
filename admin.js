const BACKEND_URL =
  "https://script.google.com/macros/s/AKfycbz-vpBAMA4nzRY11QsACuRMq8D6nmnBEni-a5_BNAUIsjJyTk1y8p2P6lDTcOgvTM7D/exec";

let adminPin = "8888";

/* ---- on-screen + console log (set DEBUG = false when everything works) ---- */
const DEBUG = true, T0 = Date.now();
function dbg(m) {
  const line = "[" + ((Date.now() - T0) / 1000).toFixed(1) + "s] " + m;
  console.log("[KKM999 admin]", line);
  if (!DEBUG) return;
  try {
    let b = document.getElementById("dbg");
    if (!b) {
      const w = document.createElement("div"); w.id = "dbgw"; w.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:99999;background:rgba(0,0,0,.88)";
      const x = document.createElement("button"); x.textContent = "✕ tutup"; x.style.cssText = "position:absolute;right:6px;top:4px;background:#333;color:#fff;border:0;border-radius:8px;padding:5px 10px;font:12px sans-serif;cursor:pointer;z-index:2";
      x.onclick = function () { w.remove(); window.__dbgOff = true; };
      b = document.createElement("pre"); b.id = "dbg"; b.style.cssText = "max-height:36vh;overflow:auto;margin:0;padding:8px 10px;padding-top:30px;color:#9fe;font:11px/1.45 monospace;white-space:pre-wrap;word-break:break-all";
      w.appendChild(x); w.appendChild(b); document.body.appendChild(w);
    }
    if (window.__dbgOff) return;
    b.textContent += line + "\n"; b.scrollTop = b.scrollHeight;
  } catch (e) {}
}
window.addEventListener("error", function (ev) { dbg("JS ERROR: " + ev.message + " (line " + ev.lineno + ")"); });
window.addEventListener("unhandledrejection", function (ev) { dbg("PROMISE ERROR: " + (ev.reason && ev.reason.message || ev.reason)); });
dbg("admin.js loaded · SIAGA token: " + (function () { try { return sessionStorage.getItem("kkah_session_token") ? "ada" : "tiada"; } catch (e) { return "?"; } })());
const HR_TOKEN = () => { try { return sessionStorage.getItem("kkah_session_token") || ""; } catch (e) { return ""; } };

/* Opened from SIAGA as a superadmin? Then no PIN is needed — SIAGA's login is the proof. */
async function autoUnlock() {
  const note = t => { try { const e = document.getElementById("pin-error"); if (e && !/Checking|Ralat|lambat/.test(e.textContent)) e.textContent = t; } catch (x) {} };
  if (!HR_TOKEN()) { note("v5 · tiada sesi SIAGA — buka dari menu dashboard SIAGA"); return; }
  els.pinGate.style.visibility = "hidden"; showOverlay("Menyemak akses SIAGA…");      // no flicker: the PIN box only appears if SIAGA access is not enough
  try {
    const r = await call("checkAdminPin", {});
    if (r.status === "ok") { dbg("SIAGA superadmin diterima → buka laporan"); els.pinGate.hidden = true; els.pinGate.style.display = "none"; els.adminRoot.hidden = false; loadMonth(); }
    else {
      let dbg; try { dbg = await call("superDebug", {}); } catch (e) { dbg = { why: "superDebug gagal: " + e.message }; }
      note("v5 · " + (await siagaRoleHint()) + "  |  KKM999→SIAGA: " + (dbg.why || dbg.message || "?") + (dbg.ok ? " (server sah superadmin, tetapi baris injection dalam doPost tidak berfungsi / tidak disimpan)" : ""));
    }
  } catch (e) { note("v5 · semakan SIAGA gagal: " + (e && e.message ? e.message : "?")); }
  finally { hideOverlay(); els.pinGate.style.visibility = ""; }
}

/* Diagnosis only: ask SIAGA directly what role this login has. */
async function siagaRoleHint() {
  try {
    const r = await fetch("https://script.google.com/macros/s/AKfycbxOamlCtYPlZCvQOys1VTjkZu7aVqMsdDStTdytPex7eH5jNGuIBiR91BfougaEF3SI/exec", { method: "POST", body: JSON.stringify({ action: "getMyProfile", token: HR_TOKEN() }) }).then(x => x.json());
    if (!r.ok) return "SIAGA tolak sesi: " + (r.error || "?");
    if (r.role === undefined) return "SIAGA tidak menghantar 'role' — edit getMyProfile belum ada / belum deploy versi baharu";
    if (r.role !== "superadmin") return "akaun ini role = '" + r.role + "' (bukan superadmin)";
    return "SIAGA berkata superadmin — tetapi server KKM999 tolak (semak baris injection dalam doPost & deploy versi baharu)";
  } catch (e) { return "tidak dapat hubungi SIAGA: " + e.message; }
}

const els = {};
["pin-gate", "pin-input", "pin-error", "admin-root", "status-dot", "month-input",
 "content", "loading-overlay", "loading-label", "toast"].forEach(function (id) {
  els[id.replace(/-([a-z])/g, function (m, c) { return c.toUpperCase(); })] = document.getElementById(id);
});

/* Default the picker to the current month. */
(function () {
  const d = new Date();
  els.monthInput.value = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
})();

document.getElementById("btn-pin-submit").addEventListener("click", submitPin);
els.pinInput.addEventListener("keydown", function (e) { if (e.key === "Enter") submitPin(); });

async function submitPin() {
  const pin = els.pinInput.value.trim();
  dbg("PIN dihantar (" + pin.length + " aksara)");
  els.pinError.textContent = "Checking…";
  try {
    const r = await call("checkAdminPin", { adminPin: pin });
    if (r.status === "ok") {
      dbg("PIN betul → buka laporan");
      adminPin = pin;
      els.pinGate.hidden = true;
      els.pinGate.style.display = "none";    // .pin-gate{display:flex} in style.css overrides the hidden attribute — this is what kept the PIN box on top
      els.adminRoot.hidden = false;
      els.pinError.textContent = "";
      loadMonth();
    } else {
      els.pinError.textContent = r.message || "Incorrect PIN";
    }
  } catch (e) {
    els.pinError.textContent = e && e.name === "AbortError" ? "Server terlalu lambat (>30 saat). Cuba lagi." : "Ralat: " + (e && e.message ? e.message : "tiada sambungan");
  }
}

async function call(action, body) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 30000);     // never hang silently
  try {
    dbg("→ " + action + (HR_TOKEN() ? " (+token)" : ""));
    const res = await fetch(BACKEND_URL, {
      method: "POST",
      body: JSON.stringify(Object.assign({ action: action, hrToken: HR_TOKEN() }, body)),
      signal: ctl.signal
    });
    const txt = await res.text();
    dbg("← " + action + " HTTP " + res.status + " " + txt.slice(0, 150).replace(/\s+/g, " "));
    try { return JSON.parse(txt); }
    catch (e) { throw new Error("Server tidak membalas JSON (HTTP " + res.status + "): " + txt.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 180)); }
  } finally { clearTimeout(timer); }
}

document.getElementById("btn-load").addEventListener("click", loadMonth);

async function loadMonth() {
  const month = els.monthInput.value;
  if (!month) return;

  showOverlay("Loading " + month + "…");
  try {
    const r = await call("getAnalytics", { adminPin: adminPin, month: month });
    if (r.status !== "ok") {
      els.content.innerHTML = '<div class="admin-empty">' + escapeHtml(r.message || "Could not load") + "</div>";
      return;
    }
    dbg("render: " + r.totalCases + " kes");
    render(r);
    dbg("render selesai");
  } catch (e) {
    dbg("loadMonth RALAT: " + (e && e.stack || e));
    els.content.innerHTML = '<div class="admin-empty">Ralat: ' + escapeHtml(String(e && e.message || e)) + "</div>";
  } finally {
    hideOverlay();
  }
}

function render(d) {
  if (!d.totalCases) {
    els.content.innerHTML = '<div class="admin-empty">No cases recorded for ' + d.month + '.</div>';
    return;
  }

  const kpiOk = d.kpiCompliancePct !== null && d.kpiCompliancePct >= 80;
  const parts = [];

  parts.push('<div class="kpi-cards">');
  parts.push(kpiCard(d.totalCases, "Total cases", ""));
  parts.push(kpiCard(d.avgResponseMin !== null ? d.avgResponseMin + " min" : "—", "Avg response time (en route → scene)", ""));
  parts.push(kpiCard(d.kpiCompliancePct !== null ? d.kpiCompliancePct + "%" : "—", "Within 15-min KPI", kpiOk ? "good" : "bad"));
  parts.push(kpiCard(d.totalActiveHours + " hrs", "Total active time (en route → base)", ""));
  parts.push("</div>");

  parts.push('<div class="admin-section"><h2>Cases by priority</h2>');
  const priOrder = ["P1", "P2", "P3", "P4", "Unset"];
  const maxPri = Math.max.apply(null, priOrder.map(function (k) { return d.byPriority[k] || 0; }).concat([1]));
  priOrder.forEach(function (k) {
    const n = d.byPriority[k] || 0;
    if (!n && k === "Unset") return;
    parts.push(barRow(k, n, maxPri, "p" + k.slice(1).toLowerCase()));
  });
  parts.push("</div>");

  parts.push('<div class="admin-section"><h2>Cases per day</h2>');
  const maxDay = Math.max.apply(null, d.byDay.map(function (r) { return r.count; }).concat([1]));
  d.byDay.forEach(function (r) {
    parts.push(barRow(r.date.slice(-2), r.count, maxDay, ""));
  });
  parts.push("</div>");

  parts.push('<div class="admin-section"><h2>Cases per crew</h2>');
  const maxCrew = Math.max.apply(null, d.byCrew.map(function (r) { return r.cases; }).concat([1]));
  d.byCrew.forEach(function (r) {
    parts.push(barRow(r.crew, r.cases, maxCrew, ""));
  });
  parts.push("</div>");

  els.content.innerHTML = parts.join("");
}

function kpiCard(value, label, cls) {
  return '<div class="kpi-card ' + cls + '"><div class="kpi-value">' + escapeHtml(String(value)) +
    '</div><div class="kpi-label">' + escapeHtml(label) + "</div></div>";
}

function barRow(label, value, max, cls) {
  const pct = Math.max(6, Math.round((value / max) * 100));
  return '<div class="bar-row"><span class="bar-label">' + escapeHtml(String(label)) +
    '</span><div class="bar-track"><div class="bar-fill ' + cls + '" style="width:' + pct + '%">' +
    value + "</div></div></div>";
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

function showOverlay(label) { els.loadingLabel.textContent = label; els.loadingOverlay.classList.add("visible"); }
function hideOverlay() { els.loadingOverlay.classList.remove("visible"); }

autoUnlock();
