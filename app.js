const STORAGE_KEY = "campus_go_ar_search_v1";
const FALLBACK_COORDS = { lat: 3.5952, lng: 98.6722 };

let map = null;
let playerMarker = null;
let radarCircle = null;
let playerCoords = null;
let radarRadiusMeters = 65;
let creaturesConfig = [];
let mapMarkers = [];
let selectedCreature = null;
let cameraStream = null;
let simulationMode = false;
let isThrowingOrb = false;
let audioCtx = null;

// Status pencarian AR di kamera
let arSession = {
  active: false,
  offsetX: 190,     // mulai di luar/sisi pandang agar harus dicari dulu
  offsetY: -35,
  targetX: 190,
  targetY: -35,
  misses: 0,
  fled: false,
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
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(660, now + 0.14);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
      osc.start(now);
      osc.stop(now + 0.16);
    } else if (kind === "throw") {
      osc.type = "sine";
      osc.frequency.setValueAtTime(350, now);
      osc.frequency.exponentialRampToValueAtTime(840, now + 0.24);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
      osc.start(now);
      osc.stop(now + 0.26);
    } else if (kind === "win") {
      osc.type = "triangle";
      osc.frequency.setValueAtTime(523.25, now);
      osc.frequency.setValueAtTime(659.25, now + 0.11);
      osc.frequency.setValueAtTime(783.99, now + 0.22);
      osc.frequency.setValueAtTime(1046.5, now + 0.34);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
      osc.start(now);
      osc.stop(now + 0.55);
    } else if (kind === "evade") {
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(320, now);
      osc.frequency.exponentialRampToValueAtTime(180, now + 0.22);
      gain.gain.setValueAtTime(0.14, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
      osc.start(now);
      osc.stop(now + 0.24);
    } else {
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.linearRampToValueAtTime(110, now + 0.35);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);
      osc.start(now);
      osc.stop(now + 0.38);
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
  mapMarkers.forEach((m) => map.removeLayer(m));
  mapMarkers = [];
}

function spawnNearRadar(centerLat, centerLng) {
  clearMapMarkers();

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

async function openCamera() {
  const video = document.getElementById("camera-stream");
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
  if (arSession.animFrameId) cancelAnimationFrame(arSession.animFrameId);
  if (arSession.fleeTimeoutId) clearTimeout(arSession.fleeTimeoutId);
  arSession.active = false;
}

// Menggambar makhluk 3D-shaded bergerak di canvas (bukan JPG statis)
function drawCreature3D(ctx, creature, cx, cy, t, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  ctx.translate(cx, cy);

  const bob = Math.sin(t * 4.2) * 8;
  const tilt = Math.cos(t * 2.5) * 0.12;
  ctx.translate(0, bob);
  ctx.rotate(tilt);

  // Bayangan/aura bawah
  const aura = ctx.createRadialGradient(0, 10, 8, 0, 10, 75);
  aura.addColorStop(0, creature.accentColor + "88");
  aura.addColorStop(1, "transparent");
  ctx.fillStyle = aura;
  ctx.beginPath();
  ctx.arc(0, 10, 75, 0, Math.PI * 2);
  ctx.fill();

  // Tubuh 3D bergradasi
  const bodyGrad = ctx.createRadialGradient(-16, -22, 10, 0, 0, 56);
  bodyGrad.addColorStop(0, "#ffffff");
  bodyGrad.addColorStop(0.25, creature.coreColor);
  bodyGrad.addColorStop(1, "#0f172a");

  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.ellipse(0, 4, 46, 40, 0, 0, Math.PI * 2);
  ctx.fill();

  // Telinga / tanduk hewan yang ikut bergerak
  const earSwing = Math.sin(t * 5.5) * 0.18;
  [-22, 22].forEach((ex, idx) => {
    ctx.save();
    ctx.translate(ex, -30);
    ctx.rotate((idx === 0 ? -0.35 : 0.35) + earSwing);
    ctx.fillStyle = creature.coreColor;
    ctx.beginPath();
    ctx.ellipse(0, -14, 10, 22, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });

  // Kaki kecil yang melangkah
  const legStep = Math.sin(t * 6) * 8;
  ctx.fillStyle = creature.coreColor;
  ctx.beginPath();
  ctx.arc(-18, 40 + legStep * 0.4, 9, 0, Math.PI * 2);
  ctx.arc(18, 40 - legStep * 0.4, 9, 0, Math.PI * 2);
  ctx.fill();

  // Mata ekspresif
  ctx.fillStyle = "#090d16";
  ctx.beginPath();
  ctx.arc(-14, -4, 6.5, 0, Math.PI * 2);
  ctx.arc(14, -4, 6.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(-16, -6, 2.5, 0, Math.PI * 2);
  ctx.arc(12, -6, 2.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function isCreatureCentered() {
  if (arSession.fled || arSession.captured) return false;
  return Math.abs(arSession.offsetX) < 55 && Math.abs(arSession.offsetY) < 55;
}

function updateCompassHint() {
  const compassEl = document.getElementById("compass-text");
  const statusEl = document.getElementById("hunt-status");

  if (arSession.fled) {
    compassEl.textContent = "Monster menghilang!";
    statusEl.textContent = "Monster sudah menghilang dari pandangan. Kembali ke radar...";
    return;
  }
  if (arSession.captured) {
    compassEl.textContent = "Tertangkap!";
    return;
  }

  if (isCreatureCentered()) {
    compassEl.textContent = "🎯 Target ditemukan di tengah bidikan!";
    statusEl.textContent = "Monster terlihat jelas! Ketuk atau swipe ↑ Orb Kristal.";
  } else if (arSession.offsetX > 55) {
    compassEl.textContent = "◀ Geser pandangan ke KANAN / arahkan HP ke kanan";
    statusEl.textContent = "Monster bersembunyi di sisi kanan sekitarmu...";
  } else if (arSession.offsetX < -55) {
    compassEl.textContent = "▶ Geser pandangan ke KIRI / arahkan HP ke kiri";
    statusEl.textContent = "Monster bersembunyi di sisi kiri sekitarmu...";
  } else {
    compassEl.textContent = "↕ Geser pandangan atas/bawah untuk mengunci target";
    statusEl.textContent = "Cari posisi monster di sekitar layar kamera...";
  }
}

function evadeCreature(reasonText = "Monster menghindar!") {
  if (arSession.fled || arSession.captured) return;

  arSession.misses += 1;
  const maxMisses = selectedCreature.fleeAfterMisses || 3;

  if (arSession.misses >= maxMisses) {
    arSession.fled = true;
    playSound("flee");
    updateCompassHint();
    if (selectedCreature.marker && map) {
      map.removeLayer(selectedCreature.marker);
    }
    setTimeout(() => {
      closeCamera();
      document.getElementById("hunt-view").classList.add("hidden");
      selectedCreature = null;
    }, 1500);
    return;
  }

  // Menghindar ke arah berlawanan
  const dir = arSession.offsetX >= 0 ? -1 : 1;
  arSession.targetX = dir * (150 + Math.random() * 60);
  arSession.targetY = (Math.random() - 0.5) * 90;
  playSound("evade");
  document.getElementById("hunt-status").textContent =
    `${reasonText} (${arSession.misses}/${maxMisses} sebelum menghilang) — cari lagi!`;
}

function startArLoop() {
  const canvas = document.getElementById("creature-canvas");
  const ctx = canvas.getContext("2d");

  const render = () => {
    if (!arSession.active) return;
    arSession.time += 0.03;

    // Interpolasi halus saat menghindar atau digeser
    arSession.offsetX += (arSession.targetX - arSession.offsetX) * 0.14;
    arSession.offsetY += (arSession.targetY - arSession.offsetY) * 0.14;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const drawX = canvas.width / 2 + arSession.offsetX;
    const drawY = canvas.height / 2 + arSession.offsetY;
    const alpha = arSession.fled ? 0 : 1;

    if (selectedCreature) {
      drawCreature3D(ctx, selectedCreature, drawX, drawY, arSession.time, alpha);
    }

    updateCompassHint();
    arSession.animFrameId = requestAnimationFrame(render);
  };

  arSession.animFrameId = requestAnimationFrame(render);

  // Jika tidak ditangkap dalam 18 detik, monster menghilang
  if (arSession.fleeTimeoutId) clearTimeout(arSession.fleeTimeoutId);
  arSession.fleeTimeoutId = setTimeout(() => {
    if (!arSession.captured && !arSession.fled) {
      arSession.fled = true;
      playSound("flee");
      updateCompassHint();
      if (selectedCreature && selectedCreature.marker && map) {
        map.removeLayer(selectedCreature.marker);
      }
      setTimeout(() => {
        closeCamera();
        document.getElementById("hunt-view").classList.add("hidden");
        selectedCreature = null;
      }, 1500);
    }
  }, 18000);
}

document.getElementById("open-cam-btn").addEventListener("click", async () => {
  if (!selectedCreature) return;
  unlockAudio();
  playSound("scan");

  // Mulai di luar tengah agar pengguna harus mencari ke sekeliling dulu
  const startSide = Math.random() < 0.5 ? 195 : -195;
  arSession = {
    active: true,
    offsetX: startSide,
    offsetY: (Math.random() - 0.5) * 70,
    targetX: startSide,
    targetY: (Math.random() - 0.5) * 70,
    misses: 0,
    fled: false,
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

// Geser layar kamera (drag / touch) untuk mencari arah monster di sekeliling
const huntViewEl = document.getElementById("hunt-view");
let panStartX = null;
let panStartY = null;

huntViewEl.addEventListener("touchstart", (e) => {
  if (e.target.closest("#crystal-orb")) return;
  panStartX = e.touches[0].clientX;
  panStartY = e.touches[0].clientY;
});

huntViewEl.addEventListener("touchmove", (e) => {
  if (panStartX === null || !arSession.active || arSession.fled) return;
  const dx = e.touches[0].clientX - panStartX;
  const dy = e.touches[0].clientY - panStartY;
  arSession.targetX = Math.max(-220, Math.min(220, arSession.targetX + dx * 0.45));
  arSession.targetY = Math.max(-110, Math.min(110, arSession.targetY + dy * 0.45));
  panStartX = e.touches[0].clientX;
  panStartY = e.touches[0].clientY;
});

huntViewEl.addEventListener("touchend", () => {
  panStartX = null;
  panStartY = null;
});

// Dukungan mouse drag di desktop untuk menguji mencari monster di sekeliling
let mousePanning = false;
let lastMouseX = 0;
let lastMouseY = 0;

huntViewEl.addEventListener("mousedown", (e) => {
  if (e.target.closest("#crystal-orb") || e.target.closest("button")) return;
  mousePanning = true;
  lastMouseX = e.clientX;
  lastMouseY = e.clientY;
});

window.addEventListener("mousemove", (e) => {
  if (!mousePanning || !arSession.active || arSession.fled) return;
  const dx = e.clientX - lastMouseX;
  const dy = e.clientY - lastMouseY;
  arSession.targetX = Math.max(-220, Math.min(220, arSession.targetX + dx * 0.7));
  arSession.targetY = Math.max(-110, Math.min(110, arSession.targetY + dy * 0.7));
  lastMouseX = e.clientX;
  lastMouseY = e.clientY;
});

window.addEventListener("mouseup", () => {
  mousePanning = false;
});

// Dukungan giroskop HP (DeviceOrientation) agar menggerakkan HP ikut menggeser arah pandang
window.addEventListener("deviceorientation", (e) => {
  if (!arSession.active || arSession.fled || e.gamma === null) return;
  arSession.targetX = Math.max(-210, Math.min(210, e.gamma * 5.5));
  if (e.beta !== null) {
    arSession.targetY = Math.max(-100, Math.min(100, (e.beta - 55) * 2.5));
  }
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
  if (!selectedCreature || isThrowingOrb || arSession.fled || arSession.captured) return;

  const statusEl = document.getElementById("hunt-status");
  if (!isCreatureCentered()) {
    statusEl.textContent = "Arahkan bidikan ke tengah monster dulu sebelum melempar!";
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

    // Jika menghindar saat dilempar
    const evaded = Math.random() < (selectedCreature.evadeChance || 0.45);
    if (evaded) {
      isThrowingOrb = false;
      evadeCreature("Monster menghindar gesit!");
      return;
    }

    const success = Math.random() < 0.75;
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
      evadeCreature("Lemparan meleset & monster bergeser!");
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