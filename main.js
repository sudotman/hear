const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const elements = {
  siteHeader: $(".site-header"),
  startView: $("#start-view"),
  reader: $("#reader"),
  openForm: $("#open-form"),
  articleQuery: $("#article-query"),
  headerSearch: $("#header-search"),
  headerQuery: $("#header-query"),
  articleTitle: $("#article-title"),
  articleDescription: $("#article-description"),
  articleKicker: $("#article-kicker"),
  durationLabel: $("#duration-label"),
  wordCountLabel: $("#word-count-label"),
  sourceLink: $("#source-link"),
  articleCopy: $("#article-copy"),
  outlineNav: $("#outline-nav"),
  imageWrap: $("#article-image-wrap"),
  articleImage: $("#article-image"),
  articlePlaceholder: $("#article-placeholder"),
  imageCaption: $("#image-caption"),
  heroPlay: $("#hero-play"),
  restartButton: $("#restart-button"),
  player: $("#player"),
  mediaAudio: $("#media-audio"),
  playButton: $("#play-button"),
  backButton: $("#back-button"),
  forwardButton: $("#forward-button"),
  seekRange: $("#seek-range"),
  elapsedTime: $("#elapsed-time"),
  totalTime: $("#total-time"),
  nowSection: $("#now-section"),
  nowTitle: $("#now-title"),
  miniCover: $("#mini-cover"),
  miniCoverImage: $("#mini-cover-image"),
  rateButton: $("#rate-button"),
  voiceButton: $("#voice-button"),
  voiceName: $("#voice-name"),
  voiceType: $("#voice-type"),
  voiceSheet: $("#voice-sheet"),
  voiceSelect: $("#voice-select"),
  naturalVoiceSelect: $("#natural-voice-select"),
  naturalVoiceRow: $("#natural-voice-row"),
  systemVoiceRow: $("#system-voice-row"),
  naturalEngine: $("#natural-engine"),
  systemEngine: $("#system-engine"),
  engineDescription: $("#engine-description"),
  voiceNote: $("#voice-note"),
  rateRange: $("#rate-range"),
  rateOutput: $("#rate-output"),
  rateDescription: $("#rate-description"),
  followToggle: $("#follow-toggle"),
  previewVoice: $("#preview-voice"),
  neuralSheet: $("#neural-sheet"),
  downloadNeural: $("#download-neural"),
  setupButton: $("#setup-button"),
  setupSheet: $("#setup-sheet"),
  bookmarkletLink: $("#bookmarklet-link"),
  copyBookmarklet: $("#copy-bookmarklet"),
  shareButton: $("#share-button"),
  loadingView: $("#loading-view"),
  loadingTitle: $("#loading-title"),
  loadingDetail: $("#loading-detail"),
  loadingProgress: $("#loading-progress"),
  toast: $("#toast"),
};

const synth = window.speechSynthesis;
const supportsSpeech = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
const WORDS_PER_MINUTE = 185;
const STORAGE_PREFIX = "hearwiki:";
const NATURAL_VOICES = {
  af_heart: "Heart",
  af_bella: "Bella",
  bf_emma: "Emma",
  bm_fable: "Fable",
  am_michael: "Michael",
};
const EXCLUDED_SECTIONS = new Set([
  "see also",
  "notes",
  "footnotes",
  "citations",
  "references",
  "sources",
  "bibliography",
  "works cited",
  "further reading",
  "external links",
  "general references",
  "related articles",
  // French
  "voir aussi",
  "notes et références",
  "références",
  "bibliographie",
  "articles connexes",
  "liens externes",
  // Spanish
  "véase también",
  "notas",
  "referencias",
  "bibliografía",
  "enlaces externos",
  "otras lecturas",
  // Portuguese
  "ver também",
  "referências",
  "ligações externas",
  "leitura adicional",
  // German
  "siehe auch",
  "anmerkungen",
  "einzelnachweise",
  "literatur",
  "weblinks",
  // Italian
  "voci correlate",
  "note",
  "collegamenti esterni",
  // Dutch and Swedish
  "zie ook",
  "noten",
  "referenties",
  "externe links",
  "se även",
  "referenser",
  "källor",
  "externa länkar",
  "vidare läsning",
  // Polish and Russian
  "zobacz też",
  "uwagi",
  "przypisy",
  "linki zewnętrzne",
  "см также",
  "примечания",
  "источники",
  "литература",
  "ссылки",
  // Hindi, Japanese, Chinese, Korean, and Arabic
  "इन्हें भी देखें",
  "टिप्पणी",
  "सन्दर्भ",
  "संदर्भ",
  "बाहरी कड़ियाँ",
  "脚注",
  "注釈",
  "出典",
  "参考文献",
  "関連項目",
  "外部リンク",
  "参见",
  "參見",
  "注释",
  "註釋",
  "參考文獻",
  "外部链接",
  "外部連結",
  "같이 보기",
  "각주",
  "참고 문헌",
  "외부 링크",
  "انظر أيضًا",
  "ملاحظات",
  "مراجع",
  "المراجع",
  "وصلات خارجية",
]);

const state = {
  article: null,
  chunks: [],
  neuralSegments: [],
  voices: [],
  selectedVoice: null,
  engine: localStorage.getItem(`${STORAGE_PREFIX}engine`) || "neural",
  neuralVoice: localStorage.getItem(`${STORAGE_PREFIX}neural-voice`) || "af_heart",
  neuralWorker: null,
  neuralReady: false,
  neuralInitPromise: null,
  neuralInitResolve: null,
  neuralInitReject: null,
  neuralRequests: new Map(),
  neuralCache: new Map(),
  neuralRequestId: 0,
  neuralRunId: 0,
  currentSegmentIndex: 0,
  currentAudioUrl: null,
  audioUnlocked: false,
  unlockAudioUrl: null,
  pendingNeuralAction: null,
  mediaSwitching: false,
  lastAudioSave: 0,
  rate: Number(localStorage.getItem(`${STORAGE_PREFIX}rate`)) || 1,
  follow: localStorage.getItem(`${STORAGE_PREFIX}follow`) !== "false",
  playback: "idle",
  currentIndex: 0,
  boundaryWords: 0,
  runId: 0,
  currentUtterance: null,
  activeBlockId: null,
  toastTimer: null,
  isSeeking: false,
};

function cleanText(value) {
  return value
    .replace(/\[[\d\s,–—-]+\]/g, "")
    .replace(/\[(?:citation needed|clarification needed|when\?|where\?|who\?)\]/gi, "")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/[\t\n\r ]+/g, " ")
    .replace(/\s+([’'])\s+/g, "$1")
    .trim();
}

function normalizedHeading(value) {
  return cleanText(value)
    .replace(/\[edit\]$/i, "")
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .trim()
    .toLowerCase();
}

function wordCount(text) {
  return text.match(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu)?.length || 1;
}

function splitLongText(text, maxLength = 320) {
  if (text.length <= maxLength) return [text];

  const pieces = [];
  let remainder = text;

  while (remainder.length > maxLength) {
    const window = remainder.slice(0, maxLength + 1);
    const breakAt = Math.max(
      window.lastIndexOf("; "),
      window.lastIndexOf(": "),
      window.lastIndexOf(", "),
      window.lastIndexOf(" "),
    );
    const index = breakAt > maxLength * 0.55 ? breakAt + 1 : maxLength;
    pieces.push(remainder.slice(0, index).trim());
    remainder = remainder.slice(index).trim();
  }

  if (remainder) pieces.push(remainder);
  return pieces;
}

function segmentSentences(text, lang) {
  let sentences;

  if ("Segmenter" in Intl) {
    try {
      const segmenter = new Intl.Segmenter(lang, { granularity: "sentence" });
      sentences = [...segmenter.segment(text)].map(({ segment }) => segment.trim()).filter(Boolean);
    } catch {
      sentences = null;
    }
  }

  if (!sentences?.length) {
    sentences = text.match(/[^.!?]+(?:[.!?]+[”’"']?|$)/g)?.map((item) => item.trim()).filter(Boolean) || [text];
  }

  return sentences.flatMap((sentence) => splitLongText(sentence));
}

function parseArticleInput(rawInput) {
  const input = rawInput.trim();
  if (!input) throw new Error("Paste a Wikipedia link or enter an article title.");

  let possibleUrl = input;
  if (/^(?:[a-z-]+\.)?(?:m\.)?wikipedia\.org\//i.test(input)) {
    possibleUrl = `https://${input}`;
  }

  if (/^https?:\/\//i.test(possibleUrl)) {
    const url = new URL(possibleUrl);
    const hostMatch = url.hostname.match(/^([a-z-]+)(?:\.m)?\.wikipedia\.org$/i);
    if (!hostMatch) throw new Error("That link isn’t a Wikipedia article.");

    let title = "";
    if (url.pathname.startsWith("/wiki/")) {
      title = url.pathname.slice(6);
    } else if (url.searchParams.get("title")) {
      title = url.searchParams.get("title");
    }

    if (!title) throw new Error("I couldn’t find an article title in that link.");
    return {
      lang: hostMatch[1].toLowerCase(),
      title: decodeURIComponent(title).replaceAll("_", " "),
      fromUrl: true,
    };
  }

  const languagePrefix = input.match(/^([a-z-]{2,12}):\s*(.+)$/i);
  return {
    lang: languagePrefix ? languagePrefix[1].toLowerCase() : "en",
    title: languagePrefix ? languagePrefix[2] : input,
    fromUrl: false,
  };
}

function safeLanguage(lang) {
  return /^[a-z-]{2,12}$/i.test(lang) ? lang.toLowerCase() : "en";
}

function articleImageFromSummary(summary) {
  const thumbnail = summary?.thumbnail?.source;
  if (thumbnail) return thumbnail.replace(/\/\d+px-/, "/1280px-");
  return summary?.originalimage?.source || "";
}

async function fetchArticle(title, language, allowSearch = true) {
  const lang = safeLanguage(language);
  const key = encodeURIComponent(title.trim().replaceAll(" ", "_"));
  const origin = `https://${lang}.wikipedia.org`;
  const htmlUrl = `${origin}/w/rest.php/v1/page/${key}/html`;
  const summaryUrl = `${origin}/api/rest_v1/page/summary/${key}`;

  const [htmlResponse, summaryResponse] = await Promise.all([
    fetch(htmlUrl, { headers: { Accept: "text/html" } }),
    fetch(summaryUrl, { headers: { Accept: "application/json" } }).catch(() => null),
  ]);

  if (!htmlResponse.ok) {
    if (htmlResponse.status === 404 && allowSearch) {
      const searchUrl = `${origin}/w/rest.php/v1/search/title?q=${encodeURIComponent(title)}&limit=1`;
      const searchResponse = await fetch(searchUrl);
      if (searchResponse.ok) {
        const searchData = await searchResponse.json();
        const result = searchData.pages?.[0];
        if (result?.key || result?.title) {
          return fetchArticle(result.key || result.title, lang, false);
        }
      }
    }
    throw new Error(htmlResponse.status === 404 ? "I couldn’t find that Wikipedia article." : "Wikipedia didn’t respond. Try again in a moment.");
  }

  const html = await htmlResponse.text();
  const summary = summaryResponse?.ok ? await summaryResponse.json() : null;
  const blocks = extractArticleBlocks(html);

  if (!blocks.length) throw new Error("That page doesn’t contain a readable article.");

  const resolvedTitle = summary?.title || title.replaceAll("_", " ");
  return {
    lang,
    title: resolvedTitle,
    description: cleanText(summary?.description || "A clean listening edition from Wikipedia"),
    image: articleImageFromSummary(summary),
    sourceUrl: summary?.content_urls?.desktop?.page || `${origin}/wiki/${encodeURIComponent(resolvedTitle.replaceAll(" ", "_"))}`,
    blocks,
  };
}

function extractArticleBlocks(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");

  // Reference markup is consistent even when the visible section heading is not.
  // Mark its enclosing section before citation nodes themselves are removed.
  doc.querySelectorAll("section[data-mw-section-id]").forEach((section) => {
    if (section.querySelector(".mw-references-wrap, .references, [typeof~='mw:Extension/references']")) {
      section.dataset.hearwikiExclude = "true";
    }
  });

  const removableSelectors = [
    "script",
    "style",
    "link",
    "sup",
    "table",
    "figure",
    "audio",
    "video",
    "nav",
    "aside",
    ".mw-editsection",
    ".mw-ref",
    ".reference",
    ".references",
    ".mw-references-wrap",
    ".shortdescription",
    ".hatnote",
    ".infobox",
    ".sidebar",
    ".navbox",
    ".vertical-navbox",
    ".metadata",
    ".ambox",
    ".tmbox",
    ".ombox",
    ".cmbox",
    ".fmbox",
    ".portalbox",
    ".sistersitebox",
    ".authority-control",
    ".gallery",
    ".toc",
    ".nomobile",
    ".noprint",
    "[typeof~='mw:Extension/references']",
  ];

  doc.querySelectorAll(removableSelectors.join(",")).forEach((element) => element.remove());

  const blocks = [];
  let skipSection = false;
  let sectionName = "Introduction";
  let sectionId = "introduction";

  const candidates = doc.body.querySelectorAll("h2, h3, p, li");
  for (const element of candidates) {
    if (element.closest("table, figure, nav, aside")) continue;
    if (element.tagName === "LI" && element.querySelector("li")) continue;

    const text = cleanText(element.textContent || "");
    if (!text) continue;

    if (element.tagName === "H2") {
      const heading = normalizedHeading(text);
      skipSection = EXCLUDED_SECTIONS.has(heading) || element.closest("section")?.dataset.hearwikiExclude === "true";
      if (skipSection) continue;

      sectionName = text;
      sectionId = `section-${blocks.length}`;
      blocks.push({ id: sectionId, type: "h2", text, section: sectionName, sectionId });
      continue;
    }

    if (skipSection) continue;

    if (element.tagName === "H3") {
      if (text.length < 2) continue;
      blocks.push({ id: `block-${blocks.length}`, type: "h3", text, section: sectionName, sectionId });
      continue;
    }

    if (text.length < 18 || /^(coordinates|isbn|doi)\s*:/i.test(text)) continue;
    blocks.push({
      id: `block-${blocks.length}`,
      type: element.tagName === "LI" ? "li" : "p",
      text,
      section: sectionName,
      sectionId,
    });
  }

  return blocks;
}

function createSpeechChunks(article) {
  const chunks = [];
  let cumulativeWords = 0;

  const addChunk = (text, block) => {
    const count = wordCount(text);
    chunks.push({
      text,
      blockId: block?.id || null,
      section: block?.section || "Opening",
      sectionId: block?.sectionId || "introduction",
      startWord: cumulativeWords,
      wordCount: count,
    });
    cumulativeWords += count;
  };

  addChunk(article.title, null);
  for (const block of article.blocks) {
    if (block.type === "h2" || block.type === "h3") {
      addChunk(`${block.text}.`, block);
      continue;
    }
    for (const sentence of segmentSentences(block.text, article.lang)) {
      addChunk(sentence, block);
    }
  }

  return chunks;
}

function createNeuralSegments(chunks, maxCharacters = 360) {
  const segments = [];
  let current = null;

  const commit = () => {
    if (!current) return;
    current.text = current.text.trim();
    current.wordCount = current.endWord - current.startWord;
    segments.push(current);
    current = null;
  };

  chunks.forEach((chunk, chunkIndex) => {
    const candidateLength = current ? current.text.length + chunk.text.length + 1 : chunk.text.length;
    if (current && candidateLength > maxCharacters) commit();

    if (!current) {
      current = {
        text: "",
        startChunk: chunkIndex,
        endChunk: chunkIndex + 1,
        startWord: chunk.startWord,
        endWord: chunk.startWord + chunk.wordCount,
        wordCount: chunk.wordCount,
        blockId: chunk.blockId,
        section: chunk.section,
        sectionId: chunk.sectionId,
      };
    }

    current.text += `${current.text ? " " : ""}${chunk.text}`;
    current.endChunk = chunkIndex + 1;
    current.endWord = chunk.startWord + chunk.wordCount;
  });

  commit();
  return segments;
}

function neuralSegmentIndexForChunk(chunkIndex) {
  let low = 0;
  let high = Math.max(0, state.neuralSegments.length - 1);
  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2);
    if (state.neuralSegments[mid].startChunk <= chunkIndex) low = mid;
    else high = mid - 1;
  }
  return low;
}

function renderArticle(article) {
  elements.articleTitle.textContent = article.title;
  elements.articleDescription.textContent = article.description;
  elements.articleKicker.textContent = `From ${article.lang}.wikipedia.org`;
  elements.sourceLink.href = article.sourceUrl;
  elements.nowTitle.textContent = article.title;

  const count = state.chunks.at(-1)?.startWord + state.chunks.at(-1)?.wordCount || 0;
  const minutes = Math.max(1, Math.round(count / (WORDS_PER_MINUTE * state.rate)));
  elements.durationLabel.textContent = `${minutes} min listen`;
  elements.wordCountLabel.textContent = `${count.toLocaleString()} words`;
  elements.totalTime.textContent = formatTime((count / WORDS_PER_MINUTE / state.rate) * 60);

  if (article.image) {
    elements.articleImage.src = article.image;
    elements.articleImage.alt = `Lead image for ${article.title}`;
    elements.imageCaption.textContent = `Image from ${article.lang}.wikipedia.org`;
    elements.imageWrap.hidden = false;
    elements.articlePlaceholder.hidden = true;
    elements.miniCoverImage.src = article.image;
    elements.miniCoverImage.hidden = false;
    $("span", elements.miniCover).hidden = true;
  } else {
    elements.imageWrap.hidden = true;
    elements.articlePlaceholder.hidden = false;
    elements.articlePlaceholder.querySelector("span").textContent = article.title[0]?.toUpperCase() || "W";
    elements.miniCoverImage.hidden = true;
    $("span", elements.miniCover).hidden = false;
    $("span", elements.miniCover).textContent = article.title[0]?.toUpperCase() || "W";
  }

  elements.articleCopy.replaceChildren();
  let currentList = null;
  for (const block of article.blocks) {
    let node;
    if (block.type === "li") {
      if (!currentList) {
        currentList = document.createElement("ul");
        elements.articleCopy.append(currentList);
      }
      node = document.createElement("li");
      currentList.append(node);
    } else {
      currentList = null;
      node = document.createElement(block.type);
      elements.articleCopy.append(node);
    }
    node.id = block.id;
    node.textContent = block.text;
  }

  elements.outlineNav.replaceChildren();
  const introTarget = article.blocks.find((block) => block.type === "p" || block.type === "li");
  if (introTarget) addOutlineLink("Introduction", introTarget.id, "introduction");
  for (const block of article.blocks.filter((item) => item.type === "h2")) {
    addOutlineLink(block.text, block.id, block.sectionId);
  }
}

function addOutlineLink(label, targetId, sectionId) {
  const link = document.createElement("a");
  link.href = `#${targetId}`;
  link.textContent = label;
  link.dataset.sectionId = sectionId;
  elements.outlineNav.append(link);
}

function totalWords() {
  const last = state.chunks.at(-1);
  return last ? last.startWord + last.wordCount : 1;
}

function chunkIndexForWord(targetWord) {
  let low = 0;
  let high = Math.max(0, state.chunks.length - 1);

  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2);
    if (state.chunks[mid].startWord <= targetWord) low = mid;
    else high = mid - 1;
  }

  return low;
}

function currentWordPosition() {
  if (state.engine === "neural") {
    const segment = state.neuralSegments[state.currentSegmentIndex];
    const duration = elements.mediaAudio.duration;
    if (segment && Number.isFinite(duration) && duration > 0) {
      const ratio = Math.min(1, Math.max(0, elements.mediaAudio.currentTime / duration));
      return Math.min(totalWords(), segment.startWord + segment.wordCount * ratio);
    }
  }
  const chunk = state.chunks[state.currentIndex];
  if (!chunk) return totalWords();
  return Math.min(totalWords(), chunk.startWord + state.boundaryWords);
}

function naturalVoiceAvailable() {
  return state.article?.lang?.toLowerCase().startsWith("en");
}

function updateEngineUI() {
  if (!naturalVoiceAvailable() && state.engine === "neural") state.engine = "system";
  const isNeural = state.engine === "neural";
  elements.naturalEngine.setAttribute("aria-pressed", String(isNeural));
  elements.systemEngine.setAttribute("aria-pressed", String(!isNeural));
  elements.naturalEngine.disabled = !naturalVoiceAvailable();
  elements.naturalVoiceRow.hidden = !isNeural;
  elements.systemVoiceRow.hidden = isNeural;
  elements.voiceType.textContent = isNeural ? "Natural · on device" : "System voice";
  elements.voiceName.textContent = isNeural
    ? NATURAL_VOICES[state.neuralVoice] || "Heart"
    : state.selectedVoice?.name || "System voice";
  elements.engineDescription.textContent = naturalVoiceAvailable()
    ? "Neural audio generated privately on this device"
    : "Natural voice currently supports English articles";
  elements.voiceNote.textContent = isNeural
    ? "The first use downloads a 95–165 MB open voice model, depending on your device. It stays in Safari’s local cache; article text never goes to a speech service."
    : "System voices start instantly, but Safari may expose only its compact voices. Natural voice is the higher-quality option for English articles.";
  elements.naturalVoiceSelect.value = state.neuralVoice;
}

function clearNeuralCache() {
  for (const entry of state.neuralCache.values()) URL.revokeObjectURL(entry.url);
  state.neuralCache.clear();
  state.currentAudioUrl = null;
}

function setNeuralLoading(progress = null, detail = "Loading the natural voice") {
  elements.loadingTitle.textContent = "Preparing your natural voice…";
  elements.loadingDetail.textContent = detail;
  elements.loadingProgress.hidden = progress === null;
  if (progress !== null) {
    elements.loadingProgress.style.setProperty("--download-progress", `${Math.min(100, Math.max(0, progress))}%`);
  }
  elements.loadingView.hidden = false;
}

function hideLoading() {
  elements.loadingView.hidden = true;
  elements.loadingProgress.hidden = true;
  elements.loadingProgress.style.setProperty("--download-progress", "0%");
}

function ensureNeuralWorker({ background = false } = {}) {
  if (state.neuralReady) return Promise.resolve();
  if (state.neuralInitPromise) return state.neuralInitPromise;

  state.neuralWorker = new Worker(new URL("./tts-worker.js", import.meta.url), { type: "module" });
  state.neuralInitPromise = new Promise((resolve, reject) => {
    state.neuralInitResolve = resolve;
    state.neuralInitReject = reject;
  });

  state.neuralWorker.addEventListener("message", (event) => {
    const message = event.data;
    if (message.type === "progress") {
      if (background) return;
      if (message.file?.includes("onnx") && Number.isFinite(message.progress)) {
        setNeuralLoading(message.progress, `Downloading voice model · ${Math.round(message.progress)}%`);
      } else if (message.status === "initiate") {
        setNeuralLoading(null, "Preparing voice files");
      }
      return;
    }

    if (message.type === "ready") {
      state.neuralReady = true;
      localStorage.setItem(`${STORAGE_PREFIX}neural-ready`, "true");
      state.neuralInitResolve?.();
      state.neuralInitResolve = null;
      state.neuralInitReject = null;
      hideLoading();
      return;
    }

    if (message.type === "audio") {
      const request = state.neuralRequests.get(message.id);
      if (!request) return;
      state.neuralRequests.delete(message.id);
      const url = URL.createObjectURL(new Blob([message.buffer], { type: "audio/wav" }));
      const entry = { url, duration: message.duration };
      if (request.cacheKey) state.neuralCache.set(request.cacheKey, entry);
      request.resolve(entry);
      trimNeuralCache();
      return;
    }

    if (message.type === "generation-error") {
      const request = state.neuralRequests.get(message.id);
      if (!request) return;
      state.neuralRequests.delete(message.id);
      request.reject(new Error(message.message));
      return;
    }

    if (message.type === "fatal") {
      const error = new Error(message.message);
      state.neuralInitReject?.(error);
      state.neuralInitPromise = null;
      state.neuralInitResolve = null;
      state.neuralInitReject = null;
      for (const request of state.neuralRequests.values()) request.reject(error);
      state.neuralRequests.clear();
      hideLoading();
    }
  });

  state.neuralWorker.addEventListener("error", (event) => {
    const error = new Error(event.message || "The natural voice stopped unexpectedly.");
    state.neuralInitReject?.(error);
    state.neuralInitPromise = null;
    state.neuralInitResolve = null;
    state.neuralInitReject = null;
    hideLoading();
  });

  if (!background) setNeuralLoading(null, "Starting the private voice engine");
  state.neuralWorker.postMessage({ type: "init" });
  return state.neuralInitPromise;
}

function trimNeuralCache() {
  if (state.neuralCache.size <= 8) return;
  for (const [key, entry] of state.neuralCache) {
    const segmentNumber = Number(key.split(":").at(-1));
    if (entry.url === state.currentAudioUrl || Math.abs(segmentNumber - state.currentSegmentIndex) <= 2) continue;
    URL.revokeObjectURL(entry.url);
    state.neuralCache.delete(key);
    if (state.neuralCache.size <= 8) break;
  }
}

async function generateNeuralText(text, cacheKey = "") {
  if (cacheKey && state.neuralCache.has(cacheKey)) return state.neuralCache.get(cacheKey);
  const existing = [...state.neuralRequests.values()].find((request) => request.cacheKey === cacheKey && cacheKey);
  if (existing) return existing.promise;

  await ensureNeuralWorker();
  const id = ++state.neuralRequestId;
  let resolveRequest;
  let rejectRequest;
  const promise = new Promise((resolve, reject) => {
    resolveRequest = resolve;
    rejectRequest = reject;
  });
  state.neuralRequests.set(id, {
    cacheKey,
    promise,
    resolve: resolveRequest,
    reject: rejectRequest,
  });
  state.neuralWorker.postMessage({ type: "generate", id, text, voice: state.neuralVoice });
  return promise;
}

function getNeuralSegment(segmentIndex) {
  const segment = state.neuralSegments[segmentIndex];
  if (!segment) return Promise.reject(new Error("That part of the article is unavailable."));
  const cacheKey = `${state.neuralVoice}:${segmentIndex}`;
  return generateNeuralText(segment.text, cacheKey);
}

function createSilentWavUrl() {
  const sampleRate = 8000;
  const samples = sampleRate;
  const buffer = new ArrayBuffer(44 + samples);
  const view = new DataView(buffer);
  const write = (offset, text) => [...text].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
  write(0, "RIFF");
  view.setUint32(4, 36 + samples, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  write(36, "data");
  view.setUint32(40, samples, true);
  new Uint8Array(buffer, 44).fill(128);
  return URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
}

function unlockMediaAudio() {
  if (state.audioUnlocked) return;
  const silentUrl = createSilentWavUrl();
  state.unlockAudioUrl = silentUrl;
  elements.mediaAudio.src = silentUrl;
  elements.mediaAudio.loop = true;
  elements.mediaAudio.muted = true;
  elements.mediaAudio.play().then(() => {
    state.audioUnlocked = true;
  }).catch(() => {
    URL.revokeObjectURL(silentUrl);
    if (state.unlockAudioUrl === silentUrl) state.unlockAudioUrl = null;
  });
}

function releaseUnlockAudio() {
  if (!state.unlockAudioUrl) return;
  URL.revokeObjectURL(state.unlockAudioUrl);
  state.unlockAudioUrl = null;
}

function requestNeuralAction(action) {
  state.pendingNeuralAction = action;
  if (state.neuralReady || localStorage.getItem(`${STORAGE_PREFIX}neural-ready`) === "true") {
    unlockMediaAudio();
    state.pendingNeuralAction = null;
    action();
    return;
  }
  elements.neuralSheet.showModal();
}

async function playNeuralFromChunk(chunkIndex, targetWord = null) {
  if (!naturalVoiceAvailable()) {
    showToast("Natural voice currently supports English articles.");
    return;
  }

  const safeIndex = Math.min(Math.max(0, chunkIndex), state.chunks.length - 1);
  const segmentIndex = neuralSegmentIndexForChunk(safeIndex);
  const segment = state.neuralSegments[segmentIndex];
  if (!segment) return;

  state.runId += 1;
  if (supportsSpeech) synth.cancel();
  const runId = ++state.neuralRunId;
  if (elements.mediaAudio.dataset.mode) {
    state.mediaSwitching = true;
    elements.mediaAudio.pause();
    state.mediaSwitching = false;
  }
  state.currentIndex = safeIndex;
  state.currentSegmentIndex = segmentIndex;
  state.boundaryWords = 0;
  setPlaybackState("buffering");
  elements.nowSection.textContent = "Preparing natural voice";
  updateProgress(targetWord ?? segment.startWord);

  try {
    const audio = await getNeuralSegment(segmentIndex);
    if (runId !== state.neuralRunId || state.engine !== "neural") return;

    state.mediaSwitching = true;
    state.currentAudioUrl = audio.url;
    releaseUnlockAudio();
    elements.mediaAudio.loop = false;
    elements.mediaAudio.muted = false;
    elements.mediaAudio.volume = 1;
    elements.mediaAudio.playbackRate = state.rate;
    elements.mediaAudio.dataset.mode = "article";
    elements.mediaAudio.src = audio.url;
    elements.mediaAudio.load();

    await new Promise((resolve) => {
      if (elements.mediaAudio.readyState >= 1) resolve();
      else elements.mediaAudio.addEventListener("loadedmetadata", resolve, { once: true });
    });

    if (targetWord !== null && Number.isFinite(elements.mediaAudio.duration)) {
      const ratio = Math.min(1, Math.max(0, (targetWord - segment.startWord) / segment.wordCount));
      elements.mediaAudio.currentTime = ratio * elements.mediaAudio.duration;
    }

    await elements.mediaAudio.play();
    if (runId !== state.neuralRunId) {
      elements.mediaAudio.pause();
      return;
    }
    state.mediaSwitching = false;
    setPlaybackState("playing");
    updateActiveBlock(state.chunks[state.currentIndex]);
    getNeuralSegment(segmentIndex + 1).catch(() => {});
    getNeuralSegment(segmentIndex + 2).catch(() => {});
  } catch (error) {
    if (runId !== state.neuralRunId) return;
    state.mediaSwitching = false;
    setPlaybackState("paused");
    showToast(error.name === "NotAllowedError" ? "Tap play once more to start audio." : "Natural voice failed. You can switch to System voice in settings.");
  }
}

function pauseNeural() {
  elements.mediaAudio.pause();
  setPlaybackState("paused");
  savePosition();
}

function stopNeural(resetSource = false) {
  state.neuralRunId += 1;
  state.mediaSwitching = true;
  elements.mediaAudio.pause();
  elements.mediaAudio.loop = false;
  elements.mediaAudio.muted = false;
  if (resetSource) {
    elements.mediaAudio.removeAttribute("src");
    elements.mediaAudio.dataset.mode = "";
    releaseUnlockAudio();
  }
  state.mediaSwitching = false;
}

function setPlaybackState(nextState) {
  state.playback = nextState;
  elements.player.dataset.state = nextState;
  const playing = nextState === "playing";
  elements.playButton.setAttribute("aria-label", playing ? "Pause" : nextState === "buffering" ? "Preparing voice" : "Play");
  const heroLabel = $("span:last-child", elements.heroPlay);
  heroLabel.textContent = playing
    ? "Pause listening"
    : nextState === "buffering"
      ? "Preparing voice…"
      : nextState === "paused"
        ? "Resume listening"
        : "Start listening";
  if ("mediaSession" in navigator) {
    navigator.mediaSession.playbackState = playing || (nextState === "buffering" && state.engine === "neural")
      ? "playing"
      : nextState === "paused"
        ? "paused"
        : "none";
  }
}

function applyVoiceToUtterance(utterance) {
  if (state.selectedVoice) utterance.voice = state.selectedVoice;
  utterance.lang = state.selectedVoice?.lang || state.article?.lang || "en-US";
  utterance.rate = state.rate;
  utterance.pitch = 1;
  utterance.volume = 1;
}

function startSpeechAt(index) {
  if (!supportsSpeech || !state.chunks.length) {
    showToast("Speech playback isn’t available in this browser.");
    return;
  }

  const safeIndex = Math.min(Math.max(0, index), state.chunks.length - 1);
  state.runId += 1;
  const runId = state.runId;
  synth.cancel();
  if (synth.paused) synth.resume();
  state.currentIndex = safeIndex;
  state.boundaryWords = 0;
  setPlaybackState("playing");
  updateProgress();

  window.setTimeout(() => speakChunk(runId), 70);
}

function speakChunk(runId) {
  if (runId !== state.runId || state.playback !== "playing") return;
  const chunk = state.chunks[state.currentIndex];
  if (!chunk) {
    finishPlayback();
    return;
  }

  const utterance = new SpeechSynthesisUtterance(chunk.text);
  state.currentUtterance = utterance;
  applyVoiceToUtterance(utterance);

  utterance.onstart = () => {
    if (runId !== state.runId) return;
    updateActiveBlock(chunk);
    updateProgress();
  };

  utterance.onboundary = (event) => {
    if (runId !== state.runId || typeof event.charIndex !== "number") return;
    state.boundaryWords = Math.min(chunk.wordCount - 1, wordCount(chunk.text.slice(0, event.charIndex)));
    updateProgress();
  };

  utterance.onend = () => {
    if (runId !== state.runId || state.playback !== "playing") return;
    state.currentIndex += 1;
    state.boundaryWords = 0;
    savePosition();
    if (state.currentIndex >= state.chunks.length) {
      finishPlayback();
    } else {
      speakChunk(runId);
    }
  };

  utterance.onerror = (event) => {
    if (runId !== state.runId || event.error === "canceled" || event.error === "interrupted") return;
    setPlaybackState("paused");
    showToast("The voice paused unexpectedly. Press play to continue.");
  };

  synth.speak(utterance);
}

function finishPlayback() {
  if (state.engine === "neural") stopNeural(false);
  state.currentIndex = Math.max(0, state.chunks.length - 1);
  state.boundaryWords = state.chunks.at(-1)?.wordCount || 0;
  state.currentUtterance = null;
  setPlaybackState("ended");
  updateProgress();
  savePosition();
}

function togglePlayback() {
  if (!state.article) return;

  if (state.engine === "neural") {
    if (state.playback === "buffering") return;
    if (state.playback === "playing") {
      pauseNeural();
      return;
    }
    if (state.playback === "paused" && elements.mediaAudio.src && state.currentAudioUrl === elements.mediaAudio.src) {
      unlockMediaAudio();
      elements.mediaAudio.playbackRate = state.rate;
      elements.mediaAudio.play().then(() => setPlaybackState("playing")).catch(() => {
        playNeuralFromChunk(state.currentIndex, currentWordPosition());
      });
      return;
    }
    if (state.playback === "ended") state.currentIndex = 0;
    requestNeuralAction(() => playNeuralFromChunk(state.currentIndex));
    return;
  }

  if (state.playback === "playing") {
    synth.pause();
    setPlaybackState("paused");
    savePosition();
    return;
  }

  if (state.playback === "paused" && synth.paused && state.currentUtterance) {
    synth.resume();
    setPlaybackState("playing");
    return;
  }

  if (state.playback === "ended") state.currentIndex = 0;
  startSpeechAt(state.currentIndex);
}

function stopSpeech(nextState = "idle") {
  state.runId += 1;
  if (supportsSpeech) {
    synth.cancel();
    if (synth.paused) synth.resume();
  }
  stopNeural(true);
  state.currentUtterance = null;
  setPlaybackState(nextState);
}

function seekToIndex(index, preservePlaying = true, targetWord = null) {
  const wasPlaying = state.playback === "playing";
  state.currentIndex = Math.min(Math.max(0, index), Math.max(0, state.chunks.length - 1));
  state.boundaryWords = 0;
  if (wasPlaying && preservePlaying) {
    if (state.engine === "neural") playNeuralFromChunk(state.currentIndex, targetWord);
    else startSpeechAt(state.currentIndex);
  } else {
    stopSpeech(state.playback === "idle" ? "idle" : "paused");
    updateActiveBlock(state.chunks[state.currentIndex]);
    updateProgress();
  }
  savePosition();
}

function skipSeconds(seconds) {
  if (!state.chunks.length) return;
  const deltaWords = (WORDS_PER_MINUTE / 60) * state.rate * seconds;
  const target = Math.min(totalWords() - 1, Math.max(0, currentWordPosition() + deltaWords));
  seekToIndex(chunkIndexForWord(target), true, target);
}

function updateActiveBlock(chunk) {
  if (!chunk) return;
  elements.nowSection.textContent = chunk.section;

  if (chunk.blockId && chunk.blockId !== state.activeBlockId) {
    if (state.activeBlockId) document.getElementById(state.activeBlockId)?.classList.remove("is-speaking");
    const block = document.getElementById(chunk.blockId);
    block?.classList.add("is-speaking");
    state.activeBlockId = chunk.blockId;

    $$("a", elements.outlineNav).forEach((link) => {
      link.classList.toggle("active", link.dataset.sectionId === chunk.sectionId);
    });

    if (state.follow && block && state.playback === "playing") {
      const rect = block.getBoundingClientRect();
      const safeBottom = window.innerHeight - 150;
      if (rect.top < 100 || rect.bottom > safeBottom) {
        block.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }
}

function updateProgress(previewWord = null) {
  const words = totalWords();
  const position = previewWord ?? currentWordPosition();
  const ratio = Math.min(1, Math.max(0, position / words));
  const value = Math.round(ratio * 1000);
  elements.seekRange.value = String(value);
  elements.seekRange.style.setProperty("--range-progress", `${ratio * 100}%`);
  elements.elapsedTime.textContent = formatTime((position / WORDS_PER_MINUTE / state.rate) * 60);
  elements.totalTime.textContent = formatTime((words / WORDS_PER_MINUTE / state.rate) * 60);
  updateMediaPosition(position);
}

function updateMediaPosition(positionWords = currentWordPosition()) {
  if (!("mediaSession" in navigator) || !state.article || state.playback === "idle") return;
  const duration = (totalWords() / WORDS_PER_MINUTE) * 60;
  const position = Math.min(duration - 0.01, Math.max(0, (positionWords / WORDS_PER_MINUTE) * 60));
  if (!Number.isFinite(duration) || duration <= 0) return;
  try {
    navigator.mediaSession.setPositionState({ duration, position, playbackRate: state.rate });
  } catch {
    // Position state is optional on older Safari versions.
  }
}

function formatTime(totalSeconds) {
  const seconds = Math.max(0, Math.round(totalSeconds || 0));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function savePosition() {
  if (!state.article) return;
  localStorage.setItem(
    `${STORAGE_PREFIX}position`,
    JSON.stringify({
      key: `${state.article.lang}:${state.article.title}`,
      index: state.currentIndex,
    }),
  );
}

function restorePosition() {
  try {
    const saved = JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}position`));
    const key = `${state.article.lang}:${state.article.title}`;
    if (saved?.key === key && Number.isInteger(saved.index) && saved.index < state.chunks.length - 1) {
      state.currentIndex = Math.max(0, saved.index);
      setPlaybackState(state.currentIndex > 0 ? "paused" : "idle");
      updateActiveBlock(state.chunks[state.currentIndex]);
    }
  } catch {
    // Ignore a stale or manually edited preference.
  }
}

function voiceScore(voice, articleLanguage) {
  const name = `${voice.name} ${voice.voiceURI}`.toLowerCase();
  const voiceLang = voice.lang.toLowerCase();
  const target = safeLanguage(articleLanguage || "en");
  let score = voiceLang.startsWith(target) ? 100 : 0;
  if (/premium|enhanced|natural|neural/.test(name)) score += 45;
  if (/siri/.test(name)) score += 40;
  if (/ava|serena|daniel|samantha|karen|moira|rishi|veena|zoe|jamie/.test(name)) score += 25;
  if (voice.default) score += 12;
  if (voice.localService) score += 4;
  return score;
}

function loadVoices() {
  if (!supportsSpeech) {
    elements.voiceName.textContent = "Unavailable";
    return;
  }

  const voices = synth.getVoices();
  if (!voices.length) return;
  state.voices = voices.slice().sort((a, b) => {
    const scoreDifference = voiceScore(b, state.article?.lang) - voiceScore(a, state.article?.lang);
    return scoreDifference || a.name.localeCompare(b.name);
  });

  const savedVoice = localStorage.getItem(`${STORAGE_PREFIX}voice`);
  const currentlySelected = state.selectedVoice?.voiceURI;
  const targetLanguage = safeLanguage(state.article?.lang || "en");
  const matchesArticle = (voice) => voice?.lang.toLowerCase().startsWith(targetLanguage);
  const savedMatch = state.voices.find((voice) => voice.voiceURI === savedVoice);
  const currentMatch = state.voices.find((voice) => voice.voiceURI === currentlySelected);
  state.selectedVoice =
    (matchesArticle(savedMatch) ? savedMatch : null) ||
    (matchesArticle(currentMatch) ? currentMatch : null) ||
    state.voices.find(matchesArticle) ||
    savedMatch ||
    currentMatch ||
    state.voices[0];

  renderVoiceOptions();
}

function renderVoiceOptions() {
  const language = safeLanguage(state.article?.lang || "en");
  const matching = state.voices.filter((voice) => voice.lang.toLowerCase().startsWith(language));
  const other = state.voices.filter((voice) => !voice.lang.toLowerCase().startsWith(language));
  elements.voiceSelect.replaceChildren();

  const addGroup = (label, voices) => {
    if (!voices.length) return;
    const group = document.createElement("optgroup");
    group.label = label;
    for (const voice of voices) {
      const option = document.createElement("option");
      option.value = voice.voiceURI;
      option.textContent = `${voice.name} · ${voice.lang}`;
      option.selected = voice.voiceURI === state.selectedVoice?.voiceURI;
      group.append(option);
    }
    elements.voiceSelect.append(group);
  };

  addGroup(`Best match · ${language.toUpperCase()}`, matching);
  addGroup("Other installed voices", other);
  if (state.engine === "system") elements.voiceName.textContent = state.selectedVoice?.name || "System voice";
}

function setRate(nextRate, restartSpeech = true) {
  state.rate = Math.min(1.5, Math.max(0.7, Number(nextRate) || 1));
  localStorage.setItem(`${STORAGE_PREFIX}rate`, String(state.rate));
  const label = `${Number(state.rate.toFixed(2))}×`;
  elements.rateRange.value = String(state.rate);
  elements.rateRange.style.setProperty("--range-progress", `${((state.rate - 0.7) / 0.8) * 100}%`);
  elements.rateButton.textContent = label;
  elements.rateOutput.textContent = label;
  elements.rateDescription.textContent = state.rate < 0.9 ? "Unhurried" : state.rate > 1.2 ? "Brisk" : "Natural pace";

  if (state.article) {
    const count = totalWords();
    elements.durationLabel.textContent = `${Math.max(1, Math.round(count / (WORDS_PER_MINUTE * state.rate)))} min listen`;
    updateProgress();
  }

  if (state.engine === "neural") {
    elements.mediaAudio.playbackRate = state.rate;
  } else if (restartSpeech && state.playback === "playing") {
    startSpeechAt(state.currentIndex);
  } else if (restartSpeech && state.playback === "paused") {
    stopSpeech("paused");
  }
}

async function loadArticle(rawInput) {
  let parsed;
  try {
    parsed = parseArticleInput(rawInput);
  } catch (error) {
    showToast(error.message);
    return;
  }

  stopSpeech("idle");
  clearNeuralCache();
  elements.loadingTitle.textContent = "Editing for your ears…";
  elements.loadingView.hidden = false;
  elements.loadingProgress.hidden = true;
  elements.loadingDetail.textContent = "Removing citations and references";

  try {
    const article = await fetchArticle(parsed.title, parsed.lang);
    state.article = article;
    state.chunks = createSpeechChunks(article);
    state.neuralSegments = createNeuralSegments(state.chunks);
    state.engine = article.lang.toLowerCase().startsWith("en")
      ? localStorage.getItem(`${STORAGE_PREFIX}engine`) || "neural"
      : "system";
    state.currentIndex = 0;
    state.currentSegmentIndex = 0;
    state.boundaryWords = 0;
    state.activeBlockId = null;
    renderArticle(article);
    loadVoices();
    restorePosition();
    state.currentSegmentIndex = neuralSegmentIndexForChunk(state.currentIndex);
    updateEngineUI();
    updateMediaMetadata();
    updateProgress();

    if (state.engine === "neural" && localStorage.getItem(`${STORAGE_PREFIX}neural-ready`) === "true") {
      const warmNaturalVoice = () => ensureNeuralWorker({ background: true }).catch(() => {});
      if ("requestIdleCallback" in window) window.requestIdleCallback(warmNaturalVoice, { timeout: 2500 });
      else window.setTimeout(warmNaturalVoice, 500);
    }

    elements.startView.hidden = true;
    elements.reader.hidden = false;
    elements.player.hidden = false;
    elements.shareButton.hidden = false;
    elements.siteHeader.dataset.condensed = "true";
    document.body.classList.add("player-visible");
    elements.headerQuery.value = "";

    const params = new URLSearchParams({ lang: article.lang, title: article.title });
    history.replaceState({ article: article.title }, "", `${location.pathname}?${params}`);
    document.title = `${article.title} — Hearwiki`;
    window.scrollTo({ top: 0, behavior: "instant" });

    if (state.currentIndex > 0) {
      showToast(`Ready to resume ${article.title}`);
    }
  } catch (error) {
    showToast(error.message || "I couldn’t prepare that article.");
  } finally {
    hideLoading();
  }
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  window.clearTimeout(state.toastTimer);
  state.toastTimer = window.setTimeout(() => elements.toast.classList.remove("show"), 3200);
}

function setBookmarklet() {
  const appBase = location.hostname === "localhost" || location.hostname === "127.0.0.1"
    ? "https://hear.satyam.lol/"
    : new URL(".", location.href).href.split("?")[0];
  const code = `javascript:location.href='${appBase}?url='+encodeURIComponent(location.href)`;
  elements.bookmarkletLink.href = code;
  elements.copyBookmarklet.dataset.code = code;
}

function updateMediaMetadata() {
  if (!("mediaSession" in navigator) || !("MediaMetadata" in window) || !state.article) return;
  const artwork = state.article.image
    ? [{ src: state.article.image }]
    : [];
  navigator.mediaSession.metadata = new MediaMetadata({
    title: state.article.title,
    artist: "Hearwiki",
    album: "Wikipedia · clean listening edition",
    artwork,
  });
}

function initMediaSession() {
  if (!("mediaSession" in navigator)) return;
  try {
    navigator.mediaSession.setActionHandler("play", togglePlayback);
    navigator.mediaSession.setActionHandler("pause", togglePlayback);
    navigator.mediaSession.setActionHandler("seekbackward", (details) => skipSeconds(-(details.seekOffset || 15)));
    navigator.mediaSession.setActionHandler("seekforward", (details) => skipSeconds(details.seekOffset || 15));
    navigator.mediaSession.setActionHandler("seekto", (details) => {
      if (!Number.isFinite(details.seekTime)) return;
      const duration = (totalWords() / WORDS_PER_MINUTE) * 60;
      const targetWord = Math.min(totalWords() - 1, Math.max(0, (details.seekTime / duration) * totalWords()));
      seekToIndex(chunkIndexForWord(targetWord), true, targetWord);
    });
    navigator.mediaSession.setActionHandler("stop", () => {
      stopSpeech("paused");
      state.currentIndex = 0;
      state.currentSegmentIndex = 0;
      updateProgress();
    });
  } catch {
    // Some Safari versions expose Media Session without every action.
  }
}

function selectEngine(nextEngine) {
  if (nextEngine === "neural" && !naturalVoiceAvailable()) {
    showToast("Natural voice currently supports English articles.");
    return;
  }
  if (nextEngine === state.engine) return;

  const wasPlaying = state.playback === "playing";
  const targetWord = currentWordPosition();
  const targetIndex = chunkIndexForWord(targetWord);
  stopSpeech("paused");
  state.engine = nextEngine;
  localStorage.setItem(`${STORAGE_PREFIX}engine`, nextEngine);
  state.currentIndex = targetIndex;
  state.currentSegmentIndex = neuralSegmentIndexForChunk(targetIndex);
  updateEngineUI();
  updateActiveBlock(state.chunks[targetIndex]);
  updateProgress();

  if (wasPlaying) {
    if (nextEngine === "neural") requestNeuralAction(() => playNeuralFromChunk(targetIndex, targetWord));
    else startSpeechAt(targetIndex);
  }
}

function previewSystemVoice() {
  if (!supportsSpeech) return;
  stopNeural(true);
  const wasPlaying = state.playback === "playing";
  if (wasPlaying) {
    state.runId += 1;
    synth.cancel();
    setPlaybackState("paused");
  } else {
    synth.cancel();
  }
  if (synth.paused) synth.resume();
  const utterance = new SpeechSynthesisUtterance("A good article should sound as considered as it reads.");
  applyVoiceToUtterance(utterance);
  synth.speak(utterance);
}

async function previewNaturalVoice() {
  requestNeuralAction(async () => {
    stopSpeech("paused");
    const runId = ++state.neuralRunId;
    setPlaybackState("buffering");
    elements.nowSection.textContent = "Preparing voice preview";
    try {
      const entry = await generateNeuralText(
        "A good article should sound as considered as it reads.",
        `preview:${state.neuralVoice}`,
      );
      if (runId !== state.neuralRunId) return;
      elements.mediaAudio.dataset.mode = "preview";
      releaseUnlockAudio();
      elements.mediaAudio.loop = false;
      elements.mediaAudio.muted = false;
      elements.mediaAudio.volume = 1;
      elements.mediaAudio.playbackRate = state.rate;
      elements.mediaAudio.src = entry.url;
      await elements.mediaAudio.play();
      setPlaybackState("playing");
    } catch {
      setPlaybackState("paused");
      showToast("The natural voice preview could not start.");
    }
  });
}

elements.openForm.addEventListener("submit", (event) => {
  event.preventDefault();
  loadArticle(elements.articleQuery.value);
});

elements.headerSearch.addEventListener("submit", (event) => {
  event.preventDefault();
  loadArticle(elements.headerQuery.value);
});

$$('[data-article]').forEach((button) => {
  button.addEventListener("click", () => loadArticle(button.dataset.article));
});

elements.playButton.addEventListener("click", togglePlayback);
elements.heroPlay.addEventListener("click", togglePlayback);
elements.restartButton.addEventListener("click", () => {
  if (state.engine === "neural") requestNeuralAction(() => playNeuralFromChunk(0));
  else startSpeechAt(0);
});
elements.backButton.addEventListener("click", () => skipSeconds(-15));
elements.forwardButton.addEventListener("click", () => skipSeconds(15));

elements.seekRange.addEventListener("input", () => {
  state.isSeeking = true;
  const targetWord = (Number(elements.seekRange.value) / 1000) * totalWords();
  updateProgress(targetWord);
  updateActiveBlock(state.chunks[chunkIndexForWord(targetWord)]);
});

elements.seekRange.addEventListener("change", () => {
  const targetWord = (Number(elements.seekRange.value) / 1000) * totalWords();
  state.isSeeking = false;
  seekToIndex(chunkIndexForWord(targetWord), true, targetWord);
});

elements.voiceButton.addEventListener("click", () => elements.voiceSheet.showModal());
elements.naturalEngine.addEventListener("click", () => selectEngine("neural"));
elements.systemEngine.addEventListener("click", () => selectEngine("system"));
elements.naturalVoiceSelect.addEventListener("change", () => {
  const targetWord = currentWordPosition();
  state.neuralVoice = elements.naturalVoiceSelect.value;
  localStorage.setItem(`${STORAGE_PREFIX}neural-voice`, state.neuralVoice);
  clearNeuralCache();
  updateEngineUI();
  if (state.playback === "playing" && state.engine === "neural") {
    playNeuralFromChunk(chunkIndexForWord(targetWord), targetWord);
  }
});
elements.voiceSelect.addEventListener("change", () => {
  state.selectedVoice = state.voices.find((voice) => voice.voiceURI === elements.voiceSelect.value) || state.selectedVoice;
  localStorage.setItem(`${STORAGE_PREFIX}voice`, state.selectedVoice?.voiceURI || "");
  if (state.engine === "system") {
    elements.voiceName.textContent = state.selectedVoice?.name || "System voice";
    if (state.playback === "playing") startSpeechAt(state.currentIndex);
    else if (state.playback === "paused") stopSpeech("paused");
  }
});

elements.previewVoice.addEventListener("click", () => {
  if (state.engine === "neural") previewNaturalVoice();
  else previewSystemVoice();
});

elements.rateRange.addEventListener("input", () => setRate(elements.rateRange.value, false));
elements.rateRange.addEventListener("change", () => {
  if (state.engine === "system" && state.playback === "playing") startSpeechAt(state.currentIndex);
  else if (state.engine === "system" && state.playback === "paused") stopSpeech("paused");
});
elements.rateButton.addEventListener("click", () => {
  if (window.matchMedia("(max-width: 780px)").matches) {
    elements.voiceSheet.showModal();
    return;
  }
  const rates = [0.85, 1, 1.15, 1.3];
  const next = rates.find((rate) => rate > state.rate + 0.01) ?? rates[0];
  setRate(next);
});

elements.followToggle.addEventListener("change", () => {
  state.follow = elements.followToggle.checked;
  localStorage.setItem(`${STORAGE_PREFIX}follow`, String(state.follow));
});

elements.downloadNeural.addEventListener("click", () => {
  const action = state.pendingNeuralAction;
  state.pendingNeuralAction = null;
  unlockMediaAudio();
  elements.neuralSheet.close();
  action?.();
});

elements.mediaAudio.addEventListener("timeupdate", () => {
  if (state.engine !== "neural" || elements.mediaAudio.dataset.mode !== "article") return;
  const position = currentWordPosition();
  const chunkIndex = chunkIndexForWord(position);
  if (chunkIndex !== state.currentIndex) {
    state.currentIndex = chunkIndex;
    updateActiveBlock(state.chunks[chunkIndex]);
  }
  updateProgress(position);
  const now = Date.now();
  if (!state.lastAudioSave || now - state.lastAudioSave > 5000) {
    state.lastAudioSave = now;
    savePosition();
  }
});

elements.mediaAudio.addEventListener("ended", () => {
  if (elements.mediaAudio.dataset.mode === "preview") {
    elements.mediaAudio.dataset.mode = "";
    elements.mediaAudio.removeAttribute("src");
    state.currentAudioUrl = null;
    setPlaybackState("paused");
    updateActiveBlock(state.chunks[state.currentIndex]);
    return;
  }
  if (state.engine !== "neural" || state.playback !== "playing") return;
  const nextSegment = state.currentSegmentIndex + 1;
  if (nextSegment >= state.neuralSegments.length) finishPlayback();
  else playNeuralFromChunk(state.neuralSegments[nextSegment].startChunk);
});

elements.mediaAudio.addEventListener("pause", () => {
  if (
    state.engine === "neural" &&
    elements.mediaAudio.dataset.mode === "article" &&
    state.playback === "playing" &&
    !state.mediaSwitching &&
    !elements.mediaAudio.ended
  ) {
    setPlaybackState("paused");
    savePosition();
  }
});

elements.mediaAudio.addEventListener("play", () => {
  if (state.engine === "neural" && elements.mediaAudio.dataset.mode === "article" && state.playback !== "buffering") {
    setPlaybackState("playing");
  }
});

elements.mediaAudio.addEventListener("error", () => {
  if (state.mediaSwitching || !elements.mediaAudio.getAttribute("src")) return;
  setPlaybackState("paused");
  showToast("Audio playback stopped. Press play to retry this passage.");
});

elements.setupButton.addEventListener("click", () => elements.setupSheet.showModal());
$$('[data-close-dialog]').forEach((button) => {
  button.addEventListener("click", () => button.closest("dialog").close());
});

for (const dialog of $$("dialog")) {
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
}

elements.neuralSheet.addEventListener("close", () => {
  state.pendingNeuralAction = null;
});

elements.copyBookmarklet.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(elements.copyBookmarklet.dataset.code);
    showToast("Safari shortcut copied");
  } catch {
    showToast("Drag the orange button to Safari’s Favorites Bar.");
  }
});

elements.shareButton.addEventListener("click", async () => {
  const shareData = { title: `${state.article.title} — Hearwiki`, url: location.href };
  try {
    if (navigator.share) await navigator.share(shareData);
    else {
      await navigator.clipboard.writeText(location.href);
      showToast("Listening link copied");
    }
  } catch (error) {
    if (error.name !== "AbortError") showToast("Couldn’t share this link.");
  }
});

document.addEventListener("keydown", (event) => {
  const isTyping = /INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || event.target.isContentEditable;
  if (isTyping || !state.article || elements.voiceSheet.open || elements.setupSheet.open || elements.neuralSheet.open) return;
  if (event.code === "Space") {
    event.preventDefault();
    togglePlayback();
  } else if (event.code === "ArrowLeft") {
    event.preventDefault();
    skipSeconds(-15);
  } else if (event.code === "ArrowRight") {
    event.preventDefault();
    skipSeconds(15);
  }
});

window.addEventListener("beforeunload", savePosition);
if (supportsSpeech) {
  synth.addEventListener?.("voiceschanged", loadVoices);
  synth.onvoiceschanged = loadVoices;
}

setRate(state.rate, false);
elements.followToggle.checked = state.follow;
setBookmarklet();
loadVoices();
initMediaSession();

const initialParams = new URLSearchParams(location.search);
const initialInput = initialParams.get("url") || (
  initialParams.get("title")
    ? `${safeLanguage(initialParams.get("lang") || "en")}:${initialParams.get("title")}`
    : ""
);
if (initialInput) loadArticle(initialInput);
