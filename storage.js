/**
 * IndexedDB storage for offline resilience.
 *
 * Three stores:
 *   cases  — one record per case, latest state. Upserted, so last write wins,
 *            matching how the backend upserts by Case UID.
 *   audio  — recordings and their chunks. Chunks are written DURING recording,
 *            so an interrupted recording is still recoverable.
 *   meta   — settings (staff list cache, hospital coordinate overrides, key).
 */

const DB_NAME = "ambulance-report";
const DB_VERSION = 1;

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise(function (resolve, reject) {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = function (e) {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("cases")) {
        db.createObjectStore("cases", { keyPath: "caseUid" });
      }
      if (!db.objectStoreNames.contains("audio")) {
        const store = db.createObjectStore("audio", { keyPath: "id" });
        store.createIndex("state", "state", { unique: false });
      }
      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta", { keyPath: "key" });
      }
    };
    req.onsuccess = function () { resolve(req.result); };
    req.onerror = function () { reject(req.error); };
  });
  return dbPromise;
}

function tx(storeName, mode, fn) {
  return openDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      const transaction = db.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      let result;
      try {
        result = fn(store);
      } catch (e) {
        reject(e);
        return;
      }
      transaction.oncomplete = function () {
        resolve(result && result.result !== undefined ? result.result : result);
      };
      transaction.onerror = function () { reject(transaction.error); };
    });
  });
}

const Store = {
  /* ---- Cases ---- */
  putCase: function (record) {
    return tx("cases", "readwrite", function (s) { return s.put(record); });
  },
  getCase: function (uid) {
    return tx("cases", "readonly", function (s) { return s.get(uid); });
  },
  allCases: function () {
    return tx("cases", "readonly", function (s) { return s.getAll(); });
  },
  deleteCase: function (uid) {
    return tx("cases", "readwrite", function (s) { return s.delete(uid); });
  },

  /* ---- Audio ---- */
  putAudio: function (record) {
    return tx("audio", "readwrite", function (s) { return s.put(record); });
  },
  getAudio: function (id) {
    return tx("audio", "readonly", function (s) { return s.get(id); });
  },
  allAudio: function () {
    return tx("audio", "readonly", function (s) { return s.getAll(); });
  },
  deleteAudio: function (id) {
    return tx("audio", "readwrite", function (s) { return s.delete(id); });
  },

  /* ---- Meta / settings ---- */
  setMeta: function (key, value) {
    return tx("meta", "readwrite", function (s) { return s.put({ key: key, value: value }); });
  },
  getMeta: function (key) {
    return tx("meta", "readonly", function (s) { return s.get(key); }).then(function (r) {
      return r ? r.value : null;
    });
  }
};
