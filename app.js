import { subtitleToText, getTranscriptStats } from "./parser.js";

// Built-in realistic YouTube auto-caption VTT sample with word timings and rolling duplicates
const YOUTUBE_SAMPLE_VTT = `WEBVTT
Kind: captions
Language: en

00:00:01.000 --> 00:00:03.200
[Music]
welcome<00:00:01.350><c> back</c><00:00:01.850><c> everyone</c><00:00:02.300><c> to</c><00:00:02.800><c> the</c> channel

00:00:03.200 --> 00:00:05.600
welcome back everyone to the channel
today<00:00:03.550><c> we</c><00:00:03.950><c> are</c><00:00:04.250><c> looking</c><00:00:04.850><c> at</c><00:00:05.150><c> how</c>

00:00:05.600 --> 00:00:08.100
today we are looking at how
subtitles<00:00:06.050><c> work</c><00:00:06.550><c> across</c><00:00:07.100><c> modern</c> video platforms

00:00:08.100 --> 00:00:10.800
subtitles work across modern video platforms
and<00:00:08.550><c> why</c><00:00:09.100><c> raw</c><00:00:09.550><c> caption</c><00:00:10.050><c> files</c>

00:00:10.800 --> 00:00:13.400
and why raw caption files
are<00:00:11.200><c> so</c><00:00:11.700><c> frustrating</c><00:00:12.400><c> to</c> read directly

00:00:15.500 --> 00:00:18.000
<v Alex>Most auto-generated captions</v>
repeat<00:00:15.900><c> previous</c><00:00:16.500><c> lines</c><00:00:17.100><c> to</c> smooth scrolling

00:00:18.000 --> 00:00:20.500
<v Alex>repeat previous lines to smooth scrolling</v>
which<00:00:18.400><c> creates</c><00:00:19.000><c> duplicate</c><00:00:19.650><c> sentences</c>

00:00:20.500 --> 00:00:23.200
<v Alex>which creates duplicate sentences</v>
when<00:00:20.950><c> you</c><00:00:21.400><c> copy</c><00:00:22.000><c> the</c> text into notes

00:00:25.500 --> 00:00:28.200
<v Maya>When you strip the metadata</v>
and<00:00:26.100><c> merge</c><00:00:26.700><c> natural</c> speech pauses

00:00:28.200 --> 00:00:31.000
<v Maya>and merge natural speech pauses</v>
the<00:00:28.800><c> transcript</c><00:00:29.400><c> turns</c><00:00:30.000><c> into</c> clean prose`;

// State
let filesState = []; // [{ id, name, content, transcript, stats }]
let activeFileIndex = 0;

// DOM Elements
const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const browseBtn = document.getElementById("browseBtn");
const sampleBtn = document.getElementById("sampleBtn");
const pasteInput = document.getElementById("pasteInput");
const emptyState = document.getElementById("emptyState");
const fileTabsWrapper = document.getElementById("fileTabsWrapper");
const fileTabs = document.getElementById("fileTabs");

const segmentButtons = document.querySelectorAll(".segment-btn");
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
const outputDisplay = document.getElementById("outputDisplay");

const copyBtn = document.getElementById("copyBtn");
const downloadBtn = document.getElementById("downloadBtn");
const downloadAllBtn = document.getElementById("downloadAllBtn");
const clearBtn = document.getElementById("clearBtn");

const NO_CUES_MESSAGE = "No subtitle cues found. Please ensure the file or pasted text is a valid .srt or .vtt file with timestamps (e.g. 00:00:01,000 --> 00:00:04,000).";

// Segmented control handling
segmentButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    segmentButtons.forEach(b => {
      b.classList.remove("active");
      b.setAttribute("aria-checked", "false");
    });
    btn.classList.add("active");
    btn.setAttribute("aria-checked", "true");
    paragraphMode.value = btn.dataset.mode;
    updateGapVisibility();
    reprocessAll();
  });
});

// Options change listeners
[paragraphMode, gapThreshold, timestampOption, keepSpeakers, removeSoundTags, dedupeRolling].forEach(el => {
  if (el) {
    el.addEventListener("change", () => {
      updateGapVisibility();
      reprocessAll();
    });
  }
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
    dedupeRolling: dedupeRolling.checked,
  };
}

// Render formatted output document
function renderDocument(text) {
  if (!text) {
    outputDisplay.innerHTML = '<p class="placeholder-text">Your clean transcript will appear here.</p>';
    outputArea.value = "";
    return;
  }

  outputArea.value = text;

  if (text === NO_CUES_MESSAGE) {
    outputDisplay.innerHTML = `<p class="placeholder-text" style="color: #9F2F2D;">${text}</p>`;
    return;
  }

  const paragraphs = text.split(/\n\n+/);
  const html = paragraphs.map(p => {
    const escaped = escapeHtml(p).replace(/\n/g, "<br>");
    return `<p>${escaped}</p>`;
  }).join("");

  outputDisplay.innerHTML = html;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Process files or paste
function reprocessAll() {
  const options = getOptions();

  if (filesState.length > 0) {
    emptyState.classList.add("hidden");
    clearBtn.classList.remove("hidden");
    filesState.forEach(file => {
      file.transcript = subtitleToText(file.content, options);
      if (!file.transcript && file.content.trim()) {
        file.transcript = NO_CUES_MESSAGE;
        file.stats = { words: 0, characters: 0, readingTimeMinutes: 0 };
      } else {
        file.stats = getTranscriptStats(file.transcript);
      }
    });
    renderActiveFile();
  } else if (pasteInput.value.trim()) {
    emptyState.classList.add("hidden");
    clearBtn.classList.remove("hidden");
    const rawText = pasteInput.value.trim();
    const transcript = subtitleToText(rawText, options);
    if (!transcript) {
      renderDocument(NO_CUES_MESSAGE);
      renderStats({ words: 0, characters: 0, readingTimeMinutes: 0 });
    } else {
      renderDocument(transcript);
      const stats = getTranscriptStats(transcript);
      renderStats(stats);
    }
  } else {
    emptyState.classList.remove("hidden");
    clearBtn.classList.add("hidden");
    renderDocument("");
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

  pasteInput.value = filesState[activeFileIndex]?.content || "";

  if (filesState.length > 1) {
    fileTabsWrapper.classList.remove("hidden");
    downloadAllBtn.classList.remove("hidden");
  } else {
    fileTabsWrapper.classList.add("hidden");
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
    renderDocument(active.transcript);
    renderStats(active.stats);
  }
}

// File and sample interactions
browseBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  fileInput.click();
});

if (sampleBtn) {
  sampleBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    loadSample();
  });
}

function loadSample() {
  filesState = [];
  fileTabsWrapper.classList.add("hidden");
  downloadAllBtn.classList.add("hidden");
  pasteInput.value = YOUTUBE_SAMPLE_VTT;
  reprocessAll();
}

// Drag & drop on whole left pane
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

async function handleUploadedFiles(fileList) {
  pasteInput.value = "";
  const filesArray = Array.from(fileList);

  const loadedFiles = await Promise.all(
    filesArray.map(file => {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (event) => {
          resolve({
            id: Math.random().toString(36).slice(2),
            name: file.name,
            content: event.target.result,
            transcript: "",
            stats: { words: 0, characters: 0, readingTimeMinutes: 0 },
          });
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file, "utf-8");
      });
    })
  );

  filesState = loadedFiles;
  activeFileIndex = 0;
  reprocessAll();
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

// Copy button with 1.5s visual feedback
let copyTimeout = null;
copyBtn.addEventListener("click", async () => {
  const text = outputArea.value;
  if (!text || text === NO_CUES_MESSAGE) return;

  try {
    await navigator.clipboard.writeText(text);
  } catch {
    outputArea.select();
    document.execCommand("copy");
  }

  const originalText = copyBtn.textContent;
  copyBtn.textContent = "Copied";
  copyBtn.style.color = "var(--accent)";
  copyBtn.style.borderColor = "var(--accent)";
  clearTimeout(copyTimeout);
  copyTimeout = setTimeout(() => {
    copyBtn.textContent = originalText;
    copyBtn.style.color = "";
    copyBtn.style.borderColor = "";
  }, 1500);
});

// Download active file
downloadBtn.addEventListener("click", () => {
  const text = outputArea.value;
  if (!text || text === NO_CUES_MESSAGE) return;

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

  const combined = filesState
    .filter(f => f.transcript && f.transcript !== NO_CUES_MESSAGE)
    .map(f => `=== ${f.name} ===\n\n${f.transcript}`)
    .join("\n\n\n");
  if (!combined) return;
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
  clearBtn.classList.add("hidden");
  emptyState.classList.remove("hidden");
  renderDocument("");
  renderStats({ words: 0, characters: 0, readingTimeMinutes: 0 });
});

// Check ?sample=1 URL parameter on load
window.addEventListener("DOMContentLoaded", () => {
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get("sample") === "1" || urlParams.get("sample") === "true") {
    loadSample();
  }
});
