import {
  cacheWork,
  fetchGutenbergCatalog,
  fetchStandardCatalog,
  fetchStandardItemFromSlug,
  getCachedWork,
  loadGutenbergWork,
  loadStandardWork,
  parseEpub,
  removeCachedWork,
} from "./library.js";

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
  outlineLabel: $("#outline-label"),
  endLabel: $("#end-label"),
  readingNoteText: $("#reading-note-text"),
  imageWrap: $("#article-image-wrap"),
  articleImage: $("#article-image"),
  articlePlaceholder: $("#article-placeholder"),
  imageCaption: $("#image-caption"),
  heroPlay: $("#hero-play"),
  restartButton: $("#restart-button"),
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
  nowTitle: $("#now-title"),
  miniCover: $("#mini-cover"),
  miniCoverImage: $("#mini-cover-image"),
  rateButton: $("#rate-button"),
  voiceButton: $("#voice-button"),
  voiceName: $("#voice-name"),
  voiceType: $("#voice-type"),
  voiceSheet: $("#voice-sheet"),
  chaptersButton: $("#chapters-button"),
  chaptersSheet: $("#chapters-sheet"),
  chaptersSheetTitle: $("#chapters-sheet-title"),
  chapterList: $("#chapter-list"),
  voiceSelect: $("#voice-select"),
  naturalVoiceSelect: $("#natural-voice-select"),
  voiceTraits: $("#voice-traits"),
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
const LIBRARY_KEY = `${STORAGE_PREFIX}library-v2`;
const PROGRESS_KEY = `${STORAGE_PREFIX}progress-v2`;
const NATURAL_VOICES = {
  af_heart: { name: "Heart", note: "Warm, balanced American voice · the strongest all-round choice" },
  af_bella: { name: "Bella", note: "Lively American voice · more expressive and animated" },
  bf_emma: { name: "Emma", note: "Composed British voice · calm for long-form listening" },
  bm_fable: { name: "Fable", note: "Characterful British voice · suited to storytelling" },
  am_michael: { name: "Michael", note: "Grounded American voice · steady, lower narration" },
};
const NEURAL_INIT_STALL_MS = 120_000;
const NEURAL_GENERATION_TIMEOUT_MS = 120_000;
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
  neuralInitTimer: null,
  neuralShowLoading: false,
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
  catalogSource: "all",
  catalogQuery: "",
  catalogPage: 1,
  catalogItems: [],
  catalogRequestId: 0,
  chapters: [],
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
    image: work.image?.startsWith("data:") ? "" : work.image,
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

function renderBookCard(item, { removable = false } = {}) {
  const wrapper = document.createElement("article");
  wrapper.className = "book-item";
  const button = document.createElement("button");
  button.className = "book-card";
  button.type = "button";
  button.setAttribute("aria-label", `Open ${item.title} by ${item.author}`);

  const cover = document.createElement("span");
  cover.className = "book-cover";
  cover.style.setProperty("--cover-hue", coverColor(item));
  if (item.image) {
    const image = document.createElement("img");
    image.src = item.image;
    image.alt = "";
    image.loading = "lazy";
    image.addEventListener("load", () => cover.classList.add("has-image"), { once: true });
    image.addEventListener("error", () => image.remove(), { once: true });
    cover.append(image);
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
  author.textContent = item.author || "Unknown author";
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

function interleave(left, right, limit = 30) {
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
    renderSavedLibrary();
    return;
  }
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
      items = await fetchStandardCatalog({ query, page: state.catalogPage, limit: 24 });
    } else if (state.catalogSource === "gutenberg") {
      items = await fetchGutenbergCatalog({ query, page: state.catalogPage });
    } else {
      const results = await Promise.allSettled([
        fetchStandardCatalog({ query, page: state.catalogPage, limit: 15 }),
        fetchGutenbergCatalog({ query, page: state.catalogPage }),
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
    elements.catalogStatus.textContent = error.message || "The public libraries could not be reached.";
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
  if (entry.image) {
    elements.continueImage.src = entry.image;
    elements.continueImage.hidden = false;
    fallback.hidden = true;
  } else {
    elements.continueImage.hidden = true;
    fallback.hidden = false;
    fallback.textContent = entry.title[0]?.toUpperCase() || "H";
  }
}

function showLibraryView({ scrollTop = true } = {}) {
  elements.reader.hidden = true;
  elements.startView.hidden = false;
  elements.libraryButton.hidden = true;
  elements.importButton.hidden = false;
  elements.shareButton.hidden = true;
  elements.siteHeader.dataset.condensed = state.article ? "true" : "false";
  document.body.classList.add("library-open");
  document.title = "Hear — the written world, spoken";
  if (scrollTop) window.scrollTo({ top: 0, behavior: "smooth" });
  updateContinueListening();
}

function showReaderView({ scrollTop = true } = {}) {
  if (!state.article) return;
  elements.startView.hidden = true;
  elements.reader.hidden = false;
  elements.libraryButton.hidden = false;
  elements.importButton.hidden = true;
  elements.shareButton.hidden = false;
  elements.siteHeader.dataset.condensed = "true";
  document.body.classList.remove("library-open");
  document.title = `${state.article.title} — Hear`;
  if (scrollTop) window.scrollTo({ top: 0, behavior: "instant" });
}

async function openLibraryItem(item) {
  const key = item.key || item.id;
  const cached = await getCachedWork(key).catch(() => null);
  if (cached) {
    activateWork(cached);
    return;
  }
  if (item.kind === "article") {
    loadArticle(`${item.lang || "en"}:${item.title}`);
    return;
  }
  if (item.source === "local") {
    showToast("This EPUB is no longer in browser storage. Import the file again.");
    return;
  }
  loadCatalogItem(item.catalogItem || item);
}

async function loadCatalogItem(item) {
  stopSpeech("idle");
  clearNeuralCache();
  elements.loadingView.hidden = false;
  elements.loadingProgress.hidden = true;
  elements.loadingTitle.textContent = `Opening ${item.title}…`;
  elements.loadingDetail.textContent = `Connecting to ${item.sourceLabel}`;
  try {
    const cached = await getCachedWork(item.id).catch(() => null);
    let resolvedItem = item;
    if (!cached && item.source === "standard" && !item.downloadUrl) {
      elements.loadingDetail.textContent = "Opening the Standard Ebooks edition";
      resolvedItem = await fetchStandardItemFromSlug(item.id.replace(/^standard:/, ""));
    }
    const work = cached || (resolvedItem.source === "standard"
      ? await loadStandardWork(resolvedItem, (message) => { elements.loadingDetail.textContent = message; })
      : await loadGutenbergWork(resolvedItem, (message) => { elements.loadingDetail.textContent = message; }));
    if (!cached) await cacheWork(work).catch(() => {});
    activateWork(work);
  } catch (error) {
    showToast(error.message || "That book could not be opened.");
  } finally {
    hideLoading();
  }
}

async function importEpub(file) {
  if (!file) return;
  if (!/\.epub$/i.test(file.name) && file.type !== "application/epub+zip") {
    showToast("Choose a DRM-free EPUB file.");
    return;
  }
  elements.loadingView.hidden = false;
  elements.loadingProgress.hidden = true;
  elements.loadingTitle.textContent = `Opening ${file.name}…`;
  elements.loadingDetail.textContent = "Finding the book’s reading order";
  try {
    const key = `local:${file.name}:${file.size}:${file.lastModified}`;
    const work = await parseEpub(await file.arrayBuffer(), {
      key,
      source: "local",
      sourceLabel: "My EPUB",
    });
    await cacheWork(work).catch(() => {});
    activateWork(work);
  } catch (error) {
    showToast(error.message || "That EPUB could not be opened.");
  } finally {
    elements.epubInput.value = "";
    hideLoading();
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

  if (article.image) {
    elements.articleImage.src = article.image;
    elements.articleImage.alt = article.kind === "book" ? `Cover of ${article.title}` : `Lead image for ${article.title}`;
    elements.imageCaption.textContent = article.kind === "book"
      ? `Cover from ${article.sourceLabel}`
      : `Image from ${article.lang}.wikipedia.org`;
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
    ? NATURAL_VOICES[state.neuralVoice]?.name || "Heart"
    : state.selectedVoice?.name || "System voice";
  elements.voiceButton.setAttribute(
    "aria-label",
    `Voice settings, ${isNeural ? `Natural, ${NATURAL_VOICES[state.neuralVoice]?.name || "Heart"}` : state.selectedVoice?.name || "System voice"}`,
  );
  elements.engineDescription.textContent = naturalVoiceAvailable()
    ? "Kokoro 82M · generated privately on this device"
    : "Natural voice currently supports English works";
  elements.voiceNote.textContent = isNeural
    ? "The first use downloads about 100 MB of model files. Safari caches them locally; the text you listen to never goes to a speech service."
    : "System voices start instantly, but Safari may expose only its compact voices. Natural voice is the higher-quality option for English works.";
  elements.naturalVoiceSelect.value = state.neuralVoice;
  elements.voiceTraits.textContent = NATURAL_VOICES[state.neuralVoice]?.note || NATURAL_VOICES.af_heart.note;
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

function clearNeuralInitTimer() {
  window.clearTimeout(state.neuralInitTimer);
  state.neuralInitTimer = null;
}

function resetNeuralWorker(error = new Error("The natural voice engine was reset.")) {
  clearNeuralInitTimer();
  const worker = state.neuralWorker;
  state.neuralWorker = null;
  state.neuralReady = false;
  state.neuralShowLoading = false;
  worker?.terminate();

  const rejectInitialization = state.neuralInitReject;
  state.neuralInitPromise = null;
  state.neuralInitResolve = null;
  state.neuralInitReject = null;
  rejectInitialization?.(error);

  for (const request of state.neuralRequests.values()) {
    window.clearTimeout(request.timer);
    request.reject(error);
  }
  state.neuralRequests.clear();
  hideLoading();
}

function armNeuralInitTimer(worker) {
  clearNeuralInitTimer();
  state.neuralInitTimer = window.setTimeout(() => {
    if (worker !== state.neuralWorker || state.neuralReady) return;
    const error = new Error("The natural voice stopped responding while it was starting.");
    error.name = "TimeoutError";
    error.recoverable = true;
    resetNeuralWorker(error);
  }, NEURAL_INIT_STALL_MS);
}

function ensureNeuralWorker({ background = false } = {}) {
  if (state.neuralReady && state.neuralWorker) return Promise.resolve();
  if (state.neuralReady && !state.neuralWorker) state.neuralReady = false;
  if (state.neuralInitPromise) {
    if (!background) {
      state.neuralShowLoading = true;
      setNeuralLoading(null, "Finishing the private voice engine");
    }
    return state.neuralInitPromise;
  }

  const worker = new Worker(new URL("./tts-worker.js", import.meta.url), { type: "module" });
  state.neuralWorker = worker;
  state.neuralShowLoading = !background;
  state.neuralInitPromise = new Promise((resolve, reject) => {
    state.neuralInitResolve = resolve;
    state.neuralInitReject = reject;
  });

  worker.addEventListener("message", (event) => {
    if (worker !== state.neuralWorker) return;
    const message = event.data;
    if (message.type === "progress") {
      armNeuralInitTimer(worker);
      if (!state.neuralShowLoading) return;
      if (message.file?.includes("onnx") && Number.isFinite(message.progress)) {
        setNeuralLoading(message.progress, `Downloading voice model · ${Math.round(message.progress)}%`);
      } else if (message.status === "initiate" || message.status === "starting") {
        setNeuralLoading(null, "Preparing voice files");
      }
      return;
    }

    if (message.type === "ready") {
      clearNeuralInitTimer();
      state.neuralReady = true;
      localStorage.setItem(`${STORAGE_PREFIX}neural-ready`, "true");
      const resolveInitialization = state.neuralInitResolve;
      state.neuralInitPromise = null;
      state.neuralInitResolve = null;
      state.neuralInitReject = null;
      state.neuralShowLoading = false;
      resolveInitialization?.();
      hideLoading();
      return;
    }

    if (message.type === "generating") {
      if (state.playback === "buffering") elements.nowSection.textContent = "Generating on this device";
      return;
    }

    if (message.type === "audio") {
      const request = state.neuralRequests.get(message.id);
      if (!request) return;
      state.neuralRequests.delete(message.id);
      window.clearTimeout(request.timer);
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
      window.clearTimeout(request.timer);
      request.reject(new Error(message.message));
      return;
    }

    if (message.type === "fatal") {
      const error = new Error(message.message);
      error.recoverable = true;
      resetNeuralWorker(error);
    }
  });

  worker.addEventListener("error", (event) => {
    if (worker !== state.neuralWorker) return;
    const error = new Error(event.message || "The natural voice stopped unexpectedly.");
    error.recoverable = true;
    resetNeuralWorker(error);
  });

  if (state.neuralShowLoading) setNeuralLoading(null, "Starting the private voice engine");
  armNeuralInitTimer(worker);
  worker.postMessage({ type: "init" });
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

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await ensureNeuralWorker();
      const id = ++state.neuralRequestId;
      let resolveRequest;
      let rejectRequest;
      const promise = new Promise((resolve, reject) => {
        resolveRequest = resolve;
        rejectRequest = reject;
      });
      const timer = window.setTimeout(() => {
        if (!state.neuralRequests.has(id)) return;
        const error = new Error("The natural voice took too long to generate this passage.");
        error.name = "TimeoutError";
        error.recoverable = true;
        resetNeuralWorker(error);
      }, NEURAL_GENERATION_TIMEOUT_MS);
      state.neuralRequests.set(id, {
        cacheKey,
        promise,
        resolve: resolveRequest,
        reject: rejectRequest,
        timer,
      });
      state.neuralWorker.postMessage({ type: "generate", id, text, voice: state.neuralVoice });
      return await promise;
    } catch (error) {
      if (!error.recoverable || attempt > 0) throw error;
      setNeuralLoading(null, "Restarting the private voice engine");
    }
  }
  throw new Error("The natural voice could not start.");
}

function getNeuralSegment(segmentIndex) {
  const segment = state.neuralSegments[segmentIndex];
  if (!segment) return Promise.reject(new Error("That part of the work is unavailable."));
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
  const segmentIndex = neuralSegmentIndexForChunk(safeIndex);
  const segment = state.neuralSegments[segmentIndex];
  if (!segment) return;

  state.runId += 1;
  if (supportsSpeech) synth.cancel();
  const runId = ++state.neuralRunId;
  if (elements.mediaAudio.dataset.mode && elements.mediaAudio.dataset.mode !== "unlock") {
    state.mediaSwitching = true;
    elements.mediaAudio.pause();
    state.mediaSwitching = false;
  }
  state.currentIndex = safeIndex;
  state.currentSegmentIndex = segmentIndex;
  state.boundaryWords = 0;
  setPlaybackState("buffering");
  elements.nowSection.textContent = "Generating on this device";
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
    const metadataReady = waitForAudioMetadata(elements.mediaAudio);
    elements.mediaAudio.load();
    await metadataReady;

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
    updateActiveBlock(state.chunks[state.currentIndex]);
    if (error.name === "NotAllowedError") {
      showToast("Tap play once more to start audio.");
    } else if (error.name === "TimeoutError") {
      showToast("Natural voice was reset after taking too long. Press play to retry, or choose System voice.");
    } else {
      showToast("Natural voice could not start. Press play to retry, or choose System voice.");
    }
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
  elements.playButton.setAttribute("aria-label", playing ? "Pause" : nextState === "buffering" ? "Cancel voice preparation" : "Play");
  const heroLabel = $("span:last-child", elements.heroPlay);
  heroLabel.textContent = playing
    ? "Pause listening"
    : nextState === "buffering"
      ? "Cancel preparation"
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
    if (state.playback === "paused" && elements.mediaAudio.src && state.currentAudioUrl === elements.mediaAudio.src) {
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

  if (state.engine === "neural") {
    elements.mediaAudio.playbackRate = state.rate;
  } else if (restartSpeech && state.playback === "playing") {
    startSpeechAt(state.currentIndex);
  } else if (restartSpeech && state.playback === "paused") {
    stopSpeech("paused");
  }
}

function activateWork(work) {
  stopSpeech("idle");
  clearNeuralCache();
  state.article = work;
  state.chunks = createSpeechChunks(work);
  state.neuralSegments = createNeuralSegments(state.chunks);
  state.engine = work.lang.toLowerCase().startsWith("en")
    ? localStorage.getItem(`${STORAGE_PREFIX}engine`) || "neural"
    : "system";
  state.currentIndex = 0;
  state.currentSegmentIndex = 0;
  state.boundaryWords = 0;
  state.activeBlockId = null;
  renderArticle(work);
  loadVoices();
  restorePosition();
  state.currentSegmentIndex = neuralSegmentIndexForChunk(state.currentIndex);
  updateEngineUI();
  updateMediaMetadata();
  updateProgress();
  rememberWork(work);

  if (state.engine === "neural" && localStorage.getItem(`${STORAGE_PREFIX}neural-ready`) === "true") {
    const warmNaturalVoice = () => ensureNeuralWorker({ background: true }).catch(() => {});
    if ("requestIdleCallback" in window) window.requestIdleCallback(warmNaturalVoice, { timeout: 2500 });
    else window.setTimeout(warmNaturalVoice, 500);
  }

  elements.player.hidden = false;
  document.body.classList.add("player-visible");
  elements.headerQuery.value = "";
  showReaderView();

  let url = location.pathname;
  if (work.source === "wikipedia") {
    url += `?${new URLSearchParams({ lang: work.lang, title: work.title })}`;
  } else if (work.source === "standard") {
    url += `?${new URLSearchParams({ source: "standard", book: work.key.replace(/^standard:/, "") })}`;
  } else if (work.source === "gutenberg") {
    url += `?${new URLSearchParams({ source: "gutenberg", book: work.key.replace(/^gutenberg:/, "") })}`;
  }
  history.replaceState({ work: work.key }, "", url);

  if (state.currentIndex > 0) showToast(`Ready to resume ${work.title}`);
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
    await cacheWork(article).catch(() => {});
    activateWork(article);
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
    artist: state.article.author || state.article.sourceLabel || "Hear",
    album: `${state.article.sourceLabel || "Hear"} · listening edition`,
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
    showToast("Natural voice currently supports English works.");
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
  const utterance = new SpeechSynthesisUtterance("A good book should sound as considered as it reads.");
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
        "A good book should sound as considered as it reads.",
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

elements.brandLink.addEventListener("click", (event) => {
  event.preventDefault();
  showLibraryView();
  history.replaceState({}, "", location.pathname);
});
elements.libraryButton.addEventListener("click", () => {
  showLibraryView();
  history.replaceState({}, "", location.pathname);
});
elements.nowPlayingButton.addEventListener("click", () => showReaderView());
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
  state.catalogQuery = elements.catalogQuery.value;
  if (state.catalogSource === "saved") state.catalogSource = "all";
  $$('button[data-source]', elements.sourceSwitcher).forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.source === state.catalogSource));
  });
  $$('button[data-topic]', elements.catalogTopics).forEach((button) => button.setAttribute("aria-pressed", "false"));
  loadCatalog();
  elements.catalogTitle.scrollIntoView({ behavior: "smooth", block: "start" });
});

$$('button[data-source]', elements.sourceSwitcher).forEach((button) => {
  button.addEventListener("click", () => chooseCatalogSource(button.dataset.source));
});

$$('button[data-topic]', elements.catalogTopics).forEach((button) => {
  button.addEventListener("click", () => {
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
    isTyping || !state.article || elements.voiceSheet.open || elements.setupSheet.open ||
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
elements.followToggle.checked = state.follow;
setBookmarklet();
loadVoices();
initMediaSession();
elements.libraryButton.hidden = true;
updateContinueListening();
loadCatalog();

const initialParams = new URLSearchParams(location.search);
const initialInput = initialParams.get("url") || (
  initialParams.get("title")
    ? `${safeLanguage(initialParams.get("lang") || "en")}:${initialParams.get("title")}`
    : ""
);
const initialSource = initialParams.get("source");
const initialBook = initialParams.get("book");
if (initialInput) {
  loadArticle(initialInput);
} else if (initialSource === "standard" && initialBook) {
  getCachedWork(`standard:${initialBook}`).then((cached) => {
    if (cached) activateWork(cached);
    else fetchStandardItemFromSlug(initialBook).then(loadCatalogItem).catch((error) => showToast(error.message));
  });
} else if (initialSource === "gutenberg" && /^\d+$/.test(initialBook || "")) {
  const item = {
    id: `gutenberg:${initialBook}`,
    gutenbergId: initialBook,
    source: "gutenberg",
    sourceLabel: "Project Gutenberg",
    title: `Project Gutenberg #${initialBook}`,
    author: "Project Gutenberg",
    description: "A public-domain edition from Project Gutenberg.",
    sourceUrl: `https://www.gutenberg.org/ebooks/${initialBook}`,
  };
  getCachedWork(item.id).then((cached) => cached ? activateWork(cached) : loadCatalogItem(item));
} else {
  showLibraryView({ scrollTop: false });
}
