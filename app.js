// ===== CONFIGURED =====
const BACKEND_URL =
  "https://script.google.com/macros/s/AKfycbz-vpBAMA4nzRY11QsACuRMq8D6nmnBEni-a5_BNAUIsjJyTk1y8p2P6lDTcOgvTM7D/exec";
// ======================

const STAGE_ORDER = ["enRoute", "atScene", "depart", "atHospital", "atBase"];
const STAGE_LABELS = {
  enRoute: "En route",
  atScene: "At scene",
  depart: "Depart",
  atHospital: "At hospital",
  atBase: "At base"
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
  priority: "Normal",
  saveTimer: null,
  saving: false,
  dirty: false,
  apiKey: "",
  coordOverrides: {},
  staff: { amo: [], pilot: [] }
};

const els = {};
[
  "case-id", "location-text", "case-type", "hospital-name", "outcome", "notes",
  "report-text", "toast", "loading-overlay", "loading-label", "status-dot",
  "btn-voice-commands", "voice-heard", "btn-record", "record-label",
  "record-timer", "recording-status", "queue-banner", "queue-text",
  "hospital-hint", "amo-select", "pilot-select", "amo-name", "pilot-name",
  "personal-api-key", "key-status", "location-calibration", "pending-detail",
  "staff-status", "settings-sheet", "settings-backdrop"
].forEach(function (id) {
  els[camel(id)] = document.getElementById(id);
});

function camel(s) {
  return s.replace(/-([a-z])/g, function (m, c) { return c.toUpperCase(); });
}

// Friendlier aliases used throughout the code.
els.hospital = els.hospitalName;

function newUid() {
  return "C" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/* ---------- Service worker ---------- */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("service-worker.js").catch(function () {});
  });
}

/* ---------- Status ---------- */
function setStatus(text, cls) {
  els.statusDot.textContent = text;
  els.statusDot.className = "status-dot" + (cls ? " " + cls : "");
}

window.addEventListener("online", function () {
  setStatus("Back online", "");
  drainQueue();
});
window.addEventListener("offline", function () {
  setStatus("Offline", "offline");
  showToast("Offline — work is saved on this phone and will sync later");
});

/* ---------- Backend ---------- */
async function callBackend(action, body) {
  const res = await fetch(BACKEND_URL, {
    method: "POST",
    body: JSON.stringify(Object.assign({ action: action }, body))
  });
  return res.json();
}

/* ============================================================
   OFFLINE QUEUE
   Every case edit is written to IndexedDB first, then pushed.
   Audio is stored as chunks during recording, so nothing is lost
   if the app is backgrounded, signal drops, or the phone dies.
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
    caseType: els.caseType.value.trim(),
    enRouteTime: s.enRoute ? s.enRoute.time : "",
    atSceneTime: s.atScene ? s.atScene.time : "",
    departTime: s.depart ? s.depart.time : "",
    managementNotes: els.notes.value.trim(),
    atHospitalTime: s.atHospital ? s.atHospital.time : "",
    hospital: els.hospital.value.trim(),
    outcome: els.outcome.value,
    atBaseTime: s.atBase ? s.atBase.time : "",
    amo: currentName("amo"),
    pilot: currentName("pilot"),
    recordingUrl: state.recordingUrl
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
  // Local first. This is the write that must never fail.
  await Store.putCase({ caseUid: payload.caseUid, payload: payload, synced: false });
  drainQueue();
}

let draining = false;

async function drainQueue() {
  if (draining) return;
  if (!navigator.onLine) {
    setStatus("Offline", "offline");
    refreshQueueBanner();
    return;
  }
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
  if (!pending.length) {
    state.dirty = false;
    setStatus("Saved", "");
    return;
  }

  for (let i = 0; i < pending.length; i++) {
    const rec = pending[i];
    try {
      const result = await callBackend("save", { payload: rec.payload });
      if (result.status === "ok") {
        // The active case stays in the store so later edits keep upserting
        // the same row; finished cases are cleared out.
        if (rec.caseUid === state.caseUid) {
          await Store.putCase({ caseUid: rec.caseUid, payload: rec.payload, synced: true });
        } else {
          await Store.deleteCase(rec.caseUid);
        }
      } else {
        setStatus("Save failed", "error");
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
          audioBase64: base64,
          mimeType: rec.mimeType,
          filename: rec.filename
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
        setRecordingStatus("Recording uploaded to Drive", "done");
      }

      if (rec.state === "pending-transcribe") {
        setRecordingStatus("Transcribing…", "");
        const t = await callBackend("transcribe", {
          audioBase64: base64,
          mimeType: rec.mimeType,
          apiKey: state.apiKey
        });

        if (t.status === "ok") {
          if (rec.caseUid === state.caseUid) {
            const cleaned = formatBloodPressure(t.transcript);
            els.notes.value = els.notes.value.trim()
              ? els.notes.value.trim() + "\n" + cleaned
              : cleaned;
            renderReport();
            scheduleSave(0);
          }
          rec.state = "done";
          rec.chunks = []; // audio is safely in Drive; free the device storage
          await Store.putAudio(rec);
          setRecordingStatus("Transcribed — review and edit if needed", "done");
        } else if (t.retryable) {
          setRecordingStatus(t.message, "error");
          return;
        } else {
          rec.state = "done";
          rec.chunks = [];
          await Store.putAudio(rec);
          setRecordingStatus("Transcription failed: " + t.message + " — recording is saved in Drive", "error");
        }
      }
    } catch (e) {
      return; // stay queued, retry on next drain
    }
  }
}

async function refreshQueueBanner() {
  const cases = await Store.allCases();
  const audio = await Store.allAudio();
  const pendingCases = cases.filter(function (c) { return !c.synced; }).length;
  const pendingAudio = audio.filter(function (a) { return a.state !== "done"; }).length;
  const total = pendingCases + pendingAudio;

  if (total === 0) {
    els.queueBanner.hidden = true;
    if (els.pendingDetail) els.pendingDetail.textContent = "None";
    return;
  }

  const parts = [];
  if (pendingCases) parts.push(pendingCases + " case update" + (pendingCases > 1 ? "s" : ""));
  if (pendingAudio) parts.push(pendingAudio + " recording" + (pendingAudio > 1 ? "s" : ""));
  const label = parts.join(" and ") + " waiting to sync";

  els.queueText.textContent = navigator.onLine ? label : label + " (offline)";
  els.queueBanner.hidden = false;
  if (els.pendingDetail) els.pendingDetail.textContent = label;
}

document.getElementById("btn-sync-now").addEventListener("click", function () {
  showToast("Syncing…");
  drainQueue();
});
document.getElementById("btn-force-sync").addEventListener("click", function () {
  showToast("Syncing…");
  drainQueue();
});

setInterval(function () {
  if (navigator.onLine) drainQueue();
}, CONFIG.SYNC_INTERVAL_MS);

/* ---------- Priority ---------- */
document.querySelectorAll(".priority-chip").forEach(function (chip) {
  chip.addEventListener("click", function () {
    document.querySelectorAll(".priority-chip").forEach(function (c) {
      c.classList.remove("active");
    });
    chip.classList.add("active");
    state.priority = chip.dataset.priority;
    document.querySelector(".app").classList.toggle("red-zone", state.priority === "Red Zone");
    renderReport();
    scheduleSave(0);
  });
});

/* ---------- Stage logging ---------- */
document.querySelectorAll("[data-stage-btn]").forEach(function (btn) {
  btn.addEventListener("click", function () { logStage(btn.dataset.stageBtn); });
});

function logStage(stageKey) {
  if (state.stages[stageKey]) {
    showToast(STAGE_LABELS[stageKey] + " already logged");
    return;
  }

  const now = new Date();
  state.stages[stageKey] = { time: formatTime(now), iso: now.toISOString() };

  updateStageCard(stageKey);
  showToast(STAGE_LABELS[stageKey] + " logged at " + state.stages[stageKey].time);
  renderReport();
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

/* ---------- Geolocation + hospital matching ---------- */
function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = function (d) { return (d * Math.PI) / 180; };
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.sqrt(a));
}

function resolvedCoords(name, fallback) {
  const o = state.coordOverrides[name];
  return o ? o : fallback;
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

document.getElementById("btn-mark-location").addEventListener("click", function () {
  getPosition(
    function (lat, lng) {
      state.markedLocation = { lat: lat, lng: lng };
      if (!els.locationText.value.trim()) els.locationText.value = lat + ", " + lng;
      showToast("Location marked");
      renderReport();
      scheduleSave();
    },
    function () { showToast("Could not get GPS location"); }
  );
});

function getPosition(onOk, onErr) {
  if (!navigator.geolocation) {
    if (onErr) onErr();
    return;
  }
  navigator.geolocation.getCurrentPosition(
    function (pos) {
      onOk(pos.coords.latitude.toFixed(6), pos.coords.longitude.toFixed(6));
    },
    function () { if (onErr) onErr(); },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 5000 }
  );
}

function captureGeolocation(stageKey) {
  getPosition(function (lat, lng) {
    state.stages[stageKey].lat = lat;
    state.stages[stageKey].lng = lng;

    if (stageKey === "atScene" && !state.markedLocation) {
      state.markedLocation = { lat: lat, lng: lng };
      if (!els.locationText.value.trim()) els.locationText.value = lat + ", " + lng;
    }

    if (stageKey === "atHospital") {
      const match = matchHospital(parseFloat(lat), parseFloat(lng));
      if (match) {
        // Never overwrite something the crew typed themselves.
        if (!els.hospital.value.trim()) els.hospital.value = match.name;
        els.hospitalHint.textContent = "Detected: " + match.name + " (" + match.dist + "m)";
      } else {
        els.hospitalHint.textContent = "No hospital matched this GPS fix — type the name";
      }
    }

    if (stageKey === "atBase") {
      const base = resolvedCoords(CONFIG.BASE.name, CONFIG.BASE);
      const d = Math.round(haversineM(parseFloat(lat), parseFloat(lng), base.lat, base.lng));
      if (d > CONFIG.MATCH_RADIUS_M) {
        showToast("Note: you are " + d + "m from the base location on file");
      }
    }

    renderReport();
    scheduleSave();
  });
}

/* ---------- Recording (offline-safe, chunked) ---------- */
let mediaRecorder = null;
let currentAudioId = null;
let currentChunks = [];
let recordStart = null;
let timerInterval = null;

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
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
    });

    currentChunks = [];
    currentAudioId = "A" + Date.now().toString(36);
    const opts = pickMimeType();
    opts.audioBitsPerSecond = CONFIG.AUDIO_BITRATE;
    mediaRecorder = new MediaRecorder(stream, opts);

    const mime = (mediaRecorder.mimeType || "audio/webm").split(";")[0];

    mediaRecorder.addEventListener("dataavailable", async function (e) {
      if (!e.data || !e.data.size) return;
      currentChunks.push(e.data);
      // Persist after every chunk, so an interrupted recording survives.
      await Store.putAudio({
        id: currentAudioId,
        caseUid: state.caseUid,
        chunks: currentChunks.slice(),
        mimeType: mime,
        filename:
          "case-" + (els.caseId.value.trim() || state.caseUid) + "-" + todayISO() + extFor(mime),
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
          navigator.onLine ? "Saved on device — uploading…" : "Saved on device — will upload when back online",
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
  } catch (e) {
    setRecordingStatus("Microphone access denied", "error");
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state === "recording") mediaRecorder.stop();
  clearInterval(timerInterval);
  els.btnRecord.classList.remove("recording");
  els.recordLabel.textContent = "Start recording";
}

function pickMimeType() {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  for (let i = 0; i < candidates.length; i++) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(candidates[i])) {
      return { mimeType: candidates[i] };
    }
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
    const reader = new FileReader();
    reader.onload = function () { resolve(reader.result.split(",")[1]); };
    reader.onerror = function () { reject(new Error("Could not read audio")); };
    reader.readAsDataURL(blob);
  });
}

function setRecordingStatus(msg, cls) {
  els.recordingStatus.textContent = msg;
  els.recordingStatus.className = "recording-status" + (cls ? " " + cls : "");
}

/* ---------- Blood pressure formatting ----------
   Safety net over the Gemini prompt. Rewrites only the separator between two
   numbers that follow a BP mention; digits are never altered, and other
   numbers (GCS, SpO2, pulse) are left alone. */
function formatBloodPressure(text) {
  return text.replace(
    /\b(bp|b\.p\.|blood pressure|tekanan darah)\b([^0-9\n]{0,12})(\d{2,3})\s*(?:over|per|\/|-|–)\s*(\d{2,3})(?:\s*mmhg)?/gi,
    function (m, label, gap, sys, dia) {
      return label + " " + sys + "/" + dia + "mmHg";
    }
  );
}

/* ---------- Voice commands ---------- */
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let voiceOn = false;

if (!SpeechRecognition) {
  els.btnVoiceCommands.disabled = true;
  els.btnVoiceCommands.innerHTML = '<span class="mic-glyph"></span> Voice commands unavailable';
}

els.btnVoiceCommands.addEventListener("click", function () {
  if (voiceOn) stopVoiceCommands();
  else startVoiceCommands();
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
    if (e.error === "not-allowed") {
      stopVoiceCommands();
      showToast("Microphone permission needed for voice commands");
    }
  });

  try {
    recognition.start();
    voiceOn = true;
    els.btnVoiceCommands.classList.add("listening");
    els.btnVoiceCommands.innerHTML = '<span class="mic-glyph"></span> Listening';
    showToast("Voice commands on — buttons still work");
  } catch (e) {
    showToast("Could not start voice commands");
  }
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
    const phrases = STAGE_PHRASES[keys[k]];
    for (let j = 0; j < phrases.length; j++) {
      if (said.indexOf(phrases[j]) > -1) return keys[k];
    }
  }
  return null;
}

/* ---------- Staff dropdowns ---------- */
function currentName(role) {
  const sel = role === "amo" ? els.amoSelect : els.pilotSelect;
  const input = role === "amo" ? els.amoName : els.pilotName;
  if (sel.value === "__other") return input.value.trim();
  return sel.value;
}

function wireStaffSelect(role) {
  const sel = role === "amo" ? els.amoSelect : els.pilotSelect;
  const input = role === "amo" ? els.amoName : els.pilotName;
  sel.addEventListener("change", function () {
    input.hidden = sel.value !== "__other";
    if (sel.value === "__other") input.focus();
    renderReport();
    scheduleSave();
  });
  input.addEventListener("input", function () {
    renderReport();
    scheduleSave();
  });
}
wireStaffSelect("amo");
wireStaffSelect("pilot");

function populateStaff(staff) {
  [["amo", els.amoSelect], ["pilot", els.pilotSelect]].forEach(function (pair) {
    const role = pair[0];
    const sel = pair[1];
    const keep = sel.value;
    sel.innerHTML = '<option value="">Select…</option>';
    (staff[role] || []).forEach(function (name) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      sel.appendChild(opt);
    });
    const other = document.createElement("option");
    other.value = "__other";
    other.textContent = "Type manually…";
    sel.appendChild(other);
    if (keep) sel.value = keep;
  });
}

async function loadStaff(force) {
  const cached = await Store.getMeta("staff");
  if (cached && !force) {
    state.staff = cached;
    populateStaff(cached);
  }
  if (!navigator.onLine) return;
  try {
    const r = await callBackend("getStaff", {});
    if (r.status === "ok") {
      state.staff = { amo: r.amo, pilot: r.pilot };
      await Store.setMeta("staff", state.staff);
      populateStaff(state.staff);
      if (els.staffStatus) {
        els.staffStatus.textContent = r.amo.length + " AMO, " + r.pilot.length + " pilot loaded";
      }
    }
  } catch (e) {
    if (els.staffStatus && force) els.staffStatus.textContent = "Could not reach the sheet";
  }
}

document.getElementById("btn-refresh-staff").addEventListener("click", function () {
  loadStaff(true);
});

/* ---------- Settings ---------- */
function openSettings() {
  els.settingsSheet.hidden = false;
  els.settingsBackdrop.hidden = false;
  renderCalibration();
  refreshQueueBanner();
}
function closeSettings() {
  els.settingsSheet.hidden = true;
  els.settingsBackdrop.hidden = true;
}

document.getElementById("btn-settings").addEventListener("click", openSettings);
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
  const container = els.locationCalibration;
  container.innerHTML = "";
  const places = CONFIG.HOSPITALS.concat([CONFIG.BASE]);

  places.forEach(function (place) {
    const c = resolvedCoords(place.name, place);
    const overridden = !!state.coordOverrides[place.name];

    const row = document.createElement("div");
    row.className = "calib-row";

    const label = document.createElement("div");
    label.className = "calib-name";
    label.innerHTML =
      place.name +
      '<span class="calib-coords">' +
      Number(c.lat).toFixed(5) + ", " + Number(c.lng).toFixed(5) +
      (overridden ? " (calibrated)" : " (default)") +
      "</span>";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Set";
    btn.addEventListener("click", function () {
      btn.textContent = "…";
      getPosition(
        async function (lat, lng) {
          state.coordOverrides[place.name] = { lat: parseFloat(lat), lng: parseFloat(lng) };
          await Store.setMeta("coordOverrides", state.coordOverrides);
          renderCalibration();
          showToast(place.name + " coordinates set");
        },
        function () {
          btn.textContent = "Set";
          showToast("Could not get GPS location");
        }
      );
    });

    row.appendChild(label);
    row.appendChild(btn);
    container.appendChild(row);
  });
}

/* ---------- Report ---------- */
function formatTime(d) {
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

function todayISO() {
  const d = new Date();
  return (
    d.getFullYear() + "-" +
    String(d.getMonth() + 1).padStart(2, "0") + "-" +
    String(d.getDate()).padStart(2, "0")
  );
}

function buildReport() {
  const s = state.stages;
  const lines = ["Date: " + todayISO(), "Case ID: " + (els.caseId.value.trim() || "-")];

  if (state.priority !== "Normal") {
    lines.push("Priority: " + (state.priority === "Red Zone" ? "🔴 RED ZONE" : "⚠ URGENT"));
  }

  lines.push(
    "Location: " + (els.locationText.value.trim() || "-"),
    "Case type: " + (els.caseType.value.trim() || "-"),
    "En route: " + (s.enRoute ? s.enRoute.time : "-"),
    "At scene: " + (s.atScene ? s.atScene.time : "-"),
    "Depart: " + (s.depart ? s.depart.time : "-"),
    "",
    "Management notes during transportation:",
    els.notes.value.trim() || "-",
    "",
    "At hospital: " +
      (s.atHospital ? s.atHospital.time : "-") +
      (els.hospital.value.trim() ? " (" + els.hospital.value.trim() + ")" : ""),
    "Outcome: " + els.outcome.value,
    "At base: " + (s.atBase ? s.atBase.time : "-"),
    "",
    "Ambulance team",
    "AMO: " + (currentName("amo") || "-"),
    "Pilot: " + (currentName("pilot") || "-"),
    "Voice recording file: " + (state.recordingUrl || "-"),
    "-end of report-"
  );

  return lines.join("\n");
}

function renderReport() {
  els.reportText.textContent = buildReport();
}

[els.caseId, els.locationText, els.caseType, els.hospital, els.notes].forEach(function (el) {
  el.addEventListener("input", function () {
    renderReport();
    scheduleSave();
  });
});
els.outcome.addEventListener("change", function () {
  renderReport();
  scheduleSave();
});

/* ---------- Copy / WhatsApp ---------- */
document.getElementById("btn-copy").addEventListener("click", async function () {
  try {
    await navigator.clipboard.writeText(buildReport());
    showToast("Report copied");
  } catch (e) {
    showToast("Could not copy — select the text manually");
  }
});

document.getElementById("btn-whatsapp").addEventListener("click", function () {
  window.open("https://wa.me/?text=" + encodeURIComponent(buildReport()), "_blank");
});

/* ---------- New case ---------- */
document.getElementById("btn-new-case").addEventListener("click", async function () {
  const audio = await Store.allAudio();
  const stuck = audio.filter(function (a) { return a.state !== "done"; }).length;
  const warn = stuck
    ? "There " + (stuck > 1 ? "are " + stuck + " recordings" : "is 1 recording") +
      " still waiting to upload. They will keep syncing in the background. Start a new case anyway?"
    : "Start a new case? The current case stays saved.";
  if (!confirm(warn)) return;

  state.caseUid = newUid();
  state.stages = {};
  state.markedLocation = null;
  state.recordingUrl = "";
  state.priority = "Normal";
  state.dirty = false;

  [els.caseId, els.locationText, els.caseType, els.hospital, els.notes].forEach(function (el) {
    el.value = "";
  });
  els.outcome.value = "Transported";
  els.hospitalHint.textContent = "";

  document.querySelectorAll(".priority-chip").forEach(function (c) {
    c.classList.toggle("active", c.dataset.priority === "Normal");
  });
  document.querySelector(".app").classList.remove("red-zone");

  document.querySelectorAll(".stage-card").forEach(function (card) {
    card.classList.remove("done", "active");
    const btn = card.querySelector("[data-stage-btn]");
    btn.textContent = "Log";
    btn.disabled = false;
    card.querySelector(".stage-time").textContent = "";
  });
  document.querySelector('.stage-card[data-stage="enRoute"]').classList.add("active");

  els.recordTimer.textContent = "00:00";
  setRecordingStatus("", "");
  setStatus("Ready", "");
  renderReport();
  showToast("New case started");
});

/* ---------- Overlay / toast ---------- */
function showOverlay(label) {
  els.loadingLabel.textContent = label;
  els.loadingOverlay.classList.add("visible");
}
function hideOverlay() {
  els.loadingOverlay.classList.remove("visible");
}

let toastTimer;
function showToast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { els.toast.classList.remove("visible"); }, 2400);
}

/* ---------- Boot ---------- */
(async function init() {
  state.apiKey = (await Store.getMeta("apiKey")) || "";
  state.coordOverrides = (await Store.getMeta("coordOverrides")) || {};
  if (state.apiKey) {
    els.personalApiKey.value = state.apiKey;
    els.keyStatus.textContent = "Personal key in use on this device";
  }

  // Recover any recording that was cut short by a crash or closed tab.
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
  renderReport();
  setStatus(navigator.onLine ? "Ready" : "Offline", navigator.onLine ? "" : "offline");
  refreshQueueBanner();
  drainQueue();
})();
