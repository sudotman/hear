import {
  cacheWork,
  fetchGutenbergCatalog,
  fetchStandardCatalog,
  fetchStandardItemFromSlug,
  getCachedCover,
  getCachedWork,
  loadGutenbergWork,
  loadStandardWork,
  removeCachedWork,
} from "./library.js";
import {
  KITTEN_DTYPES,
  KITTEN_DEFAULT_MODEL,
  KITTEN_MODELS,
  KITTEN_VOICES,
  KOKORO_DTYPES,
  KOKORO_MODEL,
  KOKORO_MODEL_FILES,
  SPEECH_ENGINES,
  SPEECH_MODEL_CHOICES,
  defaultKokoroDtype,
  formatMegabytes,
  getModelDownloadDetails,
} from "./app-config.js";
import { parseEpubInWorker } from "./epub-client.js";
import { fetchWithTimeout, isAbortError } from "./fetch-utils.js";
import { libraryRouteState, routeForWork, routeStateForWork } from "./route-utils.js";
import { registerHearServiceWorker } from "./pwa.js";
import { KokoroWebGPU, KokoroWasm, KittenWasm } from "./tts-backends.js";
import { clearTtsCache, createAudioCacheKey, deleteTtsDatabase, getCachedAudio, getTtsCacheStats, putCachedAudio, requestPersistentStorage } from "./tts-cache.js";
import { clearAllModelCaches, deleteCacheEntry, getModelCacheEntries } from "./model-cache.js";
import { coverProxyPath } from "./cover-policy.js";
import { countWords, segmentNarrationSentences } from "./narration-text.js";
import { NeuralPlayer } from "./neural-player.js";
import { createNeuralSegments } from "./neural-segments.js";
import {
  doiFromArticleUrl,
  looksLikeArticleUrl,
  normalizeDoi,
  normalizePublicArticleUrl,
} from "./article-policy.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const elements = {
  siteHeader: $(".site-header"),
  startView: $("#start-view"),
  reader: $("#reader"),
  brandLink: $("#brand-link"),
  libraryButton: $("#library-button"),
  importButton: $("#import-button"),
  documentInput: $("#document-input"),
  catalogSearch: $("#catalog-search"),
  catalogQuery: $("#catalog-query"),
  catalogSearchLabel: $("#catalog-search-label"),
  catalogSubmit: $("#catalog-submit"),
  catalogSubmitLabel: $("#catalog-submit-label"),
  discoveryHint: $("#discovery-hint"),
  searchModes: $$("[data-search-mode]"),
  catalogControls: $("#catalog-controls"),
  sourceSwitcher: $("#source-switcher"),
  savedCount: $("#saved-count"),
  catalogTopics: $("#catalog-topics"),
  catalogTitle: $("#catalog-title"),
  catalogStatus: $("#catalog-status"),
  catalogProgress: $("#catalog-progress"),
  catalogProgressBar: $("#catalog-progress-bar"),
  catalogProgressLabel: $("#catalog-progress-label"),
  bookGrid: $("#book-grid"),
  loadMore: $("#load-more"),
  continueListening: $("#continue-listening"),
  continueList: $("#continue-list"),
  headerSearch: $("#header-search"),
  headerQuery: $("#header-query"),
  articleTitle: $("#article-title"),
  articleDescription: $("#article-description"),
  articleKicker: $("#article-kicker"),
  durationLabel: $("#duration-label"),
  wordCountLabel: $("#word-count-label"),
  sourceLink: $("#source-link"),
  originalSourceLink: $("#original-source-link"),
  articleCopy: $("#article-copy"),
  outlineNav: $("#outline-nav"),
  outlineLabel: $("#outline-label"),
  endLabel: $("#end-label"),
  readingNoteText: $("#reading-note-text"),
  imageWrap: $("#article-image-wrap"),
  articleImage: $("#article-image"),
  imageCaption: $("#image-caption"),
  heroPlay: $("#hero-play"),
  restartButton: $("#restart-button"),
  jumpToCurrent: $("#jump-to-current"),
  player: $("#player"),
  nowPlayingButton: $("#now-playing-button"),
  mediaAudio: $("#media-audio"),
  playButton: $("#play-button"),
  backButton: $("#back-button"),
  forwardButton: $("#forward-button"),
  seekRange: $("#seek-range"),
  elapsedTime: $("#elapsed-time"),
  totalTime: $("#total-time"),
  nowSection: $("#now-section"),
  playerAnnouncement: $("#player-announcement"),
  nowTitle: $("#now-title"),
  miniCover: $("#mini-cover"),
  miniCoverImage: $("#mini-cover-image"),
  rateButton: $("#rate-button"),
  voiceButton: $("#voice-button"),
  voiceName: $("#voice-name"),
  voiceType: $("#voice-type"),
  voiceSheet: $("#voice-sheet"),
  advancedSheet: $("#advanced-sheet"),
  advancedSettingsButton: $("#advanced-settings-button"),
  chaptersButton: $("#chapters-button"),
  chaptersSheet: $("#chapters-sheet"),
  chaptersSheetTitle: $("#chapters-sheet-title"),
  chapterList: $("#chapter-list"),
  voiceSelect: $("#voice-select"),
  naturalVoiceSelect: $("#natural-voice-select"),
  voiceTraits: $("#voice-traits"),
  naturalVoiceRow: $("#natural-voice-row"),
  systemVoiceRow: $("#system-voice-row"),
  modelOptions: $("#model-options"),
  engineOptions: $("#engine-options"),
  modelVariants: $("#model-variants"),
  modelVariantSummary: $("#model-variant-summary"),
  safariVoiceTip: $("#safari-voice-tip"),
  engineDescription: $("#engine-description"),
  kittenVoiceSelect: $("#kitten-voice-select"),
  kittenVoiceRow: $("#kitten-voice-row"),
  kittenVoiceTraits: $("#kitten-voice-traits"),
  activeModelLabel: $("#active-model-label"),
  clearAudioCache: $("#clear-audio-cache"),
  clearAllData: $("#clear-all-data"),
  modelCacheList: $("#model-cache-list"),
  modelCacheTotal: $("#model-cache-total"),
  refreshModelCache: $("#refresh-model-cache"),
  clearModelCache: $("#clear-model-cache"),
  storageUsageLabel: $("#storage-usage-label"),
  storageNote: $("#storage-note"),
  voiceNote: $("#voice-note"),
  rateRange: $("#rate-range"),
  rateOutput: $("#rate-output"),
  rateDescription: $("#rate-description"),
  followToggle: $("#follow-toggle"),
  previewVoice: $("#preview-voice"),
  neuralSheet: $("#neural-sheet"),
  neuralDownloadSize: $("#neural-download-size"),
  neuralDownloadUnit: $("#neural-download-unit"),
  neuralDownloadModel: $("#neural-download-model"),
  neuralDownloadStorage: $("#neural-download-storage"),
  downloadNeural: $("#download-neural"),
  setupButton: $("#setup-button"),
  setupSheet: $("#setup-sheet"),
  recoverySheet: $("#recovery-sheet"),
  recoveryDescription: $("#recovery-description"),
  recoveryOptions: $("#recovery-options"),
  bookmarkletLink: $("#bookmarklet-link"),
  copyBookmarklet: $("#copy-bookmarklet"),
  shareButton: $("#share-button"),
  loadingView: $("#loading-view"),
  loadingTitle: $("#loading-title"),
  loadingDetail: $("#loading-detail"),
  playerProgress: $("#player-progress"),
  engineStatus: $("#engine-status"),
  loadingCancel: $("#loading-cancel"),
  toast: $("#toast"),
};

const synth = window.speechSynthesis;
const supportsSpeech = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
const WORDS_PER_MINUTE = 185;
const STORAGE_PREFIX = "hearwiki:";
const LIBRARY_KEY = `${STORAGE_PREFIX}library-v2`;
const PROGRESS_KEY = `${STORAGE_PREFIX}progress-v2`;
const CATALOG_TOPICS = {
  fiction: { label: "Fiction", standard: "fiction", gutenberg: "fiction" },
  adventure: { label: "Adventure", standard: "adventure", gutenberg: "adventure" },
  mystery: { label: "Mystery", standard: "mystery", gutenberg: "mystery" },
  "short-stories": { label: "Short stories", standard: "shorts", gutenberg: "short stories" },
  philosophy: { label: "Ideas", standard: "philosophy", gutenberg: "philosophy" },
  poetry: { label: "Poetry", standard: "poetry", gutenberg: "poetry" },
};
const TTS_APP_VERSION = "2026.08.06";
const NATURAL_VOICES = {
  af_heart: { name: "Heart", note: "Warm and balanced — the strongest all-round choice." },
  af_bella: { name: "Bella", note: "Lively and expressive." },
  bf_emma: { name: "Emma", note: "Calm and composed; good for long listening." },
  bm_fable: { name: "Fable", note: "Characterful; suits storytelling." },
  am_michael: { name: "Michael", note: "Steady, lower narration." },
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

const rawBackendPreference = localStorage.getItem(`${STORAGE_PREFIX}tts-backend`);
// Migrate legacy "auto" (unreliable WebGPU benchmark) to explicit choice.
// Fresh installs default to "system" (instant, no download) per #4.
const initialBackendPreference = rawBackendPreference === "auto" ? "system" : rawBackendPreference || "system";
const rawKokoroDevice = localStorage.getItem(`${STORAGE_PREFIX}kokoro-device`);
const initialKokoroDevice = rawKokoroDevice === "webgpu" ? "webgpu" : "wasm";
const rawKokoroDtype = localStorage.getItem(`${STORAGE_PREFIX}kokoro-dtype`);
const KOKORO_DTYPE_DEFAULT = defaultKokoroDtype();
// Migration: retired precisions move to this device's default.
if (rawKokoroDtype && !KOKORO_DTYPES.includes(rawKokoroDtype)) {
  localStorage.setItem(`${STORAGE_PREFIX}kokoro-dtype`, KOKORO_DTYPE_DEFAULT);
}
const _migratedKokoroDtype = localStorage.getItem(`${STORAGE_PREFIX}kokoro-dtype`);
const initialKokoroDtype = KOKORO_DTYPES.includes(_migratedKokoroDtype) ? _migratedKokoroDtype : KOKORO_DTYPE_DEFAULT;
const rawKittenModel = localStorage.getItem(`${STORAGE_PREFIX}kitten-model`);
const initialKittenModel = KITTEN_MODELS.includes(rawKittenModel) ? rawKittenModel : KITTEN_DEFAULT_MODEL;
// The old Nano 0.1 Transformers.js archive is not compatible with Hear's
// Kitten Nano 0.8 runtime. Move existing installs to the supported layout.
if (rawKittenModel && rawKittenModel !== initialKittenModel) {
  localStorage.setItem(`${STORAGE_PREFIX}kitten-model`, initialKittenModel);
}
const rawKittenDtype = localStorage.getItem(`${STORAGE_PREFIX}kitten-dtype`);
// Migration: older installs may have stored fp16/q8/q4 which Kitten Nano 0.8 does not ship
if (rawKittenDtype && !KITTEN_DTYPES.includes(rawKittenDtype)) {
  localStorage.setItem(`${STORAGE_PREFIX}kitten-dtype`, "fp32");
}
const initialKittenDtype = KITTEN_DTYPES.includes(rawKittenDtype) ? rawKittenDtype : "fp32";
const rawKittenVoice = localStorage.getItem(`${STORAGE_PREFIX}kitten-voice`);
const initialKittenVoice = KITTEN_VOICES.includes(rawKittenVoice) ? rawKittenVoice : "Bella";
const IS_ANDROID = /Android/i.test(navigator.userAgent);
const IS_SAFARI = /^((?!chrome|chromium|android|crios|fxios|edg).)*safari/i.test(navigator.userAgent);
function supportsWebGPU() {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}
const state = {
  article: null,
  chunks: [],
  neuralSegments: [],
  voices: [],
  selectedVoice: null,
  backendPreference: initialBackendPreference,
  kokoroDevice: initialKokoroDevice,
  kokoroDtype: initialKokoroDtype,
  kittenModel: initialKittenModel,
  kittenDtype: initialKittenDtype,
  kittenVoice: initialKittenVoice,
  engine: initialBackendPreference === "system" ? "system" : "neural",
  activeBackendId: null,
  ttsBackend: null,
  neuralWorkerPromise: null,
  neuralVoice: localStorage.getItem(`${STORAGE_PREFIX}neural-voice`) || "af_heart",
  neuralReady: false,
  savedModels: new Set(),
  pendingNeuralAction: null,
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
  catalogSource: "all",
  catalogQuery: "",
  catalogTopic: "",
  catalogPage: 1,
  catalogItems: [],
  discoveryMode: "books",
  catalogRequestId: 0,
  catalogAbortController: null,
  libraryCoverCache: new Map(),
  contentAbortController: null,
  contentRequestId: 0,
  lastAnnouncement: "",
  lastAnnouncementAt: 0,
  chapters: [],
  jumpReturnTimer: null,
  jumpVisibilityFrame: null,
};

const neuralPlayer = createNeuralPlayer();

function readStoredJson(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function libraryEntries() {
  const entries = readStoredJson(LIBRARY_KEY, []);
  return Array.isArray(entries) ? entries : [];
}

function progressEntries() {
  const entries = readStoredJson(PROGRESS_KEY, {});
  return entries && typeof entries === "object" ? entries : {};
}

function workLibraryEntry(work) {
  return {
    key: work.key,
    kind: work.kind,
    source: work.source,
    sourceLabel: work.sourceLabel,
    sourceUrl: work.sourceUrl,
    originalSourceUrl: work.originalSourceUrl || "",
    provenanceLabel: work.provenanceLabel || "",
    title: work.title,
    author: work.author || work.sourceLabel || "Unknown author",
    description: work.description,
    image: work.image?.startsWith("data:") ? (work.catalogItem?.image || "") : work.image,
    lang: work.lang,
    catalogItem: work.catalogItem || null,
    savedAt: Date.now(),
  };
}

function rememberWork(work) {
  const entry = workLibraryEntry(work);
  const entries = libraryEntries().filter((item) => item.key !== work.key);
  entries.unshift(entry);
  localStorage.setItem(LIBRARY_KEY, JSON.stringify(entries.slice(0, 80)));
  if (work.image?.startsWith("data:")) state.libraryCoverCache.set(work.key, work.image);
  else state.libraryCoverCache.delete(work.key);
  elements.savedCount.textContent = String(Math.min(80, entries.length));
  updateContinueListening();
}

function progressFor(key) {
  return progressEntries()[key] || null;
}

function coverColor(item) {
  const colors = ["#4c5663", "#6f4136", "#344e49", "#6a5940", "#4d3d55", "#5b4b43", "#38505a"];
  const seed = [...`${item.title}${item.author}`].reduce((sum, character) => sum + character.codePointAt(0), 0);
  return colors[seed % colors.length];
}

function displayImageSource(item) {
  const image = item?.image || item?.catalogItem?.image;
  if (!image) return "";
  try {
    const url = new URL(image, location.href);
    if (url.protocol === "data:" || url.protocol === "blob:" || url.origin === location.origin) return url.href;
    // Wikimedia serves images with CORS enabled, while Wikimedia rejects the
    // Cloudflare image proxy. Loading it directly also remains valid under COEP.
    // The REST summary API now returns thumbnails on thumb.wikimedia.org.
    if (url.hostname === "upload.wikimedia.org" || url.hostname === "thumb.wikimedia.org") return url.href;
    const proxyPath = coverProxyPath(url.href);
    if (proxyPath) return new URL(proxyPath, location.origin).href;
    return crossOriginIsolated ? "" : url.href;
  } catch {
    return "";
  }
}

function canDisplayImage(item) {
  return Boolean(displayImageSource(item));
}

function cachedCoverFor(item) {
  if (!item?.key) return Promise.resolve("");
  const cached = state.libraryCoverCache.get(item.key);
  if (typeof cached === "string") return Promise.resolve(cached);
  if (cached) return cached;
  const request = getCachedCover(item.key)
    .catch(() => "")
    .then((image) => {
      state.libraryCoverCache.set(item.key, image);
      return image;
    });
  state.libraryCoverCache.set(item.key, request);
  return request;
}

function appendBookCoverImage(cover, item, source = displayImageSource(item)) {
  if (!source || cover.querySelector("img")) return;
  const image = document.createElement("img");
  image.crossOrigin = "anonymous";
  image.src = source;
  image.alt = "";
  image.loading = "lazy";
  image.addEventListener("load", () => cover.classList.add("has-image"), { once: true });
  image.addEventListener("error", () => image.remove(), { once: true });
  cover.prepend(image);
}

function renderBookCard(item, { removable = false } = {}) {
  const wrapper = document.createElement("article");
  wrapper.className = "book-item";
  wrapper.classList.toggle("article-result", item.kind === "article");
  const button = document.createElement("button");
  button.className = "book-card";
  button.type = "button";
  button.setAttribute(
    "aria-label",
    item.kind === "article" ? `Open ${item.title} from ${item.sourceLabel || "its publisher"}` : `Open ${item.title} by ${item.author}`,
  );

  const cover = document.createElement("span");
  cover.className = "book-cover";
  cover.style.setProperty("--cover-hue", coverColor(item));
  if (canDisplayImage(item)) appendBookCoverImage(cover, item);
  else if (item.key) {
    cachedCoverFor(item).then((image) => {
      if (image) appendBookCoverImage(cover, { ...item, image });
    });
  }
  const source = document.createElement("span");
  source.className = "book-source";
  source.textContent = item.sourceLabel || "My library";
  const coverTitle = document.createElement("span");
  coverTitle.className = "book-cover-title";
  coverTitle.textContent = item.title;
  const mark = document.createElement("span");
  mark.className = "book-cover-mark";
  mark.textContent = item.title[0]?.toUpperCase() || "H";
  cover.append(source, coverTitle, mark);

  const title = document.createElement("h3");
  title.textContent = item.title;
  const author = document.createElement("small");
  author.textContent = item.kind === "article"
    ? item.description || `${item.sourceLabel || "Web"} article`
    : item.author || "Unknown author";
  button.append(cover, title, author);

  const progress = progressFor(item.key || item.id);
  if (progress?.totalWords) {
    const track = document.createElement("span");
    track.className = "book-progress";
    const fill = document.createElement("i");
    fill.style.setProperty("--book-progress", `${Math.min(100, (progress.word / progress.totalWords) * 100)}%`);
    track.append(fill);
    button.append(track);
  }
  button.addEventListener("click", () => openLibraryItem(item));
  wrapper.append(button);

  if (removable) {
    const remove = document.createElement("button");
    remove.className = "remove-book";
    remove.type = "button";
    remove.setAttribute("aria-label", `Remove ${item.title} from My library`);
    remove.textContent = "×";
    remove.addEventListener("click", async () => {
      const entries = libraryEntries().filter((entry) => entry.key !== item.key);
      localStorage.setItem(LIBRARY_KEY, JSON.stringify(entries));
      state.libraryCoverCache.delete(item.key);
      const progress = progressEntries();
      delete progress[item.key];
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
      await removeCachedWork(item.key).catch(() => {});
      renderSavedLibrary();
      updateContinueListening();
      showToast(`${item.title} removed from My library`);
    });
    wrapper.append(remove);
  }
  return wrapper;
}

function renderCatalogItems(items, { append = false, removable = false } = {}) {
  if (!append) elements.bookGrid.replaceChildren();
  const fragment = document.createDocumentFragment();
  items.forEach((item) => fragment.append(renderBookCard(item, { removable })));
  elements.bookGrid.append(fragment);
}

function renderSavedLibrary() {
  const entries = libraryEntries();
  state.catalogItems = entries;
  elements.savedCount.textContent = String(entries.length);
  elements.catalogProgress.hidden = true;
  elements.catalogProgress.closest(".catalog-section")?.setAttribute("aria-busy", "false");
  elements.catalogTitle.textContent = "My listening library";
  elements.catalogStatus.textContent = entries.length
    ? `${entries.length} ${entries.length === 1 ? "work" : "works"} · progress saved locally`
    : "Your opened books, EPUBs, and articles will appear here.";
  renderCatalogItems(entries, { removable: true });
  elements.loadMore.hidden = true;
}

function interleave(left, right, limit = 30) {
  const result = [];
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length && result.length < limit; index += 1) {
    if (left[index]) result.push(left[index]);
    if (right[index] && result.length < limit) result.push(right[index]);
  }
  return result;
}

function normalizeCatalogText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function catalogMatchScore(item, query) {
  const needle = normalizeCatalogText(query);
  if (!needle) return 0;
  const title = normalizeCatalogText(item.title);
  const author = normalizeCatalogText(item.author);
  const titleAndAuthor = `${title} ${author}`.trim();
  const categories = normalizeCatalogText(item.categories?.join(" "));
  const description = normalizeCatalogText(item.description);
  const tokens = needle.split(" ").filter(Boolean);
  let score = item.source === "standard" ? 12 : 0;
  if (titleAndAuthor === needle) score += 1800;
  else if (titleAndAuthor.startsWith(needle)) score += 1100;
  if (title === needle) score += 1200;
  else if (title.startsWith(needle)) score += 850;
  else if (title.includes(needle)) score += 650;
  if (author === needle) score += 900;
  else if (author.includes(needle)) score += 600;
  if (categories.includes(needle)) score += 420;
  tokens.forEach((token) => {
    if (title.split(" ").includes(token)) score += 90;
    else if (title.includes(token)) score += 45;
    if (author.split(" ").includes(token)) score += 65;
    else if (author.includes(token)) score += 30;
    if (categories.includes(token)) score += 22;
    if (description.includes(token)) score += 6;
  });
  return score;
}

function catalogIdentity(item) {
  return `${normalizeCatalogText(item.title)}|${normalizeCatalogText(item.author)}`;
}

function prepareCatalogItems(standard, gutenberg, query, limit = 30) {
  const candidates = query
    ? [...standard, ...gutenberg]
        .map((item, index) => ({ item, index, score: catalogMatchScore(item, query) }))
        .sort((left, right) => right.score - left.score || left.index - right.index)
        .map(({ item }) => item)
    : interleave(standard, gutenberg, limit * 2);
  const editions = new Map();
  candidates.forEach((item) => {
    const identity = catalogIdentity(item);
    const current = editions.get(identity);
    if (!current || (item.source === "standard" && current.source !== "standard")) editions.set(identity, item);
  });
  return [...editions.values()].slice(0, limit);
}

function setCatalogProgress(completed, total, label) {
  const safeTotal = Math.max(1, total);
  elements.catalogProgress.hidden = false;
  elements.catalogProgressBar.value = Math.round((completed / safeTotal) * 100);
  elements.catalogProgressLabel.textContent = label;
  elements.catalogProgress.closest(".catalog-section")?.setAttribute("aria-busy", String(completed < safeTotal));
}

async function loadCatalog({ append = false } = {}) {
  if (state.catalogSource === "saved") {
    state.catalogAbortController?.abort();
    renderSavedLibrary();
    return;
  }
  state.catalogAbortController?.abort();
  const controller = new AbortController();
  state.catalogAbortController = controller;
  const requestId = ++state.catalogRequestId;
  if (!append) {
    state.catalogPage = 1;
    elements.bookGrid.replaceChildren();
  }
  const query = state.catalogQuery.trim();
  const topic = CATALOG_TOPICS[state.catalogTopic] || null;
  const searching = Boolean(query);
  const standardUnits = state.catalogSource === "gutenberg" ? 0 : 1;
  const gutenbergUnits = state.catalogSource === "standard" ? 0 : (searching && !topic ? 2 : 1);
  const totalUnits = standardUnits + gutenbergUnits;
  let completedUnits = 0;
  let reportedGutenbergUnits = 0;
  const results = { standard: [], gutenberg: [] };
  const failures = [];
  const progressAction = searching ? `Searching for “${query}”` : topic ? `Browsing ${topic.label}` : "Browsing popular books";
  const updateProgress = (units, label) => {
    if (requestId !== state.catalogRequestId) return;
    completedUnits = Math.min(totalUnits, completedUnits + units);
    setCatalogProgress(completedUnits, totalUnits, label);
  };
  const previewResults = () => {
    if (append || requestId !== state.catalogRequestId) return;
    const preview = prepareCatalogItems(results.standard, results.gutenberg, query);
    if (preview.length) renderCatalogItems(preview);
  };
  elements.catalogStatus.textContent = `${progressAction}…`;
  setCatalogProgress(0, totalUnits, "Starting catalog search");
  elements.loadMore.hidden = true;

  try {
    const tasks = [];
    if (standardUnits) {
      tasks.push(fetchStandardCatalog({
        query,
        topic: topic?.standard || "",
        page: state.catalogPage,
        limit: 18,
        signal: controller.signal,
      }).then((items) => {
        results.standard = items;
        updateProgress(1, "Standard Ebooks checked");
        previewResults();
      }).catch((error) => {
        updateProgress(1, "Standard Ebooks could not be reached");
        failures.push({ source: "Standard Ebooks", error });
      }));
    }
    if (gutenbergUnits) {
      tasks.push(fetchGutenbergCatalog({
        query,
        topic: topic?.gutenberg || "",
        page: state.catalogPage,
        signal: controller.signal,
        onProgress: ({ completed }) => {
          const delta = completed - reportedGutenbergUnits;
          reportedGutenbergUnits = completed;
          updateProgress(delta, completed < gutenbergUnits
            ? "Project Gutenberg titles and authors checked"
            : "Project Gutenberg subjects checked");
        },
      }).then((items) => {
        results.gutenberg = items;
        previewResults();
      }).catch((error) => {
        failures.push({ source: "Project Gutenberg", error });
      }));
    }
    await Promise.all(tasks);
    if (requestId !== state.catalogRequestId) return;
    if (failures.length === (standardUnits ? 1 : 0) + (gutenbergUnits ? 1 : 0)) throw failures[0].error;
    let items = prepareCatalogItems(results.standard, results.gutenberg, query);
    const existingIds = new Set(append ? state.catalogItems.map((item) => item.id || item.key) : []);
    items = items.filter((item) => !existingIds.has(item.id || item.key));
    state.catalogItems = append ? [...state.catalogItems, ...items] : items;
    renderCatalogItems(items, { append });
    elements.catalogTitle.textContent = query ? `Books for “${query}”` : topic ? topic.label : "Books worth hearing";
    const sourceSummary = state.catalogSource === "all"
      ? "Standard Ebooks and Project Gutenberg"
      : state.catalogSource === "standard" ? "Standard Ebooks" : "Project Gutenberg";
    const failureNote = failures.length ? ` · ${failures.map((failure) => failure.source).join(" and ")} didn’t respond` : "";
    elements.catalogStatus.textContent = state.catalogItems.length
      ? `${state.catalogItems.length} ${state.catalogItems.length === 1 ? "book" : "books"} from ${sourceSummary}${failureNote}`
      : query
        ? `No downloadable public-domain edition matched “${query}”. Try a shorter title, the author’s name, or import an EPUB you own.`
        : `No books were found in ${topic?.label || "this collection"}.`;
    setCatalogProgress(totalUnits, totalUnits, "Catalog checked");
    elements.catalogProgress.hidden = true;
    elements.loadMore.hidden = items.length < (state.catalogSource === "standard" ? 18 : 20);
  } catch (error) {
    if (requestId !== state.catalogRequestId) return;
    if (isAbortError(error)) return;
    elements.catalogStatus.textContent = error.message || "The public libraries could not be reached.";
    elements.catalogProgress.hidden = true;
    elements.catalogProgress.closest(".catalog-section")?.setAttribute("aria-busy", "false");
  } finally {
    if (state.catalogAbortController === controller) state.catalogAbortController = null;
  }
}

function chooseCatalogSource(source) {
  state.catalogSource = source;
  state.catalogPage = 1;
  $$('button[data-source]', elements.sourceSwitcher).forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.source === source));
  });
  loadCatalog();
}

function setDiscoveryMode(mode, { focus = true, refresh = true } = {}) {
  const nextMode = mode === "articles" ? "articles" : "books";
  const changed = state.discoveryMode !== nextMode;
  state.discoveryMode = nextMode;
  const isArticles = state.discoveryMode === "articles";
  elements.searchModes.forEach((button) => {
    const selected = button.dataset.searchMode === state.discoveryMode;
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
  elements.catalogSearchLabel.textContent = isArticles ? "Open an article or search Wikipedia" : "Search public-domain books";
  elements.catalogQuery.placeholder = isArticles ? "Paste an article URL or search Wikipedia" : "Title, author, or subject";
  elements.catalogSubmit.setAttribute("aria-label", isArticles ? "Open or search articles" : "Search public-domain books");
  elements.catalogSubmitLabel.textContent = isArticles ? "Open" : "Search";
  elements.discoveryHint.textContent = isArticles
    ? "Paste a link to a public article or paper, or search Wikipedia."
    : "Searches Standard Ebooks and Project Gutenberg.";
  elements.setupButton.hidden = !isArticles;
  elements.catalogControls.hidden = isArticles;
  if (changed && isArticles) {
    state.catalogAbortController?.abort();
    state.catalogRequestId += 1;
    state.catalogItems = [];
    elements.bookGrid.replaceChildren();
    elements.catalogProgress.hidden = true;
    elements.catalogProgress.closest(".catalog-section")?.setAttribute("aria-busy", "false");
    elements.catalogTitle.textContent = "Open an article to hear";
    elements.catalogStatus.textContent = "Paste a public article link, or enter a topic to search Wikipedia.";
    elements.loadMore.hidden = true;
  } else if (changed && refresh) {
    loadCatalog();
  }
  if (focus) elements.catalogQuery.focus();
}

function updateContinueListening() {
  const entries = libraryEntries();
  const entriesByKey = new Map(entries.map((entry) => [entry.key, entry]));
  const recent = Object.values(progressEntries())
    .map((progress) => ({ progress, entry: entriesByKey.get(progress.key) }))
    .filter(({ progress, entry }) => entry && progress.totalWords && progress.word / progress.totalWords < 0.995)
    .sort((left, right) => right.progress.updatedAt - left.progress.updatedAt)
    .slice(0, 4);
  elements.savedCount.textContent = String(entries.length);
  elements.continueList.replaceChildren();
  if (!recent.length) {
    elements.continueListening.hidden = true;
    return;
  }
  elements.continueListening.hidden = false;
  recent.forEach(({ progress, entry }) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.key = entry.key;
    button.setAttribute("aria-label", `Resume ${entry.title} by ${entry.author}`);
    const cover = document.createElement("span");
    cover.className = "continue-cover";
    const fallback = document.createElement("i");
    fallback.textContent = entry.title[0]?.toUpperCase() || "H";
    cover.append(fallback);
    const showImage = (source) => {
      if (!source || cover.querySelector("img")) return;
      const image = document.createElement("img");
      image.crossOrigin = "anonymous";
      image.alt = "";
      image.src = source;
      image.addEventListener("load", () => { fallback.hidden = true; }, { once: true });
      image.addEventListener("error", () => { image.remove(); fallback.hidden = false; }, { once: true });
      cover.append(image);
    };
    const imageSource = displayImageSource(entry);
    if (imageSource) showImage(imageSource);
    else cachedCoverFor(entry).then((image) => {
      if (!image || !button.isConnected) return;
      showImage(displayImageSource({ ...entry, image }));
    });
    const copy = document.createElement("span");
    copy.className = "continue-copy";
    const title = document.createElement("strong");
    title.textContent = entry.title;
    const author = document.createElement("small");
    author.textContent = entry.author;
    const track = document.createElement("span");
    track.className = "continue-track";
    const fill = document.createElement("i");
    const ratio = Math.min(1, progress.word / progress.totalWords);
    fill.style.width = `${ratio * 100}%`;
    track.append(fill);
    const label = document.createElement("span");
    label.textContent = `${Math.round(ratio * 100)}% listened · ${progress.section || "resume"}`;
    copy.append(title, author, track, label);
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "m9 7 8 5-8 5V7Z");
    icon.append(path);
    button.append(cover, copy, icon);
    button.addEventListener("click", () => openLibraryItem(entry));
    elements.continueList.append(button);
  });
}

function showArticleImageFallback() {
  elements.imageWrap.hidden = true;
}

function showMiniCoverFallback() {
  elements.miniCoverImage.hidden = true;
  const fallback = $("span", elements.miniCover);
  fallback.hidden = false;
  fallback.textContent = state.article?.title?.[0]?.toUpperCase() || "H";
}

elements.articleImage.addEventListener("error", showArticleImageFallback);
elements.miniCoverImage.addEventListener("error", showMiniCoverFallback);

function showLibraryView({ scrollTop = true } = {}) {
  elements.reader.hidden = true;
  elements.startView.hidden = false;
  elements.libraryButton.hidden = true;
  elements.importButton.hidden = false;
  elements.shareButton.hidden = true;
  elements.siteHeader.dataset.condensed = state.article ? "true" : "false";
  document.body.classList.add("library-open");
  elements.jumpToCurrent.hidden = true;
  document.title = "Hear — the written world, spoken";
  if (scrollTop) window.scrollTo({ top: 0, behavior: "smooth" });
  updateContinueListening();
  if (state.discoveryMode === "books" && !state.catalogItems.length && !state.catalogAbortController) loadCatalog();
}

function showReaderView({ scrollTop = true } = {}) {
  if (!state.article) return;
  elements.startView.hidden = true;
  elements.reader.hidden = false;
  elements.libraryButton.hidden = false;
  elements.importButton.hidden = true;
  elements.shareButton.hidden = state.article.source === "local";
  elements.siteHeader.dataset.condensed = "true";
  document.body.classList.remove("library-open");
  document.title = `${state.article.title} — Hear`;
  if (scrollTop) window.scrollTo({ top: 0, behavior: "instant" });
  queueJumpToCurrentVisibility();
}

function navigateToLibrary({ historyMode = "push", scrollTop = true } = {}) {
  state.contentAbortController?.abort();
  showLibraryView({ scrollTop });
  const method = historyMode === "replace" ? "replaceState" : historyMode === "push" ? "pushState" : null;
  if (method) history[method](libraryRouteState(), "", location.pathname);
}

function beginContentTask(title, detail) {
  state.contentAbortController?.abort();
  const controller = new AbortController();
  const requestId = ++state.contentRequestId;
  state.contentAbortController = controller;
  elements.loadingTitle.textContent = title;
  elements.loadingDetail.textContent = detail;
  elements.loadingCancel.hidden = false;
  elements.loadingView.dataset.kind = "content";
  elements.loadingView.hidden = false;
  setLoadingIsolation(true);
  announcePlayerStatus(`${title} ${detail}`, { force: true });
  return { controller, requestId };
}

function finishContentTask(controller, requestId) {
  if (state.contentAbortController !== controller || requestId !== state.contentRequestId) return;
  state.contentAbortController = null;
  hideLoading();
}

async function openLibraryItem(item, options = {}) {
  const key = item.key || item.id;
  const cached = await getCachedWork(key).catch(() => null);
  if (cached) {
    activateWork(cached, options);
    return;
  }
  if (item.kind === "article") {
    loadArticle(
      item.source === "web" && item.sourceUrl ? item.sourceUrl : `${item.lang || "en"}:${item.title}`,
      {
        ...options,
        originalSourceUrl: item.originalSourceUrl || "",
        provenanceLabel: item.provenanceLabel || "",
      },
    );
    return;
  }
  if (item.source === "local") {
    showToast("This imported document is no longer in browser storage. Import the file again.");
    return;
  }
  loadCatalogItem(item.catalogItem || item, options);
}

async function loadCatalogItem(item, { historyMode = "push" } = {}) {
  stopSpeech("idle");
  const { controller, requestId } = beginContentTask(`Opening ${item.title}…`, `Connecting to ${item.sourceLabel}`);
  try {
    const cached = await getCachedWork(item.id).catch(() => null);
    let resolvedItem = item;
    if (!cached && item.source === "standard" && !item.downloadUrl) {
      elements.loadingDetail.textContent = "Opening the Standard Ebooks edition";
      resolvedItem = await fetchStandardItemFromSlug(item.id.replace(/^standard:/, ""), { signal: controller.signal });
    }
    const work = cached || (resolvedItem.source === "standard"
      ? await loadStandardWork(
        resolvedItem,
        (message) => { if (requestId === state.contentRequestId) elements.loadingDetail.textContent = message; },
        { signal: controller.signal, parse: parseEpubInWorker },
      )
      : await loadGutenbergWork(
        resolvedItem,
        (message) => { if (requestId === state.contentRequestId) elements.loadingDetail.textContent = message; },
        { signal: controller.signal },
      ));
    if (controller.signal.aborted || requestId !== state.contentRequestId) return;
    if (!cached) await cacheWork(work).catch(() => {});
    activateWork(work, { historyMode });
  } catch (error) {
    if (isAbortError(error)) return;
    showToast(error.message || "That book could not be opened.");
  } finally {
    finishContentTask(controller, requestId);
  }
}

async function importEpub(file, { historyMode = "push" } = {}) {
  if (!file) return;
  if (!/\.epub$/i.test(file.name) && file.type !== "application/epub+zip") {
    showToast("Choose a DRM-free EPUB file.");
    return;
  }
  if (file.size > 100 * 1024 * 1024) {
    showToast("That EPUB is over the 100 MB import limit.");
    return;
  }
  const { controller, requestId } = beginContentTask(`Opening ${file.name}…`, "Checking the EPUB archive");
  try {
    const key = `local:${file.name}:${file.size}:${file.lastModified}`;
    const work = await parseEpubInWorker(
      await file.arrayBuffer(),
      { key, source: "local", sourceLabel: "My EPUB" },
      {
        signal: controller.signal,
        onStatus: (message) => { if (requestId === state.contentRequestId) elements.loadingDetail.textContent = message; },
      },
    );
    if (controller.signal.aborted || requestId !== state.contentRequestId) return;
    await cacheWork(work).catch(() => {});
    activateWork(work, { historyMode });
  } catch (error) {
    if (isAbortError(error)) return;
    showToast(error.message || "That EPUB could not be opened.");
  } finally {
    finishContentTask(controller, requestId);
  }
}

async function importPdf(file, { historyMode = "push" } = {}) {
  if (!file) return;
  if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
    showToast("Choose a PDF file.");
    return;
  }
  if (file.size > 50 * 1024 * 1024) {
    showToast("That PDF is over the 50 MB import limit.");
    return;
  }
  const { controller, requestId } = beginContentTask(`Opening ${file.name}…`, "Loading the local PDF parser");
  try {
    const { parsePdfFile } = await import("./pdf-import.js");
    const work = await parsePdfFile(file, {
      signal: controller.signal,
      onStatus: (message) => { if (requestId === state.contentRequestId) elements.loadingDetail.textContent = message; },
    });
    if (controller.signal.aborted || requestId !== state.contentRequestId) return;
    await cacheWork(work).catch(() => {});
    activateWork(work, { historyMode });
  } catch (error) {
    if (isAbortError(error)) return;
    showToast(error.message || "That PDF could not be opened.");
  } finally {
    finishContentTask(controller, requestId);
  }
}

async function importDocument(file, options = {}) {
  if (!file) return;
  try {
    if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") await importPdf(file, options);
    else await importEpub(file, options);
  } finally {
    elements.documentInput.value = "";
  }
}

function cleanText(value) {
  return String(value || "")
    .replace(/\[[\d\s,–—-]+\]/g, "")
    .replace(/\[(?:citation needed|clarification needed|when\?|where\?|who\?)\]/gi, "")
    // Brackets emptied by removing pronunciation guides: "( , )", "(UK: , US: )".
    .replace(/\s*\((?:\s*[\p{L}.]+\s*:)?(?:\s*[,;]\s*(?:[\p{L}.]+\s*:)?)*\s*\)/gu, "")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/[\t\n\r ]+/g, " ")
    .replace(/\s+([’'])\s+/g, "$1")
    .trim();
}

function conciseText(value, maxLength = 440) {
  const text = cleanText(value || "");
  if (text.length <= maxLength) return text;
  const excerpt = text.slice(0, maxLength);
  const boundary = Math.max(excerpt.lastIndexOf(". "), excerpt.lastIndexOf("; "), excerpt.lastIndexOf(" "));
  return `${excerpt.slice(0, boundary > maxLength * 0.65 ? boundary + 1 : maxLength).trim()}…`;
}

function normalizedHeading(value) {
  return cleanText(value)
    .replace(/\[edit\]$/i, "")
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .trim()
    .toLowerCase();
}

function wordCount(text) {
  return countWords(text);
}

function parseArticleInput(rawInput) {
  const input = rawInput.trim();
  if (!input) throw new Error("Paste an article link or enter a Wikipedia topic.");

  let possibleUrl = input;
  if (looksLikeArticleUrl(input) && !/^https?:\/\//i.test(input)) {
    possibleUrl = `https://${input}`;
  }

  if (/^https?:\/\//i.test(possibleUrl)) {
    const publicUrl = normalizePublicArticleUrl(possibleUrl);
    if (!publicUrl) throw new Error("Use a public article URL without a login or private network address.");
    const url = new URL(publicUrl);
    const hostMatch = url.hostname.match(/^([a-z-]+)(?:\.m)?\.wikipedia\.org$/i);
    if (!hostMatch) {
      return {
        type: "web",
        url: publicUrl,
        fromUrl: true,
      };
    }

    let title = "";
    if (url.pathname.startsWith("/wiki/")) {
      title = url.pathname.slice(6);
    } else if (url.searchParams.get("title")) {
      title = url.searchParams.get("title");
    }

    if (!title) throw new Error("I couldn’t find an article title in that link.");
    return {
      type: "wikipedia",
      lang: hostMatch[1].toLowerCase(),
      title: decodeURIComponent(title).replaceAll("_", " "),
      fromUrl: true,
    };
  }

  const languagePrefix = input.match(/^([a-z-]{2,12}):\s*(.+)$/i);
  return {
    type: "wikipedia",
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

function wikipediaSearchImage(page, origin) {
  const source = page?.thumbnail?.url || "";
  if (!source) return "";
  try {
    return new URL(source, origin).href;
  } catch {
    return "";
  }
}

function wikipediaSearchDescription(page) {
  if (page?.description) return cleanText(page.description);
  const document = new DOMParser().parseFromString(page?.excerpt || "", "text/html");
  return conciseText(document.body.textContent, 180) || "Wikipedia article";
}

async function fetchWikipediaSearch(parsed, { signal, limit = 15 } = {}) {
  const lang = safeLanguage(parsed.lang);
  const origin = `https://${lang}.wikipedia.org`;
  const url = new URL("/w/rest.php/v1/search/page", origin);
  url.searchParams.set("q", parsed.title.trim());
  url.searchParams.set("limit", String(limit));
  const response = await fetchWithTimeout(url.href, { headers: { Accept: "application/json" }, signal });
  if (!response.ok) throw new Error("Wikipedia search didn’t respond. Try again in a moment.");
  const payload = await response.json();
  return (payload.pages || []).map((page) => {
    const title = cleanText(page.title || page.key?.replaceAll("_", " ") || "Untitled article");
    const pageKey = page.key || title.replaceAll(" ", "_");
    return {
      key: `wikipedia:${lang}:${title}`,
      kind: "article",
      lang,
      title,
      author: "Wikipedia contributors",
      description: wikipediaSearchDescription(page),
      image: wikipediaSearchImage(page, origin),
      source: "wikipedia",
      sourceLabel: "Wikipedia",
      sourceUrl: `${origin}/wiki/${encodeURIComponent(pageKey)}`,
      catalogItem: null,
    };
  }).filter((item) => item.title);
}

async function searchWikipedia(parsed, { scroll = true } = {}) {
  state.catalogAbortController?.abort();
  const controller = new AbortController();
  const requestId = ++state.catalogRequestId;
  state.catalogAbortController = controller;
  elements.catalogControls.hidden = true;
  elements.bookGrid.replaceChildren();
  elements.catalogTitle.textContent = `Results for “${parsed.title.trim()}”`;
  elements.catalogStatus.textContent = "Searching Wikipedia…";
  elements.loadMore.hidden = true;

  try {
    const items = await fetchWikipediaSearch(parsed, { signal: controller.signal });
    if (requestId !== state.catalogRequestId) return;
    state.catalogItems = items;
    renderCatalogItems(items);
    elements.catalogStatus.textContent = items.length
      ? `${items.length} matching ${items.length === 1 ? "article" : "articles"} · choose one to prepare for listening`
      : "No matching articles were found. Try a broader search.";
    if (scroll) elements.catalogTitle.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    if (requestId !== state.catalogRequestId || isAbortError(error)) return;
    elements.catalogStatus.textContent = error.message || "Wikipedia search didn’t respond.";
  } finally {
    if (state.catalogAbortController === controller) state.catalogAbortController = null;
  }
}

function handleArticleInput(rawInput, { fromHeader = false } = {}) {
  let parsed;
  try {
    parsed = parseArticleInput(rawInput);
  } catch (error) {
    showToast(error.message);
    return;
  }
  if (parsed.fromUrl) {
    loadArticle(rawInput);
    return;
  }
  if (fromHeader) {
    setDiscoveryMode("articles", { focus: false });
    elements.catalogQuery.value = rawInput.trim();
    navigateToLibrary();
  }
  searchWikipedia(parsed);
}

async function fetchArticle(title, language, allowSearch = true, { signal } = {}) {
  const lang = safeLanguage(language);
  const key = encodeURIComponent(title.trim().replaceAll(" ", "_"));
  const origin = `https://${lang}.wikipedia.org`;
  const htmlUrl = `${origin}/w/rest.php/v1/page/${key}/html`;
  const summaryUrl = `${origin}/api/rest_v1/page/summary/${key}`;

  const [htmlResponse, summaryResponse] = await Promise.all([
    fetchWithTimeout(htmlUrl, { headers: { Accept: "text/html" }, signal }),
    fetchWithTimeout(summaryUrl, { headers: { Accept: "application/json" }, signal }).catch((error) => {
      if (isAbortError(error)) throw error;
      return null;
    }),
  ]);

  if (!htmlResponse.ok) {
    if (htmlResponse.status === 404 && allowSearch) {
      const searchUrl = `${origin}/w/rest.php/v1/search/title?q=${encodeURIComponent(title)}&limit=1`;
      const searchResponse = await fetchWithTimeout(searchUrl, { signal });
      if (searchResponse.ok) {
        const searchData = await searchResponse.json();
        const result = searchData.pages?.[0];
        if (result?.key || result?.title) {
          return fetchArticle(result.key || result.title, lang, false, { signal });
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
    key: `wikipedia:${lang}:${resolvedTitle}`,
    kind: "article",
    lang,
    title: resolvedTitle,
    author: "Wikipedia contributors",
    description: cleanText(summary?.description || "A clean listening edition from Wikipedia"),
    image: articleImageFromSummary(summary),
    source: "wikipedia",
    sourceLabel: "Wikipedia",
    sourceUrl: summary?.content_urls?.desktop?.page || `${origin}/wiki/${encodeURIComponent(resolvedTitle.replaceAll(" ", "_"))}`,
    catalogItem: null,
    blocks,
  };
}

function webSourceLabel(sourceUrl, siteName = "") {
  const namedSource = cleanText(siteName);
  if (namedSource) return conciseText(namedSource, 64);
  try {
    return new URL(sourceUrl).hostname.replace(/^www\./i, "");
  } catch {
    return "Web article";
  }
}

class ArticleImportError extends Error {
  constructor(message, code = "unavailable", { doi = "" } = {}) {
    super(message);
    this.name = "ArticleImportError";
    this.code = code;
    this.doi = doi;
  }
}

function webArticleError(status) {
  if (status === 400) return new ArticleImportError("Use a public article URL without a login or private network address.", "invalid");
  if (status === 403) return new ArticleImportError("That page did not allow Hear to retrieve its article text.", "access-denied");
  if (status === 404) return new ArticleImportError("That article is no longer available at its original address.", "missing");
  if (status === 413) return new ArticleImportError("That page is over the 3 MB article import limit.", "too-large");
  if (status === 415) return new ArticleImportError("That link does not point to an HTML article. Download a PDF copy and import it instead.", "non-html");
  return new ArticleImportError("That publisher could not make the article available. Try again or use another public link.", "unavailable");
}

async function fetchWebArticle(sourceUrl, { signal, onStatus } = {}) {
  const requestUrl = `/article?url=${encodeURIComponent(sourceUrl)}`;
  onStatus?.(`Fetching ${new URL(sourceUrl).hostname}`);
  const response = await fetchWithTimeout(requestUrl, { headers: { Accept: "text/plain" }, signal });
  if (!response.ok) throw webArticleError(response.status);

  const html = await response.text();
  let resolvedUrl = sourceUrl;
  try {
    resolvedUrl = decodeURIComponent(response.headers.get("x-hear-source-url") || "") || sourceUrl;
  } catch {
    resolvedUrl = sourceUrl;
  }
  resolvedUrl = normalizePublicArticleUrl(resolvedUrl) || sourceUrl;
  onStatus?.("Finding the article and removing page clutter");

  const doc = new DOMParser().parseFromString(html, "text/html");
  const docLanguage = doc.documentElement.lang || "en";
  const doi = normalizeDoi(doc.querySelector(
    'meta[name="citation_doi" i], meta[name="dc.identifier" i], meta[name="doi" i]',
  )?.content) || doiFromArticleUrl(resolvedUrl);
  doc.querySelectorAll("script, style, template, noscript, iframe, object, embed").forEach((element) => element.remove());
  const base = doc.createElement("base");
  base.href = resolvedUrl;
  doc.head.prepend(base);

  let readable;
  try {
    const { Readability } = await import("@mozilla/readability");
    readable = new Readability(doc, { maxElemsToParse: 30_000, charThreshold: 180 }).parse();
  } catch {
    throw new ArticleImportError("That page is too complex to turn into a clean article.", "unreadable", { doi });
  }
  if (!readable?.content || !readable.title) {
    throw new ArticleImportError(
      "No readable article was found. Try the publisher’s print view or a direct article link.",
      "unreadable",
      { doi },
    );
  }

  const blocks = extractArticleBlocks(readable.content);
  const readableWords = blocks.reduce((count, block) => count + (block.type.startsWith("h") ? 0 : wordCount(block.text)), 0);
  const accessWallPattern = /(?:purchase|buy|rent) (?:this )?(?:article|paper)|institutional access|subscribe to (?:read|access|continue)|(?:sign|log) in (?:through|with|to) (?:your )?(?:institution|access)|get full access|check access|preview of subscription content/i;
  const appearsAccessLimited = doi && readableWords < 1_200 && accessWallPattern.test(readable.textContent || "");
  if (readableWords < 40 || appearsAccessLimited) {
    throw new ArticleImportError(
      appearsAccessLimited
        ? "The page appears to contain an abstract or access notice instead of the full paper."
        : "The page did not include enough readable article text. It may require a login or JavaScript.",
      "limited",
      { doi },
    );
  }

  const sourceLabel = webSourceLabel(resolvedUrl, readable.siteName);
  const byline = cleanText(readable.byline || "").replace(/^by\s+/i, "");
  const language = String(readable.lang || docLanguage || "en").trim().replaceAll("_", "-") || "en";
  return {
    key: `web:${resolvedUrl}`,
    kind: "article",
    lang: language,
    title: cleanText(readable.title),
    author: byline || sourceLabel,
    description: conciseText(readable.excerpt, 320) || `A clean listening edition from ${sourceLabel}.`,
    image: "",
    source: "web",
    sourceLabel,
    sourceUrl: resolvedUrl,
    catalogItem: null,
    blocks,
  };
}

async function fetchRecoveryAlternatives(sourceUrl, { doi = "", includeArchive = false, signal } = {}) {
  const endpoint = new URL("/recover", location.origin);
  endpoint.searchParams.set("url", sourceUrl);
  if (doi) endpoint.searchParams.set("doi", doi);
  if (includeArchive) endpoint.searchParams.set("archive", "1");
  const response = await fetchWithTimeout(endpoint, { headers: { Accept: "application/json" }, signal });
  if (!response.ok) return [];
  const payload = await response.json();
  return Array.isArray(payload.alternatives) ? payload.alternatives.filter((alternative) => (
    alternative
    && normalizePublicArticleUrl(alternative.url)
    && typeof alternative.provider === "string"
    && typeof alternative.label === "string"
  )) : [];
}

function showRecoveryOptions(alternatives, originalSourceUrl) {
  elements.recoveryDescription.textContent = alternatives.some((alternative) => alternative.kind === "archive")
    ? "The original page could not be prepared. Choose an archived snapshot or authorized open copy instead."
    : "The original page could not be prepared. Choose an authorized open copy instead.";
  elements.recoveryOptions.replaceChildren();

  alternatives.forEach((alternative) => {
    const button = document.createElement("button");
    button.className = "recovery-option";
    button.type = "button";

    const provider = document.createElement("span");
    provider.className = "recovery-provider";
    provider.textContent = alternative.provider;
    const copy = document.createElement("span");
    copy.className = "recovery-option-copy";
    const label = document.createElement("strong");
    label.textContent = alternative.label;
    const detail = document.createElement("small");
    detail.textContent = alternative.detail || "Publicly available copy";
    const arrow = document.createElement("span");
    arrow.className = "recovery-arrow";
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = "↗";
    copy.append(label, detail);
    button.append(provider, copy, arrow);
    button.addEventListener("click", () => {
      elements.recoverySheet.close();
      loadArticle(alternative.url, {
        originalSourceUrl,
        provenanceLabel: alternative.provider,
      });
    });
    elements.recoveryOptions.append(button);
  });

  if (!elements.recoverySheet.open) elements.recoverySheet.showModal();
  requestAnimationFrame(() => $("button", elements.recoveryOptions)?.focus({ preventScroll: true }));
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
    // Pronunciation guides: a voice spells IPA out glyph by glyph.
    ".IPA",
    "[lang$='-fonipa']",
    "a[href*='Help:IPA']",
    "a[href*='Pronunciation_respelling']",
    ".ext-phonos",
    "[typeof~='mw:Extension/phonos']",
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

  const addChunk = (text, block, extra = {}) => {
    const count = wordCount(text);
    chunks.push({
      text,
      blockId: block?.id || null,
      section: block?.section || "Opening",
      sectionId: block?.sectionId || "introduction",
      startWord: cumulativeWords,
      wordCount: count,
      ...extra,
    });
    cumulativeWords += count;
  };

  addChunk(article.title, null, { kind: "title" });
  for (const block of article.blocks) {
    if (block.type === "h2" || block.type === "h3") {
      addChunk(`${block.text}.`, block, { kind: "heading" });
      continue;
    }
    // Respect explicit line breaks (verse/poetry) preserved by library.js — each line becomes its own chunk sequence
    const linePieces = block.text.includes("\n") ? block.text.split(/\n+/).map((part) => part.trim()).filter(Boolean) : [block.text];
    for (let pieceIndex = 0; pieceIndex < linePieces.length; pieceIndex += 1) {
      let piece = linePieces[pieceIndex];
      const isLineBreakPiece = pieceIndex > 0;
      // Ensure a pause between verse lines that lack terminal punctuation — period gives a sentence-level break instead of same-breath comma
      if (pieceIndex < linePieces.length - 1 && !/[.!?;:,…—]$/.test(piece)) {
        piece = `${piece} .`;
      }
      const sentences = segmentNarrationSentences(piece, article.lang);
      for (let s = 0; s < sentences.length; s += 1) {
        const isFirstSentenceOfPiece = s === 0;
        addChunk(sentences[s], block, isLineBreakPiece && isFirstSentenceOfPiece ? { lineBreak: true } : {});
      }
    }
  }

  return chunks;
}

function rebuildNeuralSegments(word = state.chunks[state.currentIndex]?.startWord || 0) {
  state.neuralSegments = createNeuralSegments(state.chunks, {
    // Kitten runs sentences together when given several at once.
    mergeShort: state.backendPreference !== "kitten",
  });
  neuralPlayer.load(state.neuralSegments, word);
}

function showArtworkFallback(article) {
  elements.articleImage.removeAttribute("src");
  elements.imageWrap.hidden = true;
  elements.miniCoverImage.removeAttribute("src");
  elements.miniCoverImage.hidden = true;
  $("span", elements.miniCover).hidden = false;
  $("span", elements.miniCover).textContent = article.title[0]?.toUpperCase() || "W";
}

function renderArticleArtwork(article) {
  showArtworkFallback(article);
  const source = displayImageSource(article);
  if (!source) return;
  try {
    elements.articleImage.src = source;
    elements.articleImage.alt = article.kind === "book" ? `Cover of ${article.title}` : `Lead image for ${article.title}`;
    elements.imageCaption.textContent = article.kind === "book"
      ? `Cover from ${article.sourceLabel}`
      : article.source === "wikipedia" ? `Image from ${article.lang}.wikipedia.org` : `Image from ${article.sourceLabel}`;
    elements.imageWrap.hidden = false;
    elements.miniCoverImage.src = source;
    elements.miniCoverImage.hidden = false;
    $("span", elements.miniCover).hidden = true;
    updateMediaMetadata();
  } catch (error) {
    if (!isAbortError(error)) showArtworkFallback(article);
  }
}

function renderArticle(article) {
  elements.reader.dataset.kind = article.kind;
  elements.articleTitle.textContent = article.title;
  elements.articleDescription.textContent = article.kind === "book" && article.author
    ? `${article.author}. ${conciseText(article.description)}`
    : article.description;
  elements.articleKicker.textContent = article.kind === "book"
    ? `${article.sourceLabel} · listening edition`
    : article.source === "wikipedia"
      ? `From ${article.lang}.wikipedia.org`
      : article.source === "local"
        ? "Private PDF · on this device"
        : `From ${article.sourceLabel}${article.provenanceLabel ? ` · via ${article.provenanceLabel}` : ""}`;
  elements.sourceLink.hidden = !article.sourceUrl;
  elements.sourceLink.href = article.sourceUrl || "#";
  elements.sourceLink.textContent = article.kind === "book"
    ? `Edition at ${article.sourceLabel} ↗`
    : article.provenanceLabel ? `Copy at ${article.provenanceLabel} ↗` : "Original article ↗";
  elements.originalSourceLink.hidden = !article.originalSourceUrl;
  elements.originalSourceLink.href = article.originalSourceUrl || "#";
  elements.originalSourceLink.textContent = "Original page ↗";
  elements.nowTitle.textContent = article.title;
  elements.outlineLabel.textContent = article.kind === "book" ? "Chapters" : "In this article";
  elements.endLabel.textContent = article.kind === "book" ? "End of the book." : "That’s the clean version.";
  elements.readingNoteText.textContent = article.kind === "book"
    ? "Footnotes, endnotes, navigation, and decorative matter have been left out of narration."
    : article.source === "local"
      ? "Selectable text was extracted from this PDF on your device. Citations, tables, and references have been left out where detected."
    : "Footnotes, citation numbers, tables, and references have been removed from narration.";

  const count = state.chunks.at(-1)?.startWord + state.chunks.at(-1)?.wordCount || 0;
  const minutes = Math.max(1, Math.round(count / (WORDS_PER_MINUTE * state.rate)));
  elements.durationLabel.textContent = `${minutes} min listen`;
  elements.wordCountLabel.textContent = `${count.toLocaleString()} words`;
  elements.totalTime.textContent = formatTime((count / WORDS_PER_MINUTE / state.rate) * 60);

  renderArticleArtwork(article);

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
  const introTarget = article.kind === "article" && article.blocks.find((block) => block.type === "p" || block.type === "li");
  if (introTarget) addOutlineLink("Introduction", introTarget.id, "introduction");
  for (const block of article.blocks.filter((item) => item.type === "h2")) {
    addOutlineLink(block.text, block.id, block.sectionId);
  }
  renderChapters(article);
}

function renderChapters(article) {
  const seen = new Set();
  const chapters = [];
  for (const chunk of state.chunks) {
    if (!chunk.sectionId || seen.has(chunk.sectionId)) continue;
    if (article.kind === "article" && chunk.sectionId === "introduction") {
      seen.add(chunk.sectionId);
      chapters.push({ title: "Introduction", sectionId: chunk.sectionId, chunkIndex: state.chunks.indexOf(chunk), startWord: chunk.startWord });
      continue;
    }
    const heading = article.blocks.find((block) => block.type === "h2" && block.sectionId === chunk.sectionId);
    if (!heading) continue;
    seen.add(chunk.sectionId);
    chapters.push({ title: heading.text, sectionId: chunk.sectionId, chunkIndex: state.chunks.indexOf(chunk), startWord: chunk.startWord });
  }
  chapters.forEach((chapter, index) => {
    const endWord = chapters[index + 1]?.startWord ?? totalWords();
    chapter.wordCount = Math.max(1, endWord - chapter.startWord);
  });
  state.chapters = chapters;
  elements.chaptersButton.hidden = chapters.length < 2;
  elements.chaptersSheetTitle.textContent = article.kind === "book" ? "Choose a chapter." : "Choose a section.";
  elements.chapterList.replaceChildren();
  chapters.forEach((chapter, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.sectionId = chapter.sectionId;
    const number = document.createElement("span");
    number.textContent = String(index + 1).padStart(2, "0");
    const title = document.createElement("strong");
    title.textContent = chapter.title;
    const duration = document.createElement("small");
    duration.textContent = `${Math.max(1, Math.round(chapter.wordCount / (WORDS_PER_MINUTE * state.rate)))} min`;
    button.append(number, title, duration);
    button.addEventListener("click", () => {
      const wasPlaying = state.playback === "playing";
      seekToIndex(chapter.chunkIndex, wasPlaying, chapter.startWord);
      document.getElementById(chapter.sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" });
      elements.chaptersSheet.close();
      if (!wasPlaying) showToast(`Ready at ${chapter.title}`);
    });
    elements.chapterList.append(button);
  });
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
  if (state.engine === "neural" && state.neuralSegments.length) {
    return Math.min(totalWords(), neuralPlayer.positionWord());
  }
  const chunk = state.chunks[state.currentIndex];
  if (!chunk) return totalWords();
  return Math.min(totalWords(), chunk.startWord + state.boundaryWords);
}

function naturalVoiceAvailable() {
  return state.article?.lang?.toLowerCase().startsWith("en");
}

function selectedModelChoiceId() {
  if (state.backendPreference === "system") return "system";
  if (state.backendPreference === "kitten") return `kitten:${state.kittenModel}`;
  const dtype = state.kokoroDevice === "webgpu" ? "fp32" : state.kokoroDtype;
  return `kokoro:${state.kokoroDevice}:${dtype}`;
}

// Which model weights are already in CacheStorage, as "repo/path.onnx".
async function refreshSavedModels() {
  const saved = new Set();
  if (typeof caches !== "undefined") {
    for (const name of ["kitten-cache", "transformers-cache"]) {
      try {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) {
          const match = request.url.match(/huggingface\.co\/([^/]+\/[^/]+)\/resolve\/[^/]+\/(.+\.onnx)$/);
          if (match) saved.add(`${match[1]}/${match[2]}`);
        }
      } catch {}
    }
  }
  state.savedModels = saved;
  updateEngineUI();
}

function isModelSaved(choice) {
  if (!choice || choice.engine === "system") return false;
  if (choice.engine === "kitten") return [...state.savedModels].some((key) => key.startsWith(`${choice.model}/`));
  const file = choice.device === "webgpu" ? KOKORO_MODEL_FILES.fp32 : KOKORO_MODEL_FILES[choice.dtype];
  return state.savedModels.has(`${KOKORO_MODEL}/${file}`);
}

// Choosing an engine keeps the variant last used with it.
function engineChoiceId(engineId) {
  if (engineId === "kitten") return `kitten:${state.kittenModel}`;
  if (engineId === "kokoro") return `kokoro:${state.kokoroDevice}:${state.kokoroDevice === "webgpu" ? "fp32" : state.kokoroDtype}`;
  return "system";
}

function renderOption(button, { name, detail }) {
  const marker = document.createElement("span");
  marker.className = "option-marker";
  marker.setAttribute("aria-hidden", "true");
  const copy = document.createElement("span");
  copy.className = "option-copy";
  const title = document.createElement("strong");
  title.textContent = name;
  const description = document.createElement("small");
  description.textContent = detail;
  copy.append(title, description);
  const facts = document.createElement("span");
  facts.className = "option-facts";
  const size = document.createElement("strong");
  size.className = "option-size";
  const meta = document.createElement("small");
  meta.className = "option-meta";
  facts.append(size, meta);
  button.append(marker, copy, facts);
}

function renderModelChoices() {
  if (!elements.engineOptions.childElementCount) {
    for (const engine of SPEECH_ENGINES) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "option";
      button.dataset.engine = engine.id;
      button.setAttribute("role", "radio");
      button.setAttribute("aria-checked", "false");
      renderOption(button, engine);
      elements.engineOptions.append(button);
    }
  }
  if (!elements.modelOptions.childElementCount) {
    for (const choice of SPEECH_MODEL_CHOICES) {
      if (choice.engine === "system") continue;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "option";
      button.dataset.modelChoice = choice.id;
      button.dataset.engine = choice.engine;
      button.setAttribute("role", "radio");
      button.setAttribute("aria-checked", "false");
      renderOption(button, choice);
      $(".option-size", button).textContent = `≈ ${formatMegabytes(choice.sizeMb)}`;
      elements.modelOptions.append(button);
    }
  }
}

function runtimeLabel(choice) {
  return `${choice.dtype} · ${choice.device === "webgpu" ? "WebGPU" : "WASM"}`;
}

function activeModelLabel(choice) {
  if (choice.engine === "system") return "System voice · instant · no download";
  let label;
  if (state.activeBackendId === "kitten-wasm") label = `${state.kittenModel} · ${state.kittenDtype} · WASM`;
  else if (state.activeBackendId === "kokoro-webgpu") label = `${KOKORO_MODEL} · fp32 · WebGPU`;
  else if (state.activeBackendId === "kokoro-wasm") {
    label = `${KOKORO_MODEL} · ${state.kokoroDtype} · WASM${state.kokoroDevice === "webgpu" ? " (WebGPU unavailable)" : ""}`;
  } else label = `${choice.repository} · ${runtimeLabel(choice)}`;
  return `${label} · ${state.neuralReady && state.activeBackendId ? "loaded" : "loads when you press play"}`;
}

function updateEngineUI() {
  if (!naturalVoiceAvailable() && state.engine === "neural") {
    state.engine = "system";
    state.backendPreference = "system";
  }
  const isNeural = state.engine === "neural";
  const englishOnly = !naturalVoiceAvailable();
  renderModelChoices();
  const selected = SPEECH_MODEL_CHOICES.find((choice) => choice.id === selectedModelChoiceId()) || SPEECH_MODEL_CHOICES[0];

  for (const button of elements.engineOptions.querySelectorAll("[data-engine]")) {
    const engine = button.dataset.engine;
    const choice = SPEECH_MODEL_CHOICES.find((item) => item.id === engineChoiceId(engine));
    const loaded = state.neuralReady && state.activeBackendId?.startsWith(engine);
    const saved = isModelSaved(choice);
    button.setAttribute("aria-checked", String(engine === selected.engine));
    button.disabled = engine !== "system" && englishOnly;
    $(".option-size", button).textContent = engine === "system" ? "No download" : saved ? "Saved" : `≈ ${formatMegabytes(choice?.sizeMb)}`;
    $(".option-meta", button).textContent = engine === "system"
      ? "Instant"
      : englishOnly ? "English works only" : loaded ? "Loaded" : "On device";
  }
  for (const button of elements.modelOptions.querySelectorAll("[data-model-choice]")) {
    const choice = SPEECH_MODEL_CHOICES.find((item) => item.id === button.dataset.modelChoice);
    const webGpuUnavailable = choice.device === "webgpu" && !supportsWebGPU();
    button.hidden = choice.engine !== selected.engine;
    button.disabled = webGpuUnavailable || englishOnly;
    button.setAttribute("aria-checked", String(choice.id === selected.id));
    $(".option-size", button).textContent = isModelSaved(choice) ? "Saved" : `≈ ${formatMegabytes(choice.sizeMb)}`;
    $(".option-meta", button).textContent = webGpuUnavailable ? "Not available here" : runtimeLabel(choice);
  }
  elements.modelVariants.hidden = !isNeural;
  elements.modelVariantSummary.textContent = isNeural ? selected.name : "";
  // Exact active model: Hugging Face repository, precision, and device.
  elements.activeModelLabel.textContent = activeModelLabel(selected);
  elements.activeModelLabel.title = elements.activeModelLabel.textContent;

  const kitten = isNeural && selected.engine === "kitten";
  const kokoro = isNeural && selected.engine === "kokoro";
  elements.naturalVoiceRow.hidden = !kokoro;
  elements.kittenVoiceRow.hidden = !kitten;
  elements.systemVoiceRow.hidden = isNeural;
  elements.kittenVoiceSelect.value = state.kittenVoice;
  elements.naturalVoiceSelect.value = state.neuralVoice;
  elements.voiceTraits.textContent = NATURAL_VOICES[state.neuralVoice]?.note || NATURAL_VOICES.af_heart.note;
  elements.safariVoiceTip.hidden = isNeural || !IS_SAFARI;

  const voiceName = kitten
    ? state.kittenVoice
    : kokoro
      ? NATURAL_VOICES[state.neuralVoice]?.name || "Heart"
      : state.selectedVoice?.name || "System voice";
  elements.voiceName.textContent = voiceName;
  elements.voiceType.textContent = kitten ? "Kitten" : kokoro ? "Kokoro" : "System voice";
  elements.voiceButton.setAttribute("aria-label", `Voice and speed: ${voiceName}, ${elements.voiceType.textContent}`);
  elements.engineDescription.textContent = englishOnly
    ? "Natural voices are available for English works. This one uses the system voice."
    : "Natural voices run entirely on this device and download only when you press play.";
  const details = getModelDownloadDetails({
    backend: state.backendPreference,
    kokoroDevice: state.kokoroDevice,
    kokoroDtype: state.kokoroDtype,
    kittenModel: state.kittenModel,
  });
  elements.voiceNote.textContent = !isNeural
    ? "System voices start instantly. Natural voices download only when you choose one and press play."
    : state.neuralReady
      ? `${details.engineName} is loaded and works offline.`
      : isModelSaved(selected)
        ? `${details.engineName} is saved on this device and starts without downloading.`
        : `The first play downloads about ${formatMegabytes(details.sizeMb)} once; after that it works offline.`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "unknown";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024).toLocaleString()} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

async function refreshStorageLabel() {
  if (!elements.storageUsageLabel) return;
  try {
    const estimatePromise = navigator.storage?.estimate
      ? navigator.storage.estimate().catch(() => null)
      : Promise.resolve(null);
    const [stats, estimate] = await Promise.all([
      getTtsCacheStats().catch(() => null),
      estimatePromise,
    ]);
    const audio = stats
      ? `${formatBytes(stats.bytes)} across ${stats.count.toLocaleString()} passage${stats.count === 1 ? "" : "s"}`
      : "Size unavailable";
    const browser = estimate?.usage !== undefined && estimate?.quota !== undefined
      ? ` Hear is using ${formatBytes(estimate.usage)} of ${formatBytes(estimate.quota)} available to this site.`
      : "";
    elements.storageUsageLabel.textContent = `${audio}. Passages you have heard replay instantly; the oldest are removed after 256 MB.${browser}`;
    if (elements.storageNote) elements.storageNote.textContent = "Articles, books, and generated audio stay in this browser. No text or audio is ever sent to a speech service.";
  } catch {}
  await refreshModelCacheUI().catch(() => {});
}

async function updateNeuralDownloadSheet() {
  const details = getModelDownloadDetails({
    backend: state.backendPreference,
    kokoroDevice: state.kokoroDevice,
    kokoroDtype: state.kokoroDtype,
    kittenModel: state.kittenModel,
  });
  elements.neuralDownloadSize.textContent = `≈ ${details.sizeMb}`;
  elements.neuralDownloadUnit.textContent = "MB";
  const choice = SPEECH_MODEL_CHOICES.find((item) => item.id === selectedModelChoiceId());
  elements.neuralDownloadModel.textContent = `${details.engineName} · ${choice?.name || details.label}, saved in this browser after one download.`;
  elements.neuralDownloadModel.title = `${details.model} · ${details.label}`;
  elements.neuralDownloadStorage.textContent = "Checking available browser storage…";
  try {
    const estimate = await navigator.storage?.estimate?.();
    if (estimate?.quota !== undefined && estimate?.usage !== undefined) {
      elements.neuralDownloadStorage.textContent = `${formatBytes(Math.max(0, estimate.quota - estimate.usage))} of browser storage available.`;
    } else {
      elements.neuralDownloadStorage.textContent = "Your browser manages the model cache and may reclaim it when space is low.";
    }
  } catch {
    elements.neuralDownloadStorage.textContent = "Your browser manages the model cache and may reclaim it when space is low.";
  }
}

async function refreshModelCacheUI() {
  const list = elements.modelCacheList;
  const totalEl = elements.modelCacheTotal;
  const clearBtn = elements.clearModelCache;
  if (!list) return;
  if (typeof caches === "undefined") {
    list.replaceChildren(Object.assign(document.createElement("p"), { className: "cache-empty", textContent: "This browser does not expose saved model files." }));
    if (totalEl) totalEl.textContent = "—";
    if (clearBtn) clearBtn.disabled = true;
    return;
  }
  list.replaceChildren(Object.assign(document.createElement("p"), { className: "cache-empty", textContent: "Checking…" }));
  try {
    const { available, entries, totalFormatted } = await getModelCacheEntries();
    if (!available) {
      list.replaceChildren(Object.assign(document.createElement("p"), { className: "cache-empty", textContent: "This browser does not expose saved model files." }));
      if (totalEl) totalEl.textContent = "—";
      return;
    }
    if (totalEl) totalEl.textContent = entries.length ? `${totalFormatted} · ${entries.length} file${entries.length === 1 ? "" : "s"}` : "None saved";
    if (clearBtn) clearBtn.disabled = entries.length === 0;
    if (!entries.length) {
      list.replaceChildren(Object.assign(document.createElement("p"), { className: "cache-empty", textContent: "No voice models saved yet. Choose Kitten or Kokoro and press play to download one." }));
      return;
    }
    list.replaceChildren();
    const frag = document.createDocumentFragment();
    for (const entry of entries) {
      const row = document.createElement("div");
      row.className = "cache-row";
      const meta = document.createElement("div");
      meta.className = "cache-meta";
      const name = document.createElement("strong");
      name.textContent = entry.label;
      const url = document.createElement("small");
      url.textContent = `${entry.formattedSize} · ${entry.shortUrl}`;
      url.title = entry.url;
      meta.append(name, url);
      const del = document.createElement("button");
      del.type = "button";
      del.className = "text-link text-link-danger";
      del.textContent = "Remove";
      del.setAttribute("aria-label", `Delete ${entry.label}`);
      del.addEventListener("click", async () => {
        del.disabled = true;
        const prev = del.textContent;
        del.textContent = "…";
        try {
          await deleteCacheEntry(entry.cacheName, entry.url);
          clearModelConsentRecords();
          // Reset worker so next play re-fetches cleanly
          await resetNeuralWorker(new Error("Model cache entry deleted")).catch(() => {});
          showToast(`${entry.label} removed`);
          await refreshModelCacheUI();
          await refreshSavedModels();
        } catch (err) {
          showToast(err.message || "Could not delete");
          del.disabled = false;
          del.textContent = prev;
        }
      });
      row.append(meta, del);
      frag.append(row);
    }
    list.append(frag);
  } catch (err) {
    list.replaceChildren(Object.assign(document.createElement("p"), { className: "cache-empty", textContent: err.message || "Could not read saved models." }));
  }
}

function clearModelConsentRecords() {
  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index);
    if (key?.startsWith(`${STORAGE_PREFIX}model-consent:`)) localStorage.removeItem(key);
  }
}

async function handleClearModelCache() {
  const btn = elements.clearModelCache;
  if (btn) btn.disabled = true;
  if (!confirm("Remove all saved voice models? The next natural-voice play will download the model again.")) {
    if (btn) btn.disabled = false;
    return;
  }
  try {
    await clearAllModelCaches();
    clearModelConsentRecords();
    await resetNeuralWorker(new Error("Model caches cleared")).catch(() => {});
    showToast("Saved voice models removed");
    await refreshModelCacheUI();
    await refreshSavedModels();
  } catch (err) {
    showToast(err.message || "Could not clear saved models");
  } finally {
    if (btn) {
      // re-enable via refresh
      refreshModelCacheUI().catch(() => { btn.disabled = false; });
    }
  }
}

async function handleClearAudioCache() {
  const btn = elements.clearAudioCache;
  if (btn) btn.disabled = true;
  try {
    await clearTtsCache();
    neuralPlayer.dropGeneratedAudio();
    await refreshStorageLabel();
    showToast("Generated audio cleared");
  } catch (error) {
    showToast(error.message || "Could not clear generated audio");
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function handleClearAllData() {
  if (!confirm("Clear all Hear data? This removes your library, progress, voice choices, models, and generated audio, then reloads.")) return;
  const btn = elements.clearAllData;
  if (btn) btn.disabled = true;
  try {
    await clearTtsCache().catch(() => {});
    await deleteTtsDatabase().catch(() => {});
    // Clear model caches as well
    await clearAllModelCaches().catch(() => {});
    // Clear work cache DB
    try {
      indexedDB.deleteDatabase("hear-work-cache");
    } catch {}
    neuralPlayer.stop();
    await resetNeuralWorker(new Error("Storage cleared")).catch(() => {});
    // Wipe hearwiki:* localStorage keys
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith(STORAGE_PREFIX)) localStorage.removeItem(key);
    }
    // Also remove webgpu probe keys
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (key && key.includes("webgpu-probe")) localStorage.removeItem(key);
    }
    showToast("All Hear data cleared — reloading");
    setTimeout(() => location.reload(), 600);
  } catch (error) {
    showToast(error.message || "Could not clear all data");
    if (btn) btn.disabled = false;
  }
}

function engineLabel(backendId = state.activeBackendId) {
  const kind = backendId?.startsWith("kitten") || (!backendId && state.backendPreference === "kitten") ? "kitten" : "kokoro";
  if (kind === "kitten") {
    const variant = SPEECH_MODEL_CHOICES.find((choice) => choice.id === `kitten:${state.kittenModel}`);
    return `Kitten ${variant?.name || "Nano 0.8"}`;
  }
  const webgpu = backendId === "kokoro-webgpu" || (!backendId && state.kokoroDevice === "webgpu");
  return webgpu ? "Kokoro · WebGPU" : `Kokoro · ${state.kokoroDtype}`;
}

// Model downloads and warm-up show in the player (a thin progress rule and
// the status line) and in the voice sheet, never as a blocking overlay: the
// work stays readable while a voice downloads.
function setNeuralLoading(progress = null, detail = "", short = detail) {
  const bar = elements.playerProgress;
  bar.hidden = false;
  bar.dataset.indeterminate = String(progress === null);
  bar.style.setProperty("--progress", `${progress === null ? 0 : Math.min(100, Math.max(0, progress))}%`);
  elements.engineStatus.hidden = false;
  elements.engineStatus.textContent = detail;
  elements.nowSection.title = detail;
  if (state.engine === "neural" && state.playback === "buffering") setPlayerStatus(short, { announce: false });
}

function hideNeuralLoading() {
  elements.playerProgress.hidden = true;
  elements.engineStatus.hidden = true;
  elements.engineStatus.textContent = "";
  elements.nowSection.removeAttribute("title");
}

function setLoadingIsolation(active) {
  [elements.siteHeader, $("main"), elements.jumpToCurrent, elements.player, ...$$("dialog")].forEach((element) => {
    if (element) element.inert = active;
  });
  if (active) requestAnimationFrame(() => elements.loadingCancel.focus({ preventScroll: true }));
}

function hideLoading() {
  elements.loadingView.hidden = true;
  elements.loadingView.dataset.kind = "";
  setLoadingIsolation(false);
}

function ttsCallbacks() {
  return {
    onProgress(message) {
      const backend = message.backend || state.activeBackendId || state.backendPreference;
      const name = engineLabel(message.backend);
      const file = message.file || "";
      const pct = Number.isFinite(message.progress) ? Math.round(message.progress) : null;
      if (message.status === "ready") {
        setNeuralLoading(100, `${name} is ready · ${backend}`, `${name} is ready`);
        return;
      }
      if (message.status === "loading") {
        setNeuralLoading(null, `Preparing ${file || "the model"} for this device · ${backend}`, `Starting ${name}…`);
        return;
      }
      if (message.status === "starting" || !file) {
        setNeuralLoading(null, `Starting ${name} · ${backend}`, `Starting ${name}…`);
        return;
      }
      // Later downloads (a newly chosen Kokoro voice) arrive while the engine
      // is already running; clear the rule once they finish.
      if (state.neuralReady && pct !== null && pct >= 100) {
        hideNeuralLoading();
        return;
      }
      const cached = message.cached || message.status === "cached";
      const sizes = message.total > 0 ? ` · ${formatBytes(message.loaded)} of ${formatBytes(message.total)}` : "";
      setNeuralLoading(
        pct,
        `${cached ? "Loading saved" : "Downloading"} ${file}${sizes}${pct !== null ? ` · ${pct}%` : ""} · ${backend}`,
        cached ? `Loading ${name}…` : `Downloading ${name}${pct !== null ? ` · ${pct}%` : "…"}`,
      );
    },
    onReady(message) {
      state.neuralReady = true;
      localStorage.setItem(`${STORAGE_PREFIX}neural-ready`, "true");
      state.activeBackendId = message.backend || state.activeBackendId;
      console.info("[Hear TTS] runtime", {
        crossOriginIsolated: message.crossOriginIsolated,
        sharedArrayBuffer: message.sharedArrayBuffer,
        cores: message.cores,
        backend: message.backend,
        model: message.model,
        dtype: message.dtype,
        device: message.device,
      });
      hideNeuralLoading();
      refreshSavedModels();
      if (state.playback === "buffering") setPlayerStatus(`Preparing the first sentence · ${engineLabel()}`, { announce: false });
    },
    onGenerating(message) {
      if (state.engine !== "neural" || state.playback !== "buffering") return;
      const index = neuralPlayer.waiting?.index;
      const total = state.neuralSegments.length;
      const position = Number.isInteger(index) && total ? ` ${index + 1} of ${total}` : "";
      const action = message?.stage === "phonemize" ? "Reading" : message?.stage === "encoding" ? "Finishing" : "Generating";
      setPlayerStatus(`${action} passage${position} · ${engineLabel(message?.backend)}`, { announce: false });
    },
    onMetric(metric) {
      window.__hearwikiTtsMetrics ||= [];
      window.__hearwikiTtsMetrics.push(metric);
      window.__hearwikiTtsMetrics = window.__hearwikiTtsMetrics.slice(-100);
      console.info("[Hear TTS] generation", JSON.stringify(metric));
    },
    onFatal(error) {
      state.neuralReady = false;
      console.error("[Hear TTS] backend failure", error);
      hideNeuralLoading();
      updateEngineUI();
    },
  };
}

function webGpuProbeKey() {
  const identity = `${navigator.userAgent}|${navigator.platform}|${TTS_APP_VERSION}`;
  let hash = 2166136261;
  for (const character of identity) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return `${STORAGE_PREFIX}webgpu-probe:${(hash >>> 0).toString(16)}`;
}

function markInterruptedWebGpuProbe() {
  const key = webGpuProbeKey();
  if (localStorage.getItem(`${key}:pending`) === "true" && !localStorage.getItem(`${key}:result`)) {
    localStorage.setItem(`${key}:result`, JSON.stringify({ ok: false, reason: "interrupted", version: TTS_APP_VERSION }));
    localStorage.removeItem(`${key}:pending`);
  }
}

async function probeKokoroWebGpu() {
  const key = webGpuProbeKey();
  const cached = readStoredJson(`${key}:result`, null);
  if (cached) return cached;
  if (!("gpu" in navigator)) return { ok: false, reason: "unavailable" };
  localStorage.setItem(`${key}:pending`, "true");
  const candidate = new KokoroWebGPU(ttsCallbacks(), { dtype: state.kokoroDtype, voice: state.neuralVoice });
  try {
    setNeuralLoading(null, "Testing Kokoro on this graphics chip · kokoro-webgpu", "Testing WebGPU…");
    const rtf = await candidate.benchmark();
    const result = { ok: Number.isFinite(rtf), rtf, version: TTS_APP_VERSION };
    localStorage.setItem(`${key}:result`, JSON.stringify(result));
    if (result.ok) return { ...result, backend: candidate };
    await candidate.dispose();
    return result;
  } catch (error) {
    await candidate.dispose();
    const result = { ok: false, reason: error.message, version: TTS_APP_VERSION };
    localStorage.setItem(`${key}:result`, JSON.stringify(result));
    return result;
  } finally {
    localStorage.removeItem(`${key}:pending`);
  }
}

async function createSelectedBackend() {
  if (state.backendPreference === "kitten") {
    return new KittenWasm(ttsCallbacks(), { model: state.kittenModel, dtype: state.kittenDtype });
  }
  if (state.backendPreference === "kokoro") {
    const opts = { dtype: state.kokoroDtype, voice: state.neuralVoice };
    // Explicit device saved as hearwiki:kokoro-device (wasm/webgpu). WebGPU is
    // crash-prone on Android and iOS, so respect the explicit value and only
    // probe when the listener chose WebGPU – never benchmark automatically.
    if (state.kokoroDevice === "webgpu") {
      if (!supportsWebGPU()) {
        console.warn("[Hear TTS] WebGPU not supported, falling back to WASM");
        return new KokoroWasm(ttsCallbacks(), opts);
      }
      const probe = await probeKokoroWebGpu();
      if (probe.ok) return probe.backend || new KokoroWebGPU(ttsCallbacks(), opts);
      console.warn("[Hear TTS] Kokoro WebGPU probe failed – using WASM fallback");
      return new KokoroWasm(ttsCallbacks(), opts);
    }
    return new KokoroWasm(ttsCallbacks(), opts);
  }
  return null;
}

async function resetNeuralWorker(error = new Error("The local voice engine was reset.")) {
  state.neuralReady = false;
  const backend = state.ttsBackend;
  state.ttsBackend = null;
  state.activeBackendId = null;
  state.neuralWorkerPromise = null;
  await backend?.dispose();
  hideNeuralLoading();
  if (error.name !== "BackendRestartError") console.info("[Hear TTS] worker restart", error.message);
}

function fatalError(error) {
  error.fatal = error.name !== "BackendRestartError";
  return error;
}

async function ensureNeuralWorker() {
  if (state.ttsBackend) {
    const backend = state.ttsBackend;
    try {
      await backend.load();
      return backend;
    } catch (error) {
      if (state.ttsBackend === backend) {
        state.ttsBackend = null;
        state.activeBackendId = null;
        state.neuralReady = false;
      }
      backend.dispose();
      throw fatalError(error);
    }
  }
  if (state.neuralWorkerPromise) return state.neuralWorkerPromise;
  const pending = (async () => {
    setNeuralLoading(null, `Starting ${engineLabel(null)} · ${state.backendPreference}`, `Starting ${engineLabel(null)}…`);
    const backend = await createSelectedBackend();
    if (!backend) return null;
    state.ttsBackend = backend;
    state.activeBackendId = backend.id;
    try {
      await backend.load();
    } catch (error) {
      if (state.ttsBackend === backend) {
        state.ttsBackend = null;
        state.activeBackendId = null;
      }
      await backend.dispose();
      hideNeuralLoading();
      throw fatalError(error);
    }
    if (state.ttsBackend !== backend) {
      const error = new Error("The voice engine was restarted.");
      error.name = "BackendRestartError";
      throw error;
    }
    state.neuralReady = true;
    hideNeuralLoading();
    updateEngineUI();
    return backend;
  })();
  state.neuralWorkerPromise = pending;
  try {
    return await pending;
  } finally {
    if (state.neuralWorkerPromise === pending) state.neuralWorkerPromise = null;
  }
}

function selectedNeuralCacheConfig() {
  if (state.ttsBackend) {
    return {
      identity: state.ttsBackend.cacheIdentity,
      voice: state.ttsBackend.id === "kitten-wasm" ? state.kittenVoice : state.neuralVoice,
    };
  }
  if (state.backendPreference === "kitten") {
    return {
      identity: { model: `${state.kittenModel}@0.8`, dtype: state.kittenDtype },
      voice: state.kittenVoice,
    };
  }
  return {
    identity: {
      model: `${KOKORO_MODEL}@1.0`,
      dtype: state.kokoroDevice === "webgpu" ? "fp32" : state.kokoroDtype,
    },
    voice: state.neuralVoice,
  };
}

function neuralIdentity() {
  const { identity, voice } = selectedNeuralCacheConfig();
  return { model: identity.model, dtype: identity.dtype, voice };
}

// Adapters between the playback engine and Hear's workers and caches.
function createNeuralPlayer() {
  return new NeuralPlayer({
    audio: elements.mediaAudio,
    engine: {
      identity: neuralIdentity,
      ready: () => Boolean(state.ttsBackend && state.neuralReady),
      async synthesize(text, identity) {
        const backend = await ensureNeuralWorker();
        if (!backend) throw fatalError(new Error("The natural voice is unavailable in this browser."));
        try {
          const result = await backend.synthesize(text, { voice: identity.voice, speed: 1 });
          const actual = neuralIdentity();
          const same = actual.model === identity.model && actual.dtype === identity.dtype && actual.voice === identity.voice;
          return { ...result, identity: same ? identity : actual };
        } catch (error) {
          // A hung worker cannot be interrupted; start a fresh one for the retry.
          if (error.name === "TimeoutError") await resetNeuralWorker(error).catch(() => {});
          throw error;
        }
      },
    },
    cache: {
      key: (text, identity) => createAudioCacheKey({ text, model: identity.model, voice: identity.voice, speed: 1, dtype: identity.dtype }),
      async get(key) {
        const entry = await getCachedAudio(key);
        if (entry?.buffer) return entry.buffer;
        return entry?.blob ? entry.blob.arrayBuffer() : null;
      },
      put: (key, buffer, duration) => putCachedAudio({ key, blob: new Blob([buffer], { type: "audio/wav" }), duration }),
    },
    callbacks: {
      onState: handleNeuralState,
      onPosition: handleNeuralPosition,
      onEnded: finishPlayback,
      onError: handleNeuralError,
      onSkipped(index, error) {
        console.warn("[Hear TTS] skipped passage", index, error);
        showToast("Skipped a passage the voice couldn’t read.");
      },
    },
  });
}

function handleNeuralState(mode, detail = {}) {
  if (state.engine !== "neural" && detail.reason !== "preview") return;
  if (mode === "buffering") {
    setPlaybackState("buffering", detail.reason === "preview"
      ? "Preparing a preview…"
      : state.neuralReady ? `Preparing the next passage · ${engineLabel()}` : `Starting ${engineLabel(null)}…`);
    return;
  }
  if (mode === "playing") {
    setPlaybackState("playing");
    updateActiveBlock(state.chunks[state.currentIndex]);
    return;
  }
  if (mode === "paused") {
    setPlaybackState("paused");
    updateActiveBlock(state.chunks[state.currentIndex]);
    savePosition();
    return;
  }
  if (mode === "error") {
    hideNeuralLoading();
    setPlaybackState("error", "The voice stopped · press play to retry");
  }
}

function handleNeuralPosition(word) {
  if (state.engine !== "neural") return;
  const chunkIndex = chunkIndexForWord(word);
  if (chunkIndex !== state.currentIndex) {
    state.currentIndex = chunkIndex;
    updateActiveBlock(state.chunks[chunkIndex]);
  }
  updateProgress(word);
  const now = Date.now();
  if (!state.lastAudioSave || now - state.lastAudioSave > 5000) {
    state.lastAudioSave = now;
    savePosition();
  }
}

function handleNeuralError(error) {
  if (error?.name === "NotAllowedError") {
    showToast("Tap play once more to start audio.");
    return;
  }
  if (error?.name === "TimeoutError") {
    showToast("The natural voice took too long. Press play to retry, or choose the system voice.");
    return;
  }
  const reason = error?.message ? `: ${error.message.slice(0, 120)}` : "";
  showToast(`The natural voice stopped${reason}`);
}

function enableAudioSession() {
  // Safari 17+: play as media (not ambient) so audio continues with the
  // ringer switch off and on the lock screen.
  try {
    if (navigator.audioSession && navigator.audioSession.type !== "playback") navigator.audioSession.type = "playback";
  } catch {}
}

function neuralConsentKey() {
  const details = getModelDownloadDetails({
    backend: state.backendPreference,
    kokoroDevice: state.kokoroDevice,
    kokoroDtype: state.kokoroDtype,
    kittenModel: state.kittenModel,
  });
  return `${STORAGE_PREFIX}model-consent:${state.backendPreference}:${details.model}:${details.label}`;
}

// Runs a natural-voice action straight away when the model is already
// allowed, otherwise asks first. Actions call play() synchronously so iOS
// treats them as part of the tap.
function requestNeuralAction(action, { keepSheet = false } = {}) {
  state.pendingNeuralAction = action;
  if (state.neuralReady || localStorage.getItem(neuralConsentKey()) === "true") {
    state.pendingNeuralAction = null;
    if (!keepSheet && elements.voiceSheet.open) elements.voiceSheet.close();
    enableAudioSession();
    action();
    return;
  }
  if (elements.voiceSheet.open) elements.voiceSheet.close();
  updateNeuralDownloadSheet();
  elements.neuralSheet.showModal();
}

function announcePlayerStatus(message, { force = false } = {}) {
  if (!elements.playerAnnouncement || !message || (!force && message === state.lastAnnouncement)) return;
  const now = Date.now();
  if (!force && now - state.lastAnnouncementAt < 5000) return;
  state.lastAnnouncement = message;
  state.lastAnnouncementAt = now;
  elements.playerAnnouncement.textContent = "";
  requestAnimationFrame(() => { elements.playerAnnouncement.textContent = message; });
}

function setPlayerStatus(detail = "", { announce = true } = {}) {
  const chunk = state.chunks[state.currentIndex];
  const section = chunk && chunk.kind !== "title" && chunk.sectionId !== "introduction" ? chunk.section : "";
  const defaultLabel = state.playback === "playing"
    ? section || "Listening"
    : state.playback === "paused"
      ? section ? `Paused · ${section}` : "Paused"
      : state.playback === "buffering"
        ? "Preparing the voice…"
        : state.playback === "ended"
          ? "Finished"
          : state.playback === "error"
            ? "Playback stopped · press play to retry"
            : "Ready to listen";
  const message = detail || defaultLabel;
  elements.nowSection.textContent = message;
  if (announce) announcePlayerStatus(message);
}

function setPlaybackState(nextState, detail = "") {
  const previousState = state.playback;
  state.playback = nextState;
  elements.player.dataset.state = nextState;
  elements.player.setAttribute("aria-busy", String(nextState === "buffering"));
  setPlayerStatus(detail, { announce: previousState === nextState });
  if (previousState !== nextState) announcePlayerStatus(elements.nowSection.textContent, { force: true });
  const playing = nextState === "playing";
  elements.playButton.setAttribute("aria-label", playing ? "Pause" : nextState === "buffering" ? "Cancel voice preparation" : "Play");
  const heroLabel = $("span:last-child", elements.heroPlay);
  heroLabel.textContent = playing
    ? "Pause listening"
    : nextState === "buffering"
      ? "Cancel preparation"
      : nextState === "paused"
        ? "Resume listening"
        : nextState === "error"
          ? "Retry listening"
        : "Start listening";
  if ("mediaSession" in navigator) {
    navigator.mediaSession.playbackState = playing || (nextState === "buffering" && state.engine === "neural")
      ? "playing"
      : nextState === "paused"
        ? "paused"
        : "none";
    elements.mediaAudio.dataset.mediaSessionPlaybackState = navigator.mediaSession.playbackState;
  }
  queueJumpToCurrentVisibility();
}

function applyVoiceToUtterance(utterance) {
  if (state.selectedVoice) utterance.voice = state.selectedVoice;
  utterance.lang = state.selectedVoice?.lang || state.article?.lang || "en-US";
  utterance.rate = state.rate;
  utterance.pitch = 1;
  utterance.volume = 1;
}

function applyMediaPlaybackRate() {
  neuralPlayer.setRate(state.rate);
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
    setPlaybackState("error", "System voice stopped · press play to retry");
    showToast("The voice paused unexpectedly. Press play to continue.");
  };

  synth.speak(utterance);
}

function finishPlayback() {
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
    if (state.playback === "playing" || state.playback === "buffering") {
      // Cancelling during a model download stops the download too.
      const downloading = state.playback === "buffering" && !state.neuralReady;
      neuralPlayer.pause();
      savePosition();
      if (downloading) resetNeuralWorker(new Error("Voice preparation cancelled.")).catch(() => {});
      return;
    }
    requestNeuralAction(() => neuralPlayer.play());
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
  neuralPlayer.stop();
  state.currentUtterance = null;
  setPlaybackState(nextState);
}

function seekToIndex(index, preservePlaying = true, targetWord = null) {
  const wasPlaying = state.playback === "playing";
  state.currentIndex = Math.min(Math.max(0, index), Math.max(0, state.chunks.length - 1));
  state.boundaryWords = 0;
  if (state.engine === "neural") {
    const word = targetWord ?? state.chunks[state.currentIndex]?.startWord ?? 0;
    const play = (wasPlaying || state.playback === "buffering") && preservePlaying;
    neuralPlayer.seekToWord(word, { play });
    if (!play && state.playback !== "idle") setPlaybackState("paused");
    updateActiveBlock(state.chunks[state.currentIndex]);
    updateProgress(word);
    savePosition();
    return;
  }
  if (wasPlaying && preservePlaying) {
    startSpeechAt(state.currentIndex);
  } else {
    stopSpeech(state.playback === "idle" ? "idle" : "paused");
    updateActiveBlock(state.chunks[state.currentIndex]);
    updateProgress();
  }
  savePosition();
}

function skipSeconds(seconds) {
  if (!state.chunks.length) return;
  if (state.engine === "neural") {
    neuralPlayer.skip(seconds);
    const word = neuralPlayer.positionWord();
    state.currentIndex = chunkIndexForWord(word);
    updateActiveBlock(state.chunks[state.currentIndex]);
    updateProgress(word);
    savePosition();
    return;
  }
  const deltaWords = (WORDS_PER_MINUTE / 60) * state.rate * seconds;
  const target = Math.min(totalWords() - 1, Math.max(0, currentWordPosition() + deltaWords));
  seekToIndex(chunkIndexForWord(target), true, target);
}

function updateActiveBlock(chunk) {
  if (!chunk) return;
  if (state.playback !== "buffering" && state.playback !== "error") setPlayerStatus();

  if (chunk.blockId && chunk.blockId !== state.activeBlockId) {
    if (state.activeBlockId) document.getElementById(state.activeBlockId)?.classList.remove("is-speaking");
    const block = document.getElementById(chunk.blockId);
    block?.classList.add("is-speaking");
    state.activeBlockId = chunk.blockId;

    $$("a", elements.outlineNav).forEach((link) => {
      link.classList.toggle("active", link.dataset.sectionId === chunk.sectionId);
    });
    $$("button", elements.chapterList).forEach((button) => {
      button.classList.toggle("active", button.dataset.sectionId === chunk.sectionId);
    });

    if (state.follow && block && state.playback === "playing") {
      const rect = block.getBoundingClientRect();
      const safeBottom = window.innerHeight - 150;
      if (rect.top < 100 || rect.bottom > safeBottom) {
        block.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }
  queueJumpToCurrentVisibility();
}

function updateJumpToCurrentVisibility() {
  state.jumpVisibilityFrame = null;
  const block = state.activeBlockId ? document.getElementById(state.activeBlockId) : null;
  const hasCurrentPassage = state.playback === "playing" || state.playback === "paused";
  if (!block || !hasCurrentPassage || elements.reader.hidden || state.jumpReturnTimer) {
    elements.jumpToCurrent.hidden = true;
    return;
  }

  const blockRect = block.getBoundingClientRect();
  const headerBottom = Math.max(0, elements.siteHeader?.getBoundingClientRect().bottom || 0);
  const playerTop = elements.player.hidden ? window.innerHeight : elements.player.getBoundingClientRect().top;
  const visibleTop = headerBottom + 12;
  const visibleBottom = Math.min(window.innerHeight, playerTop) - 12;
  elements.jumpToCurrent.hidden = blockRect.bottom > visibleTop && blockRect.top < visibleBottom;
}

function queueJumpToCurrentVisibility() {
  if (state.jumpVisibilityFrame !== null) return;
  state.jumpVisibilityFrame = requestAnimationFrame(updateJumpToCurrentVisibility);
}

function jumpToCurrentPassage() {
  const block = state.activeBlockId ? document.getElementById(state.activeBlockId) : null;
  if (!block) return;
  elements.jumpToCurrent.hidden = true;
  window.clearTimeout(state.jumpReturnTimer);
  state.jumpReturnTimer = window.setTimeout(() => {
    state.jumpReturnTimer = null;
    queueJumpToCurrentVisibility();
  }, 700);
  block.scrollIntoView({ behavior: "smooth", block: "center" });
  announcePlayerStatus("Returned to the current passage.", { force: true });
}

// Seconds of audio per word at 1×: measured from generated speech when a
// natural voice is playing, otherwise a typical speaking pace.
function secondsPerWord() {
  return (state.engine === "neural" && neuralPlayer.secondsPerWord()) || 60 / WORDS_PER_MINUTE;
}

function updateProgress(previewWord = null) {
  const words = totalWords();
  const position = previewWord ?? currentWordPosition();
  const ratio = Math.min(1, Math.max(0, position / words));
  const value = Math.round(ratio * 1000);
  const pace = secondsPerWord();
  elements.seekRange.value = String(value);
  elements.seekRange.style.setProperty("--range-progress", `${ratio * 100}%`);
  elements.elapsedTime.textContent = formatTime((position * pace) / state.rate);
  elements.totalTime.textContent = formatTime((words * pace) / state.rate);
  updateMediaPosition(position);
}

function updateMediaPosition(positionWords = currentWordPosition()) {
  if (!("mediaSession" in navigator) || !state.article || state.playback === "idle") return;
  const pace = secondsPerWord();
  const duration = totalWords() * pace;
  const position = Math.min(duration - 0.01, Math.max(0, positionWords * pace));
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
  const progress = progressEntries();
  progress[state.article.key] = {
    key: state.article.key,
    index: state.currentIndex,
    word: Math.round(currentWordPosition()),
    totalWords: totalWords(),
    section: state.chunks[state.currentIndex]?.section || "Opening",
    updatedAt: Date.now(),
  };
  localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
  if (document.body.classList.contains("library-open")) updateContinueListening();
}

function restorePosition() {
  let saved = progressFor(state.article.key);
  if (!saved && state.article.kind === "article") {
    const legacy = readStoredJson(`${STORAGE_PREFIX}position`, null);
    if (legacy?.key === `${state.article.lang}:${state.article.title}`) saved = legacy;
  }
  if (saved && Number.isInteger(saved.index) && saved.index < state.chunks.length - 1) {
    const targetWord = Number.isFinite(saved.word) ? saved.word : state.chunks[saved.index]?.startWord;
    state.currentIndex = Math.max(0, chunkIndexForWord(targetWord || 0));
    setPlaybackState(state.currentIndex > 0 ? "paused" : "idle");
    updateActiveBlock(state.chunks[state.currentIndex]);
    return targetWord || 0;
  }
  return 0;
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
    renderChapters(state.article);
  }

  applyMediaPlaybackRate();
  if (state.engine !== "neural" && restartSpeech && state.playback === "playing") {
    startSpeechAt(state.currentIndex);
  } else if (state.engine !== "neural" && restartSpeech && state.playback === "paused") {
    stopSpeech("paused");
  }
}

function activateWork(work, { historyMode = "push" } = {}) {
  // The voice engine stays loaded between works; only playback resets.
  stopSpeech("idle");
  state.article = work;
  state.chunks = createSpeechChunks(work);
  const storedBackend = localStorage.getItem(`${STORAGE_PREFIX}tts-backend`);
  const persisted = storedBackend === "auto" ? "system" : storedBackend;
  state.backendPreference = work.lang.toLowerCase().startsWith("en") ? persisted || "system" : "system";
  state.engine = state.backendPreference === "system" ? "system" : "neural";
  state.currentIndex = 0;
  state.boundaryWords = 0;
  state.activeBlockId = null;
  elements.jumpToCurrent.hidden = true;
  renderArticle(work);
  loadVoices();
  rebuildNeuralSegments(restorePosition());
  updateEngineUI();
  updateMediaMetadata();
  updateProgress();
  rememberWork(work);
  announcePlayerStatus(`${work.title} is ready to listen.`, { force: true });

  elements.player.hidden = false;
  document.body.classList.add("player-visible");
  elements.headerQuery.value = "";
  showReaderView();

  const method = historyMode === "replace" ? "replaceState" : historyMode === "push" ? "pushState" : null;
  if (method) history[method](routeStateForWork(work), "", routeForWork(work, location.pathname));

  if (state.currentIndex > 0) showToast(`Ready to resume ${work.title}`);
}

async function loadArticle(rawInput, {
  historyMode = "push",
  originalSourceUrl = "",
  provenanceLabel = "",
} = {}) {
  let parsed;
  try {
    parsed = parseArticleInput(rawInput);
  } catch (error) {
    showToast(error.message);
    return;
  }

  if (!elements.startView.hidden) {
    setDiscoveryMode("articles", { focus: false });
    elements.catalogQuery.value = rawInput.trim();
  }

  stopSpeech("idle");
  const detail = parsed.type === "web" ? "Fetching the public article" : "Removing citations and references";
  const { controller, requestId } = beginContentTask("Editing for your ears…", detail);

  try {
    const article = parsed.type === "web"
      ? await fetchWebArticle(parsed.url, {
        signal: controller.signal,
        onStatus: (message) => { if (requestId === state.contentRequestId) elements.loadingDetail.textContent = message; },
      })
      : await fetchArticle(parsed.title, parsed.lang, true, { signal: controller.signal });
    if (controller.signal.aborted || requestId !== state.contentRequestId) return;
    if (parsed.type === "web" && originalSourceUrl) {
      article.originalSourceUrl = normalizePublicArticleUrl(originalSourceUrl) || "";
      article.provenanceLabel = cleanText(provenanceLabel);
    }
    await cacheWork(article).catch(() => {});
    activateWork(article, { historyMode });
  } catch (error) {
    if (isAbortError(error)) return;
    const recoverableCodes = new Set(["access-denied", "missing", "non-html", "unavailable", "unreadable", "limited"]);
    if (
      parsed.type === "web"
      && !originalSourceUrl
      && error instanceof ArticleImportError
      && recoverableCodes.has(error.code)
    ) {
      elements.loadingDetail.textContent = "Checking public archives and open-access repositories";
      const alternatives = await fetchRecoveryAlternatives(parsed.url, {
        doi: error.doi || doiFromArticleUrl(parsed.url),
        includeArchive: error.code === "missing" || error.code === "unavailable",
        signal: controller.signal,
      }).catch(() => []);
      if (controller.signal.aborted || requestId !== state.contentRequestId) return;
      if (alternatives.length) {
        showRecoveryOptions(alternatives, parsed.url);
        return;
      }
    }
    showToast(error.message || "I couldn’t prepare that article.");
  } finally {
    finishContentTask(controller, requestId);
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
  const artworkSource = displayImageSource(state.article);
  let metadataArtworkSource = artworkSource;
  try {
    const artworkUrl = new URL(artworkSource, location.href);
    // Media Session does not expose a CORS mode for artwork. WebKit blocks
    // cross-origin artwork under COEP even though the visible <img> uses CORS.
    if (crossOriginIsolated && artworkUrl.origin !== location.origin) metadataArtworkSource = "";
  } catch {
    metadataArtworkSource = "";
  }
  const artwork = metadataArtworkSource
    ? [{ src: metadataArtworkSource }]
    : [];
  navigator.mediaSession.metadata = new MediaMetadata({
    title: state.article.title,
    artist: state.article.author || state.article.sourceLabel || "Hear",
    album: `${state.article.sourceLabel || "Hear"} · listening edition`,
    artwork,
  });
  elements.mediaAudio.dataset.mediaSessionTitle = navigator.mediaSession.metadata?.title || "";
}

function initMediaSession() {
  if (!("mediaSession" in navigator)) return;
  try {
    // Act on the requested state rather than toggling: after an interruption
    // iOS can send "play" while Hear still considers itself playing.
    const active = () => state.playback === "playing" || state.playback === "buffering";
    navigator.mediaSession.setActionHandler("play", () => { if (!active()) togglePlayback(); });
    navigator.mediaSession.setActionHandler("pause", () => { if (active()) togglePlayback(); });
    navigator.mediaSession.setActionHandler("seekbackward", (details) => skipSeconds(-(details.seekOffset || 15)));
    navigator.mediaSession.setActionHandler("seekforward", (details) => skipSeconds(details.seekOffset || 15));
    navigator.mediaSession.setActionHandler("seekto", (details) => {
      if (!Number.isFinite(details.seekTime)) return;
      const targetWord = Math.min(totalWords() - 1, Math.max(0, details.seekTime / secondsPerWord()));
      seekToIndex(chunkIndexForWord(targetWord), true, targetWord);
    });
    navigator.mediaSession.setActionHandler("stop", () => {
      stopSpeech("paused");
      state.currentIndex = 0;
      neuralPlayer.seekToWord(0, { play: false });
      updateProgress();
    });
  } catch {
    // Some Safari versions expose Media Session without every action.
  }
}

async function selectModelChoice(choiceId) {
  const choice = SPEECH_MODEL_CHOICES.find((item) => item.id === choiceId);
  if (!choice) return;
  if (choice.backend !== "system" && !naturalVoiceAvailable()) {
    showToast("Natural voice currently supports English works.");
    return;
  }
  if (choice.device === "webgpu" && !supportsWebGPU()) {
    showToast("WebGPU is not available in this browser.");
    return;
  }
  if (choice.device === "webgpu" && IS_ANDROID && !confirm("WebGPU is known to crash the stress harness on some Android devices. Continue with WebGPU?")) return;
  if (choice.id === selectedModelChoiceId()) return;

  const wasPlaying = state.playback === "playing" || state.playback === "buffering";
  const targetWord = currentWordPosition();
  const targetIndex = chunkIndexForWord(targetWord);
  stopSpeech(state.playback === "idle" ? "idle" : "paused");
  await resetNeuralWorker(new Error("Playback model changed."));
  state.backendPreference = choice.backend;
  state.engine = choice.backend === "system" ? "system" : "neural";
  localStorage.setItem(`${STORAGE_PREFIX}tts-backend`, choice.backend);
  if (choice.backend === "kitten") {
    state.kittenModel = choice.model;
    state.kittenDtype = choice.dtype;
    localStorage.setItem(`${STORAGE_PREFIX}kitten-model`, choice.model);
    localStorage.setItem(`${STORAGE_PREFIX}kitten-dtype`, choice.dtype);
  } else if (choice.backend === "kokoro") {
    state.kokoroDevice = choice.device;
    state.kokoroDtype = choice.dtype;
    localStorage.setItem(`${STORAGE_PREFIX}kokoro-device`, choice.device);
    localStorage.setItem(`${STORAGE_PREFIX}kokoro-dtype`, choice.dtype);
  }
  state.currentIndex = targetIndex;
  rebuildNeuralSegments(targetWord);
  updateEngineUI();
  updateActiveBlock(state.chunks[targetIndex]);
  updateProgress(targetWord);

  if (wasPlaying) {
    if (state.engine === "neural") requestNeuralAction(() => neuralPlayer.play(), { keepSheet: true });
    else startSpeechAt(targetIndex);
  }
}

function previewSystemVoice() {
  if (!supportsSpeech) return;
  neuralPlayer.stop();
  const wasPlaying = state.playback === "playing";
  if (wasPlaying) {
    state.runId += 1;
    synth.cancel();
    setPlaybackState("paused");
  } else {
    synth.cancel();
  }
  if (synth.paused) synth.resume();
  const utterance = new SpeechSynthesisUtterance("A good book should sound as considered as it reads.");
  applyVoiceToUtterance(utterance);
  synth.speak(utterance);
}

function previewNaturalVoice() {
  requestNeuralAction(() => {
    state.runId += 1;
    if (supportsSpeech) synth.cancel();
    neuralPlayer.preview("A good book should sound as considered as it reads.");
  }, { keepSheet: true });
}

elements.brandLink.addEventListener("click", (event) => {
  event.preventDefault();
  navigateToLibrary();
});
elements.libraryButton.addEventListener("click", () => navigateToLibrary());
elements.nowPlayingButton.addEventListener("click", () => {
  showReaderView();
  if (state.article) history.pushState(routeStateForWork(state.article), "", routeForWork(state.article, location.pathname));
});
elements.importButton.addEventListener("click", () => elements.documentInput.click());
elements.documentInput.addEventListener("change", () => importDocument(elements.documentInput.files?.[0]));
elements.chaptersButton.addEventListener("click", () => elements.chaptersSheet.showModal());

elements.catalogSearch.addEventListener("submit", (event) => {
  event.preventDefault();
  if (state.discoveryMode === "articles") {
    handleArticleInput(elements.catalogQuery.value);
    return;
  }
  state.catalogQuery = elements.catalogQuery.value;
  state.catalogTopic = "";
  if (state.catalogSource === "saved") state.catalogSource = "all";
  $$('button[data-source]', elements.sourceSwitcher).forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.source === state.catalogSource));
  });
  $$('button[data-topic]', elements.catalogTopics).forEach((button) => button.setAttribute("aria-pressed", "false"));
  loadCatalog();
  elements.catalogTitle.scrollIntoView({ behavior: "smooth", block: "start" });
});

elements.searchModes.forEach((button) => {
  button.addEventListener("click", () => setDiscoveryMode(button.dataset.searchMode));
  button.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    setDiscoveryMode(button.dataset.searchMode === "books" ? "articles" : "books");
  });
});

$$('button[data-source]', elements.sourceSwitcher).forEach((button) => {
  button.addEventListener("click", () => {
    setDiscoveryMode("books", { focus: false, refresh: false });
    chooseCatalogSource(button.dataset.source);
  });
});

$$('button[data-topic]', elements.catalogTopics).forEach((button) => {
  button.addEventListener("click", () => {
    setDiscoveryMode("books", { focus: false, refresh: false });
    state.catalogQuery = "";
    state.catalogTopic = button.dataset.topic;
    elements.catalogQuery.value = "";
    if (state.catalogSource === "saved") state.catalogSource = "all";
    $$('button[data-topic]', elements.catalogTopics).forEach((topic) => {
      topic.setAttribute("aria-pressed", String(topic === button));
    });
    $$('button[data-source]', elements.sourceSwitcher).forEach((source) => {
      source.setAttribute("aria-pressed", String(source.dataset.source === state.catalogSource));
    });
    loadCatalog();
  });
});

elements.loadMore.addEventListener("click", () => {
  state.catalogPage += 1;
  loadCatalog({ append: true });
});

elements.headerSearch.addEventListener("submit", (event) => {
  event.preventDefault();
  handleArticleInput(elements.headerQuery.value, { fromHeader: true });
});

$$('[data-article]').forEach((button) => {
  button.addEventListener("click", () => loadArticle(button.dataset.article));
});

elements.playButton.addEventListener("click", togglePlayback);
elements.heroPlay.addEventListener("click", togglePlayback);
elements.restartButton.addEventListener("click", () => {
  if (state.engine === "neural") requestNeuralAction(() => neuralPlayer.seekToWord(0, { play: true }));
  else startSpeechAt(0);
});
elements.backButton.addEventListener("click", () => skipSeconds(-15));
elements.forwardButton.addEventListener("click", () => skipSeconds(15));
elements.jumpToCurrent.addEventListener("click", jumpToCurrentPassage);
window.addEventListener("scroll", queueJumpToCurrentVisibility, { passive: true });
window.addEventListener("resize", queueJumpToCurrentVisibility, { passive: true });

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

elements.voiceButton.addEventListener("click", () => {
  elements.voiceSheet.showModal();
  refreshSavedModels();
});
elements.engineOptions.addEventListener("click", (event) => {
  const button = event.target.closest("[data-engine]");
  if (button && !button.disabled) selectModelChoice(engineChoiceId(button.dataset.engine));
});
elements.modelOptions.addEventListener("click", (event) => {
  const button = event.target.closest("[data-model-choice]");
  if (button && !button.disabled) selectModelChoice(button.dataset.modelChoice);
});
elements.naturalVoiceSelect.addEventListener("change", () => {
  state.neuralVoice = elements.naturalVoiceSelect.value;
  localStorage.setItem(`${STORAGE_PREFIX}neural-voice`, state.neuralVoice);
  state.ttsBackend?.prefetchVoice(state.neuralVoice);
  neuralPlayer.invalidate();
  updateEngineUI();
});
if (elements.kittenVoiceSelect) {
  elements.kittenVoiceSelect.addEventListener("change", () => {
    const next = elements.kittenVoiceSelect.value;
    if (!KITTEN_VOICES.includes(next) || next === state.kittenVoice) return;
    state.kittenVoice = next;
    localStorage.setItem(`${STORAGE_PREFIX}kitten-voice`, next);
    neuralPlayer.invalidate();
    updateEngineUI();
  });
}
if (elements.clearAudioCache) elements.clearAudioCache.addEventListener("click", handleClearAudioCache);
if (elements.clearAllData) elements.clearAllData.addEventListener("click", handleClearAllData);
if (elements.refreshModelCache) elements.refreshModelCache.addEventListener("click", refreshModelCacheUI);
if (elements.clearModelCache) elements.clearModelCache.addEventListener("click", handleClearModelCache);
elements.advancedSettingsButton.addEventListener("click", () => {
  elements.voiceSheet.close();
  elements.advancedSheet.showModal();
  refreshStorageLabel();
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
  localStorage.setItem(neuralConsentKey(), "true");
  if (elements.voiceSheet.open) elements.voiceSheet.close();
  elements.neuralSheet.close();
  enableAudioSession();
  action?.();
});

elements.mediaAudio.addEventListener("loadedmetadata", applyMediaPlaybackRate);

elements.loadingCancel.addEventListener("click", () => {
  state.contentAbortController?.abort();
  state.contentAbortController = null;
  state.contentRequestId += 1;
  hideLoading();
  showToast("Opening cancelled");
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
  const shareData = {
    title: `${state.article.title} — Hear`,
    url: state.article.source === "local" ? location.origin + location.pathname : location.href,
  };
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
  if (
    isTyping || !state.article || elements.voiceSheet.open || elements.advancedSheet.open || elements.setupSheet.open ||
    elements.neuralSheet.open || elements.chaptersSheet.open
  ) return;
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
markInterruptedWebGpuProbe();
console.log({
  crossOriginIsolated,
  sharedArrayBuffer: typeof SharedArrayBuffer !== "undefined",
  cores: navigator.hardwareConcurrency,
});
document.documentElement.dataset.crossOriginIsolated = String(crossOriginIsolated);
document.documentElement.dataset.sharedArrayBuffer = String(typeof SharedArrayBuffer !== "undefined");
document.documentElement.dataset.hardwareConcurrency = String(navigator.hardwareConcurrency || "");
requestPersistentStorage().then((persisted) => console.info("[Hear TTS] persistent storage", { persisted }));
elements.followToggle.checked = state.follow;
setBookmarklet();
loadVoices();
initMediaSession();
elements.libraryButton.hidden = true;
setDiscoveryMode("books", { focus: false });
updateContinueListening();

async function resolveCurrentRoute({ historyMode = "none", routeState = history.state } = {}) {
  if (routeState?.view === "library") {
    navigateToLibrary({ historyMode, scrollTop: false });
    return;
  }

  if (routeState?.work) {
    if (state.article?.key === routeState.work) {
      showReaderView({ scrollTop: false });
      return;
    }
    const cached = await getCachedWork(routeState.work).catch(() => null);
    if (cached) {
      activateWork(cached, { historyMode });
      return;
    }
  }

  const params = new URLSearchParams(location.search);
  const input = params.get("url") || (
    params.get("title")
      ? `${safeLanguage(params.get("lang") || "en")}:${params.get("title")}`
      : ""
  );
  const source = params.get("source");
  const book = params.get("book");
  if (input) {
    await loadArticle(input, { historyMode });
    return;
  }
  if (source === "standard" && book) {
    const cached = await getCachedWork(`standard:${book}`).catch(() => null);
    if (cached) activateWork(cached, { historyMode });
    else await loadCatalogItem({
      id: `standard:${book}`,
      source: "standard",
      sourceLabel: "Standard Ebooks",
      title: book.replaceAll("-", " "),
      author: "Standard Ebooks",
      description: "A carefully produced public-domain edition.",
      sourceUrl: `https://standardebooks.org/ebooks/${book}`,
    }, { historyMode });
    return;
  }
  if (source === "gutenberg" && /^\d+$/.test(book || "")) {
    const item = {
      id: `gutenberg:${book}`,
      gutenbergId: book,
      source: "gutenberg",
      sourceLabel: "Project Gutenberg",
      title: `Project Gutenberg #${book}`,
      author: "Project Gutenberg",
      description: "A public-domain edition from Project Gutenberg.",
      sourceUrl: `https://www.gutenberg.org/ebooks/${book}`,
    };
    const cached = await getCachedWork(item.id).catch(() => null);
    if (cached) activateWork(cached, { historyMode });
    else await loadCatalogItem(item, { historyMode });
    return;
  }
  navigateToLibrary({ historyMode, scrollTop: false });
}

window.addEventListener("popstate", (event) => {
  resolveCurrentRoute({ historyMode: "none", routeState: event.state });
});

resolveCurrentRoute({ historyMode: "replace" });
registerHearServiceWorker(() => showToast("A Hear update is ready for your next visit."));
