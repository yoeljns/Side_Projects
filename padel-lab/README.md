# Padel Lab

Put a phone on a tripod behind the court, record the match, load the video.
You get, per player, a position heatmap and the share of time at the net, plus
rally count and rally lengths, and a match log that tracks those against your
level over time.

Everything runs in the browser. The video never leaves the device, there is no
backend, and the match log is kept in `localStorage` (with JSON export/import).

## How it works

1. **Calibrate.** You tap four known floor points (by default where the two
   service lines meet the side walls). That gives a homography from image
   pixels to court metres.
2. **Track players.** The video plays at up to 4× while frames are sampled
   about five times per second of footage. A person detector (MediaPipe
   EfficientDet-Lite0) runs on crops that follow the court, because far-side
   players are too small to find in the full frame. Each box's bottom-centre is
   projected onto the floor; anything off the court is dropped. Players are
   followed per side of the net (two slots each side).
3. **Hear the hits.** The soundtrack goes through an audio worklet that
   measures high-passed energy. Sharp peaks well above the local background are
   hits; hits closer than 4.5 s apart form a rally.
4. **Stats.** Heatmaps (0.5 m cells), zone split (net = within 4 m of the net,
   transition = 4–7 m, back = beyond 7 m), distance, rally histogram.
   Positions can be counted during rallies only.

## Known limits

- **No ball tracking** (v2). Shot types, winners and errors are out of scope.
- "Hits per rally" counts loud impacts, so hard bounces off the glass inflate it.
  Rally count and duration are the dependable numbers.
- Partners on the same side can swap identities after crossing closely.
- A near-side player whose feet are below the frame is placed a little too deep.
- The camera must not move after calibration.
- The video has to be in a format the browser can play. iPhone HEVC plays in
  Safari and recent Chrome; otherwise export as H.264 MP4.
- Analysis pauses while the tab is hidden.

## Develop

```bash
npm install
```

```bash
npm run dev
```

```bash
npm test
```

```bash
npm run build
```

`npm run dev` and `npm run build` first copy the MediaPipe WASM runtime from
`node_modules` into `public/mediapipe/` (git-ignored). The detector model is
fetched from Google's MediaPipe model bucket at run time. Add `?delegate=cpu`
to the URL to force CPU inference.

## Layout

- `src/lib/court.ts` court dimensions, zones, calibration presets
- `src/lib/homography.ts` image ↔ court mapping
- `src/lib/tiles.ts`, `detector.ts` court-following crops and the person detector
- `src/lib/tracker.ts`, `stats.ts` four player tracks and their numbers
- `src/lib/audio.ts`, `hits.ts`, `public/hit-envelope.worklet.js` hit and rally detection
- `src/lib/analyzer.ts` the playback loop tying it together
- `src/lib/store.ts` match log
- `src/components/` screens and charts
