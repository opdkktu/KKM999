/* KKM999 — ambulance marker that glides and turns like a running / navigation app.
   Used by track.js (live map on the responder phone) and tracks.html (admin replay).
   Amb.create(map, {follow:true}) → { move(lat,lng,ms), setHeading(deg), place(lat,lng,deg), follow(bool), el, pos() } */
(function () {
  const SVG =
    '<svg viewBox="0 0 40 64" width="34" height="54" xmlns="http://www.w3.org/2000/svg">' +
    '<ellipse cx="20" cy="36" rx="17" ry="25" fill="rgba(0,0,0,.28)"/>' +
    '<rect x="5" y="6" width="30" height="52" rx="8" fill="#fff" stroke="#1b2b27" stroke-width="2"/>' +
    '<rect x="8" y="10" width="24" height="11" rx="4" fill="#9fd3e8" stroke="#1b2b27" stroke-width="1.2"/>' +
    '<rect x="5" y="23" width="30" height="5" fill="#E6483F"/>' +
    '<path d="M20 32v18M11 41h18" stroke="#E6483F" stroke-width="5" stroke-linecap="round"/>' +
    '<rect x="9" y="26" width="8" height="3.4" rx="1.4" class="amb-l1"/><rect x="23" y="26" width="8" height="3.4" rx="1.4" class="amb-l2"/>' +
    '</svg>';

  function css() {
    if (document.getElementById("amb-css")) return;
    const s = document.createElement("style"); s.id = "amb-css";
    s.textContent =
      ".amb-wrap{position:relative;width:54px;height:54px}" +
      ".amb-rot{position:absolute;left:50%;top:50%;width:34px;height:54px;margin:-27px 0 0 -17px;transition:none;will-change:transform}" +
      ".amb-pulse{position:absolute;left:50%;top:50%;width:54px;height:54px;margin:-27px 0 0 -27px;border-radius:50%;background:rgba(28,143,132,.28);animation:ambp 1.8s ease-out infinite}" +
      "@keyframes ambp{0%{transform:scale(.55);opacity:.9}100%{transform:scale(1.5);opacity:0}}" +
      ".amb-l1{fill:#1d7fd1;animation:ambb 0.7s steps(1) infinite}.amb-l2{fill:#E6483F;animation:ambb 0.7s steps(1) infinite reverse}" +
      "@keyframes ambb{0%{opacity:1}50%{opacity:.15}}" +
      "@media (prefers-reduced-motion:reduce){.amb-pulse,.amb-l1,.amb-l2{animation:none}}";
    document.head.appendChild(s);
  }
  const ease = t => t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  const bearing = (a, b) => { const r = Math.PI / 180, y = Math.sin((b[1] - a[1]) * r) * Math.cos(b[0] * r), x = Math.cos(a[0] * r) * Math.sin(b[0] * r) - Math.sin(a[0] * r) * Math.cos(b[0] * r) * Math.cos((b[1] - a[1]) * r); return (Math.atan2(y, x) / r + 360) % 360; };
  const angDiff = (a, b) => ((b - a + 540) % 360) - 180;

  function create(map, opts) {
    css(); opts = opts || {};
    const html = '<div class="amb-wrap"><div class="amb-pulse"></div><div class="amb-rot">' + SVG + '</div></div>';
    const marker = L.marker([0, 0], { icon: L.divIcon({ className: "", html: html, iconSize: [54, 54], iconAnchor: [27, 27] }), interactive: false, keyboard: false, zIndexOffset: 1000 });
    let pos = null, heading = 0, raf = 0, following = opts.follow !== false, added = false;
    const rot = () => { const e = marker.getElement(); return e && e.querySelector(".amb-rot"); };
    const applyHeading = () => { const r = rot(); if (r) r.style.transform = "rotate(" + heading.toFixed(1) + "deg)"; };
    function ensure(ll) { if (!added) { marker.setLatLng(ll).addTo(map); added = true; } }
    function place(lat, lng, deg) { pos = [lat, lng]; if (deg != null) heading = deg; ensure(pos); marker.setLatLng(pos); applyHeading(); if (following) map.panTo(pos, { animate: false }); }
    function move(lat, lng, ms) {
      const to = [lat, lng];
      if (!pos) { place(lat, lng); return; }
      cancelAnimationFrame(raf);
      const from = pos.slice(), dm = L.latLng(from).distanceTo(L.latLng(to));
      if (dm < 1.5) return;
      const target = dm > 4 ? bearing(from, to) : heading, h0 = heading, dh = angDiff(h0, target), t0 = performance.now(), dur = Math.max(250, ms || 1000);
      const step = now => {
        const k = Math.min(1, (now - t0) / dur), e = k;                 // linear for position (constant speed looks like real driving)
        pos = [from[0] + (to[0] - from[0]) * e, from[1] + (to[1] - from[1]) * e];
        heading = (h0 + dh * ease(Math.min(1, k * 2.2)) + 360) % 360;   // turn quickly at the start of the segment
        marker.setLatLng(pos); applyHeading();
        if (following) map.panTo(pos, { animate: false });
        if (k < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }
    return {
      marker: marker, place: place, move: move,
      setHeading: d => { heading = d; applyHeading(); },
      follow: f => { following = !!f; if (f && pos) map.panTo(pos); },
      isFollowing: () => following, pos: () => pos, heading: () => heading,
      remove: () => { cancelAnimationFrame(raf); if (added) { map.removeLayer(marker); added = false; } pos = null; }
    };
  }
  /* Strava-style trail: white casing under a coloured line, drawn as short segments coloured by speed (green slow → red fast). */
  function speedColor(kmh) { const t = Math.max(0, Math.min(1, (kmh - 5) / 75)), h = 130 - 130 * t; return "hsl(" + h + ",78%,45%)"; }
  window.Amb = { create: create, bearing: bearing, speedColor: speedColor };
})();
