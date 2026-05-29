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
  Mic
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

// Gemini TTS API (音声合成)
const generateSpeechWithRetry = async (text: string, apiKey: string) => {
  if (!apiKey) throw new Error("APIキーが設定されていません。");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`;
  
  const ttsText = text.trim().match(/[.,?!。！？]$/) ? text : text + ".";
  
  const payload = {
    contents: [{ parts: [{ text: ttsText }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } }
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
        
        const wavData = createWavFile(base64Data, sampleRate);
        return {
          url: URL.createObjectURL(wavData.blob),
          duration: wavData.duration
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

export default function App() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('mimick_api_key') || '');
  const [showApiModal, setShowApiModal] = useState(() => !localStorage.getItem('mimick_api_key'));
  const [tempApiKey, setTempApiKey] = useState(apiKey);

  const [lessons, setLessons] = useState<Lesson[]>(DEFAULT_LESSONS);
  const [currentLessonIndex, setCurrentLessonIndex] = useState<number | null>(null); 
  const [difficulty, setDifficulty] = useState<'easy' | 'normal' | 'hard'>('normal'); 
  const [currentChunkIndex, setCurrentChunkIndex] = useState<number>(0);
  const [playbackRate, setPlaybackRate] = useState<number>(1.0);
  
  const [showText, setShowText] = useState<boolean>(false);
  const [revealedChunks, setRevealedChunks] = useState<number[]>([]);

  const [visibleTranslations, setVisibleTranslations] = useState<number[]>([]); 
  const [translations, setTranslations] = useState<Record<string, string>>({}); 
  const [loadingTrans, setLoadingTrans] = useState<Record<string, boolean>>({}); 
  
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');
  
  const [isPrefetching, setIsPrefetching] = useState<boolean>(false);
  const [prefetchProgress, setPrefetchProgress] = useState<number>(0);

  const [showInputModal, setShowInputModal] = useState<boolean>(false);
  const [customTitle, setCustomTitle] = useState<string>('');
  const [customText, setCustomText] = useState<string>('');

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

  const getAudioInfo = async (text: string) => {
    if (!apiKey) throw new Error("APIキーが設定されていません。");
    if (!audioCache.current[text]) {
      audioCache.current[text] = generateSpeechWithRetry(text, apiKey).then(info => {
        if (!info) throw new Error("Failed to generate speech info");
        const lang = detectLanguage(text);
        const charCount = lang === 'kr' 
          ? Math.max(1, text.replace(/[^가-힣a-zA-Z0-9]/g, '').length)
          : Math.max(1, text.replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ¿¡]/g, '').length);
          
        const speechDuration = Math.max(0.1, info.duration - 0.3);
        const actualCPS = charCount / speechDuration;
        const targetCPS = lang === 'kr' ? 7.5 : 13.5; 
        
        let correctionRate = targetCPS / actualCPS;
        correctionRate = Math.max(0.75, Math.min(1.35, correctionRate));
        return { ...info, correctionRate };
      }).catch(err => {
        delete audioCache.current[text];
        throw err;
      });
    }
    return await audioCache.current[text];
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
    if (currentLessonIndex === null || !apiKey) return;
    let isCancelled = false;
    
    const prefetchData = async () => {
      if (!chunks || chunks.length === 0) return;
      setIsPrefetching(true);
      setPrefetchProgress(0);
      let loadedCount = 0;

      for (let i = 0; i < chunks.length; i++) {
        if (isCancelled) break;
        const text = chunks[i];
        try {
          await getAudioInfo(text);
          loadedCount++;
          if (!isCancelled) setPrefetchProgress(Math.floor((loadedCount / chunks.length) * 100));
          await new Promise(r => setTimeout(r, 250));
        } catch (err) {
          console.error("Prefetch error for:", text, err);
          loadedCount++; 
        }
      }
      if (!isCancelled) setIsPrefetching(false);
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
    if (audioRef.current) audioRef.current.pause();
    setErrorMsg('');

    prefetchData();
    return () => { isCancelled = true; };
  }, [currentLessonIndex, difficulty, chunks, apiKey]);

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
      audioRef.current.playbackRate = playbackRate * currentCorrectionRate.current;
    }
  }, [playbackRate]);

  const playChunk = useCallback(async (index: number) => {
    if (currentLessonIndex === null) return;
    if (!apiKey) {
      setShowApiModal(true);
      return;
    }
    const text = chunks[index];
    try {
      setErrorMsg('');
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
      setIsPlaying(false);
      setIsLoading(true);
      
      const audioInfo = await getAudioInfo(text);
      const audio = new Audio(audioInfo.url);
      
      currentCorrectionRate.current = audioInfo.correctionRate;
      audio.playbackRate = playbackRate * audioInfo.correctionRate;
      audioRef.current = audio;

      audio.onplay = () => { setIsLoading(false); setIsPlaying(true); };
      audio.onended = () => setIsPlaying(false);
      audio.onerror = () => {
        setIsPlaying(false); setIsLoading(false);
        setErrorMsg("音声の再生中にエラーが発生しました。");
      };

      await audio.play();
    } catch (err) {
      console.error(err);
      setIsLoading(false); setIsPlaying(false);
      setErrorMsg("AI音声の生成に失敗しました。APIキーが正しいか確認してください。");
    }
  }, [chunks, playbackRate, currentLessonIndex, apiKey]);

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

  const handleToggleAllTranslations = () => {
    if (!apiKey) {
      setShowApiModal(true);
      return;
    }
    const allVisible = chunks.every((_, i) => visibleTranslations.includes(i));
    if (allVisible) {
      setVisibleTranslations([]);
    } else {
      setVisibleTranslations(chunks.map((_, i) => i));
    }
  };

  const handleAddCustomLesson = () => {
    if (!customText.trim()) return;
    const lang = detectLanguage(customText);
    const langLabel = lang === 'kr' ? "(KR)" : lang === 'es' ? "(ES)" : "(EN)";
    const title = customTitle.trim() || `Custom Lesson ${lessons.length - DEFAULT_LESSONS.length + 1} ${langLabel}`;
    
    const newLesson = createLesson(Date.now(), title, customText);
    const newLessons = [...lessons, newLesson];
    
    setLessons(newLessons);
    setCurrentLessonIndex(newLessons.length - 1); 
    setShowInputModal(false);
    setCustomText('');
    setCustomTitle('');
  };

  const allTranslationsVisible = chunks.length > 0 && chunks.every((_, i) => visibleTranslations.includes(i));

  return (
    <>
      {/* APIキー設定モーダル */}
      {showApiModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200">
            <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="font-bold text-slate-800 flex items-center gap-2"><Key size={18}/> APIキー設定</h3>
              {apiKey && (
                <button onClick={() => setShowApiModal(false)} className="text-slate-400 hover:text-slate-600 bg-white rounded-full p-1 shadow-sm">
                  <X size={20} />
                </button>
              )}
            </div>
            <div className="p-5 flex flex-col gap-4">
              <p className="text-sm text-slate-600 leading-relaxed">
                Mimick の音声生成と翻訳には <strong>Gemini API キー</strong> が必要です。キーはお使いのブラウザにのみ保存され、安全に利用できます。
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
              {apiKey && (
                <button 
                  onClick={() => setShowApiModal(false)}
                  className="px-4 py-2 text-slate-600 font-medium hover:bg-slate-200 rounded-lg transition-colors text-sm"
                >
                  キャンセル
                </button>
              )}
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
              <h3 className="font-bold text-slate-800">新しいお題を入力</h3>
              <button onClick={() => setShowInputModal(false)} className="text-slate-400 hover:text-slate-600 bg-white rounded-full p-1 shadow-sm">
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
                onClick={() => setShowInputModal(false)}
                className="px-4 py-2 text-slate-600 font-medium hover:bg-slate-200 rounded-lg transition-colors text-sm"
              >
                キャンセル
              </button>
              <button 
                onClick={handleAddCustomLesson}
                disabled={!customText.trim()}
                className="px-5 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 text-sm shadow-md"
              >
                <Plus size={16} /> 追加して始める
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
              <button 
                onClick={() => setShowInputModal(true)}
                className="text-sm font-medium text-blue-600 bg-blue-50 px-3 py-2 rounded-lg hover:bg-blue-100 transition-colors flex items-center gap-1.5 border border-blue-100 shadow-sm"
              >
                <Plus size={16} /> 新しく入力
              </button>
            </div>
            
            <div className="grid gap-3">
              {lessons.map((lesson, index) => {
                const langTag = lesson.title.match(/\((KR|EN|ES)\)/)?.[1] || 'EN';
                const displayTitle = lesson.title.replace(/\s*\((KR|EN|ES)\)/, '');
                
                return (
                  <button
                    key={lesson.id}
                    onClick={() => setCurrentLessonIndex(index)}
                    className="flex items-center justify-between p-4 bg-white rounded-xl shadow-sm border border-slate-200 hover:border-blue-400 hover:shadow-md transition-all text-left group"
                  >
                    <div className="pr-4">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[11px] font-bold text-blue-600 bg-blue-50 border border-blue-100 px-2 py-0.5 rounded uppercase">
                          {langTag}
                        </span>
                        <h3 className="font-bold text-slate-800 group-hover:text-blue-600 transition-colors line-clamp-1">{displayTitle}</h3>
                      </div>
                      <p className="text-sm text-slate-500 line-clamp-2 leading-relaxed mt-1.5">{lesson.fullText}</p>
                    </div>
                    <div className="w-10 h-10 rounded-full bg-slate-50 group-hover:bg-blue-50 flex items-center justify-center shrink-0 transition-colors">
                      <Play size={20} className="text-slate-400 group-hover:text-blue-500 ml-1" />
                    </div>
                  </button>
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
              <div className="flex items-center gap-3">
                <div className="hidden sm:flex text-xs font-medium bg-blue-700 px-3 py-1.5 rounded-full items-center gap-1.5">
                  {isPrefetching ? (
                    <><Loader2 size={14} className="animate-spin" /> 音声を準備中 {prefetchProgress}%</>
                  ) : (
                    <><CheckCircle2 size={14} className="text-green-300" /> 準備完了</>
                  )}
                </div>
                <button 
                  onClick={() => { setTempApiKey(apiKey); setShowApiModal(true); }}
                  className="bg-blue-700 hover:bg-blue-800 p-2 rounded-full transition-colors"
                  title="APIキー設定"
                >
                  <Key size={18} />
                </button>
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

              {/* 区切りの長さの調整エリア */}
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 mb-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-slate-600">
                    <Scissors size={18} />
                    <span className="font-medium text-sm">チャンク（区切り）の長さ</span>
                  </div>
                  <div className="flex bg-slate-100 p-1 rounded-xl sm:w-64">
                    {[
                      { id: 'easy', label: '短め' },
                      { id: 'normal', label: '標準' },
                      { id: 'hard', label: '長め' }
                    ].map((level) => (
                      <button
                        key={level.id}
                        onClick={() => setDifficulty(level.id as any)}
                        className={`flex-1 py-1.5 text-sm font-medium rounded-lg transition-all ${
                          difficulty === level.id 
                            ? 'bg-white text-blue-600 shadow-sm' 
                            : 'text-slate-500 hover:text-slate-700'
                        }`}
                      >
                        {level.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

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
                        onClick={handleToggleAllTranslations} 
                        className={`flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg transition-colors shadow-sm ${
                          allTranslationsVisible ? 'text-blue-600 bg-blue-50 border border-blue-200' : 'text-slate-600 hover:bg-slate-100 border border-slate-200'
                        }`}
                      >
                        <Globe size={16} /> 
                        {allTranslationsVisible ? '自動翻訳: ON' : '自動翻訳: OFF'}
                      </button>

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
                    <Globe size={16} /> 今の塊の訳を見る
                  </button>
                )}
              </div>

              <div className="flex justify-center items-center gap-6 md:gap-8 w-full mb-4">
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
              </div>
              
              <div className="w-full max-w-md mx-auto">
                <div className="flex items-center justify-between text-xs text-slate-500 mb-1.5 font-medium px-1">
                  <div className="flex items-center gap-1.5">
                    <Gauge size={14} />
                    <span>再生速度</span>
                  </div>
                  <span className="text-blue-600 font-bold bg-blue-50 px-1.5 py-0.5 rounded">
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
