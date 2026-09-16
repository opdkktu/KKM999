// ===== CONFIGURED =====
const BACKEND_URL =
  "https://script.google.com/macros/s/AKfycbz-vpBAMA4nzRY11QsACuRMq8D6nmnBEni-a5_BNAUIsjJyTk1y8p2P6lDTcOgvTM7D/exec";
// ======================

const STAGE_ORDER = ["enRoute", "atScene", "depart", "atHospital", "atBase"];
const STAGE_LABELS = {
  enRoute: "En route", atScene: "At scene", depart: "Depart",
  atHospital: "At hospital", atBase: "At base"
};

const MOVE_PHRASES = ["bertolak", "bergerak", "transporting", "depart", "moving"];
const STAGE_PHRASES = {
  atScene: ["tiba di lokasi", "tiba lokasi", "at scene", "sampai di lokasi", "on scene"],
  atHospital: ["sampai hospital", "tiba di hospital", "at hospital", "arrived hospital", "arrived at hospital"],
  atBase: ["sampai di klinik", "sampai klinik", "sampai di base", "sampai base", "at base", "back to base"]
};

const state = {
  caseUid: newUid(),
  stages: {},
  markedLocation: null,
  recordingUrl: "",
  priority: "",
  casualties: [],
  pin: "",
  apiKey: "",
  coordOverrides: {},
  saveTimer: null,
  dirty: false
};

const els = {};
[
  "case-id", "location-text", "location-hint", "case-type", "hospital-name",
  "hospital-hint", "outcome", "general-notes", "report-text", "toast",
  "loading-overlay", "loading-label", "status-dot", "btn-voice-commands",
  "voice-heard", "btn-record", "record-label", "record-timer",
  "recording-status", "queue-banner", "queue-text", "amo-select",
  "pilot-select", "amo-name", "pilot-name", "personal-api-key", "key-status",
  "location-calibration", "pending-detail", "staff-status", "settings-sheet",
  "settings-backdrop", "priority-row", "casualty-list", "kpi-line",
  "guidance", "guidance-protocol", "guidance-progress", "guidance-letter",
  "guidance-title", "guidance-hint", "guidance-example",
  "pin-gate", "pin-input", "pin-error", "app-root"
].forEach(function (id) { els[camel(id)] = document.getElementById(id); });

function camel(s) { return s.replace(/-([a-z])/g, function (m, c) { return c.toUpperCase(); }); }
els.hospital = els.hospitalName;

function newUid() {
  return "C" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("service-worker.js").catch(function () {});
  });
}

/* ============================================================
   PIN GATE
   Deterrence only. Anyone holding both the backend URL and the
   PIN can post; rotate it when a responder leaves.
   ============================================================ */

async function callBackend(action, body) {
  const res = await fetch(BACKEND_URL, {
    method: "POST",
    body: JSON.stringify(Object.assign({ action: action, pin: state.pin }, body))
  });
  return res.json();
}

function showApp() {
  els.pinGate.hidden = true;
  els.appRoot.hidden = false;
}

els.btnPinSubmit = document.getElementById("btn-pin-submit");
els.btnPinSubmit.addEventListener("click", submitPin);
els.pinInput.addEventListener("keydown", function (e) {
  if (e.key === "Enter") submitPin();
});

async function submitPin() {
  const pin = els.pinInput.value.trim();
  els.pinError.textContent = "Checking…";
  try {
    const r = await callBackendRaw("checkPin", { pin: pin });
    if (r.status === "ok") {
      state.pin = pin;
      await Store.setMeta("pin", pin);
      els.pinError.textContent = "";
      showApp();
      boot();
    } else {
      els.pinError.textContent = r.message || "Incorrect PIN";
    }
  } catch (e) {
    els.pinError.textContent = "No connection — cannot verify PIN right now";
  }
}

async function callBackendRaw(action, body) {
  const res = await fetch(BACKEND_URL, {
    method: "POST",
    body: JSON.stringify(Object.assign({ action: action }, body))
  });
  return res.json();
}

document.getElementById("btn-forget-pin").addEventListener("click", async function () {
  await Store.setMeta("pin", "");
  showToast("PIN cleared — reopen the app to re-enter it");
});

/* ---------- Status ---------- */
function setStatus(text, cls) {
  els.statusDot.textContent = text;
  els.statusDot.className = "status-dot" + (cls ? " " + cls : "");
}

window.addEventListener("online", function () { setStatus("Back online", ""); drainQueue(); });
window.addEventListener("offline", function () {
  setStatus("Offline", "offline");
  showToast("Offline — work is saved on this phone and syncs later");
});

/* ---------- Priority P1-P4 ---------- */
CONFIG.PRIORITIES.forEach(function (p) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "priority-chip";
  btn.dataset.code = p.code;
  btn.textContent = p.emoji + " " + p.label;
  btn.title = p.desc;
  btn.addEventListener("click", function () {
    state.priority = p.code;
    document.querySelectorAll(".priority-chip").forEach(function (c) {
      c.classList.toggle("active", c.dataset.code === p.code);
    });
    renderReport();
    scheduleSave(0);
  });
  els.priorityRow.appendChild(btn);
});

function priorityEmoji(code) {
  const p = CONFIG.PRIORITIES.filter(function (x) { return x.code === code; })[0];
  return p ? p.emoji : "";
}
function zoneEmoji(code) {
  const z = CONFIG.ZONES.filter(function (x) { return x.code === code; })[0];
  return z ? z.emoji : "";
}

/* ============================================================
   CASUALTIES
   One ambulance run can carry several. Each keeps its own
   protocol fields, vitals and triage zone.
   ============================================================ */

function newCasualty() {
  return {
    id: "K" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    label: "",
    zone: "",
    protocol: els.caseType.value,
    mechanism: "", injury: "", treatment: "", eta: "", rawNotes: "",
    befast: { balance: "", eyes: "", face: "", arm: "", speech: "", onset: "" },
    vitals: { bp: "", pulse: "", resp: "", spo2: "", o2: "", gcs: "", glucose: "" }
  };
}

document.getElementById("btn-add-casualty").addEventListener("click", function () {
  state.casualties.push(newCasualty());
  renderCasualties();
  renderReport();
  scheduleSave(0);
});

const VITAL_FIELDS = [
  { key: "bp", label: "BP", ph: "125/56mmHg" },
  { key: "pulse", label: "Pulse", ph: "98/min" },
  { key: "resp", label: "Resp", ph: "22/min" },
  { key: "spo2", label: "SpO2", ph: "96%" },
  { key: "o2", label: "O2 delivery", ph: "room air" },
  { key: "gcs", label: "GCS", ph: "15" },
  { key: "glucose", label: "Glucose", ph: "7.2" }
];

function renderCasualties() {
  els.casualtyList.innerHTML = "";

  if (!state.casualties.length) {
    const empty = document.createElement("div");
    empty.className = "notes-hint";
    empty.textContent = "No casualty added yet. Add one, or record your handover — casualties are created automatically from what you say.";
    els.casualtyList.appendChild(empty);
    return;
  }

  state.casualties.forEach(function (c, idx) {
    const card = document.createElement("div");
    card.className = "casualty";
    card.dataset.zone = c.zone || "";

    /* Head: label + remove */
    const head = document.createElement("div");
    head.className = "casualty-head";
    const labelInput = document.createElement("input");
    labelInput.type = "text";
    labelInput.value = c.label || "";
    labelInput.placeholder = "Casualty " + (idx + 1);
    labelInput.addEventListener("input", function () {
      c.label = labelInput.value;
      renderReport();
      scheduleSave();
    });
    const del = document.createElement("button");
    del.type = "button";
    del.className = "btn-remove-casualty";
    del.textContent = "✕";
    del.setAttribute("aria-label", "Remove casualty");
    del.addEventListener("click", function () {
      if (!confirm("Remove this casualty from the report?")) return;
      state.casualties.splice(idx, 1);
      renderCasualties();
      renderReport();
      scheduleSave(0);
    });
    head.appendChild(labelInput);
    head.appendChild(del);
    card.appendChild(head);

    /* Zone chips */
    const zoneRow = document.createElement("div");
    zoneRow.className = "zone-row";
    CONFIG.ZONES.forEach(function (z) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "zone-chip" + (c.zone === z.code ? " active" : "");
      chip.dataset.zone = z.code;
      chip.textContent = z.emoji + " " + z.code;
      chip.addEventListener("click", function () {
        c.zone = c.zone === z.code ? "" : z.code;
        renderCasualties();
        renderReport();
        scheduleSave(0);
      });
      zoneRow.appendChild(chip);
    });
    card.appendChild(zoneRow);

    /* Protocol-specific narrative fields */
    const protocol = c.protocol || els.caseType.value;
    const steps = CONFIG.GUIDANCE[protocol] ? CONFIG.GUIDANCE[protocol].steps : [];

    steps.forEach(function (step) {
      if (step.key === "signs" || step.key === "arrival") return; // handled below
      const isBefast = protocol === "cva" && step.key !== "treatment";
      const value = isBefast ? c.befast[step.key] : c[step.key];
      card.appendChild(
        textField(step.letter + " — " + step.title, value, step.hint, function (v) {
          if (isBefast) c.befast[step.key] = v;
          else c[step.key] = v;
          renderReport();
          scheduleSave();
        })
      );
    });

    if (protocol !== "cva") {
      card.appendChild(
        textField("T — Treatment", c.treatment, "What you did and gave", function (v) {
          c.treatment = v; renderReport(); scheduleSave();
        })
      );
    }

    /* Vitals */
    const vg = document.createElement("div");
    vg.className = "vitals-grid";
    VITAL_FIELDS.forEach(function (f) {
      const wrap = document.createElement("div");
      wrap.className = "casualty-field";
      const lab = document.createElement("label");
      lab.textContent = f.label;
      const inp = document.createElement("input");
      inp.type = "text";
      inp.value = c.vitals[f.key] || "";
      inp.placeholder = f.ph;
      inp.addEventListener("input", function () {
        c.vitals[f.key] = normaliseVital(f.key, inp.value);
        renderReport();
        scheduleSave();
      });
      inp.addEventListener("blur", function () {
        inp.value = c.vitals[f.key] || "";
      });
      wrap.appendChild(lab);
      wrap.appendChild(inp);
      vg.appendChild(wrap);
    });
    card.appendChild(vg);

    /* ETA */
    card.appendChild(
      textField("T — ETA", c.eta, "e.g. 12 minutes to HSB", function (v) {
        c.eta = v; renderReport(); scheduleSave();
      }, true)
    );

    if (c.rawNotes) {
      card.appendChild(
        textField("Other notes", c.rawNotes, "", function (v) {
          c.rawNotes = v; renderReport(); scheduleSave();
        })
      );
    }

    els.casualtyList.appendChild(card);
  });
}

function textField(label, value, hint, onChange, single) {
  const wrap = document.createElement("div");
  wrap.className = "casualty-field";
  const lab = document.createElement("label");
  lab.textContent = label;
  wrap.appendChild(lab);
  const input = single ? document.createElement("input") : document.createElement("textarea");
  if (single) input.type = "text";
  input.value = value || "";
  if (hint) input.placeholder = hint;
  input.addEventListener("input", function () { onChange(input.value); });
  wrap.appendChild(input);
  return wrap;
}

/* Vitals normalisation. Adds units only — never alters the digits. */
function normaliseVital(key, raw) {
  const v = String(raw).trim();
  if (!v) return "";

  if (key === "bp") {
    const m = v.match(/^(\d{2,3})\s*(?:\/|over|per|-)\s*(\d{2,3})/i);
    if (m) return m[1] + "/" + m[2] + "mmHg";
    return v;
  }
  if (key === "pulse" || key === "resp") {
    const m = v.match(/^(\d{1,3})\s*(?:\/?\s*min)?$/i);
    if (m) return m[1] + "/min";
    return v;
  }
  if (key === "spo2") {
    const m = v.match(/^(\d{1,3})\s*%?$/);
    if (m) return m[1] + "%";
    return v;
  }
  return v;
}

/* ---------- Speaking guidance ---------- */
let guideIdx = 0;

function guidanceSteps() {
  const g = CONFIG.GUIDANCE[els.caseType.value];
  return g ? g.steps : [];
}

function showGuidance() {
  const steps = guidanceSteps();
  if (!steps.length) return;
  guideIdx = 0;
  els.guidance.hidden = false;
  renderGuidance();
}

function hideGuidance() { els.guidance.hidden = true; }

function renderGuidance() {
  const steps = guidanceSteps();
  const step = steps[guideIdx];
  if (!step) return;
  const g = CONFIG.GUIDANCE[els.caseType.value];
  els.guidanceProtocol.textContent = g.name;
  els.guidanceProgress.textContent = (guideIdx + 1) + " / " + steps.length;
  els.guidanceLetter.textContent = step.letter;
  els.guidanceTitle.textContent = step.title;
  els.guidanceHint.textContent = step.hint;
  els.guidanceExample.textContent = "“" + step.example + "”";
  document.getElementById("btn-guide-next").textContent =
    guideIdx === steps.length - 1 ? "Done" : "Next";
}

document.getElementById("btn-guide-next").addEventListener("click", function () {
  const steps = guidanceSteps();
  if (guideIdx < steps.length - 1) { guideIdx++; renderGuidance(); }
  else hideGuidance();
});
document.getElementById("btn-guide-prev").addEventListener("click", function () {
  if (guideIdx > 0) { guideIdx--; renderGuidance(); }
});

els.caseType.addEventListener("change", function () {
  state.casualties.forEach(function (c) { c.protocol = els.caseType.value; });
  renderCasualties();
  renderReport();
  scheduleSave(0);
});

/* ============================================================
   OFFLINE QUEUE
   ============================================================ */

function buildPayload() {
  const s = state.stages;
  return {
    caseUid: state.caseUid,
    date: todayISO(),
    caseId: els.caseId.value.trim(),
    priority: state.priority,
    locationText: els.locationText.value.trim(),
    latitude: state.markedLocation ? state.markedLocation.lat : "",
    longitude: state.markedLocation ? state.markedLocation.lng : "",
    caseType: els.caseType.value,
    enRouteTime: s.enRoute ? s.enRoute.time : "",
    atSceneTime: s.atScene ? s.atScene.time : "",
    departTime: s.depart ? s.depart.time : "",
    atHospitalTime: s.atHospital ? s.atHospital.time : "",
    hospital: els.hospital.value.trim(),
    outcome: els.outcome.value,
    atBaseTime: s.atBase ? s.atBase.time : "",
    amo: currentName("amo"),
    pilot: currentName("pilot"),
    recordingUrl: state.recordingUrl,
    generalNotes: els.generalNotes.value.trim(),
    casualties: state.casualties
  };
}

function scheduleSave(delay) {
  state.dirty = true;
  setStatus("Saving…", "saving");
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(persistAndPush, delay === undefined ? 1200 : delay);
}

async function persistAndPush() {
  const payload = buildPayload();
  await Store.putCase({ caseUid: payload.caseUid, payload: payload, synced: false });
  drainQueue();
}

let draining = false;

async function drainQueue() {
  if (draining) return;
  if (!navigator.onLine) { setStatus("Offline", "offline"); refreshQueueBanner(); return; }
  draining = true;
  try {
    await pushCases();
    await pushAudio();
  } finally {
    draining = false;
    refreshQueueBanner();
  }
}

async function pushCases() {
  const cases = await Store.allCases();
  const pending = cases.filter(function (c) { return !c.synced; });
  if (!pending.length) { state.dirty = false; setStatus("Saved", ""); return; }

  for (let i = 0; i < pending.length; i++) {
    const rec = pending[i];
    try {
      const result = await callBackend("save", { payload: rec.payload });
      if (result.status === "ok") {
        if (rec.caseUid === state.caseUid) {
          await Store.putCase({ caseUid: rec.caseUid, payload: rec.payload, synced: true });
        } else {
          await Store.deleteCase(rec.caseUid);
        }
      } else {
        setStatus(result.code === "BAD_PIN" ? "PIN rejected" : "Save failed", "error");
        return;
      }
    } catch (e) {
      setStatus("Will retry", "saving");
      return;
    }
  }
  state.dirty = false;
  setStatus("Saved", "");
}

async function pushAudio() {
  const items = await Store.allAudio();
  const pending = items.filter(function (a) { return a.state !== "done"; });

  for (let i = 0; i < pending.length; i++) {
    const rec = pending[i];
    try {
      const blob = new Blob(rec.chunks, { type: rec.mimeType });
      const base64 = await blobToBase64(blob);

      if (rec.state === "pending-upload") {
        const up = await callBackend("uploadAudio", {
          audioBase64: base64, mimeType: rec.mimeType, filename: rec.filename
        });
        if (up.status !== "ok") return;
        rec.url = up.url;
        rec.state = "pending-transcribe";
        await Store.putAudio(rec);
        if (rec.caseUid === state.caseUid) {
          state.recordingUrl = up.url;
          renderReport();
          scheduleSave(0);
        }
        setRecordingStatus("Recording saved to Drive", "done");
      }

      if (rec.state === "pending-transcribe") {
        setRecordingStatus("Structuring handover…", "");
        const t = await callBackend("transcribe", {
          audioBase64: base64, mimeType: rec.mimeType,
          apiKey: state.apiKey, protocol: rec.protocol || "trauma"
        });

        if (t.status === "ok") {
          if (rec.caseUid === state.caseUid) applyTranscription(t);
          rec.state = "done";
          rec.chunks = [];
          await Store.putAudio(rec);
        } else if (t.retryable) {
          setRecordingStatus(t.message, "error");
          return;
        } else {
          rec.state = "done";
          rec.chunks = [];
          await Store.putAudio(rec);
          setRecordingStatus("Could not structure: " + t.message + " — audio is saved in Drive", "error");
        }
      }
    } catch (e) {
      // Network blips are normal and retry silently. Anything else would
      // otherwise leave the responder staring at a stalled queue.
      if (navigator.onLine) {
        setRecordingStatus("Upload problem — still queued, will retry", "error");
      }
      return;
    }
  }
}

/* Merge Gemini's structured output into the casualty list.
   Existing casualties are filled in order; extras are appended. Anything the
   responder already typed is kept — the transcript never overwrites it. */
function applyTranscription(result) {
  if (result.unstructured) {
    els.generalNotes.value = (els.generalNotes.value.trim() + "\n" + result.transcript).trim();
    setRecordingStatus("Transcribed, but could not split into fields — see General notes", "error");
    renderReport();
    scheduleSave(0);
    return;
  }

  const incoming = result.casualties || [];
  if (!incoming.length) {
    setRecordingStatus("No casualty details recognised in that recording", "error");
    return;
  }

  incoming.forEach(function (src, i) {
    let target = state.casualties[i];
    if (!target) {
      target = newCasualty();
      state.casualties.push(target);
    }
    fillIfEmpty(target, "label", src.label);
    fillIfEmpty(target, "zone", src.zone);
    fillIfEmpty(target, "mechanism", src.mechanism);
    fillIfEmpty(target, "injury", src.injury);
    fillIfEmpty(target, "treatment", src.treatment);
    fillIfEmpty(target, "eta", src.eta);
    fillIfEmpty(target, "rawNotes", src.rawNotes);

    if (src.vitals) {
      Object.keys(src.vitals).forEach(function (k) {
        if (target.vitals[k] === undefined) return;
        fillIfEmpty(target.vitals, k, src.vitals[k]);
      });
    }
    if (src.befast) {
      Object.keys(src.befast).forEach(function (k) {
        if (target.befast[k] === undefined) return;
        fillIfEmpty(target.befast, k, src.befast[k]);
      });
    }
  });

  renderCasualties();
  renderReport();
  scheduleSave(0);
  setRecordingStatus(
    incoming.length + " casualty record" + (incoming.length > 1 ? "s" : "") +
    " filled in — check every value against what you said",
    "done"
  );
}

function fillIfEmpty(obj, key, value) {
  const v = value === undefined || value === null ? "" : String(value).trim();
  if (!v) return;
  if (obj[key] && String(obj[key]).trim()) return; // never overwrite the responder
  obj[key] = v;
}

async function refreshQueueBanner() {
  const cases = await Store.allCases();
  const audio = await Store.allAudio();
  const pc = cases.filter(function (c) { return !c.synced; }).length;
  const pa = audio.filter(function (a) { return a.state !== "done"; }).length;
  const total = pc + pa;

  if (!total) {
    els.queueBanner.hidden = true;
    if (els.pendingDetail) els.pendingDetail.textContent = "None";
    return;
  }
  const parts = [];
  if (pc) parts.push(pc + " case update" + (pc > 1 ? "s" : ""));
  if (pa) parts.push(pa + " recording" + (pa > 1 ? "s" : ""));
  const label = parts.join(" and ") + " waiting to sync";
  els.queueText.textContent = navigator.onLine ? label : label + " (offline)";
  els.queueBanner.hidden = false;
  if (els.pendingDetail) els.pendingDetail.textContent = label;
}

document.getElementById("btn-sync-now").addEventListener("click", function () { showToast("Syncing…"); drainQueue(); });
document.getElementById("btn-force-sync").addEventListener("click", function () { showToast("Syncing…"); drainQueue(); });
setInterval(function () { if (navigator.onLine) drainQueue(); }, CONFIG.SYNC_INTERVAL_MS);

/* ---------- Stage logging ---------- */
document.querySelectorAll("[data-stage-btn]").forEach(function (btn) {
  btn.addEventListener("click", function () { logStage(btn.dataset.stageBtn); });
});

function logStage(stageKey) {
  if (state.stages[stageKey]) { showToast(STAGE_LABELS[stageKey] + " already logged"); return; }

  const now = new Date();
  state.stages[stageKey] = { time: formatTime(now), iso: now.toISOString() };
  updateStageCard(stageKey);
  showToast(STAGE_LABELS[stageKey] + " logged at " + state.stages[stageKey].time);
  renderReport();
  renderKpi();
  scheduleSave(0);

  if (stageKey === "atScene" || stageKey === "atBase" || stageKey === "atHospital") {
    captureGeolocation(stageKey);
  }
}

function updateStageCard(stageKey) {
  const card = document.querySelector('.stage-card[data-stage="' + stageKey + '"]');
  const btn = card.querySelector("[data-stage-btn]");
  card.classList.remove("active");
  card.classList.add("done");
  btn.textContent = "Logged";
  btn.disabled = true;
  card.querySelector('[data-time-for="' + stageKey + '"]').textContent = state.stages[stageKey].time;
  const next = STAGE_ORDER[STAGE_ORDER.indexOf(stageKey) + 1];
  if (next) document.querySelector('.stage-card[data-stage="' + next + '"]').classList.add("active");
}

document.querySelector('.stage-card[data-stage="enRoute"]').classList.add("active");

function minutesBetween(a, b) {
  if (!a || !b) return null;
  const pa = a.split(":"), pb = b.split(":");
  let m = (+pb[0] * 60 + +pb[1]) - (+pa[0] * 60 + +pa[1]);
  if (isNaN(m)) return null;
  if (m < 0) m += 1440;
  return m;
}

function renderKpi() {
  const s = state.stages;
  const resp = minutesBetween(s.enRoute && s.enRoute.time, s.atScene && s.atScene.time);
  if (resp === null) { els.kpiLine.innerHTML = ""; return; }
  const ok = resp <= CONFIG.RESPONSE_KPI_MIN;
  els.kpiLine.innerHTML =
    'Response time: <span class="' + (ok ? "under" : "over") + '">' + resp + " min</span> " +
    "(KPI ≤ " + CONFIG.RESPONSE_KPI_MIN + " min)";
}

/* ---------- Geolocation ---------- */
function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000, toRad = function (d) { return (d * Math.PI) / 180; };
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function resolvedCoords(name, fallback) {
  return state.coordOverrides[name] || fallback;
}

function matchHospital(lat, lng) {
  let best = null;
  CONFIG.HOSPITALS.forEach(function (h) {
    const c = resolvedCoords(h.name, h);
    const d = haversineM(lat, lng, c.lat, c.lng);
    if (d <= CONFIG.MATCH_RADIUS_M && (!best || d < best.dist)) {
      best = { name: h.name, dist: Math.round(d) };
    }
  });
  return best;
}

function getPosition(onOk, onErr) {
  if (!navigator.geolocation) { if (onErr) onErr(); return; }
  navigator.geolocation.getCurrentPosition(
    function (pos) { onOk(pos.coords.latitude.toFixed(6), pos.coords.longitude.toFixed(6), pos.coords.accuracy); },
    function () { if (onErr) onErr(); },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 5000 }
  );
}

document.getElementById("btn-mark-location").addEventListener("click", function () {
  captureSceneLocation();
});

/* Scene location. The responder enters nothing up front — logging At Scene
   captures the geotag, writes a coordinate placeholder into the name field,
   and leaves it editable so they can replace it with a proper place name. */
function captureSceneLocation() {
  els.locationHint.textContent = "Getting GPS fix…";
  getPosition(
    function (lat, lng, acc) {
      state.markedLocation = { lat: lat, lng: lng };
      if (!els.locationText.value.trim()) els.locationText.value = lat + ", " + lng;
      els.locationHint.textContent =
        "Geotag captured: " + lat + ", " + lng +
        (acc ? " (±" + Math.round(acc) + "m)" : "") + " — you can rename this";
      renderReport();
      scheduleSave();
    },
    function () {
      els.locationHint.textContent = "No GPS fix — type the location manually";
    }
  );
}

function captureGeolocation(stageKey) {
  if (stageKey === "atScene") { captureSceneLocation(); return; }

  getPosition(function (lat, lng) {
    state.stages[stageKey].lat = lat;
    state.stages[stageKey].lng = lng;

    if (stageKey === "atHospital") {
      const match = matchHospital(parseFloat(lat), parseFloat(lng));
      if (match) {
        if (!els.hospital.value.trim()) els.hospital.value = match.name;
        els.hospitalHint.textContent = "Detected: " + match.name + " (" + match.dist + "m)";
      } else {
        els.hospitalHint.textContent = "No hospital matched this GPS fix — type the name";
      }
    }

    if (stageKey === "atBase") {
      const base = resolvedCoords(CONFIG.BASE.name, CONFIG.BASE);
      const d = Math.round(haversineM(parseFloat(lat), parseFloat(lng), base.lat, base.lng));
      if (d > CONFIG.MATCH_RADIUS_M) showToast("Note: " + d + "m from the base location on file");
    }

    renderReport();
    scheduleSave();
  });
}

/* ---------- Recording ---------- */
let mediaRecorder = null, currentAudioId = null, currentChunks = [];
let recordStart = null, timerInterval = null;

els.btnRecord.addEventListener("click", function () {
  if (mediaRecorder && mediaRecorder.state === "recording") stopRecording();
  else startRecording();
});

async function startRecording() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setRecordingStatus("Recording is not supported in this browser", "error");
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });

    currentChunks = [];
    currentAudioId = "A" + Date.now().toString(36);
    const opts = pickMimeType();
    opts.audioBitsPerSecond = CONFIG.AUDIO_BITRATE;
    mediaRecorder = new MediaRecorder(stream, opts);
    const mime = (mediaRecorder.mimeType || "audio/webm").split(";")[0];
    const protocol = els.caseType.value;

    mediaRecorder.addEventListener("dataavailable", async function (e) {
      if (!e.data || !e.data.size) return;
      currentChunks.push(e.data);
      await Store.putAudio({
        id: currentAudioId,
        caseUid: state.caseUid,
        chunks: currentChunks.slice(),
        mimeType: mime,
        protocol: protocol,
        filename: "case-" + (els.caseId.value.trim() || state.caseUid) + "-" + todayISO() + extFor(mime),
        state: "recording",
        createdAt: Date.now()
      });
    });

    mediaRecorder.addEventListener("stop", async function () {
      stream.getTracks().forEach(function (t) { t.stop(); });
      const rec = await Store.getAudio(currentAudioId);
      if (rec && rec.chunks.length) {
        rec.state = "pending-upload";
        await Store.putAudio(rec);
        setRecordingStatus(
          navigator.onLine ? "Saved on device — uploading…" : "Saved on device — uploads when back online",
          navigator.onLine ? "" : "done"
        );
        refreshQueueBanner();
        drainQueue();
      } else {
        setRecordingStatus("No audio captured", "error");
      }
    });

    mediaRecorder.start(CONFIG.CHUNK_MS);
    recordStart = Date.now();
    els.btnRecord.classList.add("recording");
    els.recordLabel.textContent = "Stop recording";
    setRecordingStatus("Recording — no signal needed", "");
    timerInterval = setInterval(tickTimer, 500);
    showGuidance();
  } catch (e) {
    setRecordingStatus("Microphone access denied", "error");
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state === "recording") mediaRecorder.stop();
  clearInterval(timerInterval);
  els.btnRecord.classList.remove("recording");
  els.recordLabel.textContent = "Start recording";
  hideGuidance();
}

function pickMimeType() {
  const c = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  for (let i = 0; i < c.length; i++) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(c[i])) return { mimeType: c[i] };
  }
  return {};
}

function tickTimer() {
  const secs = Math.floor((Date.now() - recordStart) / 1000);
  els.recordTimer.textContent =
    String(Math.floor(secs / 60)).padStart(2, "0") + ":" + String(secs % 60).padStart(2, "0");
}

function extFor(mime) {
  if (mime.indexOf("mp4") > -1) return ".m4a";
  if (mime.indexOf("ogg") > -1) return ".ogg";
  return ".webm";
}

function blobToBase64(blob) {
  return new Promise(function (resolve, reject) {
    const r = new FileReader();
    r.onload = function () { resolve(r.result.split(",")[1]); };
    r.onerror = function () { reject(new Error("Could not read audio")); };
    r.readAsDataURL(blob);
  });
}

function setRecordingStatus(msg, cls) {
  els.recordingStatus.textContent = msg;
  els.recordingStatus.className = "recording-status" + (cls ? " " + cls : "");
}

/* ---------- Voice commands ---------- */
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null, voiceOn = false;

if (!SpeechRecognition) {
  els.btnVoiceCommands.disabled = true;
  els.btnVoiceCommands.innerHTML = '<span class="mic-glyph"></span> Voice commands unavailable';
}

els.btnVoiceCommands.addEventListener("click", function () {
  if (voiceOn) stopVoiceCommands(); else startVoiceCommands();
});

function startVoiceCommands() {
  if (!SpeechRecognition) return;
  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.lang = "ms-MY";

  recognition.addEventListener("result", function (event) {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const said = event.results[i][0].transcript.toLowerCase().trim();
      els.voiceHeard.textContent = '"' + said + '"';
      const stage = resolveStageFromSpeech(said);
      if (stage) logStage(stage);
    }
  });
  recognition.addEventListener("end", function () {
    if (voiceOn) { try { recognition.start(); } catch (e) {} }
  });
  recognition.addEventListener("error", function (e) {
    if (e.error === "not-allowed") { stopVoiceCommands(); showToast("Microphone permission needed"); }
  });

  try {
    recognition.start();
    voiceOn = true;
    els.btnVoiceCommands.classList.add("listening");
    els.btnVoiceCommands.innerHTML = '<span class="mic-glyph"></span> Listening';
    showToast("Voice commands on — buttons still work");
  } catch (e) { showToast("Could not start voice commands"); }
}

function stopVoiceCommands() {
  voiceOn = false;
  if (recognition) { try { recognition.stop(); } catch (e) {} }
  els.btnVoiceCommands.classList.remove("listening");
  els.btnVoiceCommands.innerHTML = '<span class="mic-glyph"></span> Voice commands off';
  els.voiceHeard.textContent = "";
}

function resolveStageFromSpeech(said) {
  for (let i = 0; i < MOVE_PHRASES.length; i++) {
    if (said.indexOf(MOVE_PHRASES[i]) > -1) {
      if (!state.stages.enRoute) return "enRoute";
      if (state.stages.atScene && !state.stages.depart) return "depart";
      return null;
    }
  }
  const keys = Object.keys(STAGE_PHRASES);
  for (let k = 0; k < keys.length; k++) {
    for (let j = 0; j < STAGE_PHRASES[keys[k]].length; j++) {
      if (said.indexOf(STAGE_PHRASES[keys[k]][j]) > -1) return keys[k];
    }
  }
  return null;
}

/* ---------- Staff ---------- */
function currentName(role) {
  const sel = role === "amo" ? els.amoSelect : els.pilotSelect;
  const input = role === "amo" ? els.amoName : els.pilotName;
  return sel.value === "__other" ? input.value.trim() : sel.value;
}

function wireStaffSelect(role) {
  const sel = role === "amo" ? els.amoSelect : els.pilotSelect;
  const input = role === "amo" ? els.amoName : els.pilotName;
  sel.addEventListener("change", function () {
    input.hidden = sel.value !== "__other";
    if (sel.value === "__other") input.focus();
    renderReport(); scheduleSave();
  });
  input.addEventListener("input", function () { renderReport(); scheduleSave(); });
}
wireStaffSelect("amo");
wireStaffSelect("pilot");

function populateStaff(staff) {
  [["amo", els.amoSelect], ["pilot", els.pilotSelect]].forEach(function (pair) {
    const sel = pair[1], keep = sel.value;
    sel.innerHTML = '<option value="">Select…</option>';
    (staff[pair[0]] || []).forEach(function (name) {
      const o = document.createElement("option");
      o.value = name; o.textContent = name;
      sel.appendChild(o);
    });
    const other = document.createElement("option");
    other.value = "__other"; other.textContent = "Type manually…";
    sel.appendChild(other);
    if (keep) sel.value = keep;
  });
}

async function loadStaff(force) {
  const cached = await Store.getMeta("staff");
  if (cached && !force) populateStaff(cached);
  if (!navigator.onLine) return;
  try {
    const r = await callBackend("getStaff", {});
    if (r.status === "ok") {
      await Store.setMeta("staff", { amo: r.amo, pilot: r.pilot });
      populateStaff({ amo: r.amo, pilot: r.pilot });
      if (els.staffStatus) els.staffStatus.textContent = r.amo.length + " AMO, " + r.pilot.length + " pilot loaded";
    }
  } catch (e) {
    if (els.staffStatus && force) els.staffStatus.textContent = "Could not reach the sheet";
  }
}
document.getElementById("btn-refresh-staff").addEventListener("click", function () { loadStaff(true); });

/* ---------- Settings ---------- */
document.getElementById("btn-settings").addEventListener("click", function () {
  els.settingsSheet.hidden = false;
  els.settingsBackdrop.hidden = false;
  renderCalibration();
  refreshQueueBanner();
});
function closeSettings() { els.settingsSheet.hidden = true; els.settingsBackdrop.hidden = true; }
document.getElementById("btn-close-settings").addEventListener("click", closeSettings);
els.settingsBackdrop.addEventListener("click", closeSettings);

document.getElementById("btn-save-key").addEventListener("click", async function () {
  const key = els.personalApiKey.value.trim();
  state.apiKey = key;
  await Store.setMeta("apiKey", key);
  els.keyStatus.textContent = key ? "Personal key saved on this device" : "Cleared — using the shared server key";
  showToast("Key setting saved");
});

function renderCalibration() {
  els.locationCalibration.innerHTML = "";
  CONFIG.HOSPITALS.concat([CONFIG.BASE]).forEach(function (place) {
    const c = resolvedCoords(place.name, place);
    const overridden = !!state.coordOverrides[place.name];
    const row = document.createElement("div");
    row.className = "calib-row";
    const label = document.createElement("div");
    label.className = "calib-name";
    label.innerHTML = place.name + '<span class="calib-coords">' +
      Number(c.lat).toFixed(5) + ", " + Number(c.lng).toFixed(5) +
      (overridden ? " (calibrated)" : " (default)") + "</span>";
    const btn = document.createElement("button");
    btn.type = "button"; btn.textContent = "Set";
    btn.addEventListener("click", function () {
      btn.textContent = "…";
      getPosition(async function (lat, lng) {
        state.coordOverrides[place.name] = { lat: parseFloat(lat), lng: parseFloat(lng) };
        await Store.setMeta("coordOverrides", state.coordOverrides);
        renderCalibration();
        showToast(place.name + " coordinates set");
      }, function () { btn.textContent = "Set"; showToast("Could not get GPS location"); });
    });
    row.appendChild(label); row.appendChild(btn);
    els.locationCalibration.appendChild(row);
  });
}

/* ---------- Report ---------- */
function formatTime(d) {
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

function todayISO() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function vitalsLine(v) {
  const parts = [];
  if (v.bp) parts.push("BP " + v.bp);
  if (v.pulse) parts.push("PR " + v.pulse);
  if (v.resp) parts.push("RR " + v.resp);
  if (v.spo2) parts.push("SpO2 " + v.spo2 + (v.o2 ? " (" + v.o2 + ")" : ""));
  if (v.gcs) parts.push("GCS " + v.gcs);
  if (v.glucose) parts.push("Glucose " + v.glucose);
  return parts.join(" | ");
}

function casualtyBlock(c, idx) {
  const zone = c.zone ? zoneEmoji(c.zone) + " " + c.zone + " Zone" : "";
  const lines = ["", "👤 " + (c.label || "CASUALTY " + (idx + 1)) + (zone ? " — " + zone : "")];
  const protocol = c.protocol || els.caseType.value;

  if (protocol === "cva") {
    const b = c.befast;
    if (b.balance) lines.push("B: " + b.balance);
    if (b.eyes) lines.push("E: " + b.eyes);
    if (b.face) lines.push("F: " + b.face);
    if (b.arm) lines.push("A: " + b.arm);
    if (b.speech) lines.push("S: " + b.speech);
    if (b.onset) lines.push("T: Onset " + b.onset);
    if (c.treatment) lines.push("Rx: " + c.treatment);
  } else {
    if (c.mechanism) lines.push("M: " + c.mechanism);
    if (c.injury) lines.push("I: " + c.injury);
    const vl = vitalsLine(c.vitals);
    if (vl) lines.push("S: " + vl);
    if (c.treatment) lines.push("T: " + c.treatment);
  }

  if (protocol === "cva") {
    const vl = vitalsLine(c.vitals);
    if (vl) lines.push("S: " + vl);
  }

  if (c.eta) lines.push("T: ETA " + c.eta);
  if (c.rawNotes) lines.push("Note: " + c.rawNotes);
  return lines;
}

function buildReport() {
  const s = state.stages;
  const lines = ["🚑 AMBULANCE TRANSPORT REPORT", ""];

  lines.push("📅 Date: " + todayISO());
  lines.push("🆔 Case ID: " + (els.caseId.value.trim() || "-"));
  if (state.priority) lines.push("⚡ Priority: " + priorityEmoji(state.priority) + " " + state.priority);
  lines.push("📍 Location: " + (els.locationText.value.trim() || "-"));
  const typeName = CONFIG.GUIDANCE[els.caseType.value] ? CONFIG.GUIDANCE[els.caseType.value].name : els.caseType.value;
  lines.push("🏷 Case type: " + typeName);

  lines.push("", "⏱ TIMINGS");
  lines.push("🚑 En route: " + (s.enRoute ? s.enRoute.time : "-"));
  lines.push("📍 At scene: " + (s.atScene ? s.atScene.time : "-"));
  lines.push("🚨 Depart: " + (s.depart ? s.depart.time : "-"));
  lines.push("🏥 At hospital: " + (s.atHospital ? s.atHospital.time : "-") +
    (els.hospital.value.trim() ? " — " + els.hospital.value.trim() : ""));
  lines.push("🏠 At base: " + (s.atBase ? s.atBase.time : "-"));

  const resp = minutesBetween(s.enRoute && s.enRoute.time, s.atScene && s.atScene.time);
  if (resp !== null) lines.push("⏳ Response time: " + resp + " min");

  lines.push("📤 Outcome: " + els.outcome.value);

  if (state.casualties.length) {
    lines.push("", "🧑‍🤝‍🧑 CASUALTIES (" + state.casualties.length + ")");
    state.casualties.forEach(function (c, i) {
      casualtyBlock(c, i).forEach(function (l) { lines.push(l); });
    });
  }

  if (els.generalNotes.value.trim()) {
    lines.push("", "📝 Notes: " + els.generalNotes.value.trim());
  }

  lines.push("", "👥 TEAM");
  lines.push("AMO: " + (currentName("amo") || "-"));
  lines.push("Pilot: " + (currentName("pilot") || "-"));
  lines.push("🎙 Recording: " + (state.recordingUrl || "-"));
  lines.push("", "— end of report —");

  return lines.join("\n");
}

function renderReport() { els.reportText.textContent = buildReport(); }

[els.caseId, els.locationText, els.hospital, els.generalNotes].forEach(function (el) {
  el.addEventListener("input", function () { renderReport(); scheduleSave(); });
});
els.outcome.addEventListener("change", function () { renderReport(); scheduleSave(); });

/* ---------- Copy / WhatsApp ---------- */
document.getElementById("btn-copy").addEventListener("click", async function () {
  try {
    await navigator.clipboard.writeText(buildReport());
    showToast("Report copied");
  } catch (e) { showToast("Could not copy — select the text manually"); }
});
document.getElementById("btn-whatsapp").addEventListener("click", function () {
  window.open("https://wa.me/?text=" + encodeURIComponent(buildReport()), "_blank");
});

/* ---------- New case ---------- */
document.getElementById("btn-new-case").addEventListener("click", async function () {
  const audio = await Store.allAudio();
  const stuck = audio.filter(function (a) { return a.state !== "done"; }).length;
  const msg = stuck
    ? stuck + " recording(s) still waiting to upload. They keep syncing in the background. Start a new case anyway?"
    : "Start a new case? The current case stays saved.";
  if (!confirm(msg)) return;

  state.caseUid = newUid();
  state.stages = {};
  state.markedLocation = null;
  state.recordingUrl = "";
  state.priority = "";
  state.casualties = [];
  state.dirty = false;

  [els.caseId, els.locationText, els.hospital, els.generalNotes].forEach(function (el) { el.value = ""; });
  els.outcome.value = "Transported";
  els.hospitalHint.textContent = "";
  els.locationHint.textContent = "";
  els.kpiLine.innerHTML = "";

  document.querySelectorAll(".priority-chip").forEach(function (c) { c.classList.remove("active"); });
  document.querySelectorAll(".stage-card").forEach(function (card) {
    card.classList.remove("done", "active");
    const b = card.querySelector("[data-stage-btn]");
    b.textContent = "Log"; b.disabled = false;
    card.querySelector(".stage-time").textContent = "";
  });
  document.querySelector('.stage-card[data-stage="enRoute"]').classList.add("active");

  els.recordTimer.textContent = "00:00";
  setRecordingStatus("", "");
  setStatus("Ready", "");
  renderCasualties();
  renderReport();
  showToast("New case started");
});

/* ---------- Overlay / toast ---------- */
function showOverlay(label) { els.loadingLabel.textContent = label; els.loadingOverlay.classList.add("visible"); }
function hideOverlay() { els.loadingOverlay.classList.remove("visible"); }

let toastTimer;
function showToast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { els.toast.classList.remove("visible"); }, 2400);
}

/* ---------- Boot ---------- */
async function boot() {
  state.apiKey = (await Store.getMeta("apiKey")) || "";
  state.coordOverrides = (await Store.getMeta("coordOverrides")) || {};
  if (state.apiKey) {
    els.personalApiKey.value = state.apiKey;
    els.keyStatus.textContent = "Personal key in use on this device";
  }

  const audio = await Store.allAudio();
  const orphans = audio.filter(function (a) { return a.state === "recording"; });
  for (let i = 0; i < orphans.length; i++) {
    orphans[i].state = "pending-upload";
    await Store.putAudio(orphans[i]);
  }
  if (orphans.length) {
    setRecordingStatus("Recovered " + orphans.length + " interrupted recording — queued for upload", "done");
  }

  await loadStaff(false);
  renderCasualties();
  renderReport();
  setStatus(navigator.onLine ? "Ready" : "Offline", navigator.onLine ? "" : "offline");
  refreshQueueBanner();
  drainQueue();
}

(async function init() {
  const saved = await Store.getMeta("pin");
  if (saved) {
    state.pin = saved;
    showApp();
    boot();
    return;
  }
  // No PIN stored. If the backend has no PIN configured, go straight in.
  try {
    const r = await callBackendRaw("checkPin", { pin: "" });
    if (r.status === "ok" && r.pinRequired === false) {
      showApp(); boot(); return;
    }
  } catch (e) {
    // Offline on a fresh device: nothing is cached, so the PIN must be entered
    // once while online before the app can be used in the field.
  }
  els.pinGate.hidden = false;
})();
