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
  SPEECH_MODEL_CHOICES,
  formatMegabytes,
  getModelDownloadDetails,
} from "./app-config.js";
import { parseEpubInWorker } from "./epub-client.js";
import { fetchWithTimeout, isAbortError } from "./fetch-utils.js";
import { libraryRouteState, routeForWork, routeStateForWork } from "./route-utils.js";
import { registerHearServiceWorker } from "./pwa.js";
import { KokoroWebGPU, KokoroWasm, KittenWasm } from "./tts-backends.js";
import { clearTtsCache, createAudioCacheKey, deleteTtsDatabase, getCachedAudio, getTtsCacheStats, putCachedAudio, requestPersistentStorage } from "./tts-cache.js";
import { selectLookaheadSegmentIndices, selectNeuralCacheEvictions, shareInFlight } from "./tts-scheduling.js";
import { clearAllModelCaches, deleteCacheEntry, getModelCacheEntries } from "./model-cache.js";
import { coverProxyPath } from "./cover-policy.js";
import { segmentNarrationSentences } from "./narration-text.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const elements = {
  siteHeader: $(".site-header"),
  startView: $("#start-view"),
  reader: $("#reader"),
  brandLink: $("#brand-link"),
  libraryButton: $("#library-button"),
  importButton: $("#import-button"),
  importInlineButton: $("#import-inline-button"),
  epubInput: $("#epub-input"),
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
  catalogEyebrow: $("#catalog-eyebrow"),
  catalogTitle: $("#catalog-title"),
  catalogStatus: $("#catalog-status"),
  bookGrid: $("#book-grid"),
  loadMore: $("#load-more"),
  continueListening: $("#continue-listening"),
  continueButton: $("#continue-button"),
  continueTitle: $("#continue-title"),
  continueAuthor: $("#continue-author"),
  continueCover: $("#continue-cover"),
  continueImage: $("#continue-image"),
  continueProgress: $("#continue-progress"),
  continueLabel: $("#continue-label"),
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
  outlineLabel: $("#outline-label"),
  endLabel: $("#end-label"),
  readingNoteText: $("#reading-note-text"),
  imageWrap: $("#article-image-wrap"),
  articleImage: $("#article-image"),
  articlePlaceholder: $("#article-placeholder"),
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
  bookmarkletLink: $("#bookmarklet-link"),
  copyBookmarklet: $("#copy-bookmarklet"),
  shareButton: $("#share-button"),
  loadingView: $("#loading-view"),
  loadingTitle: $("#loading-title"),
  loadingDetail: $("#loading-detail"),
  loadingProgress: $("#loading-progress"),
  loadingCancel: $("#loading-cancel"),
  toast: $("#toast"),
};

const synth = window.speechSynthesis;
const supportsSpeech = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
const WORDS_PER_MINUTE = 185;
const STORAGE_PREFIX = "hearwiki:";
const LIBRARY_KEY = `${STORAGE_PREFIX}library-v2`;
const PROGRESS_KEY = `${STORAGE_PREFIX}progress-v2`;
const TTS_APP_VERSION = "2026.08.06";
const NATURAL_VOICES = {
  af_heart: { name: "Heart", note: "Warm, balanced American voice · the strongest all-round choice" },
  af_bella: { name: "Bella", note: "Lively American voice · more expressive and animated" },
  bf_emma: { name: "Emma", note: "Composed British voice · calm for long-form listening" },
  bm_fable: { name: "Fable", note: "Characterful British voice · suited to storytelling" },
  am_michael: { name: "Michael", note: "Grounded American voice · steady, lower narration" },
};
const AUDIO_LOAD_TIMEOUT_MS = 15_000;
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
const KOKORO_DTYPE_DEFAULT = "q8";
// Migration: older installs may have stored q8f16/uint8f16 which transformers rejects (Invalid dtype)
if (rawKokoroDtype === "q8f16" || rawKokoroDtype === "uint8f16") {
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
  neuralLoadInBackground: false,
  generationEpoch: 0,
  rtfSamples: [],
  bufferFillPromise: null,
  neuralVoice: localStorage.getItem(`${STORAGE_PREFIX}neural-voice`) || "af_heart",
  neuralReady: false,
  neuralCache: new Map(),
  neuralInFlight: new Map(),
  neuralRunId: 0,
  currentSegmentIndex: 0,
  currentAudioUrl: null,
  audioUnlocked: false,
  unlockAudioUrl: null,
  pendingNeuralAction: null,
  mediaSwitching: false,
  lastAudioSave: 0,
  neuralAdvanceTimer: null,
  pendingSegmentIndex: null,
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
    title: work.title,
    author: work.author || (work.kind === "article" ? "Wikipedia" : "Unknown author"),
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
    if (url.hostname === "upload.wikimedia.org") return url.href;
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
    item.kind === "article" ? `Open ${item.title} from Wikipedia` : `Open ${item.title} by ${item.author}`,
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
    ? item.description || "Wikipedia article"
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
  elements.catalogEyebrow.textContent = "Saved on this device";
  elements.catalogTitle.textContent = "My listening library";
  elements.catalogStatus.textContent = entries.length
    ? `${entries.length} ${entries.length === 1 ? "work" : "works"} · progress saved locally`
    : "Your opened books, EPUBs, and articles will appear here.";
  renderCatalogItems(entries, { removable: true });
  elements.loadMore.hidden = true;
}

function interleave(left, right, limit = 16) {
  const result = [];
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length && result.length < limit; index += 1) {
    if (left[index]) result.push(left[index]);
    if (right[index] && result.length < limit) result.push(right[index]);
  }
  return result;
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
  elements.catalogStatus.textContent = "Opening the shelves…";
  elements.loadMore.hidden = true;
  const query = state.catalogQuery.trim();

  try {
    let items;
    if (state.catalogSource === "standard") {
      items = await fetchStandardCatalog({ query, page: state.catalogPage, limit: 15, signal: controller.signal });
    } else if (state.catalogSource === "gutenberg") {
      items = (await fetchGutenbergCatalog({ query, page: state.catalogPage, signal: controller.signal })).slice(0, 15);
    } else {
      const results = await Promise.allSettled([
        fetchStandardCatalog({ query, page: state.catalogPage, limit: 8, signal: controller.signal }),
        fetchGutenbergCatalog({ query, page: state.catalogPage, signal: controller.signal }),
      ]);
      if (results.every((result) => result.status === "rejected")) throw results[0].reason;
      const standard = results[0].status === "fulfilled" ? results[0].value : [];
      const gutenberg = results[1].status === "fulfilled" ? results[1].value : [];
      items = interleave(standard, gutenberg);
    }
    if (requestId !== state.catalogRequestId) return;
    state.catalogItems = append ? [...state.catalogItems, ...items] : items;
    renderCatalogItems(items, { append });
    elements.catalogEyebrow.textContent = query ? "Search results" : "Open shelves";
    elements.catalogTitle.textContent = query ? `Books for “${query}”` : "Books worth hearing";
    elements.catalogStatus.textContent = items.length
      ? `${append ? "More from" : "Browse"} ${state.catalogSource === "all" ? "Standard Ebooks and Project Gutenberg" : items[0]?.sourceLabel}`
      : "No matching books were found. Try a title, author, or broader subject.";
    elements.loadMore.hidden = items.length < 10;
  } catch (error) {
    if (requestId !== state.catalogRequestId) return;
    if (isAbortError(error)) return;
    elements.catalogStatus.textContent = error.message || "The public libraries could not be reached.";
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
  const nextMode = mode === "wikipedia" ? "wikipedia" : "books";
  const changed = state.discoveryMode !== nextMode;
  state.discoveryMode = nextMode;
  const isWikipedia = state.discoveryMode === "wikipedia";
  elements.searchModes.forEach((button) => {
    const selected = button.dataset.searchMode === state.discoveryMode;
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
  elements.catalogSearchLabel.textContent = isWikipedia ? "Search or open Wikipedia" : "Search public-domain books";
  elements.catalogQuery.placeholder = isWikipedia ? "Search Wikipedia or paste an article link" : "Title, author, or subject";
  elements.catalogSubmit.setAttribute("aria-label", isWikipedia ? "Search Wikipedia" : "Search public-domain books");
  elements.catalogSubmitLabel.textContent = isWikipedia ? "Search Wikipedia" : "Search books";
  elements.discoveryHint.textContent = isWikipedia
    ? "Search by topic, then choose the article you want to hear."
    : "Search Standard Ebooks and Project Gutenberg.";
  elements.importInlineButton.hidden = isWikipedia;
  elements.setupButton.hidden = !isWikipedia;
  elements.catalogControls.hidden = isWikipedia;
  if (changed && isWikipedia) {
    state.catalogAbortController?.abort();
    state.catalogItems = [];
    elements.bookGrid.replaceChildren();
    elements.catalogEyebrow.textContent = "Wikipedia";
    elements.catalogTitle.textContent = "Find an article to hear";
    elements.catalogStatus.textContent = "Enter a person, place, event, or idea above.";
    elements.loadMore.hidden = true;
  } else if (changed && refresh) {
    loadCatalog();
  }
  if (focus) elements.catalogQuery.focus();
}

function updateContinueListening() {
  const progress = Object.values(progressEntries()).sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const entry = progress && libraryEntries().find((item) => item.key === progress.key);
  elements.savedCount.textContent = String(libraryEntries().length);
  if (!progress || !entry) {
    elements.continueListening.hidden = true;
    return;
  }
  elements.continueListening.hidden = false;
  elements.continueButton.dataset.key = entry.key;
  elements.continueTitle.textContent = entry.title;
  elements.continueAuthor.textContent = entry.author;
  const ratio = progress.totalWords ? Math.min(1, progress.word / progress.totalWords) : 0;
  elements.continueProgress.style.width = `${ratio * 100}%`;
  elements.continueLabel.textContent = `${Math.round(ratio * 100)}% listened · resume`;
  const fallback = $("i", elements.continueCover);
  const imageSource = displayImageSource(entry);
  if (imageSource) {
    elements.continueImage.src = imageSource;
    elements.continueImage.hidden = false;
    fallback.hidden = true;
  } else {
    elements.continueImage.removeAttribute("src");
    elements.continueImage.hidden = true;
    fallback.hidden = false;
    fallback.textContent = entry.title[0]?.toUpperCase() || "H";
    cachedCoverFor(entry).then((image) => {
      if (!image || elements.continueButton.dataset.key !== entry.key) return;
      const source = displayImageSource({ ...entry, image });
      if (!source) return;
      elements.continueImage.src = source;
      elements.continueImage.hidden = false;
      fallback.hidden = true;
    });
  }
}

function showContinueCoverFallback() {
  const entry = libraryEntries().find((item) => item.key === elements.continueButton.dataset.key);
  elements.continueImage.hidden = true;
  const fallback = $("i", elements.continueCover);
  fallback.hidden = false;
  fallback.textContent = entry?.title?.[0]?.toUpperCase() || "H";
}

function showArticleImageFallback() {
  elements.imageWrap.hidden = true;
  elements.articlePlaceholder.hidden = false;
  elements.articlePlaceholder.querySelector("span").textContent = state.article?.title?.[0]?.toUpperCase() || "H";
}

function showMiniCoverFallback() {
  elements.miniCoverImage.hidden = true;
  const fallback = $("span", elements.miniCover);
  fallback.hidden = false;
  fallback.textContent = state.article?.title?.[0]?.toUpperCase() || "H";
}

elements.continueImage.addEventListener("error", showContinueCoverFallback);
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
  elements.loadingProgress.hidden = true;
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
    loadArticle(`${item.lang || "en"}:${item.title}`, options);
    return;
  }
  if (item.source === "local") {
    showToast("This EPUB is no longer in browser storage. Import the file again.");
    return;
  }
  loadCatalogItem(item.catalogItem || item, options);
}

async function loadCatalogItem(item, { historyMode = "push" } = {}) {
  stopSpeech("idle");
  clearNeuralCache();
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
    elements.epubInput.value = "";
    finishContentTask(controller, requestId);
  }
}

function cleanText(value) {
  return value
    .replace(/\[[\d\s,–—-]+\]/g, "")
    .replace(/\[(?:citation needed|clarification needed|when\?|where\?|who\?)\]/gi, "")
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
  return text.match(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu)?.length || 1;
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
  elements.catalogEyebrow.textContent = `${safeLanguage(parsed.lang).toUpperCase()} Wikipedia`;
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

function handleWikipediaInput(rawInput, { fromHeader = false } = {}) {
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
    setDiscoveryMode("wikipedia", { focus: false });
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

  addChunk(article.title, null);
  for (const block of article.blocks) {
    if (block.type === "h2" || block.type === "h3") {
      addChunk(`${block.text}.`, block);
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

function createNeuralSegments(chunks, { sentenceBoundaries = false } = {}) {
  const segments = [];
  let current = null;

  const commit = () => {
    if (!current) return;
    current.text = current.text.trim();
    current.wordCount = current.endWord - current.startWord;
    segments.push(current);
    current = null;
  };

  const append = (text, chunk, chunkIndex, startWord) => {
    const pieceWords = wordCount(text);
    if (!current) {
      current = {
        text: "",
        startChunk: chunkIndex,
        endChunk: chunkIndex + 1,
        startWord,
        endWord: startWord,
        wordCount: 0,
        blockId: chunk.blockId,
        endBlockId: chunk.blockId,
        section: chunk.section,
        sectionId: chunk.sectionId,
        endsSentence: false,
      };
    }
    current.text += `${current.text ? " " : ""}${text}`;
    current.endChunk = chunkIndex + 1;
    current.endWord = startWord + pieceWords;
    current.endBlockId = chunk.blockId;
    current.endsSentence = /[.!?](?:[”’"']+)?$/.test(text.trim());
  };

  chunks.forEach((chunk, chunkIndex) => {
    // Force a segment break at explicit line breaks so Kitten inserts inter-segment silence instead of same-breath concatenation
    if (chunk.lineBreak && current) {
      commit();
    }
    // Respect paragraph boundaries — don't tack next block's first sentence onto previous paragraph's tail unless current is still very short
    if (current && chunk.blockId !== current.blockId && current.text.length >= 80) {
      // Commit at blockId change to avoid “tacked on” quoted dialogue from next <p> (e.g. “…to bed.” + “Would not a story…?”)
      commit();
    }
    let remaining = chunk.text.trim();
    let remainingStartWord = chunk.startWord;
    while (remaining) {
      const isFirst = segments.length === 0;
      const minCharacters = isFirst ? 80 : 200;
      const maxCharacters = isFirst ? 120 : 350;
      const separatorLength = current?.text ? 1 : 0;
      const available = maxCharacters - (current?.text.length || 0) - separatorLength;

      if (remaining.length <= available) {
        append(remaining, chunk, chunkIndex, remainingStartWord);
        remaining = "";
        continue;
      }

      if (current?.text.length >= minCharacters || available < 24) {
        commit();
        continue;
      }

      // Be smart: never start next segment mid-sentence. Keep whole chunk intact and move it to next segment.
      // Only slice inside chunk if chunk itself exceeds maxCharacters (long sentence already split by splitLongText, but guard anyway).
      if (remaining.length > maxCharacters) {
        let cut = remaining.lastIndexOf(" ", maxCharacters);
        if (cut < Math.max(24, maxCharacters - 45)) cut = remaining.indexOf(" ", maxCharacters);
        if (cut < 0) cut = Math.min(maxCharacters, remaining.length);
        const piece = remaining.slice(0, cut).trim();
        if (!piece) {
          commit();
          continue;
        }
        append(piece, chunk, chunkIndex, remainingStartWord);
        remainingStartWord += wordCount(piece);
        remaining = remaining.slice(cut).trim();
        commit();
      } else {
        commit();
      }
    }
    // Kitten's small model can run adjacent sentences together even when the
    // punctuation is correct. Give every speech chunk its own generation so
    // each sentence starts with a fresh prosodic context.
    if (sentenceBoundaries && current) commit();
  });

  commit();
  if (sentenceBoundaries) {
    segments.forEach((segment, index) => {
      const next = segments[index + 1];
      segment.pauseAfterMs = !next
        ? 0
        : segment.endBlockId !== next.blockId
          ? 300
          : segment.endsSentence
            ? 180
            : 80;
    });
  }
  return segments;
}

function rebuildNeuralSegments() {
  state.neuralSegments = createNeuralSegments(state.chunks, {
    sentenceBoundaries: state.backendPreference === "kitten",
  });
  state.currentSegmentIndex = neuralSegmentIndexForChunk(state.currentIndex);
}

function neuralSegmentIndexForWord(targetWord) {
  const safeWord = Math.max(0, Number(targetWord) || 0);
  const index = state.neuralSegments.findIndex((segment) => safeWord < segment.endWord);
  return index < 0 ? Math.max(0, state.neuralSegments.length - 1) : index;
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

function showArtworkFallback(article) {
  elements.articleImage.removeAttribute("src");
  elements.imageWrap.hidden = true;
  elements.articlePlaceholder.hidden = false;
  elements.articlePlaceholder.querySelector("span").textContent = article.title[0]?.toUpperCase() || "W";
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
      : `Image from ${article.lang}.wikipedia.org`;
    elements.imageWrap.hidden = false;
    elements.articlePlaceholder.hidden = true;
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
    : `From ${article.lang}.wikipedia.org`;
  elements.sourceLink.hidden = !article.sourceUrl;
  elements.sourceLink.href = article.sourceUrl || "#";
  elements.sourceLink.textContent = article.kind === "book" ? `Edition at ${article.sourceLabel} ↗` : "Original article ↗";
  elements.nowTitle.textContent = article.title;
  elements.outlineLabel.textContent = article.kind === "book" ? "Chapters" : "In this article";
  elements.endLabel.textContent = article.kind === "book" ? "End of the book." : "That’s the clean version.";
  elements.readingNoteText.textContent = article.kind === "book"
    ? "Footnotes, endnotes, navigation, and decorative matter have been left out of narration."
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

function selectedModelChoiceId() {
  if (state.backendPreference === "system") return "system";
  if (state.backendPreference === "kitten") return `kitten:${state.kittenModel}`;
  const dtype = state.kokoroDevice === "webgpu" ? "fp32" : state.kokoroDtype;
  return `kokoro:${state.kokoroDevice}:${dtype}`;
}

function renderModelChoices() {
  if (!elements.modelOptions || elements.modelOptions.childElementCount) return;
  let currentGroup = "";
  const fragment = document.createDocumentFragment();
  for (const choice of SPEECH_MODEL_CHOICES) {
    if (choice.group !== currentGroup) {
      currentGroup = choice.group;
      const heading = document.createElement("p");
      heading.className = "model-group-label";
      heading.textContent = currentGroup;
      fragment.append(heading);
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = "model-option";
    button.dataset.modelChoice = choice.id;
    button.setAttribute("role", "radio");
    button.setAttribute("aria-checked", "false");

    const marker = document.createElement("span");
    marker.className = "model-option-marker";
    marker.setAttribute("aria-hidden", "true");
    const copy = document.createElement("span");
    copy.className = "model-option-copy";
    const name = document.createElement("strong");
    name.textContent = choice.name;
    const detail = document.createElement("small");
    detail.textContent = choice.detail;
    const repository = document.createElement("small");
    repository.className = "model-repository";
    repository.textContent = choice.repository;
    repository.title = choice.repository;
    copy.append(name, detail, repository);

    const facts = document.createElement("span");
    facts.className = "model-option-facts";
    const size = document.createElement("strong");
    size.textContent = choice.sizeMb ? `${choice.estimated ? "~" : ""}${formatMegabytes(choice.sizeMb)}` : "No download";
    const runtime = document.createElement("small");
    runtime.textContent = choice.backend === "system" ? "Native" : `${choice.dtype} · ${choice.device.toUpperCase()}`;
    const availability = document.createElement("small");
    availability.className = "model-availability";
    facts.append(size, runtime, availability);
    button.append(marker, copy, facts);
    fragment.append(button);
  }
  elements.modelOptions.append(fragment);
}

function updateEngineUI() {
  if (!naturalVoiceAvailable() && state.engine === "neural") {
    state.engine = "system";
    state.backendPreference = "system";
  }
  const isNeural = state.engine === "neural";
  renderModelChoices();
  const selectedChoice = selectedModelChoiceId();
  for (const button of elements.modelOptions?.querySelectorAll("[data-model-choice]") || []) {
    const choice = SPEECH_MODEL_CHOICES.find((item) => item.id === button.dataset.modelChoice);
    const webGpuUnavailable = choice?.device === "webgpu" && !supportsWebGPU();
    const unavailable = choice?.backend !== "system" && !naturalVoiceAvailable();
    const selected = choice?.id === selectedChoice;
    button.setAttribute("aria-checked", String(selected));
    button.disabled = webGpuUnavailable || unavailable;
    const availability = button.querySelector(".model-availability");
    if (availability) availability.textContent = webGpuUnavailable ? "Unavailable here" : unavailable ? "English works only" : "";
  }
  // Exact active model label – persisted and crash-safe (includes dtype/model)
  if (elements.activeModelLabel) {
    let label = "";
    if (!isNeural) label = "System voice · instant · no download";
    else if (state.activeBackendId === "kitten-wasm") label = `Kitten ${state.kittenModel.split("/").pop()} · ${state.kittenModel} · ${state.kittenDtype} · WASM`;
    else if (state.activeBackendId === "kokoro-webgpu") label = `${KOKORO_MODEL} · fp32 · WebGPU`;
    else if (state.activeBackendId === "kokoro-wasm") label = `${KOKORO_MODEL} · ${state.kokoroDtype} · WASM`;
    else if (state.backendPreference === "kitten") label = `Kitten ${state.kittenModel.split("/").pop()} · ${state.kittenModel} · ${state.kittenDtype} · WASM · will load on play`;
    else if (state.backendPreference === "kokoro") label = `${KOKORO_MODEL} · ${state.kokoroDevice === "webgpu" ? "fp32" : state.kokoroDtype} · ${state.kokoroDevice === "webgpu" ? "WebGPU" : "WASM"} · will load on play`;
    else label = "System voice · explicit choice saved";
    elements.activeModelLabel.textContent = label;
    elements.activeModelLabel.title = label;
  }
  elements.naturalVoiceRow.hidden = !isNeural || state.backendPreference === "kitten" || state.activeBackendId === "kitten-wasm";
  // Kitten has its own 8-voice picker – show only for Kitten
  if (elements.kittenVoiceRow) {
    elements.kittenVoiceRow.hidden = !isNeural || !(state.backendPreference === "kitten" || state.activeBackendId === "kitten-wasm");
    if (elements.kittenVoiceSelect) elements.kittenVoiceSelect.value = state.kittenVoice;
    if (elements.kittenVoiceTraits) {
      const map = { Bella: "Bella · expr-2-f · warm female", Jasper: "Jasper · expr-2-m · warm male", Luna: "Luna · expr-3-f", Bruno: "Bruno · expr-3-m", Rosie: "Rosie · expr-4-f", Hugo: "Hugo · expr-4-m", Kiki: "Kiki · expr-5-f", Leo: "Leo · expr-5-m" };
      elements.kittenVoiceTraits.textContent = map[state.kittenVoice] || map.Bella;
    }
  }
  elements.systemVoiceRow.hidden = isNeural;
  const backendLabel = state.activeBackendId === "kitten-wasm"
    ? "Efficient · on device"
    : state.activeBackendId === "kokoro-webgpu"
      ? "Natural · WebGPU · on device"
      : state.activeBackendId === "kokoro-wasm"
        ? "Natural · WASM · on device"
        : state.backendPreference === "kitten"
          ? "Efficient · on device"
          : state.backendPreference === "kokoro"
            ? "Natural · on device"
            : "Natural · on device";
  elements.voiceType.textContent = isNeural ? backendLabel : "Instant · system";
  elements.voiceName.textContent = isNeural
    ? state.activeBackendId === "kitten-wasm" || state.backendPreference === "kitten"
      ? state.kittenVoice
      : NATURAL_VOICES[state.neuralVoice]?.name || "Heart"
    : state.selectedVoice?.name || "System voice";
  elements.voiceButton.setAttribute(
    "aria-label",
    `Voice settings, ${isNeural ? `${backendLabel}, ${elements.voiceName.textContent}` : state.selectedVoice?.name || "System voice"}`,
  );
  elements.engineDescription.textContent = naturalVoiceAvailable()
    ? "Every available option, ordered by family and download size. Nothing downloads until Preview or Play."
    : "Natural models are available for English works; the system voice remains instant.";
  elements.voiceNote.textContent = isNeural
    ? `${getModelDownloadDetails({ backend: state.backendPreference, kokoroDevice: state.kokoroDevice, kokoroDtype: state.kokoroDtype, kittenModel: state.kittenModel }).label}. The first play may download ${formatMegabytes(getModelDownloadDetails({ backend: state.backendPreference, kokoroDevice: state.kokoroDevice, kokoroDtype: state.kokoroDtype, kittenModel: state.kittenModel }).sizeMb)}; generated passages stay on this device.`
    : "System voices start instantly (no download). Choose Kitten (15M, fast) or Kokoro (82M, higher fidelity) to save an explicit local model choice.";
  elements.naturalVoiceSelect.value = state.neuralVoice;
  elements.voiceTraits.textContent = NATURAL_VOICES[state.neuralVoice]?.note || NATURAL_VOICES.af_heart.note;
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
    const audio = stats ? `${formatBytes(stats.bytes)} generated audio · ${stats.count} segment${stats.count === 1 ? "" : "s"}` : "Generated-audio size unavailable";
    const browser = estimate?.usage !== undefined && estimate?.quota !== undefined
      ? `browser storage ${formatBytes(estimate.usage)} of ${formatBytes(estimate.quota)}`
      : "browser quota unavailable";
    elements.storageUsageLabel.textContent = `${audio} · ${browser}`;
    if (elements.storageNote) elements.storageNote.textContent = `No text or audio is sent to a server. Generated audio is capped at 256 MB and least-recently-used passages are removed first. “Clear all” also removes voice choices, library, progress, and saved models.`;
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
  elements.neuralDownloadSize.textContent = String(details.sizeMb);
  elements.neuralDownloadUnit.textContent = details.estimated ? "MB estimate" : "MB once";
  elements.neuralDownloadModel.textContent = `${details.label}. Downloaded only after you confirm; synthesis remains on this device.`;
  elements.neuralDownloadStorage.textContent = "Checking available browser storage…";
  try {
    const estimate = await navigator.storage?.estimate?.();
    if (estimate?.quota !== undefined && estimate?.usage !== undefined) {
      elements.neuralDownloadStorage.textContent = `${formatBytes(Math.max(0, estimate.quota - estimate.usage))} currently available in this browser.`;
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
    list.replaceChildren(Object.assign(document.createElement("span"), { className: "model-cache-empty", textContent: "CacheStorage not available in this browser." }));
    if (totalEl) totalEl.textContent = "—";
    if (clearBtn) clearBtn.disabled = true;
    return;
  }
  list.replaceChildren(Object.assign(document.createElement("span"), { className: "model-cache-empty", textContent: "Checking…" }));
  try {
    const { available, entries, totalFormatted } = await getModelCacheEntries();
    if (!available) {
      list.replaceChildren(Object.assign(document.createElement("span"), { className: "model-cache-empty", textContent: "CacheStorage not available." }));
      if (totalEl) totalEl.textContent = "—";
      return;
    }
    if (totalEl) totalEl.textContent = entries.length ? `${entries.length} file${entries.length === 1 ? "" : "s"} · ${totalFormatted}` : "0 files";
    if (clearBtn) clearBtn.disabled = entries.length === 0;
    if (!entries.length) {
      list.replaceChildren(Object.assign(document.createElement("span"), { className: "model-cache-empty", textContent: "No saved models yet — pick Kitten or Kokoro and play once to cache." }));
      return;
    }
    list.replaceChildren();
    const frag = document.createDocumentFragment();
    for (const entry of entries) {
      const row = document.createElement("div");
      row.className = "model-cache-row";
      const meta = document.createElement("div");
      meta.className = "model-cache-meta";
      const name = document.createElement("strong");
      name.className = "model-cache-name";
      name.textContent = entry.label;
      const url = document.createElement("small");
      url.className = "model-cache-url";
      url.textContent = `${entry.cacheName} · ${entry.shortUrl} · ${entry.formattedSize}`;
      url.title = entry.url;
      meta.append(name, url);
      const del = document.createElement("button");
      del.type = "button";
      del.className = "text-button small danger model-cache-delete";
      del.textContent = "Delete";
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
          clearNeuralCache();
          showToast(`${entry.label} removed`);
          await refreshModelCacheUI();
          updateEngineUI();
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
    list.replaceChildren(Object.assign(document.createElement("span"), { className: "model-cache-empty", textContent: err.message || "Could not read caches." }));
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
  if (!confirm("Clear all saved models? This deletes kitten-cache, transformers-cache and kokoro-voices from CacheStorage. Next play will re-download.")) {
    if (btn) btn.disabled = false;
    return;
  }
  try {
    await clearAllModelCaches();
    clearModelConsentRecords();
    await resetNeuralWorker(new Error("Model caches cleared")).catch(() => {});
    clearNeuralCache();
    showToast("Saved models cleared — next play will re-download");
    await refreshModelCacheUI();
    updateEngineUI();
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
    if (state.engine === "neural") advanceGenerationEpoch();
    await clearTtsCache();
    clearNeuralCache();
    await refreshStorageLabel();
    showToast("Generated audio cleared — next play will regenerate");
    hideLoading();
  } catch (error) {
    showToast(error.message || "Could not clear generated audio");
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function handleClearAllData() {
  if (!confirm("Clear all Hear data? This wipes generated audio, library, progress, and voice choice, then reloads.")) return;
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
    clearNeuralCache();
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

function setNeuralLoading(progress = null, detail = "Loading the natural voice") {
  if (state.neuralLoadInBackground && state.playback === "playing") {
    setPlayerStatus(`${detail} · playback continues`, { announce: false });
    return;
  }
  const wasHidden = elements.loadingView.hidden;
  elements.loadingTitle.textContent = "Preparing your natural voice…";
  elements.loadingDetail.textContent = detail;
  elements.loadingProgress.hidden = false;
  elements.loadingProgress.dataset.indeterminate = String(progress === null);
  if (progress !== null) {
    elements.loadingProgress.style.setProperty("--download-progress", `${Math.min(100, Math.max(0, progress))}%`);
  } else {
    elements.loadingProgress.style.setProperty("--download-progress", "32%");
  }
  elements.loadingCancel.hidden = false;
  elements.loadingView.dataset.kind = "voice";
  elements.loadingView.hidden = false;
  if (wasHidden) setLoadingIsolation(true);
}

function setLoadingIsolation(active) {
  [elements.siteHeader, $("main"), elements.jumpToCurrent, elements.player, ...$$("dialog")].forEach((element) => {
    if (element) element.inert = active;
  });
  if (active) requestAnimationFrame(() => elements.loadingCancel.focus({ preventScroll: true }));
}

function hideLoading() {
  elements.loadingView.hidden = true;
  elements.loadingProgress.hidden = true;
  elements.loadingProgress.dataset.indeterminate = "false";
  elements.loadingProgress.style.setProperty("--download-progress", "0%");
  elements.loadingCancel.hidden = true;
  elements.loadingView.dataset.kind = "";
  setLoadingIsolation(false);
}

function ttsCallbacks() {
  return {
    onProgress(message) {
      const backendLabel = message.backend || state.activeBackendId || state.backendPreference || "local";
      const pct = Number.isFinite(message.progress) ? Math.round(message.progress) : null;
      const filePct = Number.isFinite(message.fileProgress) ? Math.round(message.fileProgress) : pct;
      const file = message.file || "";
      const status = message.status || "";
      const isCached = message.cached || status === "cached";
      // Detailed: file + percent + backend. Kitten sends "onnx/model.onnx" + "voices" archive;
      // Kokoro sends model files via transformers progress_callback.
      if (isCached) {
        const label = file.includes("voices") ? "voices.npz" : file || "voice model";
        setNeuralLoading(pct ?? 100, `Loading ${label} [cached · ${backendLabel}]${filePct !== null ? ` · ${filePct}%` : ""}`);
        if (state.playback === "buffering") {
          setPlayerStatus(file ? `Loading ${file.split("/").pop()} · cached · ${backendLabel}` : `Loading cached voice · ${backendLabel}`);
        }
        return;
      }
      if (status === "loading") {
        setNeuralLoading(null, `Initializing ${file || backendLabel} — compiling WASM`);
      } else if (status === "ready") {
        setNeuralLoading(100, `Voice ready [${backendLabel}]`);
      } else if (file.includes("onnx")) {
        setNeuralLoading(message.progress, `Downloading ${file} [${backendLabel}]${filePct !== null ? ` · ${filePct}%` : ""}`);
      } else if (file.includes("voices")) {
        const label = file.includes("voices") ? "voices.npz" : file;
        setNeuralLoading(message.progress, `Downloading ${label} [${backendLabel}]${filePct !== null ? ` · ${filePct}%` : ""}`);
      } else if (status === "starting") {
        setNeuralLoading(null, `Starting ${backendLabel} [explicit choice]`);
      } else if (status === "progress" && pct !== null) {
        setNeuralLoading(message.progress, `Preparing ${file || "voice files"} [${backendLabel}] · ${pct}%`);
      } else if (pct !== null) {
        setNeuralLoading(message.progress, `Preparing ${file || "local voice"} [${backendLabel}] · ${pct}%`);
      } else if (file) {
        setNeuralLoading(null, `Preparing ${file} [${backendLabel}]`);
      } else {
        setNeuralLoading(null, `Preparing ${backendLabel} local voice`);
      }
      // Also surface in player bar while buffering
      if (state.playback === "buffering") {
        setPlayerStatus(file ? `Downloading ${file.split("/").pop()} · ${filePct !== null ? filePct + "% · " : ""}${backendLabel}` : `Preparing voice files · ${backendLabel}`);
      }
    },
    onReady(message) {
      const finishedBackgroundLoad = state.neuralLoadInBackground && state.playback === "playing";
      state.neuralReady = true;
      localStorage.setItem(`${STORAGE_PREFIX}neural-ready`, "true");
      state.activeBackendId = message.backend || state.activeBackendId;
      // dtype/device from ready already includes chosen quant
      console.info("[Hear TTS] runtime", {
        crossOriginIsolated: message.crossOriginIsolated,
        sharedArrayBuffer: message.sharedArrayBuffer,
        cores: message.cores,
        backend: message.backend,
        model: message.model,
        dtype: message.dtype,
        device: message.device,
      });
      hideLoading();
      updateEngineUI();
      if (finishedBackgroundLoad) setPlayerStatus("", { announce: false });
      // Immediately kick off generation for the queued segment – ensure not stuck at 100%
      if (state.playback === "buffering") {
        setPlayerStatus(`Synthesizing first sentence · ${message.backend || state.backendPreference}`);
      }
    },
    onGenerating(message) {
      const backendLabel = message?.backend || state.activeBackendId || state.backendPreference || "local";
      const total = state.neuralSegments?.length || null;
      const messageIndex = Number.parseInt(message?.segmentKey, 10);
      const idx = Number.isInteger(messageIndex) ? messageIndex + 1 : state.currentSegmentIndex + 1;
      const segLabel = total ? `segment ${idx}/${total}` : "passage";
      const stage = message?.stage;
      const action = stage === "phonemize" ? "Reading punctuation" : stage === "encoding" ? "Finishing audio" : "Synthesizing";
      if (state.playback === "buffering") {
        setPlayerStatus(`${action} ${segLabel} · ${backendLabel}`);
      }
    },
    onMetric(metric) {
      state.rtfSamples.push(metric.rtf);
      state.rtfSamples = state.rtfSamples.filter(Number.isFinite).slice(-8);
      window.__hearwikiTtsMetrics ||= [];
      window.__hearwikiTtsMetrics.push(metric);
      window.__hearwikiTtsMetrics = window.__hearwikiTtsMetrics.slice(-100);
      console.info("[Hear TTS] generation", JSON.stringify(metric));
    },
    onFatal(error) {
      state.neuralReady = false;
      console.error("[Hear TTS] backend failure", error);
      hideLoading();
      setPlaybackState("error", "Voice engine stopped · press play to retry");
      showToast(error.message || "Voice failed to start — try another dtype/model or clear cache");
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
  candidate.setEpoch(state.generationEpoch);
  try {
    setNeuralLoading(null, "Safely testing Kokoro WebGPU");
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
    // crash-prone on Android, so respect the explicit value and only probe
    // when user chose webgpu – and never benchmark automatically.
    if (state.kokoroDevice === "webgpu") {
      if (!supportsWebGPU()) {
        console.warn("[Hear TTS] WebGPU not supported, falling back to WASM");
        return new KokoroWasm(ttsCallbacks(), opts);
      }
      // Probe is cached; only runs after explicit selection, not on page load.
      const probe = await probeKokoroWebGpu();
      if (probe.ok) return probe.backend || new KokoroWebGPU(ttsCallbacks(), opts);
      // Probe failed (common on Android) – fallback to WASM with explicit warning.
      console.warn("[Hear TTS] Kokoro WebGPU probe failed – using WASM fallback");
      return new KokoroWasm(ttsCallbacks(), opts);
    }
    return new KokoroWasm(ttsCallbacks(), opts);
  }
  return null;
}

function clearNeuralCache() {
  for (const entry of state.neuralCache.values()) URL.revokeObjectURL(entry.url);
  state.neuralCache.clear();
  state.currentAudioUrl = null;
}

async function resetNeuralWorker(error = new Error("The local voice engine was reset.")) {
  state.generationEpoch += 1;
  state.neuralRunId += 1;
  state.neuralReady = false;
  state.rtfSamples = [];
  state.bufferFillPromise = null;
  const backend = state.ttsBackend;
  state.ttsBackend = null;
  state.activeBackendId = null;
  state.neuralWorkerPromise = null;
  state.neuralLoadInBackground = false;
  await backend?.dispose();
  hideLoading();
  if (error.name !== "BackendRestartError") console.info("[Hear TTS] worker restart", error.message);
}

async function ensureNeuralWorker({ background = false } = {}) {
  if (state.ttsBackend) {
    await state.ttsBackend.load();
    return state.ttsBackend;
  }
  if (state.neuralWorkerPromise) {
    if (!background && state.neuralLoadInBackground) {
      state.neuralLoadInBackground = false;
      setNeuralLoading(null, "Finishing the selected local voice");
    }
    return state.neuralWorkerPromise;
  }
  const workerEpoch = state.generationEpoch;
  state.neuralLoadInBackground = background;
  const pending = (async () => {
    const pendingLabel = state.backendPreference === "kitten"
      ? `Kitten ${state.kittenModel.split("/").pop()} · ${state.kittenDtype} · WASM`
      : state.backendPreference === "kokoro"
        ? `Kokoro 82M · ${state.kokoroDtype} · ${state.kokoroDevice === "webgpu" ? "WebGPU" : "WASM"}`
        : "local voice";
    if (!background) setNeuralLoading(null, `Starting ${pendingLabel} [explicit: ${state.backendPreference}]`);
    const backend = await createSelectedBackend();
    if (!backend) {
      state.engine = "system";
      state.activeBackendId = "system";
      updateEngineUI();
      hideLoading();
      return null;
    }
    if (workerEpoch !== state.generationEpoch) {
      await backend.dispose();
      const error = new Error("Discarded a voice engine started for an earlier playback position.");
      error.name = "StaleGenerationError";
      throw error;
    }
    state.ttsBackend = backend;
    state.activeBackendId = backend.id;
    backend.setEpoch(workerEpoch);
    await backend.load();
    if (workerEpoch !== state.generationEpoch || state.ttsBackend !== backend) {
      await backend.dispose();
      const error = new Error("Discarded a voice engine started for an earlier playback position.");
      error.name = "StaleGenerationError";
      throw error;
    }
    state.neuralReady = true;
    updateEngineUI();
    hideLoading();
    return backend;
  })();
  state.neuralWorkerPromise = pending;
  try {
    return await pending;
  } finally {
    if (state.neuralWorkerPromise === pending) {
      state.neuralWorkerPromise = null;
      state.neuralLoadInBackground = false;
    }
  }
}

function trimNeuralCache() {
  const evictions = selectNeuralCacheEvictions([...state.neuralCache], {
    currentSegmentIndex: state.currentSegmentIndex,
    currentAudioUrl: state.currentAudioUrl,
    maxEntries: 16,
  });
  for (const key of evictions) {
    const entry = state.neuralCache.get(key);
    if (!entry) continue;
    URL.revokeObjectURL(entry.url);
    state.neuralCache.delete(key);
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
    const version = state.kittenModel.includes("0.1")
      ? "0.1"
      : state.kittenModel.includes("int8")
        ? "0.8-int8"
        : "0.8";
    return {
      identity: { model: `${state.kittenModel}@${version}`, dtype: state.kittenDtype },
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

function staleGenerationError(message = "Discarded audio from an earlier playback position.") {
  const error = new Error(message);
  error.name = "StaleGenerationError";
  return error;
}

function rememberNeuralEntry(cacheKey, stored, segmentKey) {
  const entry = stored.url
    ? stored
    : { url: URL.createObjectURL(stored.blob), duration: stored.duration, cacheKey, segmentKey };
  entry.segmentKey = segmentKey;
  state.neuralCache.set(cacheKey, entry);
  trimNeuralCache();
  return entry;
}

async function generateNeuralText(text, segmentKey = "", priority = 2, epoch = state.generationEpoch) {
  const selected = selectedNeuralCacheConfig();
  let cacheKey = await createAudioCacheKey({
    text,
    model: selected.identity.model,
    voice: selected.voice,
    speed: 1,
    dtype: selected.identity.dtype,
  });
  const memoryEntry = state.neuralCache.get(cacheKey);
  if (memoryEntry) {
    memoryEntry.segmentKey = segmentKey;
    trimNeuralCache();
    return memoryEntry;
  }
  const inFlightKey = `${epoch}:${cacheKey}`;
  let activeBackend = null;
  let activeRequestKey = inFlightKey;
  return shareInFlight(state.neuralInFlight, inFlightKey, {
    priority,
    onPriorityUpgrade(nextPriority) {
      activeBackend?.reprioritize(activeRequestKey, nextPriority, epoch);
    },
    async start(inFlight) {
      if (epoch !== state.generationEpoch) throw staleGenerationError();
      const stored = await getCachedAudio(cacheKey).catch(() => null);
      if (epoch !== state.generationEpoch) throw staleGenerationError();
      if (stored?.blob) return rememberNeuralEntry(cacheKey, stored, segmentKey);

      const backend = await ensureNeuralWorker({ background: inFlight.priority > 0 });
      if (!backend) throw new Error("SystemVoiceFallback");
      activeBackend = backend;
      const voice = backend.id === "kitten-wasm" ? state.kittenVoice : state.neuralVoice;
      const identity = backend.cacheIdentity;
      if (
        identity.model !== selected.identity.model ||
        identity.dtype !== selected.identity.dtype ||
        voice !== selected.voice
      ) {
        cacheKey = await createAudioCacheKey({
          text,
          model: identity.model,
          voice,
          speed: 1,
          dtype: identity.dtype,
        });
        const actualMemoryEntry = state.neuralCache.get(cacheKey);
        if (actualMemoryEntry) return rememberNeuralEntry(cacheKey, actualMemoryEntry, segmentKey);
        const actualStored = await getCachedAudio(cacheKey).catch(() => null);
        if (actualStored?.blob) return rememberNeuralEntry(cacheKey, actualStored, segmentKey);
      }
      if (epoch !== state.generationEpoch) throw staleGenerationError();
      activeRequestKey = `${epoch}:${cacheKey}`;
      const result = await backend.generate(text, {
        voice,
        speed: 1,
        priority: inFlight.priority,
        epoch,
        segmentKey,
        requestKey: activeRequestKey,
      });
      if (epoch !== state.generationEpoch) throw staleGenerationError();
      const blob = new Blob([result.buffer], { type: "audio/wav" });
      const entry = rememberNeuralEntry(cacheKey, {
        url: URL.createObjectURL(blob),
        duration: result.duration,
        cacheKey,
        segmentKey,
      }, segmentKey);
      putCachedAudio({ key: cacheKey, blob, duration: result.duration }).catch((error) => {
        console.warn("[Hear TTS] could not persist generated audio", error);
      });
      return entry;
    },
  });
}

function getNeuralSegment(segmentIndex, priority = 2, epoch = state.generationEpoch) {
  const segment = state.neuralSegments[segmentIndex];
  if (!segment) return Promise.reject(new Error("That part of the work is unavailable."));
  return generateNeuralText(segment.text, String(segmentIndex), priority, epoch);
}

function averageRtf() {
  if (!state.rtfSamples.length) return 0.7;
  return state.rtfSamples.reduce((sum, value) => sum + value, 0) / state.rtfSamples.length;
}

function bufferTargetSeconds() {
  const rtf = averageRtf();
  if (rtf >= 0.9) return 60;
  if (rtf >= 0.7) return 45;
  return 30;
}

async function prepareAudioBuffer(startIndex, { epoch = state.generationEpoch } = {}) {
  const indices = selectLookaheadSegmentIndices(
    state.neuralSegments,
    startIndex,
    bufferTargetSeconds(),
  );
  const entries = await Promise.all(indices.map((index, offset) => (
    // Preserve distance order even when Safari resolves IndexedDB/cache-key
    // lookups out of order: next is priority 1, then 2, 3, and so on.
    getNeuralSegment(index, offset + 1, epoch)
  )));
  if (epoch !== state.generationEpoch) throw staleGenerationError("Discarded stale buffer work.");
  return entries[0] || null;
}

function maintainAudioBuffer(nextIndex, epoch = state.generationEpoch) {
  if (
    state.playback !== "playing" ||
    state.bufferFillPromise ||
    nextIndex >= state.neuralSegments.length
  ) return;
  state.bufferFillPromise = prepareAudioBuffer(nextIndex, { epoch })
    .catch((error) => {
      if (
        error.name !== "StaleGenerationError" &&
        error.name !== "BackgroundGenerationCancelled" &&
        epoch === state.generationEpoch
      ) {
        console.warn("[Hear TTS] background buffer stopped", error);
      }
    })
    .finally(() => {
      if (epoch === state.generationEpoch) state.bufferFillPromise = null;
    });
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
  if (state.unlockAudioUrl) {
    state.mediaSwitching = true;
    elements.mediaAudio.loop = true;
    elements.mediaAudio.muted = true;
    elements.mediaAudio.play().then(() => {
      state.audioUnlocked = true;
    }).catch(() => {
      state.audioUnlocked = false;
    }).finally(() => {
      state.mediaSwitching = false;
    });
    return;
  }
  const silentUrl = createSilentWavUrl();
  state.unlockAudioUrl = silentUrl;
  state.audioUnlocked = false;
  state.mediaSwitching = true;
  elements.mediaAudio.pause();
  elements.mediaAudio.src = silentUrl;
  elements.mediaAudio.dataset.mode = "unlock";
  elements.mediaAudio.loop = true;
  elements.mediaAudio.muted = true;
  elements.mediaAudio.play().then(() => {
    state.audioUnlocked = true;
  }).catch(() => {
    state.audioUnlocked = false;
    URL.revokeObjectURL(silentUrl);
    if (state.unlockAudioUrl === silentUrl) state.unlockAudioUrl = null;
  }).finally(() => {
    state.mediaSwitching = false;
  });
}

function releaseUnlockAudio() {
  if (!state.unlockAudioUrl) return;
  URL.revokeObjectURL(state.unlockAudioUrl);
  state.unlockAudioUrl = null;
  state.audioUnlocked = false;
  if (elements.mediaAudio.dataset.mode === "unlock") elements.mediaAudio.dataset.mode = "";
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

function requestNeuralAction(action) {
  state.pendingNeuralAction = action;
  if (state.neuralReady || localStorage.getItem(neuralConsentKey()) === "true") {
    unlockMediaAudio();
    state.pendingNeuralAction = null;
    if (elements.voiceSheet.open) elements.voiceSheet.close();
    action();
    return;
  }
  if (elements.voiceSheet.open) elements.voiceSheet.close();
  updateNeuralDownloadSheet();
  elements.neuralSheet.showModal();
}

function waitForAudioMetadata(audioElement) {
  if (audioElement.readyState >= 1) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      window.clearTimeout(timer);
      audioElement.removeEventListener("loadedmetadata", handleLoaded);
      audioElement.removeEventListener("error", handleError);
    };
    const handleLoaded = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(new Error("Safari could not open the generated audio."));
    };
    const timer = window.setTimeout(() => {
      cleanup();
      const error = new Error("Safari took too long to open the generated audio.");
      error.name = "TimeoutError";
      reject(error);
    }, AUDIO_LOAD_TIMEOUT_MS);
    audioElement.addEventListener("loadedmetadata", handleLoaded, { once: true });
    audioElement.addEventListener("error", handleError, { once: true });
  });
}

async function playNeuralFromChunk(chunkIndex, targetWord = null) {
  if (!naturalVoiceAvailable()) {
    showToast("Natural voice currently supports English works.");
    return;
  }

  const safeIndex = Math.min(Math.max(0, chunkIndex), state.chunks.length - 1);
  const segmentIndex = neuralSegmentIndexForWord(targetWord ?? state.chunks[safeIndex]?.startWord ?? 0);
  const segment = state.neuralSegments[segmentIndex];
  if (!segment) return;

  window.clearTimeout(state.neuralAdvanceTimer);
  state.neuralAdvanceTimer = null;
  state.pendingSegmentIndex = null;

  state.runId += 1;
  if (supportsSpeech) synth.cancel();
  const runId = ++state.neuralRunId;
  const epoch = state.generationEpoch;
  if (elements.mediaAudio.dataset.mode && elements.mediaAudio.dataset.mode !== "unlock") {
    state.mediaSwitching = true;
    elements.mediaAudio.pause();
    state.mediaSwitching = false;
  }
  state.currentIndex = safeIndex;
  state.currentSegmentIndex = segmentIndex;
  state.boundaryWords = 0;
  setPlaybackState("buffering", `Preparing segment ${segmentIndex + 1}/${state.neuralSegments.length} · on device`);
  updateProgress(targetWord ?? segment.startWord);

  try {
    // Sentence-sized Kitten passages should begin as soon as the current
    // sentence is ready; subsequent sentences are filled in the background.
    // Waiting for a time-based startup buffer here would make the smaller
    // passages feel slower than the older multi-sentence batches.
    const audio = await getNeuralSegment(segmentIndex, 0, epoch);
    if (!audio || state.engine === "system") {
      state.currentIndex = safeIndex;
      startSpeechAt(safeIndex);
      return;
    }
    if (runId !== state.neuralRunId || state.engine !== "neural") return;

    state.mediaSwitching = true;
    state.currentAudioUrl = audio.url;
    releaseUnlockAudio();
    elements.mediaAudio.loop = false;
    elements.mediaAudio.muted = false;
    elements.mediaAudio.volume = 1;
    applyMediaPlaybackRate();
    elements.mediaAudio.dataset.mode = "article";
    elements.mediaAudio.src = audio.url;
    const metadataReady = waitForAudioMetadata(elements.mediaAudio);
    elements.mediaAudio.load();
    await metadataReady;
    applyMediaPlaybackRate();

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
    maintainAudioBuffer(segmentIndex + 1, epoch);
  } catch (error) {
    if (runId !== state.neuralRunId) return;
    state.mediaSwitching = false;
    if (error.message === "SystemVoiceFallback" || state.engine === "system") {
      showToast("Local generation is too slow here, so Hear switched to the system voice.");
      startSpeechAt(safeIndex);
      return;
    }
    setPlaybackState("error", "Voice unavailable · press play to retry");
    updateActiveBlock(state.chunks[state.currentIndex]);
    if (error.name === "NotAllowedError") {
      showToast("Tap play once more to start audio.");
    } else if (error.name === "TimeoutError") {
      showToast("Natural voice was reset after taking too long. Press play to retry, or choose System voice.");
    } else if (error.message && error.message.includes("Kitten") && error.message.includes("invalid expand")) {
      showToast(error.message);
    } else if (error.message && error.message.includes("invalid expand")) {
      showToast("This passage is too long for this Kitten model — try Nano 0.8 default or a shorter sentence.");
    } else {
      showToast(error.message ? `Natural voice could not start: ${error.message.slice(0, 120)}` : "Natural voice could not start. Press play to retry, or choose System voice.");
    }
  }
}

function pauseNeural() {
  window.clearTimeout(state.neuralAdvanceTimer);
  state.neuralAdvanceTimer = null;
  elements.mediaAudio.pause();
  setPlaybackState("paused");
  state.ttsBackend?.cancelBackground(state.generationEpoch);
  savePosition();
}

function resumeNeuralBuffering() {
  const epoch = state.generationEpoch;
  const refill = () => {
    if (epoch !== state.generationEpoch || state.playback !== "playing") return;
    maintainAudioBuffer(state.currentSegmentIndex + 1, epoch);
  };
  if (state.bufferFillPromise) state.bufferFillPromise.then(refill, refill);
  else refill();
}

function stopNeural(resetSource = false) {
  window.clearTimeout(state.neuralAdvanceTimer);
  state.neuralAdvanceTimer = null;
  state.pendingSegmentIndex = null;
  state.neuralRunId += 1;
  state.ttsBackend?.cancelBackground(state.generationEpoch);
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
  const section = state.chunks[state.currentIndex]?.section || "Opening";
  const defaultLabel = state.playback === "playing"
    ? `Listening · ${section}`
    : state.playback === "paused"
      ? `Paused · ${section}`
      : state.playback === "buffering"
        ? "Preparing local voice"
        : state.playback === "ended"
          ? "Finished"
          : state.playback === "error"
            ? "Playback needs attention"
            : `Ready · ${section}`;
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
  elements.mediaAudio.defaultPlaybackRate = state.rate;
  elements.mediaAudio.playbackRate = state.rate;
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
    if (state.playback === "buffering") {
      stopNeural(false);
      setPlaybackState("paused");
      updateActiveBlock(state.chunks[state.currentIndex]);
      savePosition();
      return;
    }
    if (state.playback === "playing") {
      pauseNeural();
      return;
    }
    if (state.playback === "paused" && state.pendingSegmentIndex !== null) {
      const nextSegment = state.pendingSegmentIndex;
      state.pendingSegmentIndex = null;
      playNeuralFromChunk(state.neuralSegments[nextSegment].startChunk, state.neuralSegments[nextSegment].startWord);
      return;
    }
    if (state.playback === "paused" && !elements.mediaAudio.ended && elements.mediaAudio.src && state.currentAudioUrl === elements.mediaAudio.src) {
      applyMediaPlaybackRate();
      elements.mediaAudio.play().then(() => {
        setPlaybackState("playing");
        resumeNeuralBuffering();
      }).catch(() => {
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

function advanceGenerationEpoch() {
  state.generationEpoch += 1;
  state.bufferFillPromise = null;
  state.ttsBackend?.setEpoch(state.generationEpoch);
  return state.generationEpoch;
}

function seekToIndex(index, preservePlaying = true, targetWord = null) {
  const wasPlaying = state.playback === "playing";
  state.currentIndex = Math.min(Math.max(0, index), Math.max(0, state.chunks.length - 1));
  state.boundaryWords = 0;
  if (state.engine === "neural") {
    stopNeural(true);
    // Keep the model loaded on seek — bump epoch to cancel in-flight generations
    // without disposing the backend. Previously this called resetNeuralWorker()
    // which tore down the worker and forced a re-download even for cached segments.
    advanceGenerationEpoch();
    state.neuralRunId += 1;
    if (wasPlaying && preservePlaying) {
      setPlaybackState("buffering");
      playNeuralFromChunk(state.currentIndex, targetWord);
    } else {
      setPlaybackState(state.playback === "idle" ? "idle" : "paused");
      updateActiveBlock(state.chunks[state.currentIndex]);
      updateProgress(targetWord);
    }
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
  stopSpeech("idle");
  resetNeuralWorker(new Error("A different work was opened."));
  clearNeuralCache();
  state.article = work;
  state.chunks = createSpeechChunks(work);
  const storedBackend = localStorage.getItem(`${STORAGE_PREFIX}tts-backend`);
  const persisted = storedBackend === "auto" ? "system" : storedBackend;
  state.backendPreference = work.lang.toLowerCase().startsWith("en") ? persisted || "system" : "system";
  state.engine = state.backendPreference === "system" ? "system" : "neural";
  state.currentIndex = 0;
  rebuildNeuralSegments();
  state.currentSegmentIndex = 0;
  state.boundaryWords = 0;
  state.activeBlockId = null;
  elements.jumpToCurrent.hidden = true;
  renderArticle(work);
  loadVoices();
  restorePosition();
  state.currentSegmentIndex = neuralSegmentIndexForChunk(state.currentIndex);
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

async function loadArticle(rawInput, { historyMode = "push" } = {}) {
  let parsed;
  try {
    parsed = parseArticleInput(rawInput);
  } catch (error) {
    showToast(error.message);
    return;
  }

  stopSpeech("idle");
  clearNeuralCache();
  const { controller, requestId } = beginContentTask("Editing for your ears…", "Removing citations and references");

  try {
    const article = await fetchArticle(parsed.title, parsed.lang, true, { signal: controller.signal });
    if (controller.signal.aborted || requestId !== state.contentRequestId) return;
    await cacheWork(article).catch(() => {});
    activateWork(article, { historyMode });
  } catch (error) {
    if (isAbortError(error)) return;
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

  const wasPlaying = state.playback === "playing";
  const targetWord = currentWordPosition();
  const targetIndex = chunkIndexForWord(targetWord);
  stopSpeech("paused");
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
  clearNeuralCache();
  rebuildNeuralSegments();
  updateEngineUI();
  updateActiveBlock(state.chunks[targetIndex]);
  updateProgress();
  showToast(`${choice.name} selected${choice.backend === "system" ? "" : " — downloads only on Preview or Play"}`);

  if (wasPlaying) {
    if (state.engine === "neural") requestNeuralAction(() => playNeuralFromChunk(targetIndex, targetWord));
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
  const utterance = new SpeechSynthesisUtterance("A good book should sound as considered as it reads.");
  applyVoiceToUtterance(utterance);
  synth.speak(utterance);
}

async function previewNaturalVoice() {
  requestNeuralAction(async () => {
    stopSpeech("paused");
    const runId = ++state.neuralRunId;
    setPlaybackState("buffering", "Preparing voice preview · on device");
    try {
      const entry = await generateNeuralText(
        "A good book should sound as considered as it reads.",
        `preview:${state.neuralVoice}`,
      );
      if (runId !== state.neuralRunId) return;
      elements.mediaAudio.dataset.mode = "preview";
      releaseUnlockAudio();
      elements.mediaAudio.loop = false;
      elements.mediaAudio.muted = false;
      elements.mediaAudio.volume = 1;
      elements.mediaAudio.src = entry.url;
      applyMediaPlaybackRate();
      await elements.mediaAudio.play();
      setPlaybackState("playing");
    } catch {
      setPlaybackState("paused");
      showToast("The natural voice preview could not start.");
    }
  });
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
elements.importButton.addEventListener("click", () => elements.epubInput.click());
elements.importInlineButton.addEventListener("click", () => elements.epubInput.click());
elements.epubInput.addEventListener("change", () => importEpub(elements.epubInput.files?.[0]));
elements.chaptersButton.addEventListener("click", () => elements.chaptersSheet.showModal());
elements.continueButton.addEventListener("click", () => {
  const entry = libraryEntries().find((item) => item.key === elements.continueButton.dataset.key);
  if (entry) openLibraryItem(entry);
});

elements.catalogSearch.addEventListener("submit", (event) => {
  event.preventDefault();
  if (state.discoveryMode === "wikipedia") {
    handleWikipediaInput(elements.catalogQuery.value);
    return;
  }
  state.catalogQuery = elements.catalogQuery.value;
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
    setDiscoveryMode(button.dataset.searchMode === "books" ? "wikipedia" : "books");
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
    state.catalogQuery = button.dataset.topic;
    elements.catalogQuery.value = button.dataset.topic;
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
  handleWikipediaInput(elements.headerQuery.value, { fromHeader: true });
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
  requestAnimationFrame(() => {
    elements.modelOptions?.querySelector('[aria-checked="true"]')?.scrollIntoView({ block: "nearest" });
  });
});
elements.modelOptions?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-model-choice]");
  if (button && !button.disabled) selectModelChoice(button.dataset.modelChoice);
});
elements.naturalVoiceSelect.addEventListener("change", () => {
  const targetWord = currentWordPosition();
  const wasPlaying = state.playback === "playing";
  state.neuralVoice = elements.naturalVoiceSelect.value;
  localStorage.setItem(`${STORAGE_PREFIX}neural-voice`, state.neuralVoice);
  stopNeural(true);
  advanceGenerationEpoch();
  clearNeuralCache();
  state.ttsBackend?.prefetchVoice(state.neuralVoice);
  updateEngineUI();
  if (wasPlaying && state.engine === "neural") {
    playNeuralFromChunk(chunkIndexForWord(targetWord), targetWord);
  }
});
if (elements.kittenVoiceSelect) {
  elements.kittenVoiceSelect.addEventListener("change", () => {
    const next = elements.kittenVoiceSelect.value;
    if (!KITTEN_VOICES.includes(next) || next === state.kittenVoice) return;
    const targetWord = currentWordPosition();
    const wasPlaying = state.playback === "playing";
    state.kittenVoice = next;
    localStorage.setItem(`${STORAGE_PREFIX}kitten-voice`, next);
    stopNeural(true);
    advanceGenerationEpoch();
    clearNeuralCache();
    updateEngineUI();
    showToast(`Kitten voice → ${next}`);
    if (state.engine === "neural" && wasPlaying) {
      playNeuralFromChunk(chunkIndexForWord(targetWord), targetWord);
    }
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
  unlockMediaAudio();
  if (elements.voiceSheet.open) elements.voiceSheet.close();
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

elements.mediaAudio.addEventListener("loadedmetadata", applyMediaPlaybackRate);

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
  else {
    const finishedSegment = state.neuralSegments[state.currentSegmentIndex];
    const advance = () => {
      state.neuralAdvanceTimer = null;
      if (state.playback !== "playing" || state.pendingSegmentIndex !== nextSegment) return;
      playNeuralFromChunk(state.neuralSegments[nextSegment].startChunk, state.neuralSegments[nextSegment].startWord);
    };
    state.pendingSegmentIndex = nextSegment;
    const pauseMs = state.backendPreference === "kitten" ? finishedSegment.pauseAfterMs || 0 : 0;
    if (pauseMs) state.neuralAdvanceTimer = window.setTimeout(advance, pauseMs);
    else advance();
  }
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
    state.ttsBackend?.cancelBackground(state.generationEpoch);
    savePosition();
  }
});

elements.mediaAudio.addEventListener("play", () => {
  if (state.engine === "neural" && elements.mediaAudio.dataset.mode === "article" && state.playback !== "buffering") {
    setPlaybackState("playing");
    resumeNeuralBuffering();
  }
});

elements.mediaAudio.addEventListener("error", () => {
  if (state.mediaSwitching || !elements.mediaAudio.getAttribute("src")) return;
  setPlaybackState("error", "Audio stopped · press play to retry");
  showToast("Audio playback stopped. Press play to retry this passage.");
});

elements.loadingCancel.addEventListener("click", async () => {
  if (elements.loadingView.dataset.kind === "content") {
    state.contentAbortController?.abort();
    state.contentAbortController = null;
    state.contentRequestId += 1;
    hideLoading();
    showToast("Opening cancelled");
    return;
  }
  if (state.playback !== "buffering") return;
  stopNeural(false);
  await resetNeuralWorker(new Error("Voice preparation cancelled.")).catch(() => {});
  hideLoading();
  updateActiveBlock(state.chunks[state.currentIndex]);
  setPlaybackState("paused", "Preparation cancelled · press play to retry");
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
