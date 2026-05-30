# Mimick - AI-Powered Reproduction (Listen & Repeat) Training App

Mimick is a modern, static web application designed to help language learners perform "reproduction training" (widely known as "Listen and Repeat" or sentence repetition) and "shadowing" effectively using **Google Gemini API** for **English, Korean, and Spanish**.

---

## 🌟 Key Features

*   **Automatic Language Detection**: Instantly detects whether the input text is in English (EN), Korean (KR), or Spanish (ES).
*   **Next-Generation AI Speech Synthesis (Gemini 3.1 TTS)**: Generates incredibly high-fidelity spoken audio using the state-of-the-art `gemini-3.1-flash-tts-preview` model.
*   **Dual-Model TTS Fallback (Fault Tolerance)**:
    *   To guarantee highly reliable audio playback, the system features a built-in recovery mechanism. If the primary 3.1 TTS model hits a rate limit (429) or encounters temporary server/network failures, it seamlessly falls back to `gemini-2.5-flash-preview-tts` on subsequent retry attempts.
*   **Intelligent AI Semantic Chunking**: 
    *   Using `gemini-3.1-flash-lite`, the app segments sentences into natural, grammatical constituent-aligned parts based on actual semantic meaning and cognitive load.
    *   Supports three distinct pedagogical difficulty levels (**Easy / Normal / Hard**).
*   **Context-Aware Translations**: 
    *   Generates accurate, idiomatic Japanese translations for each chunk by analyzing the entire context of the lesson text using `gemini-3.1-flash-lite` rather than literal, robotic word-for-word translation.
*   **Granular Cache & Data Management**:
    *   **Per-Lesson Audio Cache Clearing**: Easily delete local storage audio cache for specific lessons directly from the home screen (`VolumeX` icon) to manage browser storage limits.
    *   **On-Demand AI Data Regeneration**: Recalculate AI semantic chunking and translation details via Gemini on-demand (`RefreshCw` icon) with intuitive card-level loading status.
*   **Blind Training Mode (Blurred Text)**:
    *   Original texts and translations are blurred by default, forcing you to focus entirely on auditory listening. Click individual chunks to temporarily reveal them.
*   **Advanced Sequencing Control**: Defers audio prefetching and playback automatically until AI chunking finishes, preventing visual/auditory mismatch. Falls back elegantly to regex-based local chunking on API failure to prevent lockups.
*   **Playback Speed Control**: Seamlessly adjust the audio speed from 0.5x to 2.0x.
*   **Secure API Key Management (Bring Your Own Key)**:
    *   Your Gemini API key is stored locally in your browser (`localStorage`). It is never sent to any third-party backend servers.

---

## 🛠 Tech Stack

*   **Frontend**: React, TypeScript, Vite
*   **Styling**: Tailwind CSS v4
*   **Icons**: Lucide React
*   **APIs**: Google Gemini API (Google AI Studio)
    *   **Text/Chunking Model**: `gemini-3.1-flash-lite`
    *   **TTS Model**: `gemini-3.1-flash-tts-preview` (with fallback to `gemini-2.5-flash-preview-tts`)

---

## 🚀 Local Development

### 1. Install Dependencies
Run the following command in the root directory of the project:
```bash
npm install
```

### 2. Start Dev Server
Run the local development server:
```bash
npm run dev
```
Open your browser and navigate to `http://localhost:5173`.

### 3. Build for Production
Generate the production-ready static assets in the `dist/` directory:
```bash
npm run build
```

---

## ☁️ Firebase Hosting Deployment

This project includes predefined Firebase Hosting configuration (`firebase.json`). Follow these steps to publish your app:

### 1. Create a Firebase Project
Create a new project in the [Firebase Console](https://console.firebase.google.com/).

### 2. Install Firebase CLI & Login
```bash
# Install Firebase Tools (if not already installed)
npm install -g firebase-tools

# Login to your Google account
firebase login
```

### 3. Connect Your Project
Run this in the root directory of the project and select the Firebase project you created:
```bash
firebase use --add
```

### 4. Build and Deploy
```bash
# Build the application
npm run build

# Deploy to Firebase Hosting
firebase deploy --only hosting
```
Once deployed, the CLI will display your public `Hosting URL`.

---

## 🔒 Security & Best Practices

*   This app is a static SPA (Single Page Application). Your **Gemini API Key** is stored exclusively in your browser's `localStorage`.
*   **Recommended Setting**: We highly recommend restricting your API key in the Google Cloud Console so that it **only allows access to the "Generative Language API"**. This minimizes potential damage if your API key is ever compromised.
