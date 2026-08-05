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
  voiceSheet: $("#voice-sheet"),
  voiceSelect: $("#voice-select"),
  rateRange: $("#rate-range"),
  rateOutput: $("#rate-output"),
  rateDescription: $("#rate-description"),
  followToggle: $("#follow-toggle"),
  previewVoice: $("#preview-voice"),
  setupButton: $("#setup-button"),
  setupSheet: $("#setup-sheet"),
  bookmarkletLink: $("#bookmarklet-link"),
  copyBookmarklet: $("#copy-bookmarklet"),
  shareButton: $("#share-button"),
  loadingView: $("#loading-view"),
  loadingDetail: $("#loading-detail"),
  toast: $("#toast"),
};

const synth = window.speechSynthesis;
const supportsSpeech = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
const WORDS_PER_MINUTE = 185;
const STORAGE_PREFIX = "hearwiki:";
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
  voices: [],
  selectedVoice: null,
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
  if (thumbnail) return thumbnail.replace(/\/\d+px-/, "/1200px-");
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
  const chunk = state.chunks[state.currentIndex];
  if (!chunk) return totalWords();
  return Math.min(totalWords(), chunk.startWord + state.boundaryWords);
}

function setPlaybackState(nextState) {
  state.playback = nextState;
  elements.player.dataset.state = nextState;
  const playing = nextState === "playing";
  elements.playButton.setAttribute("aria-label", playing ? "Pause" : "Play");
  const heroLabel = $("span:last-child", elements.heroPlay);
  heroLabel.textContent = playing ? "Pause listening" : nextState === "paused" ? "Resume listening" : "Start listening";
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
  state.currentIndex = Math.max(0, state.chunks.length - 1);
  state.boundaryWords = state.chunks.at(-1)?.wordCount || 0;
  state.currentUtterance = null;
  setPlaybackState("ended");
  updateProgress();
  savePosition();
}

function togglePlayback() {
  if (!state.article) return;

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
  state.currentUtterance = null;
  setPlaybackState(nextState);
}

function seekToIndex(index, preservePlaying = true) {
  const wasPlaying = state.playback === "playing";
  state.currentIndex = Math.min(Math.max(0, index), Math.max(0, state.chunks.length - 1));
  state.boundaryWords = 0;
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
  seekToIndex(chunkIndexForWord(target));
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
  const name = voice.name.toLowerCase();
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
  elements.voiceName.textContent = state.selectedVoice?.name || "System voice";
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

  if (restartSpeech && state.playback === "playing") startSpeechAt(state.currentIndex);
  else if (restartSpeech && state.playback === "paused") stopSpeech("paused");
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
  elements.loadingView.hidden = false;
  elements.loadingDetail.textContent = "Removing citations and references";

  try {
    const article = await fetchArticle(parsed.title, parsed.lang);
    state.article = article;
    state.chunks = createSpeechChunks(article);
    state.currentIndex = 0;
    state.boundaryWords = 0;
    state.activeBlockId = null;
    renderArticle(article);
    loadVoices();
    restorePosition();
    updateProgress();

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
    elements.loadingView.hidden = true;
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

function initMediaSession() {
  if (!("mediaSession" in navigator)) return;
  try {
    navigator.mediaSession.setActionHandler("play", togglePlayback);
    navigator.mediaSession.setActionHandler("pause", togglePlayback);
    navigator.mediaSession.setActionHandler("seekbackward", (details) => skipSeconds(-(details.seekOffset || 15)));
    navigator.mediaSession.setActionHandler("seekforward", (details) => skipSeconds(details.seekOffset || 15));
  } catch {
    // Some Safari versions expose Media Session without every action.
  }
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
elements.restartButton.addEventListener("click", () => startSpeechAt(0));
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
  seekToIndex(chunkIndexForWord(targetWord));
});

elements.voiceButton.addEventListener("click", () => elements.voiceSheet.showModal());
elements.voiceSelect.addEventListener("change", () => {
  state.selectedVoice = state.voices.find((voice) => voice.voiceURI === elements.voiceSelect.value) || state.selectedVoice;
  localStorage.setItem(`${STORAGE_PREFIX}voice`, state.selectedVoice?.voiceURI || "");
  elements.voiceName.textContent = state.selectedVoice?.name || "System voice";
  if (state.playback === "playing") startSpeechAt(state.currentIndex);
  else if (state.playback === "paused") stopSpeech("paused");
});

elements.previewVoice.addEventListener("click", () => {
  if (!supportsSpeech) return;
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
});

elements.rateRange.addEventListener("input", () => setRate(elements.rateRange.value, false));
elements.rateRange.addEventListener("change", () => {
  if (state.playback === "playing") startSpeechAt(state.currentIndex);
  else if (state.playback === "paused") stopSpeech("paused");
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

elements.setupButton.addEventListener("click", () => elements.setupSheet.showModal());
$$('[data-close-dialog]').forEach((button) => {
  button.addEventListener("click", () => button.closest("dialog").close());
});

for (const dialog of $$("dialog")) {
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
}

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
  if (isTyping || !state.article || elements.voiceSheet.open || elements.setupSheet.open) return;
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
