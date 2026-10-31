(function () {
  const $ = id => document.getElementById(id);
  let map, line, dot, watchId = null, wake = null, timer = null, flushT = null;
  let pts = [], buf = [], runUid = "", t0 = 0, dist = 0;

  function ensureMap() {
    if (map) return;
    map = L.map("trk-map", { zoomControl: false }).setView([6.2, 100.43], 16);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(map);
    line = L.polyline([], { color: "#0F5C56", weight: 6 }).addTo(map);
    dot = L.circleMarker([0, 0], { radius: 9, color: "#fff", weight: 3, fillColor: "#1C8F84", fillOpacity: 1 });
  }
  function hav(a, b) {
    const R = 6371000, r = Math.PI / 180, dLa = (b.lat - a.lat) * r, dLo = (b.lng - a.lng) * r;
    const x = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) ** 2;
    return 2 * 6371000 * Math.asin(Math.sqrt(x));
  }
  function render() {
    const s = Math.floor((Date.now() - t0) / 1000), h = dist / 1000, hrs = s / 3600;
    $("trk-dist").textContent = h.toFixed(2) + " km";
    $("trk-time").textContent = String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
    $("trk-spd").textContent = (hrs > 0 ? h / hrs : 0).toFixed(1) + " km/h";
  }
  function onPos(p) {
    const c = p.coords;
    if (c.accuracy > 50) return;                       // ignore poor GPS fixes
    const pt = { lat: c.latitude, lng: c.longitude, acc: Math.round(c.accuracy), spd: c.speed, t: Date.now() };
    const last = pts[pts.length - 1];
    if (last) { const d = hav(last, pt); if (d < 5) return; dist += d; }
    pts.push(pt); buf.push(pt);
    const ll = [pt.lat, pt.lng];
    line.addLatLng(ll); dot.setLatLng(ll); if (!map.hasLayer(dot)) dot.addTo(map);
    map.panTo(ll); render();
  }
  async function flush() {
    if (!buf.length) return;
    const batch = buf.splice(0, 500);
    try {
      const r = await callBackend("saveTrack", { runUid: runUid, points: batch });
      if (r.status !== "ok") throw new Error(r.message);
    } catch (e) { buf = batch.concat(buf); }           // keep and retry next time
  }
  async function keepAwake() {
    try { wake = await navigator.wakeLock.request("screen"); } catch (e) {}
  }
  document.addEventListener("visibilitychange", () => { if (watchId !== null && !document.hidden) keepAwake(); });

  function start() {
    if (!HR_TOKEN()) { showToast("Open this from SIAGA to track"); return; }
    if (!localStorage.getItem("trk_consent")) {
      if (!confirm("Your location will be recorded and saved while tracking is ON, linked to your name. Stop any time.")) return;
      localStorage.setItem("trk_consent", "1");
    }
    pts = []; buf = []; dist = 0; t0 = Date.now(); runUid = "RUN-" + t0;
    line.setLatLngs([]);
    watchId = navigator.geolocation.watchPosition(onPos, e => showToast("GPS: " + e.message),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
    timer = setInterval(render, 1000); flushT = setInterval(flush, 20000);
    keepAwake();
    $("trk-toggle").textContent = "■ Stop"; $("btn-track").textContent = "📍●";
  }
  async function stop() {
    navigator.geolocation.clearWatch(watchId); watchId = null;
    clearInterval(timer); clearInterval(flushT);
    if (wake) { wake.release(); wake = null; }
    await flush();
    $("trk-toggle").textContent = "▶ Start"; $("btn-track").textContent = "📍";
  }
  $("btn-track").addEventListener("click", () => { $("trk").hidden = false; ensureMap(); setTimeout(() => map.invalidateSize(), 50); });
  $("trk-close").addEventListener("click", () => { $("trk").hidden = true; });   // tracking keeps running
  $("trk-toggle").addEventListener("click", () => (watchId === null ? start() : stop()));
})();
