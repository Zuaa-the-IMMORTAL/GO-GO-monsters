const STORAGE_KEY = "campus_go_360_unlimited_full_v5";
const FALLBACK_COORDS = { lat: 3.5952, lng: 98.6722 };

let map = null;
let playerMarker = null;
let radarCircle = null;
let playerCoords = null;
let radarRadiusMeters = 65;
let creaturesConfig = [];
let activeCreatures = [];
let spawnCounter = 1;
let selectedCreature = null;
let cameraStream = null;
let simulationMode = false;
let isThrowingOrb = false;
let audioCtx = null;

let prevFrameData = null;
let lastPingTime = 0;

let ar360 = {
  active: false,
  cameraYaw: 0,
  cameraPitch: 0,
  creatureYaw: 180,
  roamDir: 1,
  baseAlpha: null,
  lastGamma: null,
  lastBeta: null,
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

function normalize360(deg) {
  return ((deg % 360) + 360) % 360;
}

function signedAngleDiff(targetDeg, currentDeg) {
  let diff = normalize360(targetDeg) - normalize360(currentDeg);
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  return diff;
}

function unlockAudio() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) audioCtx = new AudioContextClass();
  }
  if (audioCtx && audioCtx.state === "suspended") {
    audioCtx.resume();
  }
}

function playSound(kind, intensity = 0.5) {
  try {
    unlockAudio();
    if (!audioCtx) return;
    const now = audioCtx.currentTime;

    if (kind === "start") {
      [440, 554.37, 659.25].forEach((freq, i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(freq, now + i * 0.08);
        gain.gain.setValueAtTime(0.14, now + i * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.22);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now + i * 0.08);
        osc.stop(now + i * 0.08 + 0.24);
      });
    } else if (kind === "scan360") {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(300, now);
      osc.frequency.exponentialRampToValueAtTime(760, now + 0.28);
      gain.gain.setValueAtTime(0.14, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.32);
    } else if (kind === "radarPing") {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      const freq = 420 + intensity * 460;
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(0.07 + intensity * 0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.1);
    } else if (kind === "throw") {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(340, now);
      osc.frequency.exponentialRampToValueAtTime(920, now + 0.25);
      gain.gain.setValueAtTime(0.16, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.27);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.28);
    } else if (kind === "caught") {
      const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
      notes.forEach((freq, idx) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = idx === notes.length - 1 ? "sine" : "triangle";
        const startAt = now + idx * 0.09;
        osc.frequency.setValueAtTime(freq, startAt);
        gain.gain.setValueAtTime(0.18, startAt);
        gain.gain.exponentialRampToValueAtTime(0.001, startAt + 0.34);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(startAt);
        osc.stop(startAt + 0.36);
      });
    } else if (kind === "evade") {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(360, now);
      osc.frequency.exponentialRampToValueAtTime(185, now + 0.22);
      gain.gain.setValueAtTime(0.14, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.25);
    } else if (kind === "flee_fly") {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(620, now);
      osc.frequency.exponentialRampToValueAtTime(210, now + 0.55);
      gain.gain.setValueAtTime(0.16, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.58);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.6);
    } else if (kind === "flee_run") {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "square";
      osc.frequency.setValueAtTime(270, now);
      osc.frequency.linearRampToValueAtTime(135, now + 0.45);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.48);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.5);
    } else {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(230, now);
      osc.frequency.linearRampToValueAtTime(125, now + 0.26);
      gain.gain.setValueAtTime(0.13, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
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

function clearActiveCreatures() {
  activeCreatures.forEach((c) => {
    if (map && c.marker) map.removeLayer(c.marker);
  });
  activeCreatures = [];
}

function spawnSingleUnlimitedCreature(template = null, customAngle = null) {
  if (!map || !playerCoords || creaturesConfig.length === 0) return null;

  const base = template || creaturesConfig[Math.floor(Math.random() * creaturesConfig.length)];
  const num = spawnCounter++;
  const angleRad = Math.random() * Math.PI * 2;
  const distDeg = 0.00007 + Math.random() * 0.00005;

  const lat = playerCoords.lat + Math.sin(angleRad) * distDeg;
  const lng = playerCoords.lng + Math.cos(angleRad) * distDeg;
  const vx = (Math.random() < 0.5 ? -1 : 1) * (0.000010 + Math.random() * 0.000008);
  const vy = (Math.random() < 0.5 ? -1 : 1) * (0.000009 + Math.random() * 0.000007);

  const icon = L.divIcon({
    className: "roaming-creature-pin",
    html: `<div class="map-roaming-marker" style="background:${base.coreColor};"></div>`,
    iconSize: [30, 30]
  });

  const marker = L.marker([lat, lng], { icon }).addTo(map);
  const creatureObj = {
    ...base,
    uid: `${base.id}-${num}`,
    displayName: `${base.name} #${num}`,
    spawnAngleDeg:
      typeof customAngle === "number"
        ? normalize360(customAngle)
        : Math.floor(Math.random() * 360),
    lat,
    lng,
    vx,
    vy,
    marker,
    caught: false
  };

  marker.on("click", () => selectCreature(creatureObj));
  activeCreatures.push(creatureObj);
  return creatureObj;
}

function populateUnlimitedPool(count = 4) {
  clearActiveCreatures();
  for (let i = 0; i < count; i++) {
    const tpl = creaturesConfig[i % creaturesConfig.length];
    spawnSingleUnlimitedCreature(tpl, tpl.spawnAngleDeg);
  }
}

setInterval(() => {
  if (!map || !playerCoords || activeCreatures.length === 0) return;

  activeCreatures.forEach((c) => {
    if (c.caught || !c.marker) return;

    const nextLat = c.lat + c.vy;
    const nextLng = c.lng + c.vx;
    const dist = distanceMeters(playerCoords.lat, playerCoords.lng, nextLat, nextLng);

    if (dist > radarRadiusMeters * 0.75) {
      c.vx *= -1;
      c.vy *= -1;
    } else {
      c.lat = nextLat;
      c.lng = nextLng;
    }

    c.marker.setLatLng([c.lat, c.lng]);
    const el = c.marker.getElement();
    const dot = el ? el.querySelector(".map-roaming-marker") : null;
    if (dot) {
      dot.style.transform = c.vx < 0 ? "scaleX(-1)" : "scaleX(1)";
    }
  });
}, 550);

function removeCreatureFromMap(creature) {
  if (!creature) return;
  if (creature.marker && map) {
    map.removeLayer(creature.marker);
  }
  activeCreatures = activeCreatures.filter((item) => item.uid !== creature.uid);
}

function selectCreature(creature) {
  if (creature.caught || !playerCoords) return;
  selectedCreature = creature;
  playSound("scan360");

  const dist = distanceMeters(
    playerCoords.lat,
    playerCoords.lng,
    creature.lat,
    creature.lng
  );
  const inRange = dist <= radarRadiusMeters;

  document.getElementById("preview-name").textContent =
    `${creature.displayName} (+${creature.points})`;
  document.getElementById("preview-dist").textContent = inRange
    ? `Jarak ${Math.round(dist)}m • Bergerak bebas di radar`
    : `Jarak ${Math.round(dist)}m • Mendekat ke radar (${radarRadiusMeters}m)`;

  document.getElementById("open-cam-btn").disabled = !inRange;
  document.getElementById("creature-preview").classList.remove("hidden");
}

document.getElementById("close-preview-btn").addEventListener("click", () => {
  document.getElementById("creature-preview").classList.add("hidden");
  selectedCreature = null;
});

async function requestOrientationPermission() {
  if (
    typeof DeviceOrientationEvent !== "undefined" &&
    typeof DeviceOrientationEvent.requestPermission === "function"
  ) {
    try {
      await DeviceOrientationEvent.requestPermission();
    } catch (e) {
      console.warn("Izin orientasi ditolak:", e);
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
    console.warn("Kamera tidak aktif, pakai latar 360°:", err);
  }
}

function stopCameraSessionOnly() {
  const video = document.getElementById("camera-stream");
  if (cameraStream) {
    cameraStream.getTracks().forEach((t) => t.stop());
    cameraStream = null;
  }
  video.srcObject = null;
  prevFrameData = null;

  if (ar360.animFrameId) cancelAnimationFrame(ar360.animFrameId);
  if (ar360.fleeTimeoutId) clearTimeout(ar360.fleeTimeoutId);
  ar360.active = false;
}

function returnToMapsView() {
  stopCameraSessionOnly();
  document.getElementById("hunt-view").classList.add("hidden");
  document.getElementById("creature-preview").classList.add("hidden");
  selectedCreature = null;
  isThrowingOrb = false;

  if (map) {
    map.invalidateSize();
    if (playerCoords) {
      map.setView([playerCoords.lat, playerCoords.lng], 18);
    }
  }
}

function sampleCameraMotion() {
  const video = document.getElementById("camera-stream");
  const sampler = document.getElementById("motion-sampler");
  if (!cameraStream || video.readyState < 2 || ar360.fleeing || ar360.captured) return;

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

  const diffTotal = diffLeft + diffRight;
  if (diffTotal > 1900) {
    const balance = (diffRight - diffLeft) / (diffTotal + 1);
    ar360.cameraYaw = normalize360(ar360.cameraYaw - balance * 8);
  }
}

window.addEventListener("deviceorientation", (e) => {
  if (!ar360.active || ar360.fleeing || ar360.captured) return;

  if (typeof e.webkitCompassHeading === "number" && !Number.isNaN(e.webkitCompassHeading)) {
    ar360.cameraYaw = normalize360(e.webkitCompassHeading);
  } else if (e.alpha !== null) {
    if (ar360.baseAlpha === null) {
      ar360.baseAlpha = e.alpha;
    }
    const deltaAlpha = e.alpha - ar360.baseAlpha;
    ar360.cameraYaw = normalize360(ar360.cameraYaw + deltaAlpha * 0.25);
    ar360.baseAlpha = e.alpha;
  }

  if (e.gamma !== null) {
    if (ar360.lastGamma !== null) {
      const dGamma = e.gamma - ar360.lastGamma;
      ar360.cameraYaw = normalize360(ar360.cameraYaw + dGamma * 0.55);
    }
    ar360.lastGamma = e.gamma;
  }

  if (e.beta !== null) {
    ar360.cameraPitch = Math.max(-35, Math.min(35, (e.beta - 60) * 0.8));
  }
});

// Tombol panah kiri/kanan pada keyboard memudahkan pengujian 360° di laptop
window.addEventListener("keydown", (e) => {
  if (!ar360.active || ar360.fleeing || ar360.captured) return;
  if (e.key === "ArrowLeft") {
    ar360.cameraYaw = normalize360(ar360.cameraYaw - 12);
  } else if (e.key === "ArrowRight") {
    ar360.cameraYaw = normalize360(ar360.cameraYaw + 12);
  }
});

function drawAnimal360(
  ctx,
  creature,
  screenX,
  screenY,
  t,
  roamDir,
  fleeProgress = 0,
  fleeDirX = 1,
  fleeDirY = -0.6
) {
  const isFly = creature.moveType === "fly";
  const fleeScale = 1 - fleeProgress * 0.72;
  const fleeAlpha = Math.max(0, 1 - fleeProgress);
  const drawX = screenX + fleeProgress * fleeDirX * 190;
  const drawY = screenY + fleeProgress * fleeDirY * 160;

  ctx.save();
  ctx.globalAlpha = fleeAlpha;
  ctx.translate(drawX, drawY);
  ctx.scale(fleeScale, fleeScale);

  const faceDir = fleeProgress > 0 ? fleeDirX : roamDir;
  if (Math.abs(faceDir) > 0.05) {
    ctx.scale(faceDir < 0 ? -1 : 1, 1);
  }

  const speedMult = fleeProgress > 0 ? 2.4 : 1.35;
  const bob = isFly
    ? Math.sin(t * 4.5 * speedMult) * 14
    : Math.abs(Math.sin(t * 7.5 * speedMult)) * -11;
  const tilt = isFly
    ? Math.sin(t * 3.5 * speedMult) * 0.18
    : Math.cos(t * 7.5 * speedMult) * 0.12;

  ctx.translate(0, bob);
  ctx.rotate(tilt);

  const aura = ctx.createRadialGradient(0, 8, 8, 0, 8, 72);
  aura.addColorStop(0, creature.accentColor + "77");
  aura.addColorStop(1, "transparent");
  ctx.fillStyle = aura;
  ctx.beginPath();
  ctx.arc(0, 8, 72, 0, Math.PI * 2);
  ctx.fill();

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

  const bodyGrad = ctx.createRadialGradient(-16, -20, 8, 0, 0, 52);
  bodyGrad.addColorStop(0, "#ffffff");
  bodyGrad.addColorStop(0.28, creature.coreColor);
  bodyGrad.addColorStop(1, "#0f172a");

  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.ellipse(0, 4, 44, 36, 0, 0, Math.PI * 2);
  ctx.fill();

  const earSwing = Math.sin(t * 6.5 * speedMult) * 0.22;
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

  const stride = Math.sin(t * 11 * speedMult) * (isFly ? 3 : 14);
  ctx.fillStyle = creature.coreColor;
  ctx.beginPath();
  ctx.arc(-18 + stride, 36, 8.5, 0, Math.PI * 2);
  ctx.arc(18 - stride, 36, 8.5, 0, Math.PI * 2);
  ctx.fill();

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

function getRelativeYaw() {
  return signedAngleDiff(ar360.creatureYaw, ar360.cameraYaw);
}

function isInFrontOfCamera() {
  if (ar360.fleeing || ar360.captured) return false;
  return Math.abs(getRelativeYaw()) <= 32;
}

function update360Hud() {
  const compassEl = document.getElementById("compass-text");
  const statusEl = document.getElementById("hunt-status");
  const relYaw = getRelativeYaw();
  const absYaw = Math.abs(relYaw);

  if (ar360.fleeing) {
    const moveDesc = selectedCreature && selectedCreature.moveType === "fly"
      ? "terbang menjauh"
      : "berlari menjauh";
    compassEl.textContent = `Arah ${Math.round(ar360.cameraYaw)}° • Makhluk ${moveDesc}!`;
    statusEl.textContent = "Monster baru akan muncul di maps...";
    return;
  }

  if (ar360.captured) {
    compassEl.textContent = `Arah ${Math.round(ar360.cameraYaw)}° • Tertangkap!`;
    return;
  }

  const now = Date.now();
  const proximity = Math.max(0, 1 - absYaw / 180);
  const pingInterval = Math.max(260, 1150 - proximity * 850);
  if (now - lastPingTime > pingInterval) {
    lastPingTime = now;
    playSound("radarPing", proximity);
  }

  if (absYaw <= 32) {
    compassEl.textContent = `Kamera ${Math.round(ar360.cameraYaw)}° • 🎯 Monster di depan kamera!`;
    statusEl.textContent = "Monster terlihat! Ketuk atau swipe ↑ Orb Kristal.";
  } else if (absYaw > 135) {
    compassEl.textContent = `Kamera ${Math.round(ar360.cameraYaw)}° • 🔄 Monster di BELAKANG (putar kamera!)`;
    statusEl.textContent = "Putar memegang kamera ke belakang untuk mengejar monster!";
  } else if (relYaw > 32) {
    compassEl.textContent = `Kamera ${Math.round(ar360.cameraYaw)}° • ↻ Putar kamera ke KANAN (${Math.round(absYaw)}°)`;
    statusEl.textContent = "Monster bergerak ke kanan—putar kamera mengikuti arahnya!";
  } else {
    compassEl.textContent = `Kamera ${Math.round(ar360.cameraYaw)}° • ↺ Putar kamera ke KIRI (${Math.round(absYaw)}°)`;
    statusEl.textContent = "Monster bergerak ke kiri—putar kamera mengikuti arahnya!";
  }
}

function handleCreatureFledAndSpawnNew(reasonText = "Monster kabur!") {
  if (ar360.fleeing || ar360.captured || !selectedCreature) return;

  ar360.fleeing = true;
  ar360.fleeProgress = 0;
  ar360.fleeDirX = Math.random() < 0.5 ? 1 : -1;
  ar360.fleeDirY = selectedCreature.moveType === "fly" ? -0.95 : 0.25;

  playSound(selectedCreature.moveType === "fly" ? "flee_fly" : "flee_run");
  update360Hud();
  document.getElementById("hunt-status").textContent =
    `${reasonText} Monster baru muncul di maps...`;

  const oldTpl = selectedCreature;
  removeCreatureFromMap(selectedCreature);
  spawnSingleUnlimitedCreature(oldTpl);

  setTimeout(() => {
    returnToMapsView();
  }, 1300);
}

function evadeToAnotherAngle() {
  if (ar360.fleeing || ar360.captured || !selectedCreature) return;

  ar360.misses += 1;
  const maxMisses = selectedCreature.fleeAfterMisses || 3;

  if (ar360.misses >= maxMisses) {
    handleCreatureFledAndSpawnNew(`${selectedCreature.displayName} menghilang kabur!`);
    return;
  }

  const shift = (Math.random() < 0.5 ? 1 : -1) * (85 + Math.random() * 75);
  ar360.creatureYaw = normalize360(ar360.creatureYaw + shift);
  ar360.roamDir = Math.random() < 0.5 ? 1 : -1;
  playSound("evade");
  document.getElementById("hunt-status").textContent =
    `${selectedCreature.displayName} berlari menghindar (${ar360.misses}/${maxMisses}) — kejar lagi!`;
}

function start360Loop() {
  const canvas = document.getElementById("creature-canvas");
  const ctx = canvas.getContext("2d");

  const render = () => {
    if (!ar360.active) return;
    ar360.time += 0.035;

    sampleCameraMotion();

    if (ar360.fleeing) {
      ar360.fleeProgress = Math.min(1, ar360.fleeProgress + 0.025);
    } else if (!ar360.captured) {
      ar360.creatureYaw = normalize360(ar360.creatureYaw + ar360.roamDir * 0.28);
      if (Math.sin(ar360.time * 1.4) > 0.96) {
        ar360.roamDir *= -1;
      }
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const relYaw = getRelativeYaw();
    if (selectedCreature && Math.abs(relYaw) <= 65) {
      const screenX = canvas.width / 2 + (relYaw / 65) * 120;
      const screenY = canvas.height / 2 + ar360.cameraPitch;

      drawAnimal360(
        ctx,
        selectedCreature,
        screenX,
        screenY,
        ar360.time,
        ar360.roamDir,
        ar360.fleeProgress,
        ar360.fleeDirX,
        ar360.fleeDirY
      );
    }

    update360Hud();
    ar360.animFrameId = requestAnimationFrame(render);
  };

  ar360.animFrameId = requestAnimationFrame(render);

  if (ar360.fleeTimeoutId) clearTimeout(ar360.fleeTimeoutId);
  ar360.fleeTimeoutId = setTimeout(() => {
    if (!ar360.captured && !ar360.fleeing) {
      handleCreatureFledAndSpawnNew("Waktu habis, monster kabur!");
    }
  }, 22000);
}

document.getElementById("open-cam-btn").addEventListener("click", async () => {
  if (!selectedCreature) return;
  unlockAudio();
  await requestOrientationPermission();
  playSound("scan360");

  const initialAngle =
    typeof selectedCreature.spawnAngleDeg === "number"
      ? selectedCreature.spawnAngleDeg
      : 180;

  ar360 = {
    active: true,
    cameraYaw: 0,
    cameraPitch: 0,
    creatureYaw: normalize360(initialAngle),
    roamDir: Math.random() < 0.5 ? 1 : -1,
    baseAlpha: null,
    lastGamma: null,
    lastBeta: null,
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
    `${selectedCreature.displayName} (+${selectedCreature.points} pts)`;

  document.getElementById("creature-preview").classList.add("hidden");
  document.getElementById("hunt-view").classList.remove("hidden");

  await openCamera();
  start360Loop();
});

document.getElementById("back-to-maps-btn").addEventListener("click", () => {
  playSound("scan360");
  returnToMapsView();
});

document.getElementById("run-away-btn").addEventListener("click", () => {
  playSound("fail");
  returnToMapsView();
});

function triggerShine() {
  const ring = document.getElementById("shine-ring");
  ring.classList.remove("hidden", "shine-active");
  void ring.offsetWidth;
  ring.classList.add("shine-active");
}

function throwCrystalOrb() {
  if (!selectedCreature || isThrowingOrb || ar360.fleeing || ar360.captured) return;

  const statusEl = document.getElementById("hunt-status");
  if (!isInFrontOfCamera()) {
    statusEl.textContent = "Kejar & arahkan kamera hingga monster berada di depan kamera!";
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
      evadeToAnotherAngle();
      return;
    }

    const success = Math.random() < 0.82;
    if (success) {
      ar360.captured = true;
      selectedCreature.caught = true;

      const caughtTpl = selectedCreature;
      removeCreatureFromMap(selectedCreature);

      state.score += caughtTpl.points;
      state.caught.push({
        uid: caughtTpl.uid,
        name: caughtTpl.displayName,
        species: caughtTpl.species,
        points: caughtTpl.points,
        time: new Date().toLocaleTimeString("id-ID")
      });
      saveState();

      spawnSingleUnlimitedCreature(caughtTpl);

      playSound("caught");
      triggerShine();
      if (navigator.vibrate) navigator.vibrate([120, 60, 180]);
      statusEl.textContent = `✨ Bersinar! ${caughtTpl.displayName} tertangkap (+${caughtTpl.points} pts)! Monster baru muncul di maps!`;

      setTimeout(() => {
        returnToMapsView();
      }, 1450);
    } else {
      isThrowingOrb = false;
      evadeToAnotherAngle();
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
  playSound("scan360");
  if (playerCoords && map) populateUnlimitedPool(4);
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
  spawnCounter = 1;
  renderHud();
  document.getElementById("inventory-list").innerHTML =
    "<li>Data direset. Monster unlimited dimunculkan ulang.</li>";
  if (playerCoords && map) populateUnlimitedPool(4);
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

    populateUnlimitedPool(4);
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
  await requestOrientationPermission();
  playSound("start");

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