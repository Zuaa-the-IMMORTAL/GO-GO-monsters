const STORAGE_KEY = "campus_go_ar_motion_v2";
const FALLBACK_COORDS = { lat: 3.5952, lng: 98.6722 };

let map = null;
let playerMarker = null;
let radarCircle = null;
let playerCoords = null;
let radarRadiusMeters = 65;
let creaturesConfig = [];
let mapMarkers = [];
let respawnTimers = [];
let selectedCreature = null;
let cameraStream = null;
let simulationMode = false;
let isThrowingOrb = false;
let audioCtx = null;

// Data untuk mendeteksi gerakan kamera secara optik (perbandingan frame video)
let prevFrameData = null;

let arSession = {
  active: false,
  offsetX: 195,
  offsetY: -25,
  targetX: 195,
  targetY: -25,
  baseGamma: null,
  baseBeta: null,
  misses: 0,
  fleeing: false,
  fleeProgress: 0,
  fleeDirX: 1,
  fleeDirY: -0.6,
  captured: false,
  animFrameId: null,
  fleeTimeoutId: null,
  time: 0
};

let state = {
  score: 0,
  caught: []
};

function unlockAudio() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) audioCtx = new AudioContextClass();
  }
  if (audioCtx && audioCtx.state === "suspended") {
    audioCtx.resume();
  }
}

// Efek suara lengkap (scan, gerak/lari/terbang, lempar, menghindar, kabur, menang)
function playSound(kind) {
  try {
    unlockAudio();
    if (!audioCtx) return;

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    const now = audioCtx.currentTime;
    if (kind === "scan") {
      osc.type = "sine";
      osc.frequency.setValueAtTime(420, now);
      osc.frequency.exponentialRampToValueAtTime(700, now + 0.16);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      osc.start(now);
      osc.stop(now + 0.18);
    } else if (kind === "throw") {
      osc.type = "sine";
      osc.frequency.setValueAtTime(340, now);
      osc.frequency.exponentialRampToValueAtTime(860, now + 0.24);
      gain.gain.setValueAtTime(0.16, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
      osc.start(now);
      osc.stop(now + 0.26);
    } else if (kind === "win") {
      osc.type = "triangle";
      osc.frequency.setValueAtTime(523.25, now);
      osc.frequency.setValueAtTime(659.25, now + 0.11);
      osc.frequency.setValueAtTime(783.99, now + 0.22);
      osc.frequency.setValueAtTime(1046.5, now + 0.34);
      gain.gain.setValueAtTime(0.22, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.56);
      osc.start(now);
      osc.stop(now + 0.56);
    } else if (kind === "evade") {
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(340, now);
      osc.frequency.exponentialRampToValueAtTime(190, now + 0.22);
      gain.gain.setValueAtTime(0.14, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
      osc.start(now);
      osc.stop(now + 0.24);
    } else if (kind === "flee_fly") {
      // Suara meluncur naik/menjauh seperti terbang kabur
      osc.type = "sine";
      osc.frequency.setValueAtTime(580, now);
      osc.frequency.exponentialRampToValueAtTime(220, now + 0.55);
      gain.gain.setValueAtTime(0.16, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.58);
      osc.start(now);
      osc.stop(now + 0.58);
    } else if (kind === "flee_run") {
      // Suara langkah cepat menjauh seperti berlari kabur
      osc.type = "square";
      osc.frequency.setValueAtTime(260, now);
      osc.frequency.linearRampToValueAtTime(140, now + 0.45);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.48);
      osc.start(now);
      osc.stop(now + 0.48);
    } else {
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.linearRampToValueAtTime(120, now + 0.28);
      gain.gain.setValueAtTime(0.13, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      osc.start(now);
      osc.stop(now + 0.3);
    }
  } catch (err) {
    console.warn("Audio gagal:", err);
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      state.score = parsed.score || 0;
      state.caught = Array.isArray(parsed.caught) ? parsed.caught : [];
    }
  } catch (err) {
    console.warn("Gagal memuat state:", err);
  }
  renderHud();
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  renderHud();
}

function renderHud() {
  document.getElementById("score-value").textContent = state.score;
  document.getElementById("inv-count").textContent = state.caught.length;
  document.getElementById("modal-score-info").textContent = `Skor: ${state.score}`;
}

function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function fetchCreatures() {
  const res = await fetch("creatures.json");
  if (!res.ok) throw new Error("Gagal memuat creatures.json");
  const data = await res.json();
  radarRadiusMeters = data.radarRadiusMeters || 65;
  return data.creatures || [];
}

function clearMapMarkers() {
  mapMarkers.forEach((m) => {
    if (map && m) map.removeLayer(m);
  });
  mapMarkers = [];
}

function clearRespawnTimers() {
  respawnTimers.forEach((id) => clearTimeout(id));
  respawnTimers = [];
}

// Menjadwalkan hewan yang kabur agar muncul kembali di peta
function scheduleRespawn(creature) {
  const delay = creature.respawnMs || 12000;
  const timerId = setTimeout(() => {
    if (!map || !playerCoords) return;
    const stillCaught = state.caught.some((c) => c.id === creature.id);
    if (stillCaught) return;

    const angle = Math.random() * Math.PI * 2;
    const distDeg = 0.00012;
    const newLat = playerCoords.lat + Math.sin(angle) * distDeg;
    const newLng = playerCoords.lng + Math.cos(angle) * distDeg;

    const icon = L.divIcon({
      className: "radar-orb-pin",
      html: `<div class="map-orb-marker" style="background:${creature.coreColor};"></div>`,
      iconSize: [28, 28]
    });

    const marker = L.marker([newLat, newLng], { icon }).addTo(map);
    mapMarkers.push(marker);

    const revivedObj = {
      ...creature,
      lat: newLat,
      lng: newLng,
      marker,
      caught: false
    };
    marker.on("click", () => selectCreature(revivedObj));
  }, delay);

  respawnTimers.push(timerId);
}

function spawnNearRadar(centerLat, centerLng) {
  clearMapMarkers();
  clearRespawnTimers();

  const offsets = [
    { dLat: 0.00010, dLng: 0.00009 },
    { dLat: -0.00010, dLng: 0.00010 },
    { dLat: 0.00009, dLng: -0.00011 },
    { dLat: -0.00011, dLng: -0.00009 }
  ];

  creaturesConfig.forEach((item, idx) => {
    const alreadyCaught = state.caught.some((c) => c.id === item.id);
    if (alreadyCaught) return;

    const off = offsets[idx % offsets.length];
    const lat = centerLat + off.dLat;
    const lng = centerLng + off.dLng;

    const icon = L.divIcon({
      className: "radar-orb-pin",
      html: `<div class="map-orb-marker" style="background:${item.coreColor};"></div>`,
      iconSize: [28, 28]
    });

    const marker = L.marker([lat, lng], { icon }).addTo(map);
    mapMarkers.push(marker);

    const obj = { ...item, lat, lng, marker, caught: false };
    marker.on("click", () => selectCreature(obj));
  });
}

function selectCreature(creature) {
  if (creature.caught || !playerCoords) return;
  selectedCreature = creature;

  const dist = distanceMeters(
    playerCoords.lat,
    playerCoords.lng,
    creature.lat,
    creature.lng
  );
  const inRange = dist <= radarRadiusMeters;

  document.getElementById("preview-name").textContent = `${creature.name} (+${creature.points})`;
  document.getElementById("preview-dist").textContent = inRange
    ? `Jarak ${Math.round(dist)}m • Sinyal terdeteksi di dekat radar`
    : `Jarak ${Math.round(dist)}m • Mendekat ke radar (${radarRadiusMeters}m)`;

  document.getElementById("open-cam-btn").disabled = !inRange;
  document.getElementById("creature-preview").classList.remove("hidden");
}

document.getElementById("close-preview-btn").addEventListener("click", () => {
  document.getElementById("creature-preview").classList.add("hidden");
  selectedCreature = null;
});

// Meminta izin orientasi gerak di iOS bila diperlukan
async function requestMotionPermissionIfNeeded() {
  if (
    typeof DeviceOrientationEvent !== "undefined" &&
    typeof DeviceOrientationEvent.requestPermission === "function"
  ) {
    try {
      await DeviceOrientationEvent.requestPermission();
    } catch (e) {
      console.warn("Izin orientasi perangkat tidak diberikan:", e);
    }
  }
}

async function openCamera() {
  const video = document.getElementById("camera-stream");
  prevFrameData = null;

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false
    });
    video.srcObject = cameraStream;
    await video.play();
  } catch (err) {
    console.warn("Kamera tidak aktif, pakai latar AR:", err);
  }
}

function closeCamera() {
  const video = document.getElementById("camera-stream");
  if (cameraStream) {
    cameraStream.getTracks().forEach((t) => t.stop());
    cameraStream = null;
  }
  video.srcObject = null;
  prevFrameData = null;

  if (arSession.animFrameId) cancelAnimationFrame(arSession.animFrameId);
  if (arSession.fleeTimeoutId) clearTimeout(arSession.fleeTimeoutId);
  arSession.active = false;
}

// Mendeteksi pergerakan kamera secara optik (selisih brightness kiri vs kanan antar-frame)
function sampleCameraMotion() {
  const video = document.getElementById("camera-stream");
  const sampler = document.getElementById("motion-sampler");
  if (!cameraStream || video.readyState < 2) return;

  const sctx = sampler.getContext("2d", { willReadFrequently: true });
  sctx.drawImage(video, 0, 0, sampler.width, sampler.height);
  const frame = sctx.getImageData(0, 0, sampler.width, sampler.height).data;

  if (!prevFrameData) {
    prevFrameData = new Uint8ClampedArray(frame);
    return;
  }

  let diffLeft = 0;
  let diffRight = 0;
  const midX = sampler.width / 2;

  for (let y = 0; y < sampler.height; y++) {
    for (let x = 0; x < sampler.width; x++) {
      const i = (y * sampler.width + x) * 4;
      const lumCurr = (frame[i] + frame[i + 1] + frame[i + 2]) / 3;
      const lumPrev = (prevFrameData[i] + prevFrameData[i + 1] + prevFrameData[i + 2]) / 3;
      const delta = Math.abs(lumCurr - lumPrev);
      if (delta > 16) {
        if (x < midX) diffLeft += delta;
        else diffRight += delta;
      }
    }
  }

  prevFrameData.set(frame);

  // Jika kamera digerakkan ke kiri/kanan, geser target posisi monster di ruang AR
  const diffTotal = diffLeft + diffRight;
  if (diffTotal > 1800 && !arSession.fleeing && !arSession.captured) {
    const balance = (diffRight - diffLeft) / (diffTotal + 1);
    arSession.targetX = Math.max(-210, Math.min(210, arSession.targetX - balance * 55));
  }
}

// Menggambar hewan yang bisa berlari ("run") atau terbang ("fly") secara alami
function drawAnimalCreature(ctx, creature, cx, cy, t, fleeProgress = 0, fleeDirX = 1, fleeDirY = -0.6) {
  const isFly = creature.moveType === "fly";

  // Saat kabur: bergerak menjauh dan mengecil secara alami
  const fleeScale = 1 - fleeProgress * 0.72;
  const fleeAlpha = Math.max(0, 1 - fleeProgress);
  const moveX = cx + fleeProgress * fleeDirX * 190;
  const moveY = cy + fleeProgress * fleeDirY * 160;

  ctx.save();
  ctx.globalAlpha = fleeAlpha;
  ctx.translate(moveX, moveY);
  ctx.scale(fleeScale, fleeScale);

  // Hadap ke arah gerak kabur bila sedang kabur
  if (fleeProgress > 0 && Math.abs(fleeDirX) > 0.1) {
    ctx.scale(fleeDirX < 0 ? -1 : 1, 1);
  }

  const speedMult = fleeProgress > 0 ? 2.4 : 1;
  const bob = isFly
    ? Math.sin(t * 4.5 * speedMult) * 14
    : Math.abs(Math.sin(t * 6.5 * speedMult)) * -10;
  const tilt = isFly
    ? Math.sin(t * 3.5 * speedMult) * 0.18
    : Math.cos(t * 6.5 * speedMult) * 0.1;

  ctx.translate(0, bob);
  ctx.rotate(tilt);

  // Aura cahaya lembut
  const aura = ctx.createRadialGradient(0, 8, 8, 0, 8, 72);
  aura.addColorStop(0, creature.accentColor + "77");
  aura.addColorStop(1, "transparent");
  ctx.fillStyle = aura;
  ctx.beginPath();
  ctx.arc(0, 8, 72, 0, Math.PI * 2);
  ctx.fill();

  // Sayap bila tipe terbang ("fly")
  if (isFly) {
    const flap = Math.sin(t * 11 * speedMult) * 0.55;
    [-1, 1].forEach((side) => {
      ctx.save();
      ctx.translate(side * 28, -6);
      ctx.rotate(side * (-0.35 + flap));
      ctx.fillStyle = creature.accentColor;
      ctx.beginPath();
      ctx.ellipse(side * 22, -6, 26, 12, side * -0.25, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }

  // Badan hewan 3D bergradasi
  const bodyGrad = ctx.createRadialGradient(-16, -20, 8, 0, 0, 52);
  bodyGrad.addColorStop(0, "#ffffff");
  bodyGrad.addColorStop(0.28, creature.coreColor);
  bodyGrad.addColorStop(1, "#0f172a");

  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.ellipse(0, 4, 44, 36, 0, 0, Math.PI * 2);
  ctx.fill();

  // Telinga / tanduk hewan
  const earSwing = Math.sin(t * 6 * speedMult) * 0.2;
  [-1, 1].forEach((side) => {
    ctx.save();
    ctx.translate(side * 20, -28);
    ctx.rotate(side * 0.32 + earSwing);
    ctx.fillStyle = creature.coreColor;
    ctx.beginPath();
    ctx.ellipse(0, -13, 9, 20, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });

  // Kaki berlari ("run") atau kaki menggantung ("fly")
  const stride = Math.sin(t * 10 * speedMult) * (isFly ? 3 : 13);
  ctx.fillStyle = creature.coreColor;
  ctx.beginPath();
  ctx.arc(-18 + stride, 36, 8.5, 0, Math.PI * 2);
  ctx.arc(18 - stride, 36, 8.5, 0, Math.PI * 2);
  ctx.fill();

  // Mata
  ctx.fillStyle = "#090d16";
  ctx.beginPath();
  ctx.arc(-13, -4, 6, 0, Math.PI * 2);
  ctx.arc(13, -4, 6, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(-15, -6, 2.3, 0, Math.PI * 2);
  ctx.arc(11, -6, 2.3, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function isCreatureCentered() {
  if (arSession.fleeing || arSession.captured) return false;
  return Math.abs(arSession.offsetX) < 55 && Math.abs(arSession.offsetY) < 55;
}

function updateCompassHint() {
  const compassEl = document.getElementById("compass-text");
  const statusEl = document.getElementById("hunt-status");

  if (arSession.fleeing) {
    const actionLabel = selectedCreature && selectedCreature.moveType === "fly"
      ? "terbang menjauh"
      : "berlari menjauh";
    compassEl.textContent = `Makhluk ${actionLabel}!`;
    statusEl.textContent = "Akan muncul kembali di peta beberapa saat lagi...";
    return;
  }

  if (arSession.captured) {
    compassEl.textContent = "Tertangkap!";
    return;
  }

  if (isCreatureCentered()) {
    compassEl.textContent = "🎯 Target terlihat di kamera!";
    statusEl.textContent = "Monster terlihat! Ketuk atau swipe ↑ Orb Kristal.";
  } else if (arSession.offsetX > 55) {
    compassEl.textContent = "◀ Arahkan kamera HP ke KANAN untuk mencari";
    statusEl.textContent = "Gerakkan kamera ke kanan agar monster masuk ke pandangan...";
  } else if (arSession.offsetX < -55) {
    compassEl.textContent = "▶ Arahkan kamera HP ke KIRI untuk mencari";
    statusEl.textContent = "Gerakkan kamera ke kiri agar monster masuk ke pandangan...";
  } else {
    compassEl.textContent = "↕ Gerakkan kamera HP perlahan untuk mengunci target";
    statusEl.textContent = "Mencari monster di sekitar kamera...";
  }
}

function startFleeAndRespawn(reasonLabel = "Monster kabur!") {
  if (arSession.fleeing || arSession.captured || !selectedCreature) return;

  arSession.fleeing = true;
  arSession.fleeProgress = 0;
  arSession.fleeDirX = Math.random() < 0.5 ? 1 : -1;
  arSession.fleeDirY = selectedCreature.moveType === "fly" ? -0.95 : 0.25;

  playSound(selectedCreature.moveType === "fly" ? "flee_fly" : "flee_run");
  updateCompassHint();
  document.getElementById("hunt-status").textContent =
    `${reasonLabel} Akan muncul kembali di peta...`;

  if (selectedCreature.marker && map) {
    map.removeLayer(selectedCreature.marker);
  }
  scheduleRespawn(selectedCreature);

  setTimeout(() => {
    closeCamera();
    document.getElementById("hunt-view").classList.add("hidden");
    selectedCreature = null;
  }, 1350);
}

function evadeWithinView() {
  if (arSession.fleeing || arSession.captured || !selectedCreature) return;

  arSession.misses += 1;
  const maxMisses = selectedCreature.fleeAfterMisses || 3;

  if (arSession.misses >= maxMisses) {
    startFleeAndRespawn(`${selectedCreature.name} menghilang kabur!`);
    return;
  }

  const dir = arSession.offsetX >= 0 ? -1 : 1;
  arSession.targetX = dir * (165 + Math.random() * 45);
  arSession.targetY = (Math.random() - 0.5) * 80;
  playSound("evade");
  document.getElementById("hunt-status").textContent =
    `${selectedCreature.name} menghindar (${arSession.misses}/${maxMisses}) — gerakkan kamera lagi!`;
}

function startArLoop() {
  const canvas = document.getElementById("creature-canvas");
  const ctx = canvas.getContext("2d");

  const render = () => {
    if (!arSession.active) return;
    arSession.time += 0.035;

    sampleCameraMotion();

    if (arSession.fleeing) {
      arSession.fleeProgress = Math.min(1, arSession.fleeProgress + 0.025);
    } else {
      arSession.offsetX += (arSession.targetX - arSession.offsetX) * 0.12;
      arSession.offsetY += (arSession.targetY - arSession.offsetY) * 0.12;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (selectedCreature) {
      drawAnimalCreature(
        ctx,
        selectedCreature,
        canvas.width / 2 + arSession.offsetX,
        canvas.height / 2 + arSession.offsetY,
        arSession.time,
        arSession.fleeProgress,
        arSession.fleeDirX,
        arSession.fleeDirY
      );
    }

    updateCompassHint();
    arSession.animFrameId = requestAnimationFrame(render);
  };

  arSession.animFrameId = requestAnimationFrame(render);

  // Jika tidak ditangkap dalam 18 detik, monster berlari/terbang menjauh & bisa muncul lagi di peta
  if (arSession.fleeTimeoutId) clearTimeout(arSession.fleeTimeoutId);
  arSession.fleeTimeoutId = setTimeout(() => {
    if (!arSession.captured && !arSession.fleeing) {
      startFleeAndRespawn("Waktu habis, monster kabur!");
    }
  }, 18000);
}

document.getElementById("open-cam-btn").addEventListener("click", async () => {
  if (!selectedCreature) return;
  unlockAudio();
  await requestMotionPermissionIfNeeded();
  playSound("scan");

  const startSide = Math.random() < 0.5 ? 195 : -195;
  arSession = {
    active: true,
    offsetX: startSide,
    offsetY: (Math.random() - 0.5) * 60,
    targetX: startSide,
    targetY: (Math.random() - 0.5) * 60,
    baseGamma: null,
    baseBeta: null,
    misses: 0,
    fleeing: false,
    fleeProgress: 0,
    fleeDirX: 1,
    fleeDirY: -0.6,
    captured: false,
    animFrameId: null,
    fleeTimeoutId: null,
    time: 0
  };

  document.getElementById("shine-ring").classList.add("hidden");
  document.getElementById("crystal-orb").classList.remove("orb-throwing");
  document.getElementById("hunt-title").textContent =
    `${selectedCreature.name} (+${selectedCreature.points} pts)`;

  document.getElementById("creature-preview").classList.add("hidden");
  document.getElementById("hunt-view").classList.remove("hidden");

  await openCamera();
  startArLoop();
});

// Gerakan orientasi kamera/perangkat HP (DeviceOrientationEvent)
window.addEventListener("deviceorientation", (e) => {
  if (!arSession.active || arSession.fleeing || e.gamma === null) return;

  if (arSession.baseGamma === null) {
    arSession.baseGamma = e.gamma;
    arSession.baseBeta = e.beta !== null ? e.beta : 60;
  }

  const deltaGamma = e.gamma - arSession.baseGamma;
  const deltaBeta = e.beta !== null ? e.beta - arSession.baseBeta : 0;

  arSession.targetX = Math.max(-210, Math.min(210, arSession.targetX - deltaGamma * 0.35));
  arSession.targetY = Math.max(-100, Math.min(100, arSession.targetY - deltaBeta * 0.2));
  arSession.baseGamma = e.gamma;
  if (e.beta !== null) arSession.baseBeta = e.beta;
});

document.getElementById("run-away-btn").addEventListener("click", () => {
  closeCamera();
  document.getElementById("hunt-view").classList.add("hidden");
  selectedCreature = null;
  isThrowingOrb = false;
});

function triggerShine() {
  const ring = document.getElementById("shine-ring");
  ring.classList.remove("hidden", "shine-active");
  void ring.offsetWidth;
  ring.classList.add("shine-active");
}

function throwCrystalOrb() {
  if (!selectedCreature || isThrowingOrb || arSession.fleeing || arSession.captured) return;

  const statusEl = document.getElementById("hunt-status");
  if (!isCreatureCentered()) {
    statusEl.textContent = "Gerakkan kamera HP hingga monster berada di tengah bidikan!";
    playSound("fail");
    return;
  }

  isThrowingOrb = true;
  const orb = document.getElementById("crystal-orb");
  orb.classList.remove("orb-throwing");
  void orb.offsetWidth;
  orb.classList.add("orb-throwing");
  playSound("throw");
  statusEl.textContent = "Melempar Orb Kristal...";

  setTimeout(() => {
    orb.classList.remove("orb-throwing");

    const evaded = Math.random() < (selectedCreature.evadeChance || 0.45);
    if (evaded) {
      isThrowingOrb = false;
      evadeWithinView();
      return;
    }

    const success = Math.random() < 0.78;
    if (success) {
      arSession.captured = true;
      selectedCreature.caught = true;
      if (selectedCreature.marker && map) {
        map.removeLayer(selectedCreature.marker);
      }

      state.score += selectedCreature.points;
      state.caught.push({
        id: selectedCreature.id,
        name: selectedCreature.name,
        species: selectedCreature.species,
        points: selectedCreature.points,
        time: new Date().toLocaleTimeString("id-ID")
      });
      saveState();

      playSound("win");
      triggerShine();
      if (navigator.vibrate) navigator.vibrate([120, 60, 180]);
      statusEl.textContent = `✨ Bersinar! ${selectedCreature.name} berhasil ditangkap (+${selectedCreature.points} pts)!`;

      setTimeout(() => {
        closeCamera();
        document.getElementById("hunt-view").classList.add("hidden");
        selectedCreature = null;
        isThrowingOrb = false;
      }, 1350);
    } else {
      isThrowingOrb = false;
      evadeWithinView();
    }
  }, 650);
}

const orbEl = document.getElementById("crystal-orb");
orbEl.addEventListener("click", throwCrystalOrb);

let orbStartY = null;
orbEl.addEventListener("touchstart", (e) => {
  orbStartY = e.touches[0].clientY;
});
orbEl.addEventListener("touchend", (e) => {
  if (orbStartY === null) return;
  if (orbStartY - e.changedTouches[0].clientY > 25) {
    throwCrystalOrb();
  }
  orbStartY = null;
});

document.getElementById("radar-btn").addEventListener("click", () => {
  if (playerCoords && map) spawnNearRadar(playerCoords.lat, playerCoords.lng);
});

document.getElementById("center-btn").addEventListener("click", () => {
  if (map && playerCoords) map.setView([playerCoords.lat, playerCoords.lng], 18);
});

const simBtn = document.getElementById("sim-btn");
const simPad = document.getElementById("sim-pad");

simBtn.addEventListener("click", () => {
  simulationMode = !simulationMode;
  simBtn.textContent = simulationMode ? "🚶 Simulasi: ON" : "🚶 Simulasi: OFF";
  simBtn.classList.toggle("sim-on", simulationMode);
  simPad.classList.toggle("hidden", !simulationMode);
});

simPad.querySelectorAll("button[data-dlat]").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (!playerCoords) return;
    updatePlayerPosition(
      playerCoords.lat + parseFloat(btn.dataset.dlat),
      playerCoords.lng + parseFloat(btn.dataset.dlng),
      "Simulasi"
    );
  });
});

document.getElementById("inv-btn").addEventListener("click", () => {
  const list = document.getElementById("inventory-list");
  list.innerHTML = "";

  if (state.caught.length === 0) {
    list.innerHTML = "<li>Belum ada makhluk yang tertangkap.</li>";
  } else {
    state.caught.forEach((c) => {
      const li = document.createElement("li");
      li.textContent = `${c.name} (${c.species}) — +${c.points} pts [${c.time}]`;
      list.appendChild(li);
    });
  }

  document.getElementById("inventory-modal").classList.remove("hidden");
});

document.getElementById("close-inv-btn").addEventListener("click", () => {
  document.getElementById("inventory-modal").classList.add("hidden");
});

document.getElementById("reset-data-btn").addEventListener("click", () => {
  localStorage.removeItem(STORAGE_KEY);
  state = { score: 0, caught: [] };
  renderHud();
  document.getElementById("inventory-list").innerHTML =
    "<li>Data direset. Makhluk dimunculkan ulang di radar.</li>";
  if (playerCoords && map) spawnNearRadar(playerCoords.lat, playerCoords.lng);
});

function updatePlayerPosition(lat, lng, sourceLabel = "GPS") {
  const isFirst = !playerCoords;
  playerCoords = { lat, lng };
  document.getElementById("gps-status").textContent =
    `${sourceLabel}: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;

  if (!map) {
    map = L.map("map").setView([lat, lng], 18);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap"
    }).addTo(map);

    radarCircle = L.circle([lat, lng], {
      radius: radarRadiusMeters,
      color: "#22d3ee",
      weight: 1.5,
      fillColor: "#22d3ee",
      fillOpacity: 0.12
    }).addTo(map);

    playerMarker = L.circleMarker([lat, lng], {
      radius: 9,
      color: "#ffffff",
      weight: 2,
      fillColor: "#22d3ee",
      fillOpacity: 1
    }).addTo(map);

    spawnNearRadar(lat, lng);
  } else {
    playerMarker.setLatLng([lat, lng]);
    if (radarCircle) radarCircle.setLatLng([lat, lng]);
    if (isFirst || simulationMode) map.panTo([lat, lng]);
  }
}

function startLocationTracking() {
  if (!navigator.geolocation) {
    updatePlayerPosition(FALLBACK_COORDS.lat, FALLBACK_COORDS.lng, "Radar");
    return;
  }

  navigator.geolocation.watchPosition(
    (pos) => {
      if (!simulationMode) {
        updatePlayerPosition(pos.coords.latitude, pos.coords.longitude, "GPS");
      }
    },
    () => {
      if (!playerCoords) {
        updatePlayerPosition(FALLBACK_COORDS.lat, FALLBACK_COORDS.lng, "Radar");
      }
    },
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
  );
}

document.getElementById("start-game-btn").addEventListener("click", async () => {
  unlockAudio();
  await requestMotionPermissionIfNeeded();
  document.getElementById("intro-screen").classList.add("hidden");
  document.getElementById("top-hud").classList.remove("hidden");

  loadState();
  try {
    creaturesConfig = await fetchCreatures();
  } catch (err) {
    document.getElementById("gps-status").textContent = err.message;
    return;
  }

  startLocationTracking();
});