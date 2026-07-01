import { parseLRC, captionIndexAt, formatTime } from "./lrc.js";
import * as pdfjs from "../vendor/pdfjs/pdf.min.mjs";
import {
  buildResourceIndex,
  createResourceRecord,
  exercisePrompts,
  lessonLabel
} from "./resource-index.js";
import {
  getAllResources,
  getMeta,
  getResource,
  saveMeta,
  saveResources
} from "./storage.js";

pdfjs.GlobalWorkerOptions.workerSrc = "./vendor/pdfjs/pdf.worker.min.mjs";

const state = {
  books: [],
  selectedBook: null,
  selectedLesson: null,
  expandedBooks: new Set(),
  completedLessons: new Set(),
  captions: [],
  currentCaptionIndex: null,
  pdfDocument: null,
  pdfPageIndex: 0,
  pdfRenderToken: 0,
  pdfRenderedPages: new Set(),
  pdfRenderObserver: null,
  pdfPageObserver: null,
  objectUrls: new Set(),
  resourceRecords: new Map(),
  resourceMode: "empty",
  answers: {},
  notes: {},
  selectedLessonId: null
};

const elements = {
  toast: document.querySelector("#toast"),
  importButton: document.querySelector("#importButton"),
  fileInput: document.querySelector("#fileInput"),
  importProgress: document.querySelector("#importProgress"),
  resourceStatus: document.querySelector("#resourceStatus"),
  bookList: document.querySelector("#bookList"),
  lessonTitle: document.querySelector("#lessonTitle"),
  lessonSubtitle: document.querySelector("#lessonSubtitle"),
  markDoneButton: document.querySelector("#markDoneButton"),
  prevPageButton: document.querySelector("#prevPageButton"),
  pageInfo: document.querySelector("#pageInfo"),
  nextPageButton: document.querySelector("#nextPageButton"),
  pdfEmpty: document.querySelector("#pdfEmpty"),
  pdfLoader: document.querySelector("#pdfLoader"),
  pdfPages: document.querySelector("#pdfPages"),
  playButton: document.querySelector("#playButton"),
  audioScrubber: document.querySelector("#audioScrubber"),
  audioTime: document.querySelector("#audioTime"),
  audio: document.querySelector("#audio"),
  currentCaption: document.querySelector("#currentCaption"),
  vocabularyList: document.querySelector("#vocabularyList"),
  captionList: document.querySelector("#captionList"),
  lessonNotes: document.querySelector("#lessonNotes"),
  exerciseList: document.querySelector("#exerciseList"),
  exerciseCount: document.querySelector("#exerciseCount"),
  studyTab: document.querySelector("#studyTab"),
  exerciseTab: document.querySelector("#exerciseTab"),
  tabs: document.querySelectorAll(".tab")
};

init();

async function init() {
  bindEvents();
  await loadState();
  await loadHostedResources();
  registerServiceWorker();
}

function bindEvents() {
  elements.importButton.addEventListener("click", importResources);
  elements.fileInput.addEventListener("change", async () => {
    if (elements.fileInput.files.length) {
      await ingestFiles([...elements.fileInput.files]);
      elements.fileInput.value = "";
    }
  });

  elements.markDoneButton.addEventListener("click", async () => {
    if (!state.selectedLesson) {
      return;
    }

    const key = lessonKey(state.selectedLesson);
    if (state.completedLessons.has(key)) {
      state.completedLessons.delete(key);
    } else {
      state.completedLessons.add(key);
    }
    await persistLearningState();
    renderSidebar();
    renderLessonHeader();
    showToast(state.completedLessons.has(key) ? "Lesson marked done" : "Lesson reopened");
  });

  elements.prevPageButton.addEventListener("click", () => scrollToPdfPage(state.pdfPageIndex - 1));
  elements.nextPageButton.addEventListener("click", () => scrollToPdfPage(state.pdfPageIndex + 1));
  elements.pdfPages.parentElement.addEventListener("scroll", debounce(updatePdfPageFromScroll, 80));

  elements.playButton.addEventListener("click", () => {
    if (elements.audio.paused) {
      elements.audio.play();
    } else {
      elements.audio.pause();
    }
  });

  elements.audio.addEventListener("play", () => {
    elements.playButton.textContent = "Pause";
  });
  elements.audio.addEventListener("pause", () => {
    elements.playButton.textContent = "Play";
  });
  elements.audio.addEventListener("timeupdate", onAudioTimeUpdate);
  elements.audio.addEventListener("loadedmetadata", updateAudioTime);

  elements.audioScrubber.addEventListener("input", () => {
    if (!Number.isFinite(elements.audio.duration) || elements.audio.duration <= 0) {
      return;
    }
    elements.audio.currentTime = (Number(elements.audioScrubber.value) / 1000) * elements.audio.duration;
  });

  elements.lessonNotes.addEventListener("input", async () => {
    if (!state.selectedLesson) {
      return;
    }
    state.notes[lessonKey(state.selectedLesson)] = elements.lessonNotes.value;
    await persistLearningState();
  });

  for (const tab of elements.tabs) {
    tab.addEventListener("click", () => selectTab(tab.dataset.tab));
  }
}

async function loadState() {
  const saved = await getMeta("learning-state", {});
  state.completedLessons = new Set(saved.completedLessons || []);
  state.answers = saved.answers || {};
  state.notes = saved.notes || {};
  state.selectedLessonId = saved.selectedLessonId || null;
}

async function persistLearningState() {
  await saveMeta("learning-state", {
    selectedLessonId: state.selectedLesson?.id || null,
    completedLessons: [...state.completedLessons],
    answers: state.answers,
    notes: state.notes
  });
}

async function loadHostedResources() {
  try {
    const response = await fetch("./resources-manifest.json", { cache: "no-cache" });
    if (response.ok) {
      const manifest = await response.json();
      const records = manifest.resources || [];
      setResourceRecords(records);
      state.resourceMode = "hosted";
      state.books = buildResourceIndex(records);
      renderResourceStatus(records.length, "Hosted");
      renderSidebar();

      const savedLesson = findLesson(state.selectedLessonId);
      const firstLesson = state.books.flatMap((book) => book.lessons.map((lesson) => ({ book, lesson })))[0];
      const target = savedLesson || firstLesson;
      if (target) {
        await selectLesson(target.book.book, target.lesson.id);
      }
      return;
    }
  } catch (error) {
    console.warn("Hosted resource manifest unavailable.", error);
  }

  await loadCachedResources();
}

async function loadCachedResources() {
  const records = await getAllResources();
  setResourceRecords(records);
  state.resourceMode = records.length ? "cached" : "empty";
  state.books = buildResourceIndex(records);
  renderResourceStatus(records.length, "Cached");

  const savedLesson = findLesson(state.selectedLessonId);
  renderSidebar();

  if (savedLesson) {
    await selectLesson(savedLesson.book.book, savedLesson.lesson.id);
  }
}

async function importResources() {
  if ("showDirectoryPicker" in window) {
    try {
      const directory = await window.showDirectoryPicker({ mode: "read" });
      const files = [];
      await collectDirectoryFiles(directory, "", files);
      await ingestFiles(files);
      return;
    } catch (error) {
      if (error.name === "AbortError") {
        return;
      }
      console.warn("Directory picker failed, falling back to file input.", error);
    }
  }

  elements.fileInput.click();
}

async function collectDirectoryFiles(directory, prefix, files) {
  for await (const [name, handle] of directory.entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === "directory") {
      await collectDirectoryFiles(handle, path, files);
    } else if (handle.kind === "file") {
      const file = await handle.getFile();
      file.relativePath = path;
      files.push(file);
    }
  }
}

async function ingestFiles(files) {
  elements.importProgress.hidden = false;
  elements.resourceStatus.textContent = "Reading resources...";

  try {
    const accepted = files.filter((file) => /\.(pdf|mp3|lrc)$/i.test(file.name));
    const records = accepted.map(createResourceRecord);
    await saveResources(records);
    setResourceRecords(records);
    state.resourceMode = "cached";
    state.books = buildResourceIndex(records);
    state.expandedBooks = new Set(state.books.map((book) => book.book));
    renderResourceStatus(records.length, "Cached");
    renderSidebar();

    const firstLesson = state.books.flatMap((book) => book.lessons.map((lesson) => ({ book, lesson })))[0];
    if (firstLesson) {
      await selectLesson(firstLesson.book.book, firstLesson.lesson.id);
    }
    showToast("Resources imported");
  } finally {
    elements.importProgress.hidden = true;
  }
}

function setResourceRecords(records) {
  state.resourceRecords = new Map(records.map((record) => [record.key, record]));
}

function renderResourceStatus(recordCount, mode = "") {
  if (!recordCount) {
    elements.resourceStatus.textContent = mode === "Cached"
      ? "Hosted library unavailable. Use + to import resources."
      : "Loading hosted lesson library...";
    return;
  }

  const lessonCount = state.books.reduce((sum, book) => sum + book.lessons.length, 0);
  const prefix = mode ? `${mode}: ` : "";
  elements.resourceStatus.textContent = `${prefix}${state.books.length} books, ${lessonCount} lessons, ${recordCount} files.`;
}

function renderSidebar() {
  elements.bookList.replaceChildren();

  for (const book of state.books) {
    const bookNode = document.createElement("section");
    bookNode.className = "book";

    const bookButton = document.createElement("button");
    bookButton.className = "book-button";
    bookButton.innerHTML = `
      <span class="book-title">${escapeHTML(book.title)}</span>
      <span class="lesson-count">${book.lessons.length}</span>
    `;
    bookButton.addEventListener("click", () => {
      if (state.expandedBooks.has(book.book)) {
        state.expandedBooks.delete(book.book);
      } else {
        state.expandedBooks.add(book.book);
      }
      renderSidebar();
    });
    bookNode.append(bookButton);

    if (state.expandedBooks.has(book.book)) {
      const lessonList = document.createElement("div");
      lessonList.className = "lesson-list";
      for (const lesson of book.lessons) {
        const button = document.createElement("button");
        button.className = `lesson-button${state.selectedLesson?.id === lesson.id ? " is-selected" : ""}`;
        button.innerHTML = `
          <div class="lesson-row-main">
            <span class="done-dot ${state.completedLessons.has(lessonKey(lesson)) ? "is-done" : ""}"></span>
            <span>${lessonLabel(lesson)}</span>
          </div>
          <div class="lesson-row-title">${escapeHTML(lesson.title)}</div>
        `;
        button.addEventListener("click", () => selectLesson(book.book, lesson.id));
        lessonList.append(button);
      }
      bookNode.append(lessonList);
    }

    elements.bookList.append(bookNode);
  }
}

async function selectLesson(bookNumber, lessonId) {
  const book = state.books.find((candidate) => candidate.book === bookNumber);
  const lesson = book?.lessons.find((candidate) => candidate.id === lessonId);
  if (!book || !lesson) {
    return;
  }

  revokeObjectUrls();
  elements.audio.pause();
  elements.audio.removeAttribute("src");
  elements.audio.load();

  state.selectedBook = book;
  state.selectedLesson = lesson;
  state.selectedLessonId = lesson.id;
  state.pdfDocument = null;
  state.pdfPageIndex = lesson.pageIndex;
  state.pdfRenderToken += 1;
  state.pdfRenderedPages = new Set();
  state.captions = [];
  state.currentCaptionIndex = null;
  resetPdfObserver();
  elements.pdfPages.replaceChildren();

  state.expandedBooks = new Set([book.book]);
  await persistLearningState();
  renderSidebar();
  renderLessonHeader();
  renderExercises();
  renderNotes();
  renderCaptions();
  renderVocabulary();
  await Promise.all([loadPdf(book, lesson), loadAudioAndCaptions(lesson)]);
}

function renderLessonHeader() {
  if (!state.selectedLesson) {
    elements.lessonTitle.textContent = "No lesson selected";
    elements.lessonSubtitle.textContent = "Choose a lesson from the left.";
    elements.markDoneButton.disabled = true;
    return;
  }

  elements.lessonTitle.textContent = `${lessonLabel(state.selectedLesson)} · ${state.selectedLesson.title}`;
  elements.lessonSubtitle.textContent = state.selectedBook.title;
  elements.markDoneButton.disabled = false;
  elements.markDoneButton.textContent = state.completedLessons.has(lessonKey(state.selectedLesson)) ? "Done" : "Mark Lesson Done";
}

async function loadPdf(book, lesson) {
  elements.pdfEmpty.hidden = false;
  elements.pdfLoader.hidden = false;
  elements.pdfPages.hidden = true;
  elements.prevPageButton.disabled = true;
  elements.nextPageButton.disabled = true;
  elements.pageInfo.textContent = "Page --";

  if (!book.pdfKey) {
    elements.pdfLoader.hidden = true;
    elements.pdfEmpty.innerHTML = "<strong>No PDF found</strong><span>This book has no matched PDF file.</span>";
    return;
  }

  const source = await resourceSource(book.pdfKey);
  if (!source) {
    elements.pdfLoader.hidden = true;
    return;
  }

  const url = source.url;
  if (source.shouldRevoke) {
    state.objectUrls.add(url);
  }
  state.pdfDocument = await pdfjs.getDocument(url).promise;
  await buildPdfScroller(lesson.pageIndex, state.pdfRenderToken);
  elements.pdfLoader.hidden = true;
}

async function buildPdfScroller(targetPageIndex, token) {
  if (!state.pdfDocument) {
    return;
  }

  elements.pdfEmpty.hidden = true;
  elements.pdfPages.hidden = false;
  elements.pdfPages.replaceChildren();
  resetPdfObserver();

  const firstPage = await state.pdfDocument.getPage(1);
  if (token !== state.pdfRenderToken) {
    return;
  }

  const stageWidth = Math.max(320, elements.pdfPages.parentElement.clientWidth - 28);
  const baseViewport = firstPage.getViewport({ scale: 1 });
  const scale = Math.min(1.55, stageWidth / baseViewport.width);
  const estimatedViewport = firstPage.getViewport({ scale });
  const pageWidth = Math.floor(estimatedViewport.width);
  const pageHeight = Math.floor(estimatedViewport.height);

  for (let index = 0; index < state.pdfDocument.numPages; index += 1) {
    const pageShell = document.createElement("div");
    pageShell.className = "pdf-page";
    pageShell.dataset.pageIndex = String(index);
    pageShell.style.width = `${pageWidth}px`;
    pageShell.style.height = `${pageHeight}px`;
    elements.pdfPages.append(pageShell);
  }

  state.pdfRenderObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const pageIndex = Number(entry.target.dataset.pageIndex);
      if (entry.isIntersecting) {
        renderPdfPageInto(entry.target, pageIndex, scale, token);
      }
    }
  }, {
    root: elements.pdfPages.parentElement,
    rootMargin: "900px 0px",
    threshold: [0.05, 0.55]
  });

  state.pdfPageObserver = new IntersectionObserver((entries) => {
    const visibleEntries = entries
      .filter((entry) => entry.isIntersecting)
      .sort((lhs, rhs) => rhs.intersectionRatio - lhs.intersectionRatio);

    if (visibleEntries[0]) {
      updateVisiblePdfPage(Number(visibleEntries[0].target.dataset.pageIndex));
    }
  }, {
    root: elements.pdfPages.parentElement,
    threshold: [0.45, 0.6, 0.75]
  });

  for (const pageNode of elements.pdfPages.children) {
    state.pdfRenderObserver.observe(pageNode);
    state.pdfPageObserver.observe(pageNode);
  }

  scrollToPdfPage(targetPageIndex, { behavior: "auto" });
  await renderPdfPageInto(elements.pdfPages.children[state.pdfPageIndex], state.pdfPageIndex, scale, token);
  updateVisiblePdfPage(state.pdfPageIndex);
}

async function renderPdfPageInto(pageNode, pageIndex, scale, token) {
  if (!state.pdfDocument || !pageNode || state.pdfRenderedPages.has(pageIndex)) {
    return;
  }

  state.pdfRenderedPages.add(pageIndex);
  const page = await state.pdfDocument.getPage(pageIndex + 1);
  if (token !== state.pdfRenderToken) {
    return;
  }

  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;
  const context = canvas.getContext("2d");

  await page.render({ canvasContext: context, viewport }).promise;
  if (token !== state.pdfRenderToken) {
    return;
  }

  pageNode.replaceChildren(canvas);
  pageNode.style.width = `${Math.floor(viewport.width)}px`;
  pageNode.style.height = `${Math.floor(viewport.height)}px`;
  pageNode.classList.add("is-rendered");
}

function scrollToPdfPage(pageIndex, options = {}) {
  if (!state.pdfDocument || !elements.pdfPages.children.length) {
    return;
  }

  const safeIndex = Math.max(0, Math.min(pageIndex, state.pdfDocument.numPages - 1));
  const pageNode = elements.pdfPages.children[safeIndex];
  if (!pageNode) {
    return;
  }

  pageNode.scrollIntoView({
    block: "start",
    behavior: options.behavior || "smooth"
  });
  updateVisiblePdfPage(safeIndex);
}

function updateVisiblePdfPage(pageIndex) {
  if (!state.pdfDocument) {
    return;
  }

  const safeIndex = Math.max(0, Math.min(pageIndex, state.pdfDocument.numPages - 1));
  state.pdfPageIndex = safeIndex;
  elements.prevPageButton.disabled = safeIndex === 0;
  elements.nextPageButton.disabled = safeIndex >= state.pdfDocument.numPages - 1;
  elements.pageInfo.textContent = `${safeIndex + 1}/${state.pdfDocument.numPages}`;
}

function updatePdfPageFromScroll() {
  if (!state.pdfDocument || !elements.pdfPages.children.length || elements.pdfPages.hidden) {
    return;
  }

  const stageTop = elements.pdfPages.parentElement.getBoundingClientRect().top + 18;
  let bestIndex = state.pdfPageIndex;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const pageNode of elements.pdfPages.children) {
    const rect = pageNode.getBoundingClientRect();
    const distance = Math.abs(rect.top - stageTop);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = Number(pageNode.dataset.pageIndex);
    }
  }

  updateVisiblePdfPage(bestIndex);
}

function resetPdfObserver() {
  if (state.pdfRenderObserver) {
    state.pdfRenderObserver.disconnect();
    state.pdfRenderObserver = null;
  }
  if (state.pdfPageObserver) {
    state.pdfPageObserver.disconnect();
    state.pdfPageObserver = null;
  }
}

async function loadAudioAndCaptions(lesson) {
  elements.playButton.disabled = true;
  elements.audioScrubber.disabled = true;
  elements.audioTime.textContent = "00:00 / 00:00";

  if (lesson.subtitleKey) {
    const subtitleText = await resourceText(lesson.subtitleKey);
    if (subtitleText) {
      state.captions = parseLRC(subtitleText);
    }
  }

  if (lesson.audioKey) {
    const audio = await resourceSource(lesson.audioKey);
    if (audio) {
      const url = audio.url;
      if (audio.shouldRevoke) {
        state.objectUrls.add(url);
      }
      elements.audio.src = url;
      elements.playButton.disabled = false;
      elements.audioScrubber.disabled = false;
    }
  }

  renderCaptions();
  renderVocabulary();
}

async function resourceSource(key) {
  const hosted = state.resourceRecords.get(key);
  if (hosted?.url) {
    return { url: hosted.url, shouldRevoke: false };
  }

  const record = await getResource(key);
  if (!record?.blob) {
    return null;
  }

  return { url: URL.createObjectURL(record.blob), shouldRevoke: true };
}

async function resourceText(key) {
  const hosted = state.resourceRecords.get(key);
  if (hosted?.url) {
    const response = await fetch(hosted.url);
    if (!response.ok) {
      return "";
    }
    return response.text();
  }

  const record = await getResource(key);
  return record?.blob ? record.blob.text() : "";
}

function onAudioTimeUpdate() {
  updateAudioTime();

  const index = captionIndexAt(elements.audio.currentTime, state.captions);
  if (index !== state.currentCaptionIndex) {
    state.currentCaptionIndex = index;
    renderActiveCaption();
  }
}

function updateAudioTime() {
  const current = elements.audio.currentTime || 0;
  const duration = elements.audio.duration || 0;
  if (Number.isFinite(duration) && duration > 0) {
    elements.audioScrubber.value = Math.round((current / duration) * 1000);
  }
  elements.audioTime.textContent = `${formatTime(current)} / ${formatTime(duration)}`;
}

function renderCaptions() {
  elements.captionList.replaceChildren();

  if (!state.captions.length) {
    elements.currentCaption.textContent = "No captions loaded for this lesson.";
    const empty = document.createElement("p");
    empty.className = "lesson-subtitle";
    empty.textContent = "Import LRC files to see synchronized captions.";
    elements.captionList.append(empty);
    return;
  }

  elements.currentCaption.textContent = state.captions[0].text;
  state.captions.forEach((caption, index) => {
    const button = document.createElement("button");
    button.className = "caption-button";
    button.dataset.index = String(index);
    button.innerHTML = `
      <span class="caption-time">${formatTime(caption.timestamp)}</span>
      <span class="caption-text">${escapeHTML(caption.text)}</span>
    `;
    button.addEventListener("click", () => {
      elements.audio.currentTime = caption.timestamp;
      elements.audio.play();
    });
    elements.captionList.append(button);
  });
}

function renderActiveCaption() {
  const captions = [...elements.captionList.querySelectorAll(".caption-button")];
  for (const button of captions) {
    button.classList.toggle("is-active", Number(button.dataset.index) === state.currentCaptionIndex);
  }

  if (state.currentCaptionIndex !== null && state.captions[state.currentCaptionIndex]) {
    elements.currentCaption.textContent = state.captions[state.currentCaptionIndex].text;
    captions[state.currentCaptionIndex]?.scrollIntoView({ block: "nearest" });
  }
}

function renderVocabulary() {
  elements.vocabularyList.replaceChildren();
  const sourceParts = [
    state.selectedLesson?.title || "",
    ...state.captions.slice(0, 6).map((caption) => caption.text)
  ];
  const stopWords = new Set([
    "a", "an", "and", "are", "as", "at", "be", "but", "by", "can", "do", "does",
    "for", "from", "had", "has", "have", "he", "her", "his", "i", "in", "is",
    "it", "its", "me", "my", "not", "of", "on", "or", "our", "she", "that",
    "the", "their", "this", "to", "was", "we", "were", "what", "with", "you",
    "your"
  ]);
  const seen = new Set();
  const terms = [];
  for (const raw of sourceParts.join(" ").split(/[^A-Za-z0-9']+/)) {
    const word = raw.replace(/^'+|'+$/g, "").toLowerCase();
    if (word.length <= 2 || stopWords.has(word) || /^\d+$/.test(word) || seen.has(word)) {
      continue;
    }
    seen.add(word);
    terms.push(word[0].toUpperCase() + word.slice(1));
    if (terms.length === 5) {
      break;
    }
  }

  if (!terms.length) {
    const empty = document.createElement("span");
    empty.className = "lesson-subtitle";
    empty.textContent = "Vocabulary will appear after captions load.";
    elements.vocabularyList.append(empty);
    return;
  }

  for (const term of terms) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = term;
    elements.vocabularyList.append(chip);
  }
}

function renderExercises() {
  elements.exerciseList.replaceChildren();

  if (!state.selectedLesson) {
    elements.exerciseCount.textContent = "0 questions";
    return;
  }

  const prompts = exercisePrompts(state.selectedLesson.book, state.selectedLesson.lesson);
  elements.exerciseCount.textContent = `${prompts.length} questions`;

  for (const prompt of prompts) {
    const key = answerKey(state.selectedLesson, prompt.questionId);
    const answer = state.answers[key] || { text: "", updatedAt: null };
    const card = document.createElement("article");
    card.className = "exercise-card";
    card.innerHTML = `
      <div class="exercise-prompt">
        <span class="exercise-label">${prompt.label}</span>
        <span>${escapeHTML(prompt.prompt)}</span>
      </div>
      <textarea class="answer-input">${escapeHTML(answer.text)}</textarea>
      <div class="saved-time">${answer.updatedAt ? `Saved ${new Date(answer.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Not saved yet"}</div>
    `;
    const input = card.querySelector(".answer-input");
    const saved = card.querySelector(".saved-time");
    input.addEventListener("input", debounce(async () => {
      state.answers[key] = { text: input.value, updatedAt: Date.now() };
      saved.textContent = `Saved ${new Date(state.answers[key].updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
      saved.classList.remove("is-saved");
      requestAnimationFrame(() => saved.classList.add("is-saved"));
      await persistLearningState();
    }, 250));
    elements.exerciseList.append(card);
  }
}

function renderNotes() {
  if (!state.selectedLesson) {
    elements.lessonNotes.value = "";
    elements.lessonNotes.disabled = true;
    return;
  }

  elements.lessonNotes.disabled = false;
  elements.lessonNotes.value = state.notes[lessonKey(state.selectedLesson)] || "";
}

function selectTab(name) {
  for (const tab of elements.tabs) {
    tab.classList.toggle("is-active", tab.dataset.tab === name);
  }
  elements.studyTab.hidden = name !== "study";
  elements.exerciseTab.hidden = name !== "exercises";
}

let toastTimer;

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    elements.toast.hidden = true;
  }, 1600);
}

function findLesson(lessonId) {
  for (const book of state.books) {
    const lesson = book.lessons.find((candidate) => candidate.id === lessonId);
    if (lesson) {
      return { book, lesson };
    }
  }
  return null;
}

function lessonKey(lesson) {
  return `${lesson.book}-${lesson.lesson}`;
}

function answerKey(lesson, questionId) {
  return `${lesson.book}-${lesson.lesson}-${questionId}`;
}

function debounce(callback, wait) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => callback(...args), wait);
  };
}

function revokeObjectUrls() {
  for (const url of state.objectUrls) {
    URL.revokeObjectURL(url);
  }
  state.objectUrls.clear();
}

function escapeHTML(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    let refreshing = false;

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) {
        return;
      }
      refreshing = true;
      window.location.reload();
    });

    navigator.serviceWorker.register("./sw.js")
      .then((registration) => {
        registration.update();
        if (registration.waiting) {
          registration.waiting.postMessage({ type: "SKIP_WAITING" });
        }
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          worker?.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) {
              worker.postMessage({ type: "SKIP_WAITING" });
            }
          });
        });
      })
      .catch((error) => {
        console.warn("Service worker registration failed.", error);
      });
  }
}
