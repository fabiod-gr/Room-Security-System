const cameraFeed = document.querySelector("#cameraFeed");
const cameraEmpty = document.querySelector("#cameraEmpty");
const cameraButton = document.querySelector("#cameraButton");
const manualRecordButton = document.querySelector("#manualRecordButton");
const armedToggle = document.querySelector("#armedToggle");
const armedLabel = document.querySelector("#armedLabel");
const modeMetric = document.querySelector("#modeMetric");
const motionMetric = document.querySelector("#motionMetric");
const uploadMetric = document.querySelector("#uploadMetric");
const recordingBadge = document.querySelector("#recordingBadge");
const refreshButton = document.querySelector("#refreshButton");
const capturesList = document.querySelector("#capturesList");
const captureTemplate = document.querySelector("#captureTemplate");
const sensitivityInput = document.querySelector("#sensitivity");
const clipLengthInput = document.querySelector("#clipLength");
const motionCanvas = document.querySelector("#motionCanvas");
const motionContext = motionCanvas.getContext("2d", { willReadFrequently: true });

let stream = null;
let previousFrame = null;
let motionTimer = null;
let mediaRecorder = null;
let isRecording = false;
let cooldownUntil = 0;
let uploadCount = 0;

function setStatus(message) {
  motionMetric.textContent = message;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

async function api(path, options = {}) {
  const response = await fetch(path, options);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || response.statusText);
  }
  return response.json();
}

async function loadStatus() {
  const data = await api("/api/status");
  armedToggle.checked = data.armed;
  renderArmedState();
  renderCaptures(data.captures);
}

async function saveArmedState(armed) {
  const data = await api("/api/status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ armed }),
  });
  armedToggle.checked = data.armed;
  renderArmedState();
}

function renderArmedState() {
  const armed = armedToggle.checked;
  armedLabel.textContent = armed ? "Armed" : "Unarmed";
  modeMetric.textContent = armed ? "Armed" : "Unarmed";

  if (armed && stream) {
    startMotionLoop();
  } else {
    stopMotionLoop();
    setStatus("Idle");
  }
}

function renderCameraState(active) {
  cameraEmpty.hidden = active;
  cameraButton.disabled = false;
  cameraButton.textContent = active ? "Turn Camera Off" : "Start Camera";
  manualRecordButton.disabled = !active || isRecording;
}

async function startCamera() {
  cameraButton.disabled = true;
  cameraButton.textContent = "Starting...";
  setStatus("Starting camera");

  stream = await navigator.mediaDevices.getUserMedia({
    video: {
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
    audio: true,
  });

  cameraFeed.srcObject = stream;
  await cameraFeed.play();

  renderCameraState(true);
  renderArmedState();
}

function stopCamera() {
  if (mediaRecorder && mediaRecorder.state === "recording") {
    mediaRecorder.stop();
  }

  stopMotionLoop();

  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
  }

  stream = null;
  cameraFeed.pause();
  cameraFeed.removeAttribute("src");
  cameraFeed.srcObject = null;
  previousFrame = null;
  setStatus("Camera off");
  renderCameraState(false);
}

function startMotionLoop() {
  if (motionTimer) return;
  previousFrame = null;
  setStatus("Watching");
  motionTimer = window.setInterval(checkMotion, 500);
}

function stopMotionLoop() {
  if (!motionTimer) return;
  window.clearInterval(motionTimer);
  motionTimer = null;
  previousFrame = null;
}

function checkMotion() {
  if (!stream || !armedToggle.checked || isRecording || Date.now() < cooldownUntil) return;
  if (cameraFeed.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;

  motionContext.drawImage(cameraFeed, 0, 0, motionCanvas.width, motionCanvas.height);
  const current = motionContext.getImageData(0, 0, motionCanvas.width, motionCanvas.height);

  if (!previousFrame) {
    previousFrame = current;
    return;
  }

  let changed = 0;
  let sampled = 0;
  const threshold = Number(sensitivityInput.value);

  for (let index = 0; index < current.data.length; index += 16) {
    const diff =
      Math.abs(current.data[index] - previousFrame.data[index]) +
      Math.abs(current.data[index + 1] - previousFrame.data[index + 1]) +
      Math.abs(current.data[index + 2] - previousFrame.data[index + 2]);
    if (diff > threshold) changed += 1;
    sampled += 1;
  }

  previousFrame = current;
  const motionPercent = (changed / sampled) * 100;
  setStatus(`${motionPercent.toFixed(1)}%`);

  if (motionPercent > 3) {
    recordClip("motion");
  }
}

async function recordClip(reason = "manual") {
  if (!stream || isRecording) return;

  const chunks = [];
  const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
    ? "video/webm;codecs=vp9,opus"
    : "video/webm";
  mediaRecorder = new MediaRecorder(stream, { mimeType });
  isRecording = true;
  recordingBadge.hidden = false;
  manualRecordButton.disabled = true;
  setStatus("Recording");

  mediaRecorder.addEventListener("dataavailable", (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  });

  mediaRecorder.addEventListener("stop", async () => {
    const blob = new Blob(chunks, { type: "video/webm" });
    try {
      await uploadCapture(blob);
      uploadCount += 1;
      uploadMetric.textContent = String(uploadCount);
      await loadStatus();
      setStatus(armedToggle.checked ? "Watching" : "Idle");
    } catch (error) {
      setStatus("Upload failed");
      console.error(error);
    } finally {
      isRecording = false;
      recordingBadge.hidden = true;
      manualRecordButton.disabled = !stream;
      cooldownUntil = Date.now() + 4000;
    }
  });

  mediaRecorder.start();
  const clipLength = Math.min(30, Math.max(3, Number(clipLengthInput.value) || 8));
  window.setTimeout(() => {
    if (mediaRecorder && mediaRecorder.state === "recording") {
      mediaRecorder.stop();
    }
  }, clipLength * 1000);
}

async function uploadCapture(blob) {
  return api("/api/captures", {
    method: "POST",
    headers: {
      "Content-Type": "video/webm",
    },
    body: blob,
  });
}

async function setCaptureFavorite(id, favorite) {
  return api(`/api/captures/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ favorite }),
  });
}

function renderCaptures(captures) {
  capturesList.replaceChildren();
  if (!captures.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No captured videos yet.";
    capturesList.append(empty);
    return;
  }

  for (const capture of captures) {
    const item = captureTemplate.content.firstElementChild.cloneNode(true);
    const video = item.querySelector("video");
    const title = item.querySelector("h3");
    const meta = item.querySelector("p");
    const favoriteButton = item.querySelector(".favorite-button");

    item.dataset.captureId = capture.id;
    video.src = capture.url;
    title.textContent = capture.filename;
    meta.textContent = `${formatDate(capture.createdAt)} - ${formatBytes(capture.size)}`;
    favoriteButton.dataset.favorite = String(Boolean(capture.favorite));
    favoriteButton.textContent = capture.favorite ? "Favorited" : "Favorite";
    favoriteButton.setAttribute("aria-pressed", String(Boolean(capture.favorite)));
    capturesList.append(item);
  }
}

cameraButton.addEventListener("click", async () => {
  if (stream) {
    stopCamera();
    return;
  }

  try {
    await startCamera();
  } catch (error) {
    renderCameraState(false);
    setStatus("Camera blocked");
    console.error(error);
  }
});

manualRecordButton.addEventListener("click", () => recordClip("manual"));

armedToggle.addEventListener("change", () => {
  saveArmedState(armedToggle.checked).catch((error) => {
    armedToggle.checked = !armedToggle.checked;
    renderArmedState();
    console.error(error);
  });
});

refreshButton.addEventListener("click", () => {
  loadStatus().catch(console.error);
});

capturesList.addEventListener("click", async (event) => {
  const button = event.target.closest(".favorite-button");
  if (!button) return;

  const card = button.closest(".capture-card");
  const favorite = button.dataset.favorite !== "true";

  button.disabled = true;
  try {
    const capture = await setCaptureFavorite(card.dataset.captureId, favorite);
    button.dataset.favorite = String(Boolean(capture.favorite));
    button.textContent = capture.favorite ? "Favorited" : "Favorite";
    button.setAttribute("aria-pressed", String(Boolean(capture.favorite)));
  } catch (error) {
    console.error(error);
  } finally {
    button.disabled = false;
  }
});

loadStatus().catch(console.error);
