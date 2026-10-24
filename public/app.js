const armedToggle = document.querySelector("#armedToggle");
const armedLabel = document.querySelector("#armedLabel");
const modeMetric = document.querySelector("#modeMetric");
const motionMetric = document.querySelector("#motionMetric");
const uptimeMetric = document.querySelector("#uptimeMetric");
const recordingBadge = document.querySelector("#recordingBadge");
const newClipsCount = document.querySelector("#newClipsCount");
const refreshButton = document.querySelector("#refreshButton");
const logoutButton = document.querySelector("#logoutButton");
const captureFilters = document.querySelector(".capture-filters");
const selectModeButton = document.querySelector("#selectModeButton");
const bulkActions = document.querySelector(".bulk-actions");
const selectAllButton = document.querySelector("#selectAllButton");
const selectVisibleButton = document.querySelector("#selectVisibleButton");
const selectionCount = document.querySelector("#selectionCount");
const downloadSelectedButton = document.querySelector("#downloadSelectedButton");
const deleteSelectedButton = document.querySelector("#deleteSelectedButton");
const capturesList = document.querySelector("#capturesList");
const storageMetric = document.querySelector("#storageMetric");
const captureTemplate = document.querySelector("#captureTemplate");
const systemLight = document.querySelector("#systemLight");
const systemSummary = document.querySelector("#systemSummary");
const systemDetail = document.querySelector("#systemDetail");
const testRecordingButton = document.querySelector("#testRecordingButton");

let eventSource = null;
let uptimeStartedAt = null;
let uptimeBaseSeconds = 0;
let allCaptures = [];
let activeCaptureFilter = "all";
let selectedCaptureIds = new Set();
let selectionMode = false;
let openCaptureDates = new Set();
let captureGroupsHaveRendered = false;

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

function getCaptureDateGroup(capture) {
  const date = new Date(capture.createdAt);
  if (Number.isNaN(date.getTime())) {
    return { key: "unknown", label: "Unknown date", timestamp: -Infinity };
  }

  const key = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");

  return {
    key,
    label: new Intl.DateTimeFormat(undefined, { dateStyle: "full" }).format(date),
    timestamp: new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime(),
  };
}

function groupCapturesByDate(captures) {
  const groups = new Map();

  for (const capture of captures) {
    const dateGroup = getCaptureDateGroup(capture);
    if (!groups.has(dateGroup.key)) {
      groups.set(dateGroup.key, { ...dateGroup, captures: [] });
    }
    groups.get(dateGroup.key).captures.push(capture);
  }

  return [...groups.values()]
    .sort((a, b) => b.timestamp - a.timestamp)
    .map((group) => ({
      ...group,
      captures: group.captures.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    }));
}

function formatUptime(seconds) {
  const totalMinutes = Math.max(0, Math.floor(seconds / 60));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  return `${days}d ${hours}h ${minutes}m`;
}

function formatCaptureType(trigger) {
  return trigger === "test" ? "Test" : "Motion";
}

function captureMatchesFilter(capture) {
  if (activeCaptureFilter === "new") return !capture.viewed;
  if (activeCaptureFilter === "favorites") return Boolean(capture.favorite);
  if (activeCaptureFilter === "test") return capture.trigger === "test";
  if (activeCaptureFilter === "motion") return capture.trigger !== "test";
  return true;
}

function updateCaptureFilterButtons() {
  for (const button of captureFilters.querySelectorAll("button")) {
    button.setAttribute("aria-selected", String(button.dataset.filter === activeCaptureFilter));
  }
}

function updateNewClipsCount() {
  const count = allCaptures.filter((capture) => !capture.viewed).length;
  newClipsCount.textContent = `(${count} new)`;
}

function getVisibleCaptures() {
  return allCaptures.filter(captureMatchesFilter);
}

function getSelectedCaptures() {
  return allCaptures.filter((capture) => selectedCaptureIds.has(capture.id));
}

function pruneSelectedCaptureIds() {
  const captureIds = new Set(allCaptures.map((capture) => capture.id));
  selectedCaptureIds = new Set([...selectedCaptureIds].filter((id) => captureIds.has(id)));
}

function updateBulkActions() {
  bulkActions.hidden = !selectionMode;
  selectModeButton.textContent = selectionMode ? "Done" : "Select";

  if (!selectionMode) return;

  const visibleCaptures = getVisibleCaptures();
  const selectedCaptures = getSelectedCaptures();
  const selectedCount = selectedCaptures.length;
  const selectedDeletableCount = selectedCaptures.filter((capture) => !capture.favorite).length;
  const allSelected = allCaptures.length > 0 && allCaptures.every((capture) => selectedCaptureIds.has(capture.id));
  const allVisibleSelected = visibleCaptures.length > 0 && visibleCaptures.every((capture) => selectedCaptureIds.has(capture.id));

  selectionCount.textContent = `${selectedCount} selected`;
  selectAllButton.disabled = allCaptures.length === 0;
  selectAllButton.textContent = allSelected ? "Clear All" : "Select All";
  selectVisibleButton.disabled = visibleCaptures.length === 0;
  selectVisibleButton.textContent = allVisibleSelected ? "Clear Visible" : "Select Visible";
  downloadSelectedButton.disabled = selectedCount === 0;
  deleteSelectedButton.disabled = selectedDeletableCount === 0;
  deleteSelectedButton.textContent = "Delete Selected";
  deleteSelectedButton.dataset.confirming = "false";
  deleteSelectedButton.title = selectedDeletableCount === selectedCount ? "" : "Favorited clips will be kept";
}

function renderUptime() {
  if (!uptimeStartedAt) return;
  const elapsedSeconds = (Date.now() - uptimeStartedAt) / 1000;
  uptimeMetric.textContent = formatUptime(uptimeBaseSeconds + elapsedSeconds);
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
  allCaptures = data.captures;
  pruneSelectedCaptureIds();
  renderCaptures();
  return data;
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
  uptimeStartedAt = Date.now();
  uptimeBaseSeconds = Number(data.uptimeSeconds || 0);
  renderUptime();
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
    systemSummary.textContent =
      data.recordingTrigger === "test"
        ? "Test Recording in Progress."
        : "Motion Detected! Recording in Progress.";
    systemDetail.textContent = "";
    return;
  }

  if (armed) {
    systemSummary.textContent = "Watching for motion";
    systemDetail.textContent = "";
    return;
  }

  systemSummary.textContent = "System unarmed";
  systemDetail.textContent = "";
}

async function setCaptureFavorite(id, favorite) {
  return api(`/api/captures/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ favorite }),
  });
}

async function setCaptureViewed(id) {
  return api(`/api/captures/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ viewed: true }),
  });
}

async function downloadCaptures(ids) {
  const response = await fetch("/api/captures/download", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || response.statusText);
  }
  return response.blob();
}

async function deleteCaptures(ids) {
  return api("/api/captures/bulk", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
}

async function deleteCapture(id) {
  return api(`/api/captures/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

function createCaptureCard(capture) {
  const item = captureTemplate.content.firstElementChild.cloneNode(true);
  const selectInput = item.querySelector(".capture-select input");
  const video = item.querySelector("video");
  const title = item.querySelector("h3");
  const meta = item.querySelector("p");
  const favoriteButton = item.querySelector(".favorite-button");
  const downloadButton = item.querySelector(".download-button");
  const deleteButton = item.querySelector(".delete-button");
  const isFavorite = Boolean(capture.favorite);
  const isViewed = Boolean(capture.viewed);

  item.dataset.captureId = capture.id;
  item.dataset.viewed = String(isViewed);
  item.dataset.selecting = String(selectionMode);
  selectInput.closest(".capture-select").hidden = !selectionMode;
  selectInput.checked = selectedCaptureIds.has(capture.id);
  video.src = capture.url;
  title.textContent = capture.filename;
  meta.textContent = `${formatDate(capture.createdAt)} - ${formatBytes(capture.size)} - Type: ${formatCaptureType(capture.trigger)}`;
  downloadButton.href = capture.url;
  downloadButton.download = capture.filename;
  favoriteButton.dataset.favorite = String(isFavorite);
  favoriteButton.textContent = isFavorite ? "Favorited" : "Favorite";
  favoriteButton.setAttribute("aria-pressed", String(isFavorite));
  deleteButton.hidden = isFavorite;
  return item;
}

function renderCaptures() {
  capturesList.replaceChildren();
  updateCaptureFilterButtons();
  updateNewClipsCount();

  const captures = allCaptures.filter(captureMatchesFilter);
  const totalBytes = allCaptures.reduce((total, capture) => total + Number(capture.size || 0), 0);
  storageMetric.textContent = formatBytes(totalBytes);

  if (!captures.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = allCaptures.length ? "No videos match this filter." : "No captured videos yet.";
    capturesList.append(empty);
    updateBulkActions();
    return;
  }

  const groups = groupCapturesByDate(captures);
  const visibleDateKeys = new Set(groups.map((group) => group.key));
  openCaptureDates = new Set([...openCaptureDates].filter((key) => visibleDateKeys.has(key)));

  if (!captureGroupsHaveRendered && groups.length) {
    openCaptureDates.add(groups[0].key);
  }
  captureGroupsHaveRendered = true;

  for (const group of groups) {
    const dateSection = document.createElement("details");
    const summary = document.createElement("summary");
    const dateLabel = document.createElement("span");
    const countLabel = document.createElement("span");
    const groupList = document.createElement("div");

    dateSection.className = "capture-date-group";
    dateSection.dataset.captureDate = group.key;
    dateSection.open = openCaptureDates.has(group.key);
    summary.className = "capture-date-summary";
    dateLabel.textContent = group.label;
    countLabel.className = "capture-date-count";
    countLabel.textContent = `${group.captures.length} ${group.captures.length === 1 ? "recording" : "recordings"}`;
    groupList.className = "capture-date-list";

    for (const capture of group.captures) {
      groupList.append(createCaptureCard(capture));
    }

    summary.append(dateLabel, countLabel);
    dateSection.append(summary, groupList);
    dateSection.addEventListener("toggle", () => {
      if (dateSection.open) {
        openCaptureDates.add(group.key);
      } else {
        openCaptureDates.delete(group.key);
      }
    });
    capturesList.append(dateSection);
  }
  updateBulkActions();
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

captureFilters.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;

  activeCaptureFilter = button.dataset.filter;
  renderCaptures();
});

selectModeButton.addEventListener("click", () => {
  selectionMode = !selectionMode;
  if (!selectionMode) {
    selectedCaptureIds.clear();
  }
  renderCaptures();
});

selectAllButton.addEventListener("click", () => {
  const allSelected = allCaptures.length > 0 && allCaptures.every((capture) => selectedCaptureIds.has(capture.id));

  if (allSelected) {
    selectedCaptureIds.clear();
  } else {
    selectedCaptureIds = new Set(allCaptures.map((capture) => capture.id));
  }
  renderCaptures();
});

selectVisibleButton.addEventListener("click", () => {
  const visibleCaptures = getVisibleCaptures();
  const allVisibleSelected = visibleCaptures.length > 0 && visibleCaptures.every((capture) => selectedCaptureIds.has(capture.id));

  for (const capture of visibleCaptures) {
    if (allVisibleSelected) {
      selectedCaptureIds.delete(capture.id);
    } else {
      selectedCaptureIds.add(capture.id);
    }
  }
  renderCaptures();
});

downloadSelectedButton.addEventListener("click", async () => {
  const ids = getSelectedCaptures().map((capture) => capture.id);
  if (!ids.length) return;

  downloadSelectedButton.disabled = true;
  try {
    const blob = await downloadCaptures(ids);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "selected-captures.zip";
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error(error);
  } finally {
    updateBulkActions();
  }
});

deleteSelectedButton.addEventListener("click", async () => {
  const ids = getSelectedCaptures()
    .filter((capture) => !capture.favorite)
    .map((capture) => capture.id);
  if (!ids.length) return;

  if (deleteSelectedButton.dataset.confirming !== "true") {
    deleteSelectedButton.dataset.confirming = "true";
    deleteSelectedButton.textContent = "Confirm Delete";
    window.setTimeout(() => {
      if (!deleteSelectedButton.isConnected || deleteSelectedButton.disabled) return;
      updateBulkActions();
    }, 3000);
    return;
  }

  deleteSelectedButton.disabled = true;
  try {
    const result = await deleteCaptures(ids);
    const deletedIds = new Set(result.deleted || []);
    allCaptures = allCaptures.filter((capture) => !deletedIds.has(capture.id));
    selectedCaptureIds = new Set([...selectedCaptureIds].filter((id) => !deletedIds.has(id)));
    renderCaptures();
  } catch (error) {
    console.error(error);
    updateBulkActions();
  }
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
  systemLight.dataset.state = "recording";
  recordingBadge.hidden = false;
  systemSummary.textContent = "Test Recording in Progress.";
  systemDetail.textContent = "";

  try {
    await startTestRecording();
    await loadStatus();
  } catch (error) {
    testRecordingButton.disabled = false;
    console.error(error);
  }
});

setInterval(renderUptime, 1000);

capturesList.addEventListener("click", async (event) => {
  const deleteButton = event.target.closest(".delete-button");
  if (deleteButton) {
    const card = deleteButton.closest(".capture-card");
    if (deleteButton.dataset.confirming !== "true") {
      deleteButton.dataset.confirming = "true";
      deleteButton.setAttribute("aria-label", "Confirm delete recording");
      deleteButton.setAttribute("title", "Click again to delete");

      window.setTimeout(() => {
        if (!deleteButton.isConnected || deleteButton.disabled) return;
        deleteButton.dataset.confirming = "false";
        deleteButton.setAttribute("aria-label", "Delete recording");
        deleteButton.setAttribute("title", "Delete recording");
      }, 3000);
      return;
    }

    deleteButton.disabled = true;

    try {
      await deleteCapture(card.dataset.captureId);
      selectedCaptureIds.delete(card.dataset.captureId);
      allCaptures = allCaptures.filter((capture) => capture.id !== card.dataset.captureId);
      renderCaptures();
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
    const isFavorite = Boolean(capture.favorite);
    allCaptures = allCaptures.map((item) => item.id === capture.id ? capture : item);

    if (activeCaptureFilter === "favorites" && !isFavorite) {
      renderCaptures();
    } else {
      const deleteButton = card.querySelector(".delete-button");

      button.dataset.favorite = String(isFavorite);
      button.textContent = isFavorite ? "Favorited" : "Favorite";
      button.setAttribute("aria-pressed", String(isFavorite));
      deleteButton.hidden = isFavorite;
    }
  } catch (error) {
    console.error(error);
  } finally {
    button.disabled = false;
  }
});

capturesList.addEventListener("change", (event) => {
  const checkbox = event.target.closest(".capture-select input");
  if (!checkbox) return;

  const card = checkbox.closest(".capture-card");
  if (checkbox.checked) {
    selectedCaptureIds.add(card.dataset.captureId);
  } else {
    selectedCaptureIds.delete(card.dataset.captureId);
  }
  updateBulkActions();
});

capturesList.addEventListener("play", async (event) => {
  const video = event.target.closest("video");
  if (!video) return;

  const card = video.closest(".capture-card");
  if (!card || card.dataset.viewed === "true") return;

  card.dataset.viewed = "true";
  try {
    const capture = await setCaptureViewed(card.dataset.captureId);
    allCaptures = allCaptures.map((item) => item.id === capture.id ? capture : item);
    if (activeCaptureFilter === "new") {
      renderCaptures();
    }
  } catch (error) {
    card.dataset.viewed = "false";
    console.error(error);
  }
}, true);

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
