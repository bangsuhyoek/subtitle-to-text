import { subtitleToText, getTranscriptStats } from "./parser.js";

// State
let filesState = []; // [{ id, name, content, transcript, stats }]
let activeFileIndex = 0;

// DOM Elements
const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const browseBtn = document.getElementById("browseBtn");
const pasteInput = document.getElementById("pasteInput");
const fileTabsWrapper = document.getElementById("fileTabsWrapper");
const fileTabs = document.getElementById("fileTabs");

const paragraphMode = document.getElementById("paragraphMode");
const gapThreshold = document.getElementById("gapThreshold");
const gapOptionItem = document.getElementById("gapOptionItem");
const timestampOption = document.getElementById("timestampOption");
const keepSpeakers = document.getElementById("keepSpeakers");
const removeSoundTags = document.getElementById("removeSoundTags");
const dedupeRolling = document.getElementById("dedupeRolling");

const wordCountEl = document.getElementById("wordCount");
const charCountEl = document.getElementById("charCount");
const readTimeEl = document.getElementById("readTime");
const outputArea = document.getElementById("outputArea");

const copyBtn = document.getElementById("copyBtn");
const downloadBtn = document.getElementById("downloadBtn");
const downloadAllBtn = document.getElementById("downloadAllBtn");
const clearBtn = document.getElementById("clearBtn");
const toast = document.getElementById("toast");

// Initialize options listeners
[paragraphMode, gapThreshold, timestampOption, keepSpeakers, removeSoundTags, dedupeRolling].forEach(el => {
  el.addEventListener("change", () => {
    updateGapVisibility();
    reprocessAll();
  });
});

function updateGapVisibility() {
  if (paragraphMode.value === "gap") {
    gapOptionItem.classList.remove("hidden");
  } else {
    gapOptionItem.classList.add("hidden");
  }
}

// Parse options builder
function getOptions() {
  const tsVal = timestampOption.value;
  let timestampInterval = 0;
  let timestampsEveryCue = false;
  if (tsVal === "cue") {
    timestampsEveryCue = true;
  } else if (tsVal !== "none") {
    timestampInterval = parseInt(tsVal, 10);
  }

  return {
    paragraphBreakMode: paragraphMode.value,
    gapThreshold: parseFloat(gapThreshold.value) || 2.0,
    timestampInterval,
    timestampsEveryCue,
    keepSpeakerLabels: keepSpeakers.checked,
    removeSoundTags: removeSoundTags.checked,
  };
}

// Process files or paste
function reprocessAll() {
  const options = getOptions();

  if (filesState.length > 0) {
    filesState.forEach(file => {
      file.transcript = subtitleToText(file.content, options);
      file.stats = getTranscriptStats(file.transcript);
    });
    renderActiveFile();
  } else if (pasteInput.value.trim()) {
    const transcript = subtitleToText(pasteInput.value, options);
    const stats = getTranscriptStats(transcript);
    outputArea.value = transcript;
    renderStats(stats);
  } else {
    outputArea.value = "";
    renderStats({ words: 0, characters: 0, readingTimeMinutes: 0 });
  }
}

function renderStats(stats) {
  wordCountEl.textContent = `${stats.words.toLocaleString()} words`;
  charCountEl.textContent = `${stats.characters.toLocaleString()} characters`;
  readTimeEl.textContent = `${stats.readingTimeMinutes} min read`;
}

function renderActiveFile() {
  if (filesState.length === 0) {
    fileTabsWrapper.classList.add("hidden");
    downloadAllBtn.classList.add("hidden");
    return;
  }

  fileTabsWrapper.classList.remove("hidden");
  if (filesState.length > 1) {
    downloadAllBtn.classList.remove("hidden");
  } else {
    downloadAllBtn.classList.add("hidden");
  }

  // Render tabs
  fileTabs.innerHTML = "";
  filesState.forEach((file, idx) => {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = `file-tab ${idx === activeFileIndex ? "active" : ""}`;
    tab.textContent = file.name;
    tab.addEventListener("click", () => {
      activeFileIndex = idx;
      renderActiveFile();
    });
    fileTabs.appendChild(tab);
  });

  const active = filesState[activeFileIndex] || filesState[0];
  if (active) {
    outputArea.value = active.transcript;
    renderStats(active.stats);
  }
}

// File Handling
browseBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  fileInput.click();
});

dropzone.addEventListener("click", () => {
  fileInput.click();
});

dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.classList.add("dragover");
});

dropzone.addEventListener("dragleave", () => {
  dropzone.classList.remove("dragover");
});

dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("dragover");
  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    handleUploadedFiles(e.dataTransfer.files);
  }
});

fileInput.addEventListener("change", () => {
  if (fileInput.files && fileInput.files.length > 0) {
    handleUploadedFiles(fileInput.files);
  }
});

function handleUploadedFiles(fileList) {
  pasteInput.value = "";
  const filesArray = Array.from(fileList);
  let loadedCount = 0;

  filesState = [];

  filesArray.forEach((file) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target.result;
      filesState.push({
        id: Math.random().toString(36).slice(2),
        name: file.name,
        content,
        transcript: "",
        stats: { words: 0, characters: 0, readingTimeMinutes: 0 },
      });
      loadedCount++;
      if (loadedCount === filesArray.length) {
        activeFileIndex = 0;
        reprocessAll();
      }
    };
    reader.readAsText(file, "utf-8");
  });
}

// Paste handling
pasteInput.addEventListener("input", () => {
  if (pasteInput.value.trim()) {
    filesState = [];
    fileTabsWrapper.classList.add("hidden");
    downloadAllBtn.classList.add("hidden");
  }
  reprocessAll();
});

// Copy button
copyBtn.addEventListener("click", async () => {
  const text = outputArea.value;
  if (!text) return;

  try {
    await navigator.clipboard.writeText(text);
    showToast("Copied to clipboard!");
  } catch {
    // Fallback
    outputArea.select();
    document.execCommand("copy");
    showToast("Copied to clipboard!");
  }
});

function showToast(message) {
  toast.textContent = message;
  toast.classList.remove("hidden");
  setTimeout(() => {
    toast.classList.add("hidden");
  }, 2200);
}

// Download active file
downloadBtn.addEventListener("click", () => {
  const text = outputArea.value;
  if (!text) return;

  let filename = "transcript.txt";
  if (filesState.length > 0 && filesState[activeFileIndex]) {
    const originalName = filesState[activeFileIndex].name;
    filename = originalName.replace(/\.[^/.]+$/, "") + "_transcript.txt";
  }

  triggerDownload(filename, text);
});

// Download all combined
downloadAllBtn.addEventListener("click", () => {
  if (filesState.length === 0) return;

  const combined = filesState.map(f => `=== ${f.name} ===\n\n${f.transcript}`).join("\n\n\n");
  triggerDownload("combined_transcripts.txt", combined);
});

function triggerDownload(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Clear button
clearBtn.addEventListener("click", () => {
  filesState = [];
  fileInput.value = "";
  pasteInput.value = "";
  outputArea.value = "";
  fileTabsWrapper.classList.add("hidden");
  downloadAllBtn.classList.add("hidden");
  renderStats({ words: 0, characters: 0, readingTimeMinutes: 0 });
});