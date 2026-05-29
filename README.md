# Mimick - AI-Powered Reproduction (Listen & Repeat) Training App

Mimick is a web application designed to help language learners perform "reproduction training" (widely known as "Listen and Repeat" or sentence repetition) and "shadowing" effectively using **Gemini API** for **English, Korean, and Spanish**.

---

## 🌟 Key Features

*   **Automatic Language Detection**: Instantly detects whether the input text is in English (EN), Korean (KR), or Spanish (ES).
*   **AI-Powered Speech Synthesis (Gemini TTS)**: Generates high-quality, clear AI voices (Aoede voice) on-demand for each chunk.
*   **Intelligent Text Chunking**: 
    *   Automatically splits text into meaningful semantic chunks based on grammar and particles.
    *   Dynamic adjustment of chunk lengths based on difficulty level (Easy / Normal / Hard).
*   **Blind Training Mode (Blurred Text)**:
    *   By default, the original text is blurred, allowing you to focus entirely on listening.
    *   You can click on individual chunks to temporarily reveal them.
*   **Contextual Translation**: 
    *   Generates extremely natural Japanese translations for each chunk by analyzing the context of the entire text using `gemini-2.5-flash`.
*   **Playback Speed Control**: Seamlessly adjust the audio speed from 0.5x to 2.0x.
*   **Custom Lesson Input**: Add custom texts such as news, TED talks, or drama scripts to practice with instantly.
*   **Secure API Key Management (Bring Your Own Key)**:
    *   Your Gemini API key is stored safely in your browser's local storage (`localStorage`). It is never uploaded to any external server.

---

## 🛠 Tech Stack

*   **Frontend**: React, TypeScript, Vite
*   **Styling**: Tailwind CSS v4
*   **Icons**: Lucide React
*   **APIs**: Gemini API (Google AI Studio)
    *   Models: `gemini-2.5-flash` (for translations) / `gemini-2.5-flash-preview-tts` (for speech synthesis)

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
