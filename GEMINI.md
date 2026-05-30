# Mimick Gemini API Integration Guide for AI Agents

Welcome to Mimick! This guide provides the necessary technical context, architecture details, and developer guidelines for AI Agents modifying or maintaining the Gemini API integration in this application.

## 1. Architecture Overview
Mimick is a language reproduction training (shadowing/reproduction) application supporting English, Korean, and Spanish. It uses Google's Gemini API for three main features:
- **Semantic Chunking**: Analyzing input text and dividing it into semantically natural fragments for three cognitive load difficulties (Easy, Normal, Hard).
- **Context-Aware Translation**: Providing accurate Japanese translations of specific chunks while considering the overall context of the lesson text.
- **Steerable Text-to-Speech (TTS)**: Generating high-fidelity spoken audio of the training chunks with prebuilt voices.

---

## 2. Model Configuration Matrix

Always use the designated stable model IDs listed below. Do not use deprecated preview IDs.

| Feature / Modality | Purpose | Primary Model ID | Fallback Model ID | API Endpoint |
| :--- | :--- | :--- | :--- | :--- |
| **Text Generation** | Translation & Semantic Chunking | `gemini-3.1-flash-lite` | *None* | `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent` |
| **Speech Generation (TTS)** | High-fidelity audio generation | `gemini-3.1-flash-tts-preview` | `gemini-2.5-flash-preview-tts` | `https://generativelanguage.googleapis.com/v1beta/models/{modelId}:generateContent` |

---

## 3. Key Functions & Workflows

### 3.1. Text-to-Speech (`generateSpeechWithRetry`)
Located in [App.tsx](file:///Users/kentaktwo/projects/katk3n/mimick/src/App.tsx).
- **Endpoint**: Uses `gemini-3.1-flash-tts-preview` by default.
- **Dynamic Fallback Recovery**: If a rate limit (`429`) or server error (`5xx`/network failure) is encountered, the generator seamlessly falls back to `gemini-2.5-flash-preview-tts` for subsequent retry attempts, ensuring robust playback availability.
- **Request Modality**: Configured to `AUDIO` output.
- **Response Format**: Extracts inline base64 audio data.
- **WAV Packaging**: Since the inline API response gives raw audio data, the application packages the raw audio data into a client-side WAV container using the utility `createWavFile`.
- **Steerable Speech Pacing**:
  - The actual Character Per Second (CPS) is calculated from the generated audio duration.
  - A dynamic pacing correction rate is computed against a language target CPS (English/Spanish: 13.5 CPS, Korean: 7.5 CPS).
  - This correction rate adjusts the playback rate of the audio element to guarantee a consistent and natural reading speed.

```typescript
const payload = {
  contents: [{ parts: [{ text: ttsText }] }],
  generationConfig: {
    responseModalities: ["AUDIO"],
    speechConfig: {
      voiceConfig: { prebuiltVoiceConfig: { voiceName: finalVoiceName } }
    }
  }
};
```

### 3.2. Semantic Chunking (`generateSemanticChunksWithGemini`)
Located in [App.tsx](file:///Users/kentaktwo/projects/katk3n/mimick/src/App.tsx).
- **Endpoint**: Uses `gemini-3.1-flash-lite` with Structured JSON Output (`responseMimeType: "application/json"`).
- **System Instruction**: Prompts Gemini as a pedagogical expert to segment a text into natural, grammatical constituent-aligned parts corresponding to `easy`, `normal`, and `hard` difficulties, while also generating full Japanese translations for each chunk in a flat lookup list.
- **Response Schema**:
```json
{
  "chunks": {
    "easy": ["string"],
    "normal": ["string"],
    "hard": ["string"]
  },
  "translations": [
    { "text": "string", "translation": "string" }
  ]
}
```

### 3.3. Chunk-level Translation Fallback (`translateChunkWithRetry`)
- **Endpoint**: Uses `gemini-3.1-flash-lite`.
- **Purpose**: If a specific chunk does not have a pre-computed translation inside the lesson payload, it queries the translation model dynamically on-demand, injecting the full text context to avoid literal/robotic translations.

---

## 4. Audio Cache & Eviction System

To preserve API quota and avoid latency, synthesized audio clips are cached in `localStorage`.
- **Storage Format**: Stored as a JSON object containing `{ base64Data, sampleRate, duration }` under the key format:
  `mimick_audio_${lessonId}_${difficulty}_${voiceGender}_${index}`
- **Eviction Strategy (`setCachedAudio`)**:
  - If a `QuotaExceededError` is caught during cache write, older audio cache entries of **other** lessons are evicted first.
  - If storage is still insufficient, older indices of the current lesson are evicted.
  - Always handle quota errors gracefully so that the application remains functional even if local storage is full.

---

## 5. Development Guidelines for Future Agents

When modifying this integration, strictly adhere to these practices:

1. **Maintain Retries & Exponential Backoff**:
   Gemini API calls must remain robust. The codebase relies on delay-based retries (e.g., `[1000, 2000, 4000, 8000]`) to gracefully handle rate limits (429 errors). Do not strip these loops out.
2. **Preserve Audio Modality Configuration**:
   When updating TTS parameters, ensure the modality list remains `["AUDIO"]`.
3. **Respect Structured JSON Schemas**:
   If changing semantic chunking prompts, update `responseSchema` accordingly to prevent parsing exceptions.
4. **Client-side Performance Optimization**:
   Audio caching is critical. Do not perform redundant API requests. Always check `localStorage` and `audioCache` memory refs before initiating a network fetch.
5. **Preserve Dual-Model TTS Fallback Strategy**:
   Always prioritize the high-fidelity `gemini-3.1-flash-tts-preview` model but preserve the automatic recovery fallback to `gemini-2.5-flash-preview-tts` on network, server, or rate-limiting failures to keep the shadowing feature uninterrupted.
6. **Defend Against Prompt Injection**:
   Wrap any user-provided inputs (e.g. prompt text in the lesson generator) with strict delimiters (such as triple quotes `"""`) and enforce safety constraints in the `systemInstruction` to ensure the API treats inputs strictly as text rather than executable commands.


