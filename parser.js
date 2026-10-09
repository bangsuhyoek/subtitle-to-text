/**
 * Subtitle to Text Parser
 * Pure client-side / ESM & Node compatible parser for SRT and WebVTT subtitles.
 */

export function decodeHtmlEntities(str) {
  if (!str) return "";
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      try {
        return String.fromCodePoint(parseInt(hex, 16));
      } catch {
        return "";
      }
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      try {
        return String.fromCodePoint(parseInt(dec, 10));
      } catch {
        return "";
      }
    });
}

export function parseTimestamp(timeStr) {
  if (!timeStr) return 0;
  const match = timeStr.trim().match(/^(?:(\d{1,2}):)?(\d{2}):(\d{2})[.,](\d{3})$/);
  if (!match) return 0;
  const hours = match[1] ? parseInt(match[1], 10) : 0;
  const minutes = parseInt(match[2], 10);
  const seconds = parseInt(match[3], 10);
  const milliseconds = parseInt(match[4], 10);
  return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
}

export function formatTimestamp(seconds, forceHours = false) {
  const s = Math.floor(seconds);
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;

  const pad = (n) => String(n).padStart(2, "0");
  if (hrs > 0 || forceHours) {
    return `[${pad(hrs)}:${pad(mins)}:${pad(secs)}]`;
  }
  return `[${pad(mins)}:${pad(secs)}]`;
}

export function extractSpeakerAndCleanSpeech(rawText) {
  let speaker = null;
  let text = rawText;

  // Check for <v Speaker> or <v.class Speaker>
  const vRegex = new RegExp("<v(?:\\.[^ >]+)?\\s+([^>]+)>(.*?)(?:<\\/v>|$)", "is");
  const vMatch = text.match(vRegex);
  if (vMatch) {
    speaker = vMatch[1].trim().replace(/["']/g, "");
    text = text.replace(new RegExp("<v(?:\\.[^ >]+)?\\s+([^>]+)>(.*?)(?:<\\/v>|$)", "gis"), "$2");
  } else {
    text = text.replace(new RegExp("<\\/?v(?:\\.[^ >]+)?(?:\\s+[^>]+)?>", "gi"), "");
  }

  return { speaker, text };
}

export function cleanCueText(rawText, options = {}) {
  const {
    keepSpeakerLabels = true,
    removeSoundTags = false,
  } = options;

  let { speaker, text } = extractSpeakerAndCleanSpeech(rawText);

  // Handle ASS/SSA override tags like {\an8}, {\pos(x,y)}
  text = text.replace(/\{[^}]*\}/g, "");

  // Strip YouTube word-timing tags like <00:00:01.234>, <01:23.456>, <00:01:23,456>
  text = text.replace(/<(?:\d{1,2}:)?\d{2}:\d{2}[.,]\d{3}>/g, "");

  // Strip remaining HTML / WebVTT / inline tags (e.g. <c>, </c>, <i>, <b>, <u>, <c.yellow>, <ruby>, <rt>, etc.)
  text = text.replace(/<[^>]+>/g, "");

  // Decode HTML entities
  text = decodeHtmlEntities(text);

  // Remove sound effect tags like [Music], (Applause), [Laughter], [cheering], etc.
  if (removeSoundTags) {
    text = text.replace(/\[(?:music|applause|laughter|laughing|laughs|chuckle|gasp|cheering|cheers|sigh|groan|cough|screaming|crying|sobbing|silence|snicker|bell|tune|sound|noise|whisper|inaudible|snort|guitar|piano|drum|singing|song|screams)[^\]]*\]/gi, "");
    text = text.replace(/\((?:music|applause|laughter|laughing|laughs|chuckle|gasp|cheering|cheers|sigh|groan|cough|screaming|crying|sobbing|silence|snicker|bell|tune|sound|noise|whisper|inaudible|snort|guitar|piano|drum|singing|song|screams)[^\)]*\)/gi, "");
    text = text.replace(/[♪♫]+/g, "");
  }

  text = text.trim();

  // If keepSpeakerLabels is true and speaker exists, prepend speaker label
  if (keepSpeakerLabels && speaker && text) {
    return `${speaker}: ${text}`;
  }

  return text;
}

export function parseCues(content, options = {}) {
  if (!content || typeof content !== "string") return [];

  // Strip BOM and normalize line endings
  let text = content.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Detect format
  const isVtt = /^\s*WEBVTT/i.test(text);

  const lines = text.split("\n");
  const cues = [];

  let inHeader = isVtt;
  let inNoteOrStyle = false;

  const timestampRegex = /^(?:(\d{1,2}:)?(\d{2}):(\d{2})[.,](\d{3}))\s*-->\s*(?:(\d{1,2}:)?(\d{2}):(\d{2})[.,](\d{3}))(.*)$/;

  let currentCue = null;
  let prevLineWasEmpty = true;
  let pendingIdentifier = null;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trim();

    if (line === "") {
      if (inHeader) {
        inHeader = false;
      }
      if (inNoteOrStyle) {
        inNoteOrStyle = false;
      }
      if (currentCue) {
        if (currentCue.lines.length > 0) {
          cues.push(finalizeCue(currentCue, options));
        }
        currentCue = null;
      }
      pendingIdentifier = null;
      prevLineWasEmpty = true;
      continue;
    }

    if (inHeader) {
      if (line.startsWith("NOTE") || line.startsWith("STYLE") || line.startsWith("REGION")) {
        inHeader = false;
        inNoteOrStyle = true;
      }
      continue;
    }

    if (line.startsWith("NOTE") || line.startsWith("STYLE") || line.startsWith("REGION")) {
      inNoteOrStyle = true;
      continue;
    }
    if (inNoteOrStyle) {
      continue;
    }

    const tsMatch = line.match(timestampRegex);
    if (tsMatch) {
      if (currentCue) {
        if (currentCue.lines.length > 0) {
          cues.push(finalizeCue(currentCue, options));
        }
        currentCue = null;
      }

      const startSec = parseTimestamp(tsMatch[0].split("-->")[0]);
      const endPart = tsMatch[0].split("-->")[1].trim().split(/\s+/)[0];
      const endSec = parseTimestamp(endPart);

      currentCue = {
        id: pendingIdentifier,
        start: startSec,
        end: endSec,
        lines: [],
      };
      pendingIdentifier = null;
      prevLineWasEmpty = false;
      continue;
    }

    if (currentCue) {
      currentCue.lines.push(line);
      prevLineWasEmpty = false;
      continue;
    }

    if (prevLineWasEmpty) {
      pendingIdentifier = line;
      prevLineWasEmpty = false;
    }
  }

  if (currentCue && currentCue.lines.length > 0) {
    cues.push(finalizeCue(currentCue, options));
  }

  return cues;
}

function finalizeCue(cue, options) {
  const rawLines = cue.lines;
  const dedupedLines = [];
  for (let l = 0; l < rawLines.length; l++) {
    if (l === 0 || rawLines[l] !== rawLines[l - 1]) {
      dedupedLines.push(rawLines[l]);
    }
  }
  const rawText = dedupedLines.join("\n");

  // Extract speaker if present in raw text
  const { speaker, text: strippedSpeechRaw } = extractSpeakerAndCleanSpeech(rawText);

  // Clean the spoken text WITHOUT speaker prefix
  const speechOnly = cleanCueText(strippedSpeechRaw, { ...options, keepSpeakerLabels: false });

  // Clean full text WITH speaker prefix for backward compatibility where needed
  const fullCleaned = cleanCueText(rawText, options);

  return {
    id: cue.id,
    start: cue.start,
    end: cue.end,
    rawText,
    speaker: speaker || null,
    speech: speechOnly,
    text: fullCleaned,
  };
}

export function deduplicateRollingCaptions(cues) {
  if (!cues || cues.length === 0) return [];

  const result = [];

  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    // Dedupe on spoken speech text (without speaker prefix) if present, fallback to cue.text
    const textToMatch = (cue.speech !== undefined ? cue.speech : cue.text) || "";
    if (!textToMatch) continue;

    if (result.length === 0) {
      result.push({
        ...cue,
        speech: textToMatch,
        text: cue.speaker ? `${cue.speaker}: ${textToMatch}` : textToMatch,
      });
      continue;
    }

    const prev = result[result.length - 1];
    const prevTextToMatch = (prev.speech !== undefined ? prev.speech : prev.text) || "";

    if (textToMatch.toLowerCase() === prevTextToMatch.toLowerCase()) {
      continue;
    }

    const prevLines = prevTextToMatch.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const currLines = textToMatch.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

    let filteredCurrLines = currLines;
    if (prevLines.length > 0 && currLines.length > 1) {
      const lastPrev = prevLines[prevLines.length - 1];
      if (currLines[0] === lastPrev) {
        filteredCurrLines = currLines.slice(1);
      }
    }

    let candidateText = filteredCurrLines.join(" ");

    const prevWords = prevTextToMatch.split(/\s+/).filter(Boolean);
    const currWords = candidateText.split(/\s+/).filter(Boolean);

    if (prevWords.length > 0 && currWords.length > 0) {
      const maxOverlapLen = Math.min(prevWords.length, currWords.length);
      let matchedLen = 0;

      for (let k = maxOverlapLen; k >= 2; k--) {
        const prevSuffix = prevWords.slice(prevWords.length - k).join(" ").toLowerCase();
        const currPrefix = currWords.slice(0, k).join(" ").toLowerCase();
        if (prevSuffix === currPrefix) {
          matchedLen = k;
          break;
        }
      }

      if (matchedLen > 0) {
        candidateText = currWords.slice(matchedLen).join(" ");
      }
    }

    const cleanCandidate = candidateText.trim();
    if (!cleanCandidate) {
      continue;
    }

    result.push({
      ...cue,
      speech: cleanCandidate,
      text: cue.speaker ? `${cue.speaker}: ${cleanCandidate}` : cleanCandidate,
    });
  }

  return result;
}

export function formatTranscript(cues, options = {}) {
  const {
    paragraphBreakMode = "gap",
    gapThreshold = 2.0,
    timestampInterval = 0,
    timestampsEveryCue = false,
    keepSpeakerLabels = true,
  } = options;

  if (!cues || cues.length === 0) return "";

  const paragraphs = [];
  let currentParagraph = [];
  let lastTimestampMarked = -1;
  let lastCue = null;
  let currentSpeaker = null;

  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    // Spoken text clean of speaker prefix
    const spokenText = (cue.speech !== undefined ? cue.speech : cue.text).replace(/\r?\n/g, " ").trim();
    if (!spokenText) continue;

    let timestampPrefix = "";
    if (timestampsEveryCue) {
      timestampPrefix = `${formatTimestamp(cue.start)} `;
    } else if (timestampInterval > 0) {
      const intervalIndex = Math.floor(cue.start / timestampInterval);
      if (intervalIndex > lastTimestampMarked) {
        const markTime = intervalIndex * timestampInterval;
        timestampPrefix = `\n\n${formatTimestamp(markTime, true)}\n`;
        lastTimestampMarked = intervalIndex;
      }
    }

    let needNewParagraph = false;
    const speakerChanged = cue.speaker !== currentSpeaker;

    if (lastCue && currentParagraph.length > 0) {
      if (keepSpeakerLabels && cue.speaker && speakerChanged) {
        // Speaker change starts a new paragraph
        needNewParagraph = true;
      } else if (paragraphBreakMode === "cues") {
        needNewParagraph = true;
      } else if (paragraphBreakMode === "gap") {
        const gap = cue.start - lastCue.end;
        if (gap >= gapThreshold) {
          needNewParagraph = true;
        }
      } else if (paragraphBreakMode === "sentence") {
        const prevText = (lastCue.speech !== undefined ? lastCue.speech : lastCue.text).trim();
        if (/[.?!][)"']?$/.test(prevText)) {
          needNewParagraph = true;
        }
      } else if (paragraphBreakMode === "continuous") {
        needNewParagraph = false;
      }
    }

    if (timestampPrefix.includes("\n\n")) {
      if (currentParagraph.length > 0) {
        paragraphs.push(currentParagraph.join(" "));
        currentParagraph = [];
      }
      paragraphs.push(timestampPrefix.trim());
    } else if (needNewParagraph && currentParagraph.length > 0) {
      paragraphs.push(currentParagraph.join(" "));
      currentParagraph = [];
    }

    // Determine text to add: only prepend speaker label if keepSpeakerLabels is true AND speaker changed
    let textToAdd = spokenText;
    if (keepSpeakerLabels && cue.speaker) {
      if (speakerChanged || currentParagraph.length === 0) {
        textToAdd = `${cue.speaker}: ${spokenText}`;
        currentSpeaker = cue.speaker;
      }
    } else {
      currentSpeaker = null;
    }

    currentParagraph.push(timestampPrefix && !timestampPrefix.includes("\n\n") ? (timestampPrefix + textToAdd).trim() : textToAdd);
    lastCue = cue;
  }

  if (currentParagraph.length > 0) {
    paragraphs.push(currentParagraph.join(" "));
  }

  return paragraphs
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function subtitleToText(content, options = {}) {
  const { dedupeRolling = true } = options;
  const rawCues = parseCues(content, options);
  const cuesToFormat = dedupeRolling ? deduplicateRollingCaptions(rawCues) : rawCues;
  return formatTranscript(cuesToFormat, options);
}

export function getTranscriptStats(text) {
  if (!text || !text.trim()) {
    return { words: 0, characters: 0, readingTimeMinutes: 0 };
  }
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const characters = text.length;
  const readingTimeMinutes = Math.ceil(words / 200);
  return { words, characters, readingTimeMinutes };
}
