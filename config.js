/**
 * Editable configuration.
 *
 * COORDINATES BELOW ARE APPROXIMATE — verify them before relying on auto-detect.
 * Easiest way: open the app at each location, go to Settings, and tap
 * "Set from my current location" next to that hospital. That writes exact
 * coordinates to the device and overrides whatever is listed here.
 */

const CONFIG = {
  // Radius in metres within which a GPS fix counts as "at" a location.
  // 800m is generous enough for large hospital compounds and GPS drift.
  MATCH_RADIUS_M: 800,

  HOSPITALS: [
    { name: "Hospital Jitra", lat: 6.26830, lng: 100.42220 },
    { name: "Hospital Sultanah Bahiyah", lat: 6.16200, lng: 100.36400 }
  ],

  // Your clinic / ambulance base. Used to auto-confirm the At Base stage.
  BASE: { name: "Klinik Kesihatan Ayer Hitam", lat: 6.20000, lng: 100.43000 },

  // Audio: mono Opus at a low bitrate. A 3-minute note lands around 360KB,
  // which uploads over weak mobile data in a single request.
  AUDIO_BITRATE: 16000,

  // Recording is written to IndexedDB in chunks this often, so a crash or
  // dead battery mid-transport loses at most this many milliseconds.
  CHUNK_MS: 10000,

  // How often the offline queue retries while there is a connection.
  SYNC_INTERVAL_MS: 20000
};
