# ASL Spaced-Repetition Trainer

Browser-based American Sign Language practice app that schedules reviews with a simplified SM2 algorithm and uses on-device hand‑pose detection for real‑time feedback.

## Features

- Spaced-repetition system tracks progress and shows signs when they are due.
- Two modes: **Start Review** for scheduled practice and **Practice** for free exploration.
- Real-time AI recognition for **I Love You**, **More**, **Help**, and **Stop** using TensorFlow hand-pose models.
- Manual grading available for all signs; processing runs entirely in the browser.

## Current Limitations

- Only a small set of signs have AI recognition; others require manual grading.
- Heuristic approach may mis-detect with poor lighting or off-camera hands.
- Motion, face, or body context is not yet supported.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the development server:
   ```bash
   npm run dev
   ```
   The app opens at <http://localhost:5173/>.

## Build

- Create a production build:
  ```bash
  npm run build
  ```
- Preview the built app:
  ```bash
  npm run preview
  ```

## Camera & AI Requirements

- A modern browser with WebGL and webcam support.
- Grant camera access when prompted; keep hands centered and well lit.
- AI runs locally in your browser—no video is uploaded.

## Usage

### Start Review

- On the home screen, click **Start Review** to work through signs due today.
- AI-supported signs are checked automatically; use **Mark Correct** or **Mark Again** to record progress for all signs.

### Practice

- Select any sign from the **All Signs** grid to practice freely.
- Exit when finished; progress is saved if you mark results.

## Troubleshooting

- **Camera/AI unavailable** – ensure your webcam is connected, allow browser permissions, and close other apps using the camera. The app falls back to manual practice if AI fails.
- **No signs due** – **Start Review** will be disabled; choose a sign from the grid to practice.
- **Recognition inconsistent** – improve lighting, keep hands within the frame, or rely on manual grading.
- **Reset progress** – clear browser storage for key `asl_srs_v1`.

