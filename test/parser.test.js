import test from "node:test";
import assert from "node:assert/strict";
import {
  parseTimestamp,
  formatTimestamp,
  cleanCueText,
  parseCues,
  deduplicateRollingCaptions,
  formatTranscript,
  subtitleToText,
  getTranscriptStats,
} from "../parser.js";

test("parseTimestamp parses various timestamp formats", () => {
  assert.equal(parseTimestamp("00:01:23.456"), 83.456);
  assert.equal(parseTimestamp("00:01:23,456"), 83.456);
  assert.equal(parseTimestamp("01:23.456"), 83.456);
  assert.equal(parseTimestamp("01:00:00.000"), 3600);
});

test("formatTimestamp formats to clean timestamp brackets", () => {
  assert.equal(formatTimestamp(83), "[01:23]");
  assert.equal(formatTimestamp(3665), "[01:01:05]");
  assert.equal(formatTimestamp(83, true), "[00:01:23]");
});

test("cleanCueText handles HTML, tags, entities, and sound tags", () => {
  // Tags removal
  assert.equal(cleanCueText("<i>Italics</i> and <b>bold</b>"), "Italics and bold");
  assert.equal(cleanCueText("<c.yellow>Colored</c> text"), "Colored text");
  assert.equal(cleanCueText("{\\an8}SubStation Alpha tag"), "SubStation Alpha tag");

  // YouTube word-timing tags and <c> tags
  assert.equal(cleanCueText("welcome<00:00:01.250><c> back</c><00:00:01.800><c> everyone</c>"), "welcome back everyone");

  // HTML entities
  assert.equal(cleanCueText("Cats &amp; dogs &quot;quote&#39; &#65; &#x42;"), 'Cats & dogs "quote\' A B');

  // Speaker labels
  assert.equal(cleanCueText("<v John Doe>Hello everyone</v>", { keepSpeakerLabels: true }), "John Doe: Hello everyone");
  assert.equal(cleanCueText("<v John Doe>Hello everyone</v>", { keepSpeakerLabels: false }), "Hello everyone");
  assert.equal(cleanCueText("<v.loud Dr. Smith>Warning!</v>", { keepSpeakerLabels: true }), "Dr. Smith: Warning!");

  // Sound effect tags removal
  assert.equal(cleanCueText("Hello [Music] world (Applause)", { removeSoundTags: true }), "Hello  world");
  assert.equal(cleanCueText("♪ Singing songs ♪", { removeSoundTags: true }), "Singing songs");
});

test("parseCues handles basic SRT", () => {
  const srt = `1
00:00:01,000 --> 00:00:03,000
Hello world

2
00:00:03,500 --> 00:00:06,000
Welcome to the video.`;

  const cues = parseCues(srt);
  assert.equal(cues.length, 2);
  assert.equal(cues[0].start, 1.0);
  assert.equal(cues[0].end, 3.0);
  assert.equal(cues[0].text, "Hello world");
  assert.equal(cues[1].text, "Welcome to the video.");
});

test("parseCues handles SRT with UTF-8 BOM and CRLF", () => {
  const srtWithBom = "\uFEFF1\r\n00:00:01,000 --> 00:00:03,000\r\nFirst line\r\n\r\n2\r\n00:00:04,000 --> 00:00:06,000\r\nSecond line\r\n";
  const cues = parseCues(srtWithBom);
  assert.equal(cues.length, 2);
  assert.equal(cues[0].text, "First line");
  assert.equal(cues[1].text, "Second line");
});

test("parseCues handles WebVTT with header, NOTE, STYLE, REGION, and cue settings", () => {
  const vtt = `WEBVTT - Header info

NOTE This is a note comment
that spans multiple lines

STYLE
::cue { color: lime; }

REGION
id:top width:40% lines:3

cue-1
00:01.000 --> 00:04.000 line:0 position:20% align:start
<v Alice>Hi Bob!</v>

00:04.500 --> 00:07.000
<v Bob>Hey Alice!</v>`;

  const cues = parseCues(vtt, { keepSpeakerLabels: true });
  assert.equal(cues.length, 2);
  assert.equal(cues[0].text, "Alice: Hi Bob!");
  assert.equal(cues[1].text, "Bob: Hey Alice!");
});

test("deduplicateRollingCaptions handles YouTube rolling captions", () => {
  const rawCues = [
    { start: 0, end: 2, text: "welcome back everyone" },
    { start: 2, end: 4, text: "welcome back everyone\nto today's video" },
    { start: 4, end: 6, text: "to today's video\nwhere we discuss transcripts" },
  ];

  const deduped = deduplicateRollingCaptions(rawCues);
  assert.equal(deduped.length, 3);
  assert.equal(deduped[0].text, "welcome back everyone");
  assert.equal(deduped[1].text, "to today's video");
  assert.equal(deduped[2].text, "where we discuss transcripts");
});

test("realistic YouTube auto-caption VTT with word timings and rolling duplicates", () => {
  const ytVtt = `WEBVTT
Kind: captions
Language: en

00:00:01.000 --> 00:00:03.000
welcome<00:00:01.250><c> back</c><00:00:01.800><c> everyone</c>

00:00:03.000 --> 00:00:05.000
welcome back everyone
to<00:00:03.450><c> today's</c><00:00:04.100><c> video</c>

00:00:05.000 --> 00:00:07.000
to today's video
where<00:00:05.300><c> we</c><00:00:05.900><c> build</c><00:00:06.400><c> tools</c>`;

  const transcript = subtitleToText(ytVtt);
  // Assert no "<" tag character exists in the output
  assert.equal(transcript.includes("<"), false);
  assert.equal(transcript.includes(">"), false);

  // Assert no repeated phrase exists in output
  assert.equal(transcript, "welcome back everyone to today's video where we build tools");
});

test("dedupeRolling option toggle is respected", () => {
  const srtDuplicates = `1
00:00:01,000 --> 00:00:03,000
Line one

2
00:00:03,000 --> 00:00:05,000
Line one
Line two`;

  const withDedupe = subtitleToText(srtDuplicates, { dedupeRolling: true });
  assert.equal(withDedupe, "Line one Line two");

  const withoutDedupe = subtitleToText(srtDuplicates, { dedupeRolling: false });
  assert.equal(withoutDedupe, "Line one Line one Line two");
});

test("formatTranscript groups paragraphs by time gap", () => {
  const cues = [
    { start: 0, end: 2, text: "Sentence one." },
    { start: 2.2, end: 3.5, text: "Sentence two." },
    { start: 7.0, end: 9.0, text: "Sentence three after pause." },
  ];

  const result = formatTranscript(cues, { paragraphBreakMode: "gap", gapThreshold: 2.0 });
  assert.equal(result, "Sentence one. Sentence two.\n\nSentence three after pause.");
});

test("formatTranscript groups paragraphs by sentence boundary", () => {
  const cues = [
    { start: 0, end: 2, text: "Hello there." },
    { start: 2.1, end: 4.0, text: "How are you doing today?" },
    { start: 4.1, end: 6.0, text: "I am fine!" },
  ];

  const result = formatTranscript(cues, { paragraphBreakMode: "sentence" });
  assert.equal(result, "Hello there.\n\nHow are you doing today?\n\nI am fine!");
});

test("formatTranscript inserts timestamp intervals", () => {
  const cues = [
    { start: 5, end: 10, text: "Introduction part." },
    { start: 65, end: 70, text: "One minute later." },
  ];

  const result = formatTranscript(cues, { timestampInterval: 60 });
  assert.ok(result.includes("[00:00:00]"));
  assert.ok(result.includes("[00:01:00]"));
});

test("subtitleToText end-to-end converts SRT to clean text", () => {
  const srt = `1
00:00:01,000 --> 00:00:03,000
<i>[Music]</i> Welcome!

2
00:00:03,100 --> 00:00:05,000
Today we test subtitles.`;

  const transcript = subtitleToText(srt, { removeSoundTags: true });
  assert.equal(transcript, "Welcome! Today we test subtitles.");
});

test("getTranscriptStats calculates words and reading time", () => {
  const stats = getTranscriptStats("Hello world from unit tests.");
  assert.equal(stats.words, 5);
  assert.equal(stats.readingTimeMinutes, 1);
});

test("rolling YouTube captions with <v Alex> on every cue emits single speaker prefix and no duplicates", () => {
  const vtt = `WEBVTT

00:00:01.000 --> 00:00:03.000
<v Alex>Most auto-generated captions</v>
repeat previous lines to smooth scrolling

00:00:03.000 --> 00:00:05.000
<v Alex>repeat previous lines to smooth scrolling</v>
which creates duplicate sentences

00:00:05.000 --> 00:00:07.000
<v Alex>which creates duplicate sentences</v>
when you copy the text into notes`;

  const transcript = subtitleToText(vtt, { dedupeRolling: true, keepSpeakerLabels: true });
  assert.equal(
    transcript,
    "Alex: Most auto-generated captions repeat previous lines to smooth scrolling which creates duplicate sentences when you copy the text into notes"
  );
});

test("alternating speakers create a new paragraph per speaker change", () => {
  const vtt = `WEBVTT

00:00:01.000 --> 00:00:02.500
<v Alex>Hello Maya, welcome to the show.</v>

00:00:02.600 --> 00:00:04.000
<v Maya>Thanks Alex, glad to be here.</v>

00:00:04.100 --> 00:00:05.500
<v Alex>Let us talk about subtitles.</v>`;

  const transcript = subtitleToText(vtt, { keepSpeakerLabels: true });
  const expected = "Alex: Hello Maya, welcome to the show.\n\nMaya: Thanks Alex, glad to be here.\n\nAlex: Let us talk about subtitles.";
  assert.equal(transcript, expected);
});
