import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Play, 
  Volume2, 
  SkipBack, 
  SkipForward, 
  Eye, 
  EyeOff, 
  Gauge,
  Scissors,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Zap,
  Plus,
  X,
  Globe,
  ChevronLeft,
  Key,
  ExternalLink,
  Mic,
  Edit3,
  Trash2,
  RotateCcw,
  SlidersHorizontal
} from 'lucide-react';

// WAVファイルを作成するためのユーティリティ関数
const createWavFile = (base64Data: string, sampleRate: number) => {
  const binaryStr = atob(base64Data);
  const dataLen = binaryStr.length;
  const buffer = new ArrayBuffer(44 + dataLen);
  const view = new DataView(buffer);

  const writeString = (offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataLen, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, dataLen, true);

  for (let i = 0; i < dataLen; i++) {
    view.setUint8(44 + i, binaryStr.charCodeAt(i));
  }

  const duration = dataLen / (sampleRate * 2);

  return {
    blob: new Blob([buffer], { type: 'audio/wav' }),
    duration
  };
};

// 音声を永続保存するためのローカルストレージヘルパー
const getCachedAudio = (lessonId: number, difficulty: string, voiceGender: string, index: number) => {
  try {
    const key = `mimick_audio_${lessonId}_${difficulty}_${voiceGender}_${index}`;
    const cached = localStorage.getItem(key);
    if (!cached) return null;
    const parsed = JSON.parse(cached);
    // 厳密な型チェック: base64Dataが正常な文字列オブジェクトか検証
    if (parsed && typeof parsed === 'object' && typeof parsed.base64Data === 'string' && typeof parsed.sampleRate === 'number') {
      return parsed;
    }
    // 不整合または古い形式のキャッシュは安全に破棄
    localStorage.removeItem(key);
    return null;
  } catch (e) {
    return null;
  }
};

const setCachedAudio = (lessonId: number, difficulty: string, voiceGender: string, index: number, data: { base64Data: string; sampleRate: number; duration: number }) => {
  try {
    const key = `mimick_audio_${lessonId}_${difficulty}_${voiceGender}_${index}`;
    localStorage.setItem(key, JSON.stringify(data));
  } catch (e: any) {
    // 容量制限（QuotaExceededError）時は、他の古いレッスンのキャッシュを優先的に削除
    if (e && e.name === 'QuotaExceededError') {
      console.warn("Storage quota exceeded. Evicting older audio caches...");
      try {
        const keys = Object.keys(localStorage).filter(k => k.startsWith('mimick_audio_'));
        const currentPrefix = `mimick_audio_${lessonId}_`;
        const otherKeys = keys.filter(k => !k.startsWith(currentPrefix));
        const activeKeys = keys.filter(k => k.startsWith(currentPrefix));
        
        // 他のレッスンのオーディオキャッシュを全削除
        for (const k of otherKeys) {
          localStorage.removeItem(k);
        }
        
        // それでも足りない場合は、現在のレッスンのインデックスの古いもの（前半）を一部削除
        if (activeKeys.length > 0) {
          activeKeys.sort(); // キー名順にソートして古い順（インデックス順）に削除
          for (let i = 0; i < Math.min(activeKeys.length, 5); i++) {
            localStorage.removeItem(activeKeys[i]);
          }
        }
        
        const key = `mimick_audio_${lessonId}_${difficulty}_${voiceGender}_${index}`;
        localStorage.setItem(key, JSON.stringify(data));
      } catch (retryError) {
        console.error("Failed to save even after evicting older cache:", retryError);
      }
    }
  }
};

const clearAllAudioCaches = () => {
  try {
    const keys = Object.keys(localStorage);
    keys.forEach(key => {
      if (key.startsWith('mimick_audio_')) {
        localStorage.removeItem(key);
      }
    });
  } catch (e) {
    console.error("Failed to clear audio caches:", e);
  }
};

// Gemini TTS API (音声合成)
const generateSpeechWithRetry = async (text: string, apiKey: string, voiceName: string) => {
  if (!apiKey) throw new Error("APIキーが設定されていません。");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`;
  
  const validVoices = ['Aoede', 'Charon', 'Fenrir', 'Kore', 'Puck'];
  const finalVoiceName = validVoices.includes(voiceName) ? voiceName : 'Aoede';
  const ttsText = text.trim().match(/[.,?!。！？]$/) ? text : text + ".";
  
  const payload = {
    contents: [{ parts: [{ text: ttsText }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: finalVoiceName } }
      }
    }
  };

  const delays = [1000, 2000, 4000, 8000];
  
  for (let i = 0; i <= delays.length; i++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      if (!response.ok) throw new Error(`API error: ${response.status}`);

      const data = await response.json();
      const inlineData = data.candidates?.[0]?.content?.parts?.[0]?.inlineData;
      if (inlineData) {
        const { mimeType, data: base64Data } = inlineData;
        const rateMatch = mimeType.match(/rate=(\d+)/);
        const sampleRate = rateMatch ? parseInt(rateMatch[1], 10) : 24000;
        
        // durationを概算（WAVファイル全体の秒数）
        const binaryStr = atob(base64Data);
        const duration = binaryStr.length / (sampleRate * 2);

        return {
          base64Data,
          sampleRate,
          duration
        };
      }
      throw new Error("No audio data returned");
    } catch (err) {
      if (i === delays.length) throw err;
      await new Promise(res => setTimeout(res, delays[i]));
    }
  }
};

// Gemini API (テキスト翻訳)
const translateChunkWithRetry = async (chunkText: string, fullText: string, apiKey: string) => {
  if (!apiKey) throw new Error("APIキーが設定されていません。");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  
  const prompt = `あなたはプロの翻訳家です。以下の文章全体の文脈を考慮して、[対象部分]を自然な日本語に翻訳してください。出力は翻訳結果のテキストのみとし、他の言葉や記号、解説は一切含めないでください。文の途中であっても、その部分のニュアンスが伝わるように訳してください。

文章全体:
${fullText}

[対象部分]:
${chunkText}`;

  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    systemInstruction: { parts: [{ text: "Provide only the translated text. Do not include any explanations or quotes." }] }
  };

  const delays = [1000, 2000, 4000];
  
  for (let i = 0; i <= delays.length; i++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      if (!response.ok) throw new Error(`API error: ${response.status}`);
      
      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) return text.trim();
      throw new Error("No translation returned");
    } catch (err) {
      if (i === delays.length) throw err;
      await new Promise(res => setTimeout(res, delays[i]));
    }
  }
};

// 言語の自動判定
const detectLanguage = (text: string) => {
  if (/[\uac00-\ud7af]/.test(text)) return 'kr';
  if (/[áéíóúñ¿¡]/i.test(text) || /\b(el|la|los|las|un|una|que|de|en|y|por|para)\b/i.test(text)) return 'es';
  return 'en';
};

// 自然言語処理による自動チャンク分割関数
const generateChunksFromText = (text: string) => {
  const lang = detectLanguage(text);
  const sentences = text.match(/[^.!?。！？¿¡]+[.!?。！？¿¡]*/g) || [text];
  
  const createChunksByDifficulty = (targetWords: number) => {
    let chunks: string[] = [];
    sentences.forEach(sentence => {
      let processed = sentence;
      if (lang === 'kr') {
        processed = sentence
          .replace(/([,，])\s*/g, '$1 | ')
          .replace(/\s+(그리고|그래서|그러나|하지만|그런데|또한|따라서)\s+/g, ' | $1 ')
          .replace(/([은는이가을를에로의]|에서|에게|으로|[고며]|지만|면|서|는데)\s+/g, '$1 | ');
      } else if (lang === 'es') {
        processed = sentence
          .replace(/([,;:])\s*/g, '$1 | ')
          .replace(/\s+\b(y|o|pero|porque|aunque|mientras|si)\b/gi, ' | $1 ')
          .replace(/\s+\b(que|quien|cual|cuyo|donde|cuando|como)\b/gi, ' | $1 ')
          .replace(/\s+\b(a|con|de|desde|en|entre|hacia|hasta|para|por|según|sin|sobre|tras)\b/gi, ' | $1 ');
      } else {
        processed = sentence
          .replace(/([,;:])\s*/g, '$1 | ')
          .replace(/\s+\b(and|but|or|because|since|although|though)\b/gi, ' | $1 ')
          .replace(/\s+\b(that|which|who|whom|whose|where|when|why|how)\b/gi, ' | $1 ')
          .replace(/\s+\b(to|in|on|at|for|with|by|about|into|through|after|before|over|under)\b/gi, ' | $1 ');
      }
        
      let fragments = processed.split('|').map(c => c.trim()).filter(c => c.length > 0);
      let currentChunk = "";
      let currentWords = 0;
      
      fragments.forEach(frag => {
        let words = frag.split(/\s+/).length;
        if (currentWords + words > targetWords && currentChunk.length > 0) {
          chunks.push(currentChunk);
          currentChunk = frag;
          currentWords = words;
        } else {
          currentChunk = currentChunk ? currentChunk + " " + frag : frag;
          currentWords += words;
        }
      });
      if (currentChunk) chunks.push(currentChunk);
    });
    return chunks;
  };

  if (lang === 'kr') {
    return { easy: createChunksByDifficulty(2), normal: createChunksByDifficulty(4), hard: createChunksByDifficulty(8) };
  } else {
    return { easy: createChunksByDifficulty(4), normal: createChunksByDifficulty(8), hard: createChunksByDifficulty(15) };
  }
};

interface Lesson {
  id: number;
  title: string;
  fullText: string;
  chunks: {
    easy: string[];
    normal: string[];
    hard: string[];
  };
}

const createLesson = (id: number, title: string, text: string): Lesson => ({
  id, title, fullText: text, chunks: generateChunksFromText(text)
});

const DEFAULT_LESSONS: Lesson[] = [
  createLesson(1, "Lesson 1: 日常会話 (Shopping) (EN)", "I'm going to the grocery store to buy some fresh vegetables for tonight's dinner."),
  createLesson(2, "Lesson 2: ビジネス (Meeting) (EN)", "I would like to start the meeting by reviewing the sales report from the last quarter before we discuss our new strategy."),
  createLesson(3, "Lesson 3: 日常会話 (挨拶と自己紹介) (KR)", "안녕하세요. 처음 뵙겠습니다. 제 이름은 김민수입니다. 앞으로 잘 부탁드립니다."),
  createLesson(4, "Lesson 4: ニュース (IT) (KR)", "최근 인공지능 기술이 빠르게 발전하면서, 우리 일상 생활의 많은 부분들이 변하고 있습니다. 특히 스마트폰에 탑재된 AI 비서는 사용자의 음성을 인식하고 다양한 명령을 수행할 수 있습니다."),
  createLesson(5, "Lesson 5: 日常会話 (挨拶と自己紹介) (ES)", "¡Hola! Mucho gusto. Mi nombre es Carlos. Encantado de conocerte y bienvenido a nuestra ciudad."),
  createLesson(6, "Lesson 6: ニュース (社会) (ES)", "El gobierno anunció hoy una nueva ley para proteger el medio ambiente, la cual entrará en vigor el próximo mes. Muchos ciudadanos han expresado su apoio a esta medida.")
];

// Web Speech API 用に特定の言語の音声一覧を取得する関数
const getVoicesForLanguage = (lang: string, allVoices: SpeechSynthesisVoice[]) => {
  const targetLang = lang.toLowerCase().replace('_', '-');
  const targetPrefix = targetLang.split('-')[0]; // e.g. "en", "ko", "es"

  // 1. Try exact or subtag-compatible matches with normalized hyphens/underscores
  let langMatch = allVoices.filter(v => {
    const vLang = v.lang.toLowerCase().replace('_', '-');
    return vLang === targetLang || vLang.startsWith(targetLang + '-') || targetLang.startsWith(vLang + '-');
  });

  // 2. Fallback to matching by main language code (e.g. "en", "ko", "es") if subtag-specific fails
  if (langMatch.length === 0) {
    langMatch = allVoices.filter(v => {
      const vLang = v.lang.toLowerCase().replace('_', '-');
      const vPrefix = vLang.split('-')[0];
      return vPrefix === targetPrefix;
    });
  }

  return langMatch;
};

// 名前またはデフォルトの割り当てに従って最適な音声を取得する関数
const getBrowserVoiceByName = (voiceName: string, lang: string, allVoices: SpeechSynthesisVoice[]) => {
  if (allVoices.length === 0) return null;

  // 1. 名前での完全一致を試みる
  if (voiceName) {
    const exactMatch = allVoices.find(v => v.name === voiceName);
    if (exactMatch) return exactMatch;
  }

  // 2. 言語ごとのデフォルト優先音声を割り当てる
  const targetLang = lang.toLowerCase().replace('_', '-');
  const targetPrefix = targetLang.split('-')[0];
  const langVoices = getVoicesForLanguage(lang, allVoices);

  if (targetPrefix === 'en') {
    const samanthaMatch = langVoices.find(v => v.name.toLowerCase().includes('samantha'));
    if (samanthaMatch) return samanthaMatch;
  } else if (targetPrefix === 'ko' || targetPrefix === 'kr') {
    const yunaMatch = langVoices.find(v => v.name.toLowerCase().includes('yuna'));
    if (yunaMatch) return yunaMatch;
  } else if (targetPrefix === 'es') {
    const monicaMatch = langVoices.find(v => {
      const nameLower = v.name.toLowerCase();
      return nameLower.includes('mónica') || nameLower.includes('monica');
    });
    if (monicaMatch) return monicaMatch;
  }

  // 3. なければ、その言語の最初の音声を選択
  return langVoices.length > 0 ? langVoices[0] : null;
};



export default function App() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('mimick_api_key') || '');
  const [showApiModal, setShowApiModal] = useState(() => !localStorage.getItem('mimick_api_key'));
  const [tempApiKey, setTempApiKey] = useState(apiKey);

  const [lessons, setLessons] = useState<Lesson[]>(() => {
    try {
      const saved = localStorage.getItem('mimick_lessons');
      return saved ? JSON.parse(saved) : DEFAULT_LESSONS;
    } catch (e) {
      return DEFAULT_LESSONS;
    }
  });
  const [currentLessonIndex, setCurrentLessonIndex] = useState<number | null>(null); 
  const [difficulty, setDifficulty] = useState<'easy' | 'normal' | 'hard'>('normal'); 
  const [currentChunkIndex, setCurrentChunkIndex] = useState<number>(0);
  const [playbackRate, setPlaybackRate] = useState<number>(1.0);
  const [ttsEngine, setTtsEngine] = useState<'gemini' | 'browser'>(
    () => (localStorage.getItem('mimick_tts_engine') as any) || 'gemini'
  );
  const [voiceName, setVoiceName] = useState<string>(() => {
    const savedName = localStorage.getItem('mimick_voice_name');
    if (savedName) return savedName;
    // Backward compatibility for users transitioning from legacy gender settings
    const legacyGender = localStorage.getItem('mimick_voice_gender');
    if (legacyGender === 'male') return 'Charon';
    if (legacyGender === 'female') return 'Aoede';
    return 'Aoede'; // Default to Aoede
  });
  const [showSettings, setShowSettings] = useState<boolean>(false);
  
  const [showText, setShowText] = useState<boolean>(false);
  const [revealedChunks, setRevealedChunks] = useState<number[]>([]);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  const [visibleTranslations, setVisibleTranslations] = useState<number[]>([]); 
  const [translations, setTranslations] = useState<Record<string, string>>({}); 
  const [loadingTrans, setLoadingTrans] = useState<Record<string, boolean>>({}); 
  
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');
  
  const [prefetchProgress, setPrefetchProgress] = useState<number>(0);
  const [prefetchStatus, setPrefetchStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

  const [showInputModal, setShowInputModal] = useState<boolean>(false);
  const [editingLessonId, setEditingLessonId] = useState<number | null>(null);
  const [customTitle, setCustomTitle] = useState<string>('');
  const [customText, setCustomText] = useState<string>('');

  useEffect(() => {
    try {
      localStorage.setItem('mimick_lessons', JSON.stringify(lessons));
    } catch (e) {
      console.error("Failed to save lessons:", e);
    }
  }, [lessons]);

  // Warm up the speechSynthesis voices so they are populated when playing
  useEffect(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      const updateVoices = () => {
        setVoices(window.speechSynthesis.getVoices());
      };
      updateVoices();
      window.speechSynthesis.addEventListener('voiceschanged', updateVoices);
      return () => {
        window.speechSynthesis.removeEventListener('voiceschanged', updateVoices);
      };
    }
  }, []);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCache = useRef<Record<string, Promise<{ url: string; duration: number; correctionRate: number }>>>({});
  const translationCache = useRef<Record<string, Promise<string>>>({});
  const currentCorrectionRate = useRef<number>(1.0);
  
  const chunkRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const currentLesson = currentLessonIndex !== null ? lessons[currentLessonIndex] : null;
  const chunks = currentLesson ? currentLesson.chunks[difficulty] : [];
  const progress = chunks.length > 0 ? ((currentChunkIndex + 1) / chunks.length) * 100 : 0;

  const handleSaveApiKey = () => {
    const trimmedKey = tempApiKey.trim();
    localStorage.setItem('mimick_api_key', trimmedKey);
    setApiKey(trimmedKey);
    setShowApiModal(false);
  };

  const scrollToChunk = useCallback((index: number) => {
    const chunkElement = chunkRefs.current[index];
    if (chunkElement) {
      chunkElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, []);

  useEffect(() => {
    if (currentLessonIndex !== null) {
      scrollToChunk(currentChunkIndex);
    }
  }, [currentChunkIndex, scrollToChunk, currentLessonIndex]);

  const getAudioInfo = async (lessonId: number, difficulty: string, index: number, text: string) => {
    if (!apiKey) throw new Error("APIキーが設定されていません。");
    const cacheKey = `${lessonId}_${difficulty}_${voiceName}_${index}`;
    
    if (!audioCache.current[cacheKey]) {
      audioCache.current[cacheKey] = (async () => {
        try {
          // 1. ローカルストレージキャッシュの確認
          let audioData = getCachedAudio(lessonId, difficulty, voiceName, index);
          
          // 2. なければ Gemini TTS API からロード
          if (!audioData) {
            audioData = await generateSpeechWithRetry(text, apiKey, voiceName);
            // キャッシュへ保存
            setCachedAudio(lessonId, difficulty, voiceName, index, audioData);
          }
          
          // 3. Base64データから WAV Blob & URL を生成
          let wavData;
          try {
            wavData = createWavFile(audioData.base64Data, audioData.sampleRate);
          } catch (decodingError) {
            console.warn("Cached audio decoding failed. Invalid Base64 in storage. Retrying API fetch...", decodingError);
            // 破損したキャッシュを削除
            const key = `mimick_audio_${lessonId}_${difficulty}_${voiceName}_${index}`;
            localStorage.removeItem(key);
            // APIから再度ロードしてキャッシュを修復
            audioData = await generateSpeechWithRetry(text, apiKey, voiceName);
            setCachedAudio(lessonId, difficulty, voiceName, index, audioData);
            wavData = createWavFile(audioData.base64Data, audioData.sampleRate);
          }
          
          // 4. 音声の補正比率（Pacing）を計算
          const lang = detectLanguage(text);
          const charCount = lang === 'kr' 
            ? Math.max(1, text.replace(/[^가-힣a-zA-Z0-9]/g, '').length)
            : Math.max(1, text.replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ¿¡]/g, '').length);
            
          const speechDuration = Math.max(0.1, audioData.duration - 0.3);
          const actualCPS = charCount / speechDuration;
          const targetCPS = lang === 'kr' ? 7.5 : 13.5; 
          
          let correctionRate = targetCPS / actualCPS;
          correctionRate = Math.max(0.75, Math.min(1.35, correctionRate));
          
          return {
            url: URL.createObjectURL(wavData.blob),
            duration: audioData.duration,
            correctionRate
          };
        } catch (error) {
          // エラーが発生した場合は、メモリキャッシュから削除して次回再試行できるようにする
          delete audioCache.current[cacheKey];
          throw error;
        }
      })();
    }
    return await audioCache.current[cacheKey];
  };

  const fetchTranslationForChunk = useCallback(async (chunkText: string) => {
    if (!apiKey) {
      setShowApiModal(true);
      return;
    }
    if (translations[chunkText] || loadingTrans[chunkText]) return;
    
    setLoadingTrans(prev => ({ ...prev, [chunkText]: true }));
    try {
      if (!translationCache.current[chunkText]) {
        if (!currentLesson) return;
        translationCache.current[chunkText] = translateChunkWithRetry(chunkText, currentLesson.fullText, apiKey).catch(e => {
          delete translationCache.current[chunkText];
          throw e;
        });
      }
      const translated = await translationCache.current[chunkText];
      setTranslations(prev => ({ ...prev, [chunkText]: translated }));
    } catch (e) {
      console.error("Translation fetch error:", e);
      setTranslations(prev => ({ ...prev, [chunkText]: "翻訳エラー" }));
    } finally {
      setLoadingTrans(prev => ({ ...prev, [chunkText]: false }));
    }
  }, [currentLesson, translations, loadingTrans, apiKey]);

  useEffect(() => {
    if (currentLessonIndex === null || !apiKey) return;
    const currentChunkText = chunks[currentChunkIndex];
    if (currentChunkText && visibleTranslations.includes(currentChunkIndex)) {
      fetchTranslationForChunk(currentChunkText);
    }
  }, [currentChunkIndex, visibleTranslations, chunks, fetchTranslationForChunk, currentLessonIndex, apiKey]);

  useEffect(() => {
    if (currentLessonIndex === null) {
      setPrefetchStatus('idle');
      return;
    }
    if (!apiKey) {
      setPrefetchStatus('idle');
      return;
    }
    let isCancelled = false;
    
    const prefetchData = async () => {
      if (!chunks || chunks.length === 0) {
        setPrefetchStatus('idle');
        return;
      }
      setPrefetchStatus('loading');
      setPrefetchProgress(0);
      let loadedCount = 0;

      // ブラウザ標準音声の場合は、API通信も永続キャッシュも不要なため事前ロード（プリフェッチ）をスキップ
      if (ttsEngine === 'browser') {
        setPrefetchStatus('success');
        setPrefetchProgress(100);
        return;
      }

      for (let i = 0; i < chunks.length; i++) {
        if (isCancelled) break;
        const text = chunks[i];
        
        // すでにローカルストレージにキャッシュがあるか確認
        const hasCache = !!getCachedAudio(currentLesson?.id ?? -1, difficulty, voiceName, i);
        
        try {
          await getAudioInfo(currentLesson?.id ?? -1, difficulty, i, text);
          loadedCount++;
          if (!isCancelled) setPrefetchProgress(Math.floor((loadedCount / chunks.length) * 100));
          
          // キャッシュが既にあれば待機時間なしで次へ。
          // キャッシュがなく新規にAPIを叩く場合は、レート制限（15 RPM = 4秒に1回）を考慮して 3000ms の遅延を入れる
          if (!hasCache && i < chunks.length - 1) {
            await new Promise(r => setTimeout(r, 3000));
          } else {
            // キャッシュがある場合でも、ブラウザスレッドを止めないよう僅かな遅延（50ms）
            await new Promise(r => setTimeout(r, 50));
          }
        } catch (err: any) {
          console.error("Prefetch error for:", text, err);
          if (!isCancelled) {
            setPrefetchStatus('error');
            const isRateLimit = err?.message?.includes('429') || (err instanceof Error && err.message.includes('rate'));
            if (isRateLimit) {
              setErrorMsg("APIの利用制限（1分間に15回）に達しました。少し待ってからプレイ、または次のチャンクに進んでください。");
            } else {
              setErrorMsg("AI音声の事前読み込み中にエラーが発生しました。APIキーが正しいか確認してください。");
            }
            break; // エラー発生時は中断
          }
        }
      }
      if (!isCancelled && loadedCount === chunks.length) {
        setPrefetchStatus('success');
      }
    };

    setCurrentChunkIndex(0);
    setIsPlaying(false);
    setIsLoading(false);
    setRevealedChunks([]);
    setVisibleTranslations([]); 
    setTranslations({});
    setLoadingTrans({});
    translationCache.current = {};
    
    chunkRefs.current = new Array(chunks?.length || 0).fill(null);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setErrorMsg('');

    prefetchData();
    return () => { 
      isCancelled = true; 
      // メモリ内の Blob URL を途中で解放すると React 18 Strict Mode での並行実行時
      // アクティブなロードが破損するため、ここではフラグ設定 (isCancelled = true) のみに留め、
      // 実際のリソース解放 is active only on full unmount
    };
  }, [currentLessonIndex, difficulty, chunks, apiKey, ttsEngine, voiceName]);

  useEffect(() => {
    setRevealedChunks([]);
  }, [showText]);

  useEffect(() => {
    return () => {
      if (audioRef.current) audioRef.current.pause();
      Object.values(audioCache.current).forEach(async (promise) => {
        try {
          const info = await promise;
          URL.revokeObjectURL(info.url);
        } catch (e) {}
      });
    };
  }, []);

  useEffect(() => {
    if (audioRef.current) {
      // Safari などのクラッシュを防ぐため、再生速度を 0.5 から 3.0 の範囲に制限（クランプ）
      const rate = Math.max(0.5, Math.min(3.0, playbackRate * currentCorrectionRate.current));
      audioRef.current.playbackRate = rate;
    }
  }, [playbackRate]);

  const playChunk = useCallback(async (index: number) => {
    if (currentLessonIndex === null || !currentLesson) return;
    
    // AI音声エンジンでAPIキーがない時のみモーダルを表示
    if (ttsEngine === 'gemini' && !apiKey) {
      setShowApiModal(true);
      return;
    }
    const text = chunks[index];

    // ブラウザ標準音声 (Web Speech API) を使用する場合の分岐
    if (ttsEngine === 'browser') {
      setIsLoading(true);
      setErrorMsg('');
      
      if (audioRef.current) {
        audioRef.current.pause();
      }
      
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
        
        const lang = detectLanguage(text);
        const utterance = new SpeechSynthesisUtterance(text);
        
        if (lang === 'kr') utterance.lang = 'ko-KR';
        else if (lang === 'es') utterance.lang = 'es-ES';
        else utterance.lang = 'en-US';
        
        const voice = getBrowserVoiceByName(voiceName, utterance.lang, voices);
        if (voice) {
          utterance.voice = voice;
          utterance.lang = voice.lang; // Force strict language-tag alignment to prevent browser fallback
        }
        
        utterance.rate = playbackRate;
        
        utterance.onstart = () => {
          setIsLoading(false);
          setIsPlaying(true);
        };
        utterance.onend = () => setIsPlaying(false);
        utterance.onerror = (e) => {
          console.error("Browser speech synthesis error:", e);
          setIsPlaying(false);
          setIsLoading(false);
          setErrorMsg("音声合成に失敗しました。");
        };
        
        audioRef.current = {
          pause: () => {
            window.speechSynthesis.cancel();
            setIsPlaying(false);
          }
        } as any;
        
        window.speechSynthesis.speak(utterance);
      } else {
        setIsLoading(false);
        setErrorMsg("ブラウザが音声合成に対応していません。");
      }
      return;
    }
    try {
      setErrorMsg('');
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
      setIsPlaying(false);
      setIsLoading(true);
      
      const audioInfo = await getAudioInfo(currentLesson.id, difficulty, index, text);
      const audio = new Audio(audioInfo.url);
      
      currentCorrectionRate.current = audioInfo.correctionRate;
      
      // Safari などのクラッシュを防ぐため、再生速度を 0.5 から 3.0 の範囲に制限（クランプ）
      const rate = Math.max(0.5, Math.min(3.0, playbackRate * audioInfo.correctionRate));
      audio.playbackRate = rate;
      audioRef.current = audio;

      audio.onplay = () => { setIsLoading(false); setIsPlaying(true); };
      audio.onended = () => setIsPlaying(false);
      audio.onerror = (e) => {
        console.error("Audio element playback error event:", e);
        setIsPlaying(false); setIsLoading(false);
        setErrorMsg("音声の再生中にエラーが発生しました。");
      };

      await audio.play();
    } catch (err: any) {
      console.error("playChunk error:", err);
      setIsLoading(false); setIsPlaying(false);
      
      const isRateLimit = err?.message?.includes('429') || (err instanceof Error && err.message.includes('rate'));
      if (isRateLimit) {
        setErrorMsg("APIの利用制限（1分間に15回）に達しました。少し待ってから再生してください。");
      } else {
        setErrorMsg("AI音声の生成に失敗しました。APIキーが正しいか確認してください。");
      }
    }
  }, [chunks, playbackRate, currentLessonIndex, currentLesson, difficulty, apiKey, ttsEngine, voiceName, voices]);

  const handlePlayCurrent = () => { if (!isLoading) playChunk(currentChunkIndex); };
  const handleNext = () => {
    if (currentChunkIndex < chunks.length - 1 && !isLoading) {
      setCurrentChunkIndex(prev => prev + 1);
      playChunk(currentChunkIndex + 1);
    }
  };
  const handlePrev = () => {
    if (currentChunkIndex > 0 && !isLoading) {
      setCurrentChunkIndex(prev => prev - 1);
      playChunk(currentChunkIndex - 1);
    }
  };

  const handleChunkClick = (index: number) => {
    if (!isLoading) {
      setCurrentChunkIndex(index);
      playChunk(index);
      if (!showText) {
        setRevealedChunks(prev => prev.includes(index) ? prev.filter(i => i !== index) : [...prev, index]);
      }
    }
  };

  const handleToggleTrans = (index: number) => {
    if (!apiKey) {
      setShowApiModal(true);
      return;
    }
    if (visibleTranslations.includes(index)) {
      setVisibleTranslations(prev => prev.filter(i => i !== index));
    } else {
      setVisibleTranslations(prev => [...prev, index]);
    }
  };

  const handleCloseInputModal = () => {
    setShowInputModal(false);
    setCustomText('');
    setCustomTitle('');
    setEditingLessonId(null);
  };

  const handleSaveCustomLesson = () => {
    if (!customText.trim()) return;
    const lang = detectLanguage(customText);
    const langLabel = lang === 'kr' ? "(KR)" : lang === 'es' ? "(ES)" : "(EN)";
    
    if (editingLessonId !== null) {
      // 既存お題の編集
      const updated = lessons.map(l => {
        if (l.id === editingLessonId) {
          const title = customTitle.trim() || l.title.replace(/\s*\((KR|EN|ES)\)/, '');
          const newTitle = title.includes(langLabel) ? title : `${title} ${langLabel}`;
          
          // テキスト自体が変わった場合、音声キャッシュを自動で破棄する（重要）
          if (l.fullText !== customText.trim()) {
            try {
              const keys = Object.keys(localStorage);
              keys.forEach(key => {
                if (key.startsWith(`mimick_audio_${editingLessonId}_`)) {
                  localStorage.removeItem(key);
                }
              });
            } catch (err) {
              console.error("Failed to clear updated audio cache:", err);
            }
          }
          
          return createLesson(l.id, newTitle, customText.trim());
        }
        return l;
      });
      setLessons(updated);
    } else {
      // 新規追加
      const title = customTitle.trim() || `Custom Lesson ${lessons.length - DEFAULT_LESSONS.length + 1} ${langLabel}`;
      const newTitle = title.includes(langLabel) ? title : `${title} ${langLabel}`;
      const newLesson = createLesson(Date.now(), newTitle, customText.trim());
      const newLessons = [...lessons, newLesson];
      setLessons(newLessons);
      setCurrentLessonIndex(newLessons.length - 1); 
    }
    
    handleCloseInputModal();
  };

  const handleDeleteLesson = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm("このお題を削除してもよろしいですか？")) {
      const updated = lessons.filter(l => l.id !== id);
      setLessons(updated);
      
      // 関連する音声キャッシュのクリア
      try {
        const keys = Object.keys(localStorage);
        keys.forEach(key => {
          if (key.startsWith(`mimick_audio_${id}_`)) {
            localStorage.removeItem(key);
          }
        });
      } catch (err) {
        console.error("Failed to clear deleted audio cache:", err);
      }
    }
  };

  const handleOpenEditModal = (lesson: Lesson, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingLessonId(lesson.id);
    setCustomTitle(lesson.title.replace(/\s*\((KR|EN|ES)\)/, ''));
    setCustomText(lesson.fullText);
    setShowInputModal(true);
  };

  const handleResetDefaultLessons = () => {
    if (window.confirm("すべてのお題を初期状態に戻しますか？（追加したカスタムお題は消去されます）")) {
      setLessons(DEFAULT_LESSONS);
      clearAllAudioCaches();
    }
  };

  return (
    <>
      {/* APIキー設定モーダル */}
      {showApiModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200">
            <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="font-bold text-slate-800 flex items-center gap-2"><Key size={18}/> APIキー設定</h3>
              <button 
                onClick={() => {
                  if (!apiKey) {
                    localStorage.setItem('mimick_tts_engine', 'browser');
                    setTtsEngine('browser');
                  }
                  setShowApiModal(false);
                }} 
                className="text-slate-400 hover:text-slate-600 bg-white rounded-full p-1 shadow-sm hover:bg-slate-50 transition-colors border border-slate-100"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-5 flex flex-col gap-4">
              <p className="text-sm text-slate-600 leading-relaxed">
                Mimick の高音質な音声生成と自動翻訳には <strong>Gemini API キー</strong> が必要です。キーはお使いのブラウザにのみ保存され、安全に利用できます。キーを設定しない場合は、ブラウザ内蔵音声で学習を進められます。
              </p>
              <a 
                href="https://aistudio.google.com/app/apikey" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-sm text-blue-600 hover:underline flex items-center gap-1 w-fit font-medium"
              >
                APIキーを無料で取得する <ExternalLink size={14}/>
              </a>
              <div>
                <input 
                  type="password" 
                  value={tempApiKey}
                  onChange={e => setTempApiKey(e.target.value)}
                  placeholder="AIzaSy..."
                  className="w-full p-2.5 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 transition-shadow text-sm font-mono"
                />
              </div>
            </div>
            <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
              <button 
                onClick={() => {
                  if (!apiKey) {
                    localStorage.setItem('mimick_tts_engine', 'browser');
                    setTtsEngine('browser');
                  }
                  setShowApiModal(false);
                }}
                className="px-4 py-2 text-slate-600 hover:text-slate-700 font-medium hover:bg-slate-100 rounded-lg border border-slate-200 transition-colors text-sm"
              >
                {apiKey ? "キャンセル" : "スキップ (ブラウザ音声を使用)"}
              </button>
              <button 
                onClick={handleSaveApiKey}
                disabled={!tempApiKey.trim()}
                className="px-5 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm shadow-md"
              >
                保存して始める
              </button>
            </div>
          </div>
        </div>
      )}

      {/* カスタム入力モーダル */}
      {showInputModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-200">
            <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="font-bold text-slate-800">
                {editingLessonId !== null ? "お題を編集" : "新しいお題を入力"}
              </h3>
              <button onClick={handleCloseInputModal} className="text-slate-400 hover:text-slate-600 bg-white rounded-full p-1 shadow-sm">
                <X size={20} />
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-1 flex flex-col gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">タイトル (任意)</label>
                <input 
                  type="text" 
                  value={customTitle}
                  onChange={e => setCustomTitle(e.target.value)}
                  placeholder="例: TED Talk / ドラマのセリフ"
                  className="w-full p-2.5 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 transition-shadow text-sm"
                />
              </div>
              <div className="flex-1 flex flex-col">
                <label className="block text-sm font-medium text-slate-700 mb-1">練習したいテキスト（英語 / 韓国語 / スペイン語）</label>
                <textarea 
                  value={customText}
                  onChange={e => setCustomText(e.target.value)}
                  placeholder="ここに練習したい文章を貼り付けてください...&#13;&#10;※言語はAIが自動で判定します。"
                  className="w-full flex-1 min-h-[200px] p-3 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 resize-none transition-shadow text-sm"
                />
              </div>
            </div>
            <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
              <button 
                onClick={handleCloseInputModal}
                className="px-4 py-2 text-slate-600 font-medium hover:bg-slate-200 rounded-lg transition-colors text-sm"
              >
                キャンセル
              </button>
              <button 
                onClick={handleSaveCustomLesson}
                disabled={!customText.trim()}
                className="px-5 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 text-sm shadow-md"
              >
                {editingLessonId !== null ? (
                  <>保存する</>
                ) : (
                  <><Plus size={16} /> 追加して始める</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {currentLessonIndex === null ? (
        /* --- ホーム（一覧）画面 --- */
        <div className="min-h-[100dvh] bg-slate-50 text-slate-800 font-sans">
          <header className="bg-blue-600 text-white p-5 md:p-6 shadow-md">
            <div className="max-w-2xl mx-auto flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Mic size={28} />
                <h1 className="text-2xl font-bold tracking-tight">Mimick</h1>
              </div>
              <button 
                onClick={() => { setTempApiKey(apiKey); setShowApiModal(true); }}
                className="bg-blue-700 hover:bg-blue-800 p-2 rounded-full transition-colors flex items-center gap-2 text-sm"
                title="APIキー設定"
              >
                <Key size={18} />
              </button>
            </div>
          </header>
          
          <main className="max-w-2xl mx-auto p-4 py-8">
            <div className="mb-6 flex justify-between items-end">
              <div>
                <h2 className="text-xl font-bold text-slate-800">お題を選ぶ</h2>
                <p className="text-sm text-slate-500 mt-1">練習したいレッスンを選択してください</p>
              </div>
              <div className="flex items-center gap-2">
                <button 
                  onClick={handleResetDefaultLessons}
                  className="text-sm font-medium text-slate-500 hover:text-red-600 bg-slate-100 hover:bg-red-50 p-2 rounded-lg transition-colors border border-slate-200"
                  title="初期状態に戻す"
                >
                  <RotateCcw size={16} />
                </button>
                <button 
                  onClick={() => setShowInputModal(true)}
                  className="text-sm font-medium text-blue-600 bg-blue-50 px-3 py-2 rounded-lg hover:bg-blue-100 transition-colors flex items-center gap-1.5 border border-blue-100 shadow-sm"
                >
                  <Plus size={16} /> 新しく入力
                </button>
              </div>
            </div>
            
            <div className="grid gap-3">
              {lessons.map((lesson, index) => {
                const langTag = lesson.title.match(/\((KR|EN|ES)\)/)?.[1] || 'EN';
                const displayTitle = lesson.title.replace(/\s*\((KR|EN|ES)\)/, '');
                
                return (
                  <div
                    key={lesson.id}
                    onClick={() => setCurrentLessonIndex(index)}
                    className="flex items-center justify-between p-4 bg-white rounded-xl shadow-sm border border-slate-200 hover:border-blue-400 hover:shadow-md transition-all text-left group cursor-pointer"
                  >
                    <div className="pr-4 flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[11px] font-bold text-blue-600 bg-blue-50 border border-blue-100 px-2 py-0.5 rounded uppercase">
                          {langTag}
                        </span>
                        <h3 className="font-bold text-slate-800 group-hover:text-blue-600 transition-colors line-clamp-1">{displayTitle}</h3>
                      </div>
                      <p className="text-sm text-slate-500 line-clamp-2 leading-relaxed mt-1.5">{lesson.fullText}</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 pl-2">
                      <button
                        onClick={(e) => handleOpenEditModal(lesson, e)}
                        className="p-2 text-slate-400 hover:text-blue-600 hover:bg-slate-100 rounded-lg transition-colors md:opacity-0 group-hover:opacity-100 focus:opacity-100"
                        title="編集"
                      >
                        <Edit3 size={16} />
                      </button>
                      <button
                        onClick={(e) => handleDeleteLesson(lesson.id, e)}
                        className="p-2 text-slate-400 hover:text-red-600 hover:bg-slate-100 rounded-lg transition-colors md:opacity-0 group-hover:opacity-100 focus:opacity-100"
                        title="削除"
                      >
                        <Trash2 size={16} />
                      </button>
                      <div className="w-10 h-10 rounded-full bg-slate-50 group-hover:bg-blue-50 flex items-center justify-center transition-colors">
                        <Play size={20} className="text-slate-400 group-hover:text-blue-500 ml-1" />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </main>
        </div>

      ) : (

        /* --- 学習（メイン）画面 --- */
        <div className="flex flex-col h-[100dvh] bg-slate-50 text-slate-800 font-sans overflow-hidden">
          <header className="bg-blue-600 text-white p-4 shadow-md shrink-0 z-10 relative">
            <div className="max-w-2xl mx-auto flex flex-row items-center justify-between">
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => setCurrentLessonIndex(null)}
                  className="text-white/90 hover:text-white hover:bg-white/10 p-1.5 rounded-full transition-colors -ml-2"
                  title="一覧に戻る"
                >
                  <ChevronLeft size={24} />
                </button>
                <h1 className="text-lg font-bold tracking-tight truncate max-w-[150px] sm:max-w-xs ml-1">{currentLesson?.title.replace(/\s*\((KR|EN|ES)\)/, '')}</h1>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex text-[11px] sm:text-xs font-medium px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-full items-center gap-1 sm:gap-1.5 shrink-0">
                  {!apiKey ? (
                    <div className="flex items-center gap-1.5 bg-amber-700 text-white rounded-full px-2.5 py-1 sm:px-3 sm:py-1.5">
                      <Key size={12} className="sm:w-3.5 sm:h-3.5 text-amber-300 animate-pulse" /> APIキー未設定
                    </div>
                  ) : prefetchStatus === 'loading' ? (
                    <div className="flex items-center gap-1.5 bg-blue-700 text-white rounded-full px-2.5 py-1 sm:px-3 sm:py-1.5">
                      <Loader2 size={12} className="animate-spin sm:w-3.5 sm:h-3.5" /> 音声を準備中 {prefetchProgress}%
                    </div>
                  ) : prefetchStatus === 'error' ? (
                    <div className="flex items-center gap-1.5 bg-red-700 text-white rounded-full px-2.5 py-1 sm:px-3 sm:py-1.5">
                      <AlertTriangle size={12} className="sm:w-3.5 sm:h-3.5 text-red-300" /> 準備失敗
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 bg-green-700 text-white rounded-full px-2.5 py-1 sm:px-3 sm:py-1.5">
                      <CheckCircle2 size={12} className="text-green-300 sm:w-3.5 sm:h-3.5" /> 準備完了
                    </div>
                  )}
                </div>
              </div>
            </div>
          </header>

          <main className="flex-1 overflow-y-auto p-4 w-full" ref={containerRef}>
            <div className="max-w-2xl mx-auto space-y-4 pb-12">
              
              {errorMsg && (
                <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-md flex items-start gap-3 shadow-sm">
                  <AlertTriangle className="text-red-500 shrink-0 mt-0.5" size={20} />
                  <p className="text-sm text-red-700">{errorMsg}</p>
                </div>
              )}



              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden relative">
                <div className="w-full bg-slate-100 h-1.5 relative">
                  <div 
                    className="bg-blue-500 h-full transition-all duration-300 ease-out" 
                    style={{ width: `${progress}%` }} 
                  />
                </div>

                <div className="p-4 md:p-6">
                  <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-3 mb-6 sticky top-0 bg-white/90 backdrop-blur-sm z-10 py-2 border-b border-slate-100/50">
                    <span className="text-xs font-bold px-3 py-1 bg-blue-100 text-blue-700 rounded-full shadow-sm self-start md:self-auto shrink-0">
                      Chunk {currentChunkIndex + 1} / {chunks.length}
                    </span>
                    
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="hidden lg:flex items-center gap-1 text-xs text-slate-400 bg-slate-50 px-2 py-1 rounded-md">
                        <Zap size={12} className="text-amber-500" /> Auto-Pacing
                      </span>

                      <button 
                        onClick={() => setShowText(!showText)} 
                        className={`flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg transition-colors shadow-sm ${
                          showText ? 'text-slate-600 hover:bg-slate-100 border border-slate-200' : 'text-blue-600 bg-blue-50 hover:bg-blue-100 border border-blue-200'
                        }`}
                      >
                        {showText ? (
                          <><EyeOff size={16} /> 原文を隠す</>
                        ) : (
                          <><Eye size={16} /> 原文を表示</>
                        )}
                      </button>
                    </div>
                  </div>
                  
                  <div className="text-xl md:text-2xl leading-relaxed md:leading-loose font-medium select-none pt-2 pb-4">
                    {chunks.map((chunk, index) => {
                      const isRevealed = showText || revealedChunks.includes(index);
                      
                      return (
                        <React.Fragment key={index}>
                          <span
                            ref={el => { chunkRefs.current[index] = el; }}
                            onClick={() => handleChunkClick(index)}
                            className={`
                              inline-block rounded-lg px-2 py-1 my-1 cursor-pointer transition-all duration-200
                              ${index === currentChunkIndex 
                                ? 'bg-blue-100 text-blue-900 shadow-sm border border-blue-300 ring-2 ring-blue-400 ring-opacity-50' 
                                : 'text-slate-700 hover:bg-slate-100 border border-transparent'}
                            `}
                          >
                            <span className={`block transition-all duration-300 ${!isRevealed ? 'blur-[6px] opacity-50' : ''}`}>
                              {chunk}
                            </span>
                          </span>
                          
                          {index < chunks.length - 1 && (
                            <span className="text-slate-300 mx-2 font-light text-2xl align-middle">/</span>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </div>

                </div>
              </div>
              
            </div>
          </main>

          <div className="bg-white border-t border-slate-200 px-4 py-4 shrink-0 shadow-[0_-10px_15px_-3px_rgba(0,0,0,0.05)] z-20">
            <div className="max-w-2xl mx-auto w-full">
              
              <div className="mb-4 min-h-[48px] flex flex-col justify-center items-center">
                {visibleTranslations.includes(currentChunkIndex) ? (
                  <div className="w-full bg-slate-50 rounded-xl px-4 py-3 border border-slate-200 text-slate-700 text-center relative flex flex-col items-center animate-in fade-in slide-in-from-bottom-2 duration-200">
                    {loadingTrans[chunks[currentChunkIndex]] ? (
                       <div className="flex items-center gap-2 text-slate-500 text-sm"><Loader2 size={16} className="animate-spin"/> 翻訳中...</div>
                    ) : (
                       <p className="text-sm md:text-base leading-relaxed font-medium">
                         {translations[chunks[currentChunkIndex]] === "翻訳エラー" ? 
                           <span className="text-red-400 text-xs font-bold">通信エラー (もう一度押して再試行)</span> : 
                           translations[chunks[currentChunkIndex]]}
                       </p>
                    )}
                    <button 
                      onClick={() => handleToggleTrans(currentChunkIndex)}
                      className="absolute -top-3 right-2 bg-white text-slate-400 hover:text-slate-600 border border-slate-200 rounded-full p-1 shadow-sm transition-colors"
                      title="訳を隠す"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <button 
                    onClick={() => handleToggleTrans(currentChunkIndex)}
                    className="flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-blue-600 bg-white border border-slate-200 hover:border-blue-200 rounded-full px-4 py-1.5 transition-colors shadow-sm"
                  >
                    <Globe size={16} /> 今のチャンクの訳を見る
                  </button>
                )}
              </div>

              <div className="flex justify-center items-center gap-6 md:gap-8 w-full mb-4">
                {/* 選択中のチャンクのぼかしON/OFFトグル (左端) */}
                <button 
                  onClick={() => {
                    setRevealedChunks(prev => 
                      prev.includes(currentChunkIndex) 
                        ? prev.filter(i => i !== currentChunkIndex) 
                        : [...prev, currentChunkIndex]
                    );
                  }} 
                  className={`p-3 rounded-full transition-all duration-200 ${
                    revealedChunks.includes(currentChunkIndex) 
                      ? 'bg-blue-50 text-blue-600 shadow-sm' 
                      : 'text-slate-400 hover:text-blue-600 hover:bg-blue-50'
                  }`}
                  title={revealedChunks.includes(currentChunkIndex) ? "選択中のチャンクをぼかす" : "選択中のチャンクを表示"}
                >
                  {revealedChunks.includes(currentChunkIndex) ? <EyeOff size={24} strokeWidth={2} /> : <Eye size={24} strokeWidth={2} />}
                </button>

                <button 
                  onClick={handlePrev} 
                  disabled={currentChunkIndex === 0 || isLoading}
                  className="p-3 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-full transition-all disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400 disabled:cursor-not-allowed"
                >
                  <SkipBack size={28} strokeWidth={2} />
                </button>
                
                <button 
                  onClick={handlePlayCurrent}
                  disabled={isLoading}
                  className={`
                    relative flex items-center justify-center w-16 h-16 md:w-20 md:h-20 rounded-full shadow-lg transition-all duration-200
                    ${isPlaying ? 'bg-blue-600 scale-95 shadow-inner' : 'bg-blue-500 hover:bg-blue-600 hover:scale-105 active:scale-95'}
                    ${isLoading ? 'bg-blue-400 hover:bg-blue-400 hover:scale-100 cursor-wait' : 'text-white'}
                  `}
                >
                  {isLoading ? (
                    <Loader2 size={32} className="animate-spin text-white" />
                  ) : isPlaying ? (
                    <Volume2 size={32} className="animate-pulse text-white" />
                  ) : (
                    <Play size={32} className="ml-1.5 text-white" fill="currentColor" />
                  )}
                </button>
                
                <button 
                  onClick={handleNext} 
                  disabled={currentChunkIndex === chunks.length - 1 || isLoading}
                  className="p-3 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-full transition-all disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400 disabled:cursor-not-allowed"
                >
                  <SkipForward size={28} strokeWidth={2} />
                </button>

                <button 
                  onClick={() => setShowSettings(!showSettings)} 
                  className={`p-3 rounded-full transition-all duration-200 ${
                    showSettings 
                      ? 'bg-blue-50 text-blue-600 shadow-sm' 
                      : 'text-slate-400 hover:text-blue-600 hover:bg-blue-50'
                  }`}
                  title="詳細設定"
                >
                  <SlidersHorizontal size={24} strokeWidth={2} />
                </button>
              </div>
              
              {/* トグル可能な設定エリア */}
              {showSettings && (
                <div className="w-full max-w-md mx-auto space-y-4 pt-4 pb-2 border-t border-slate-100 animate-in fade-in slide-in-from-top-3 duration-200">
                  <div className="grid grid-cols-2 gap-3">
                    {/* チャンク（区切り）の長さ */}
                    <div className="space-y-1">
                      <div className="flex items-center gap-1 text-[11px] text-slate-500 font-medium px-1">
                        <Scissors size={12} />
                        <span>チャンク（区切り）の長さ</span>
                      </div>
                      <select
                        value={difficulty}
                        onChange={(e) => setDifficulty(e.target.value as any)}
                        className="w-full py-1 px-2 text-[11px] font-semibold rounded-lg border border-slate-200 bg-white text-slate-700 shadow-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 h-[26px]"
                      >
                        <option value="easy">短め (Easy)</option>
                        <option value="normal">標準 (Normal)</option>
                        <option value="hard">長め (Hard)</option>
                      </select>
                    </div>

                    {/* 音声の選択 */}
                    <div className="space-y-1">
                      <div className="flex items-center gap-1 text-[11px] text-slate-500 font-medium px-1">
                        <Mic size={12} />
                        <span>音声の選択</span>
                      </div>
                      <select
                        value={
                          ttsEngine === 'browser' 
                            ? 'browser' 
                            : (voiceName === 'Charon' ? 'gemini-male' : 'gemini-female')
                        }
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === 'browser') {
                            localStorage.setItem('mimick_tts_engine', 'browser');
                            setTtsEngine('browser');
                          } else {
                            localStorage.setItem('mimick_tts_engine', 'gemini');
                            setTtsEngine('gemini');
                            const vName = val === 'gemini-female' ? 'Aoede' : 'Charon';
                            localStorage.setItem('mimick_voice_name', vName);
                            setVoiceName(vName);
                          }
                        }}
                        className="w-full py-1 px-2 text-[11px] font-semibold rounded-lg border border-slate-200 bg-white text-slate-700 shadow-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 h-[26px]"
                      >
                        <option value="gemini-female">Gemini (女性)</option>
                        <option value="gemini-male">Gemini (男性)</option>
                        <option value="browser">ブラウザ</option>
                      </select>


                    </div>
                  </div>
                </div>
              )}

              {/* 再生速度 (常に表示) */}
              <div className={`w-full max-w-md mx-auto space-y-1 ${showSettings ? 'pt-2' : 'pt-4 border-t border-slate-100'}`}>
                <div className="flex items-center justify-between text-[11px] text-slate-500 font-medium px-1">
                  <div className="flex items-center gap-1">
                    <Gauge size={12} />
                    <span>再生速度</span>
                  </div>
                  <span className="text-blue-600 font-bold bg-blue-50 px-1.5 py-0.5 rounded text-[10px]">
                    {playbackRate.toFixed(1)}x
                  </span>
                </div>
                
                <input
                  type="range"
                  min="0.5"
                  max="2.0"
                  step="0.1"
                  value={playbackRate}
                  onChange={(e) => setPlaybackRate(parseFloat(e.target.value))}
                  disabled={isLoading}
                  className="w-full accent-blue-600 h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed"
                />
              </div>
              
            </div>
          </div>
        </div>
      )}
    </>
  );
}
