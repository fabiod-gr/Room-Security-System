const armedToggle = document.querySelector("#armedToggle");
const armedLabel = document.querySelector("#armedLabel");
const modeMetric = document.querySelector("#modeMetric");
const motionMetric = document.querySelector("#motionMetric");
const recordingMetric = document.querySelector("#recordingMetric");
const recordingBadge = document.querySelector("#recordingBadge");
const refreshButton = document.querySelector("#refreshButton");
const logoutButton = document.querySelector("#logoutButton");
const capturesList = document.querySelector("#capturesList");
const captureTemplate = document.querySelector("#captureTemplate");
const systemLight = document.querySelector("#systemLight");
const systemSummary = document.querySelector("#systemSummary");
const systemDetail = document.querySelector("#systemDetail");
const testRecordingButton = document.querySelector("#testRecordingButton");

let eventSource = null;

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value) {
  if (!value) return "Never";
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
  renderStatus(data);
  renderCaptures(data.captures);
}

async function saveArmedState(armed) {
  return api("/api/status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ armed }),
  });
}

async function startTestRecording() {
  return api("/api/test-recording", {
    method: "POST",
  });
}

async function logout() {
  return api("/api/logout", {
    method: "POST",
  });
}

function renderStatus(data) {
  const sensorReady = Boolean(data.sensor?.enabled);
  const armed = Boolean(data.armed);
  const recording = Boolean(data.recording);

  armedToggle.checked = armed;
  armedLabel.textContent = armed ? "Armed" : "Unarmed";
  modeMetric.textContent = armed ? "Armed" : "Unarmed";
  motionMetric.textContent = data.lastMotionAt ? formatDate(data.lastMotionAt) : "No motion";
  recordingMetric.textContent = recording ? "Recording" : "Idle";
  recordingBadge.hidden = !recording;
  testRecordingButton.disabled = recording;

  systemLight.dataset.state = recording ? "recording" : armed && sensorReady ? "armed" : "idle";

  if (!sensorReady) {
    systemSummary.textContent = "Motion sensor unavailable";
    systemDetail.textContent = data.sensor?.error || "Install gpiozero on the Raspberry Pi and run the server there.";
    return;
  }

  if (data.recordingError) {
    systemSummary.textContent = "Recording failed";
    systemDetail.textContent = data.recordingError;
    return;
  }

  if (recording) {
    systemSummary.textContent = "Recording motion event";
    systemDetail.textContent = `The Pi webcam and microphone are recording a ${data.captureSeconds}-second clip.`;
    return;
  }

  if (armed) {
    systemSummary.textContent = "Watching for motion";
    systemDetail.textContent = "The webcam is off until the HC-SR501 detects motion.";
    return;
  }

  systemSummary.textContent = "System unarmed";
  systemDetail.textContent = "Motion can be detected, but clips are only recorded while armed.";
}

async function setCaptureFavorite(id, favorite) {
  return api(`/api/captures/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ favorite }),
  });
}

async function deleteCapture(id) {
  return api(`/api/captures/${encodeURIComponent(id)}`, {
    method: "DELETE",
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
    const downloadButton = item.querySelector(".download-button");

    item.dataset.captureId = capture.id;
    video.src = capture.url;
    title.textContent = capture.filename;
    meta.textContent = `${formatDate(capture.createdAt)} - ${formatBytes(capture.size)}`;
    downloadButton.href = capture.url;
    downloadButton.download = capture.filename;
    favoriteButton.dataset.favorite = String(Boolean(capture.favorite));
    favoriteButton.textContent = capture.favorite ? "Favorited" : "Favorite";
    favoriteButton.setAttribute("aria-pressed", String(Boolean(capture.favorite)));
    capturesList.append(item);
  }
}

armedToggle.addEventListener("change", async () => {
  const shouldArm = armedToggle.checked;
  armedToggle.disabled = true;
  try {
    await saveArmedState(shouldArm);
    await loadStatus();
  } catch (error) {
    armedToggle.checked = !shouldArm;
    console.error(error);
  } finally {
    armedToggle.disabled = false;
  }
});

refreshButton.addEventListener("click", () => {
  loadStatus().catch(console.error);
});

logoutButton.addEventListener("click", async () => {
  try {
    await logout();
  } finally {
    window.location.href = "/login";
  }
});

testRecordingButton.addEventListener("click", async () => {
  testRecordingButton.disabled = true;
  try {
    await startTestRecording();
    await loadStatus();
  } catch (error) {
    console.error(error);
  } finally {
    testRecordingButton.disabled = false;
  }
});

capturesList.addEventListener("click", async (event) => {
  const deleteButton = event.target.closest(".delete-button");
  if (deleteButton) {
    const card = deleteButton.closest(".capture-card");
    deleteButton.disabled = true;

    try {
      await deleteCapture(card.dataset.captureId);
      card.remove();
      if (!capturesList.children.length) {
        renderCaptures([]);
      }
    } catch (error) {
      deleteButton.disabled = false;
      console.error(error);
    }
    return;
  }

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

function listenForCaptureEvents() {
  if (!window.EventSource) return;

  eventSource = new EventSource("/api/events");
  eventSource.addEventListener("security-update", (event) => {
    const update = JSON.parse(event.data);
    if (update.type === "capture-added") {
      loadStatus().catch(console.error);
    }
  });

  eventSource.addEventListener("error", () => {
    console.error("Lost dashboard update connection.");
  });
}

window.addEventListener("beforeunload", () => {
  if (eventSource) {
    eventSource.close();
  }
});

loadStatus().catch(console.error);
listenForCaptureEvents();
