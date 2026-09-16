/**
 * Editable configuration.
 *
 * COORDINATES BELOW ARE APPROXIMATE — verify them before relying on auto-detect.
 * Open the app at each location, go to Settings > Location calibration, tap Set.
 */

const CONFIG = {
  MATCH_RADIUS_M: 800,

  HOSPITALS: [
    { name: "Hospital Jitra", lat: 6.26830, lng: 100.42220 },
    { name: "Hospital Sultanah Bahiyah", lat: 6.16200, lng: 100.36400 }
  ],

  BASE: { name: "Klinik Kesihatan Ayer Hitam", lat: 6.20000, lng: 100.43000 },

  AUDIO_BITRATE: 16000,
  CHUNK_MS: 10000,
  SYNC_INTERVAL_MS: 20000,

  // Response-time KPI: en route -> at scene, in minutes.
  RESPONSE_KPI_MIN: 15,

  // Case priority (Malaysian triage).
  PRIORITIES: [
    { code: "P1", label: "P1", emoji: "🔴", desc: "Immediate / critical" },
    { code: "P2", label: "P2", emoji: "🟡", desc: "Urgent / semi-critical" },
    { code: "P3", label: "P3", emoji: "🟢", desc: "Non-urgent" },
    { code: "P4", label: "P4", emoji: "⬜", desc: "Expectant / deceased" }
  ],

  // Per-casualty triage zone, reported inside the MIST arrival line.
  ZONES: [
    { code: "Red", emoji: "🔴", label: "Red Zone" },
    { code: "Yellow", emoji: "🟡", label: "Yellow Zone" },
    { code: "Green", emoji: "🟢", label: "Green Zone" },
    { code: "White", emoji: "⬜", label: "White Zone" }
  ],

  O2_DELIVERY: ["room air", "nasal prong", "face mask", "high flow mask", "neb"],

  /* On-screen speaking guidance. Shown one step at a time while recording, so
     the responder keeps the correct flow under stress. Each step maps to a
     field Gemini extracts. */
  GUIDANCE: {
    trauma: {
      name: "MISTT (Trauma)",
      steps: [
        { key: "mechanism", letter: "M", title: "Mechanism", hint: "How did it happen?", example: "Motorcycle versus car, rider thrown about 10 metres, no helmet." },
        { key: "injury", letter: "I", title: "Injury", hint: "What and where — list each site", example: "Open fracture right tibia, abrasion left forearm, head injury with scalp laceration." },
        { key: "signs", letter: "S", title: "Signs", hint: "BP, pulse, SpO2 and oxygen, respiration, GCS", example: "BP 110 over 70, pulse 112, SpO2 94 percent on high flow mask, respiration 24, GCS 13." },
        { key: "treatment", letter: "T", title: "Treatment", hint: "What you did and gave", example: "Cervical collar applied, splint to right leg, IV line branula green, normal saline 500ml running." },
        { key: "arrival", letter: "T", title: "Time / Arrival", hint: "Zone colour and ETA", example: "Red zone, ETA 12 minutes to Hospital Sultanah Bahiyah." }
      ]
    },
    cva: {
      name: "BEFAST (Stroke)",
      steps: [
        { key: "balance", letter: "B", title: "Balance", hint: "Loss of balance or coordination?", example: "Sudden loss of balance, unable to stand without support." },
        { key: "eyes", letter: "E", title: "Eyes", hint: "Vision change?", example: "Blurred vision on the right side." },
        { key: "face", letter: "F", title: "Face", hint: "Facial symmetry", example: "Facial asymmetry, left side drooping." },
        { key: "arm", letter: "A", title: "Arm", hint: "Weakness — which side", example: "Left arm weakness, cannot lift against gravity." },
        { key: "speech", letter: "S", title: "Speech", hint: "Slurred or unable", example: "Slurred speech, still able to follow command." },
        { key: "onset", letter: "T", title: "Time of onset", hint: "When symptoms started — be exact", example: "Onset time 1330, witnessed by daughter." },
        { key: "signs", letter: "S", title: "Signs", hint: "BP and glucose are essential", example: "BP 180 over 100, glucose 7.2, pulse 88, SpO2 97 percent room air, GCS 14." },
        { key: "arrival", letter: "T", title: "Zone / ETA", hint: "Stroke activation and ETA", example: "Red zone, stroke activation, ETA 15 minutes." }
      ]
    },
    medical: {
      name: "Medical",
      steps: [
        { key: "mechanism", letter: "H", title: "History", hint: "Complaint and background", example: "Chest pain since 2 hours, known hypertension and diabetes." },
        { key: "injury", letter: "F", title: "Findings", hint: "What you observed", example: "Alert, diaphoretic, chest pain radiating to left arm." },
        { key: "signs", letter: "S", title: "Signs", hint: "BP, pulse, SpO2, respiration, glucose, GCS", example: "BP 150 over 90, pulse 96, SpO2 96 percent room air, respiration 20, glucose 8.1, GCS 15." },
        { key: "treatment", letter: "T", title: "Treatment", hint: "What you did and gave", example: "Oxygen 3 litre nasal prong, aspirin 300mg given, IV line set." },
        { key: "arrival", letter: "T", title: "Zone / ETA", hint: "Zone colour and ETA", example: "Yellow zone, ETA 10 minutes." }
      ]
    }
  }
};
