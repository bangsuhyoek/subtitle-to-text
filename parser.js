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

export function cleanCueText(rawText, options = {}) {
  const {
    keepSpeakerLabels = true,
    removeSoundTags = false,
  } = options;

  let text = rawText;

  // Handle ASS/SSA override tags like {\an8}, {\pos(x,y)}
  text = text.replace(/\{[^}]*\}/g, "");

  // Extract or strip speaker labels from <v Speaker> or <v.class Speaker>
  if (keepSpeakerLabels) {
    text = text.replace(/<v(?:\.[^ >]+)?\s+([^>]+)>(.*?)(?:<\/v>|$)/gis, (match, speaker, speech) => {
      const cleanSpeaker = speaker.trim().replace(/["']/g, "");
      const cleanSpeech = speech.trim();
      return cleanSpeaker ? `${cleanSpeaker}: ${cleanSpeech}` : cleanSpeech;
    });
  } else {
    text = text.replace(/<\/?v(?:\.[^ >]+)?(?:\s+[^>]+)?>/gi, "");
  }

  // Strip remaining HTML / WebVTT tags (e.g. <i>, <b>, <u>, <c>, <c.yellow>, <ruby>, <rt>, etc.)
  text = text.replace(/<\/?[a-zA-Z][^>]*>/g, "");

  // Decode HTML entities
  text = decodeHtmlEntities(text);

  // Remove sound effect tags like [Music], (Applause), [Laughter], [cheering], etc.
  if (removeSoundTags) {
    text = text.replace(/\[(?:music|applause|laughter|laughing|laughs|chuckle|gasp|cheering|cheers|sigh|groan|cough|screaming|crying|sobbing|silence|snicker|bell|tune|sound|noise|whisper|inaudible|snort|guitar|piano|drum|singing|song|screams)[^\]]*\]/gi, "");
    text = text.replace(/\((?:music|applause|laughter|laughing|laughs|chuckle|gasp|cheering|cheers|sigh|groan|cough|screaming|crying|sobbing|silence|snicker|bell|tune|sound|noise|whisper|inaudible|snort|guitar|piano|drum|singing|song|screams)[^\)]*\)/gi, "");
    text = text.replace(/[♪♫]+/g, "");
  }

  return text.trim();
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
  const cleaned = cleanCueText(rawText, options);
  return {
    id: cue.id,
    start: cue.start,
    end: cue.end,
    rawText,
    text: cleaned,
  };
}

export function deduplicateRollingCaptions(cues) {
  if (!cues || cues.length === 0) return [];

  const result = [];

  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    if (!cue.text) continue;

    if (result.length === 0) {
      result.push({ ...cue });
      continue;
    }

    const prev = result[result.length - 1];

    if (cue.text.toLowerCase() === prev.text.toLowerCase()) {
      continue;
    }

    const prevLines = prev.text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const currLines = cue.text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

    let filteredCurrLines = currLines;
    if (prevLines.length > 0 && currLines.length > 1) {
      const lastPrev = prevLines[prevLines.length - 1];
      if (currLines[0] === lastPrev) {
        filteredCurrLines = currLines.slice(1);
      }
    }

    let candidateText = filteredCurrLines.join(" ");

    const prevWords = prev.text.split(/\s+/).filter(Boolean);
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
      text: cleanCandidate,
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
  } = options;

  if (!cues || cues.length === 0) return "";

  const paragraphs = [];
  let currentParagraph = [];
  let lastTimestampMarked = -1;
  let lastCue = null;

  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    let cueText = cue.text.trim();
    if (!cueText) continue;

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
    if (lastCue && currentParagraph.length > 0) {
      if (paragraphBreakMode === "cues") {
        needNewParagraph = true;
      } else if (paragraphBreakMode === "gap") {
        const gap = cue.start - lastCue.end;
        if (gap >= gapThreshold) {
          needNewParagraph = true;
        }
      } else if (paragraphBreakMode === "sentence") {
        const prevText = lastCue.text.trim();
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

    currentParagraph.push(timestampPrefix && !timestampPrefix.includes("\n\n") ? (timestampPrefix + cueText).trim() : cueText);
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
  const rawCues = parseCues(content, options);
  const dedupedCues = deduplicateRollingCaptions(rawCues);
  return formatTranscript(dedupedCues, options);
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
