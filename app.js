// ===== CONFIGURE THIS =====
const BACKEND_URL = "https://script.google.com/macros/s/AKfycbz-vpBAMA4nzRY11QsACuRMq8D6nmnBEni-a5_BNAUIsjJyTk1y8p2P6lDTcOgvTM7D/exec";
// ============================

const STAGE_ORDER = ["enRoute", "atScene", "depart", "atHospital", "atBase"];
const STAGE_LABELS = {
  enRoute: "En route",
  atScene: "At scene",
  depart: "Depart",
  atHospital: "At hospital",
  atBase: "At base"
};

const state = {
  stages: {}, // { enRoute: {time: "14:32", iso: "..."} , ... }
  markedLocation: null // {lat, lng}
};

const els = {
  caseId: document.getElementById("case-id"),
  locationText: document.getElementById("location-text"),
  caseType: document.getElementById("case-type"),
  amo: document.getElementById("amo-name"),
  pilot: document.getElementById("pilot-name"),
  hospital: document.getElementById("hospital-name"),
  outcome: document.getElementById("outcome"),
  notes: document.getElementById("notes"),
  reportText: document.getElementById("report-text"),
  toast: document.getElementById("toast"),
  overlay: document.getElementById("loading-overlay"),
  loadingLabel: document.getElementById("loading-label"),
  statusDot: document.getElementById("status-dot")
};

// ---- Register service worker ----
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  });
}

// ---- Online/offline status ----
function updateOnlineStatus() {
  const online = navigator.onLine;
  els.statusDot.textContent = online ? "Ready" : "Offline";
  els.statusDot.classList.toggle("offline", !online);
}
window.addEventListener("online", updateOnlineStatus);
window.addEventListener("offline", updateOnlineStatus);
updateOnlineStatus();

// ---- Stage buttons ----
document.querySelectorAll("[data-stage-btn]").forEach((btn) => {
  btn.addEventListener("click", () => logStage(btn.dataset.stageBtn));
});

function logStage(stageKey) {
  if (state.stages[stageKey]) {
    showToast(STAGE_LABELS[stageKey] + " already logged");
    return;
  }

  const now = new Date();
  const timeStr = formatTime(now);
  state.stages[stageKey] = { time: timeStr, iso: now.toISOString() };

  updateStageCard(stageKey);
  showToast(STAGE_LABELS[stageKey] + " logged at " + timeStr);
  renderReport();

  // At-scene and at-base stages also capture GPS automatically, since those
  // are the two points a location matters most for the report.
  if (stageKey === "atScene" || stageKey === "atBase") {
    captureGeolocation(stageKey);
  }
}

function updateStageCard(stageKey) {
  const card = document.querySelector('.stage-card[data-stage="' + stageKey + '"]');
  const btn = card.querySelector("[data-stage-btn]");
  const timeEl = card.querySelector('[data-time-for="' + stageKey + '"]');

  card.classList.remove("active");
  card.classList.add("done");
  btn.textContent = "Logged";
  btn.disabled = true;
  timeEl.textContent = state.stages[stageKey].time;

  const idx = STAGE_ORDER.indexOf(stageKey);
  const next = STAGE_ORDER[idx + 1];
  if (next) {
    document.querySelector('.stage-card[data-stage="' + next + '"]').classList.add("active");
  }
}

// Mark the first stage as active on load
document.querySelector('.stage-card[data-stage="enRoute"]').classList.add("active");

// ---- Geolocation ----
document.getElementById("btn-mark-location").addEventListener("click", () => {
  if (!navigator.geolocation) {
    showToast("GPS not available on this device");
    return;
  }
  showToast("Getting location…");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      state.markedLocation = {
        lat: pos.coords.latitude.toFixed(6),
        lng: pos.coords.longitude.toFixed(6)
      };
      const current = els.locationText.value.trim();
      els.locationText.value = current
        ? current
        : state.markedLocation.lat + ", " + state.markedLocation.lng;
      showToast("Location marked");
      renderReport();
    },
    () => showToast("Could not get GPS location"),
    { enableHighAccuracy: true, timeout: 10000 }
  );
});

function captureGeolocation(stageKey) {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      state.stages[stageKey].lat = pos.coords.latitude.toFixed(6);
      state.stages[stageKey].lng = pos.coords.longitude.toFixed(6);
      if (stageKey === "atScene" && !state.markedLocation) {
        state.markedLocation = { lat: state.stages[stageKey].lat, lng: state.stages[stageKey].lng };
        if (!els.locationText.value.trim()) {
          els.locationText.value = state.markedLocation.lat + ", " + state.markedLocation.lng;
        }
      }
      renderReport();
    },
    () => {},
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

// ---- Report text ----
function formatTime(d) {
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

function todayISO() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function buildReport() {
  const s = state.stages;
  const lines = [
    "Date: " + todayISO(),
    "Case ID: " + (els.caseId.value.trim() || "-"),
    "Location: " + (els.locationText.value.trim() || "-"),
    "Case type: " + (els.caseType.value.trim() || "-"),
    "En route: " + (s.enRoute ? s.enRoute.time : "-"),
    "At scene: " + (s.atScene ? s.atScene.time : "-"),
    "Depart: " + (s.depart ? s.depart.time : "-"),
    "",
    "Management notes during transportation:",
    els.notes.value.trim() || "-",
    "",
    "At hospital: " + (s.atHospital ? s.atHospital.time : "-") + (els.hospital.value.trim() ? " (" + els.hospital.value.trim() + ")" : ""),
    "Outcome: " + els.outcome.value,
    "At base: " + (s.atBase ? s.atBase.time : "-"),
    "",
    "Ambulance team",
    "AMO: " + (els.amo.value.trim() || "-"),
    "Pilot: " + (els.pilot.value.trim() || "-"),
    "Voice recording file: -",
    "-end of report-"
  ];
  return lines.join("\n");
}

function renderReport() {
  els.reportText.textContent = buildReport();
}

[els.caseId, els.locationText, els.caseType, els.amo, els.pilot, els.hospital, els.notes].forEach((el) => {
  el.addEventListener("input", renderReport);
});
els.outcome.addEventListener("change", renderReport);
renderReport();

// ---- Copy / WhatsApp ----
document.getElementById("btn-copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(buildReport());
    showToast("Report copied");
  } catch (e) {
    showToast("Could not copy — select text manually");
  }
});

document.getElementById("btn-whatsapp").addEventListener("click", () => {
  const text = encodeURIComponent(buildReport());
  window.open("https://wa.me/?text=" + text, "_blank");
});

// ---- Submit to backend ----
document.getElementById("btn-submit").addEventListener("click", async () => {
  if (BACKEND_URL.indexOf("PUT_YOUR") === 0) {
    showToast("Backend URL not configured yet");
    return;
  }

  showOverlay("Saving case…");

  const s = state.stages;
  const payload = {
    date: todayISO(),
    caseId: els.caseId.value.trim(),
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
    amo: els.amo.value.trim(),
    pilot: els.pilot.value.trim(),
    recordingUrl: ""
  };

  try {
    await fetch(BACKEND_URL, {
      method: "POST",
      body: JSON.stringify(payload)
    });
    showToast("Case saved to sheet");
  } catch (e) {
    showToast("Save failed — check connection");
  } finally {
    hideOverlay();
  }
});

// ---- Overlay / toast helpers ----
function showOverlay(label) {
  els.loadingLabel.textContent = label;
  els.overlay.classList.add("visible");
}
function hideOverlay() {
  els.overlay.classList.remove("visible");
}

let toastTimer;
function showToast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove("visible"), 2200);
}
