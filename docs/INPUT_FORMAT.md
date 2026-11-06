# INPUT_FORMAT v1 — owner-supplied meeting files

One meeting per brief. A meeting is a transcript file plus zero or more
screenshot frames.

## Transcript file

Plain UTF-8 text. One segment per line, exactly this shape:

```text
[MM:SS] Speaker: text
```

- `[MM:SS]` — minutes and zero-padded seconds (`[01:10]` = 70 seconds).
  Minutes may exceed 59 for long meetings (`[75:02]` is valid).
- `Speaker` — display name, no colon (e.g. `Dana Okafor`).
- `text` — the speaker's words on that line, non-empty.
- Blank lines are ignored. Anything else is a malformed line and the
  parser reports its line number.
- The segment id is derived from the timestamp: `[01:10]` becomes
  `t-01:10`. Two lines with the same timestamp are a duplicate id and
  are rejected.

Example (`hero.transcript.txt`):

```text
[00:05] Dana Okafor: Thanks for making time, Marco. Priya's on too, she runs our kitchen schedule.
[01:10] Marco Reyes: Let me share the proposal slide. Twelve thousand units, the 8-inch kraft box, two-color print.
```

## Frames (screenshots)

A frame is a PNG referenced by timestamp. Its id is derived the same
way: the slide shown at 70 seconds is `f-01:10`.

Two ways to attach frames:

1. **Filename convention** — `frame-MM-SS.png` (also `.jpg`/`.jpeg`),
   e.g. `frame-01-10.png` means t = 70 seconds.
2. **`frames.txt` sidecar** — one mapping per line, `<file> <MM:SS>`:

```text
frame-01-10.png 01:10
slide-q3.jpg 12:41
```

When both exist, the sidecar wins for files it names; otherwise the
filename convention applies. Duplicate frame ids are rejected.

## Normalizer inputs (converted TO this format)

`normalize.ts` converts these owner-supplied shapes into INPUT_FORMAT v1:

- WebVTT (`.vtt`) and SubRip (`.srt`) captions.
- Plain `Name: text` lines that carry a timestamp, e.g.
  `Dana Okafor (00:05): Thanks for making time.` or
  `00:05 Dana Okafor: Thanks for making time.`

PDF is explicitly out of scope (first on the cut list) and is rejected
by the normalizer.
