const PDF_PATTERN = /新概念英语(\d+)/;
const BOOK_PATTERN = /(?:NCE(\d+)|第(\d+)册)/;
const LESSON_PATTERN = /^(\d+)/;
const LESSON_RANGE_PATTERN = /^\d+&(\d+)/;

const BOOK_FOUR_PAGE_INDEX = {
  1: 33, 2: 39, 3: 45, 4: 51, 5: 57, 6: 63,
  7: 69, 8: 75, 9: 81, 10: 87, 11: 93, 12: 98,
  13: 104, 14: 110, 15: 115, 16: 120, 17: 126, 18: 132,
  19: 138, 20: 143, 21: 149, 22: 155, 23: 160, 24: 166,
  25: 177, 26: 183, 27: 188, 28: 194, 29: 200, 30: 205,
  31: 211, 32: 216, 33: 223, 34: 229, 35: 235, 36: 241,
  37: 246, 38: 251, 39: 256, 40: 262, 41: 268, 42: 273,
  43: 279, 44: 285, 45: 291, 46: 296, 47: 302, 48: 308
};

export function lessonPageIndex(book, lesson) {
  if (lesson <= 0) {
    return 0;
  }

  if (book === 1 && lesson <= 144) {
    return 4 + ((lesson - 1) * 2);
  }

  if (book === 2 && lesson <= 96) {
    const group = Math.floor((lesson - 1) / 24);
    const lessonInGroup = (lesson - 1) % 24;
    return 51 + (group * 110) + (lessonInGroup * 4);
  }

  if (book === 3 && lesson <= 60) {
    const groupStartPages = [39, 131, 217];
    const group = Math.floor((lesson - 1) / 20);
    return groupStartPages[group] + (((lesson - 1) % 20) * 4);
  }

  if (book === 4) {
    return BOOK_FOUR_PAGE_INDEX[lesson] ?? 0;
  }

  return 0;
}

export function lessonLabel(lesson) {
  if (lesson.lessonEnd > lesson.lesson) {
    return `Lesson ${lesson.lesson}-${lesson.lessonEnd}`;
  }
  return `Lesson ${lesson.lesson}`;
}

export function exercisePrompts(book, lesson) {
  if (book === 1 && lesson === 1) {
    return [
      { questionId: "q1", label: "Q1", prompt: "Write the sentence you hear first." },
      { questionId: "q2", label: "Q2", prompt: "Copy one useful expression from this lesson." },
      { questionId: "q3", label: "Q3", prompt: "Write your own short sentence using \"Excuse me\"." }
    ];
  }

  return [
    { questionId: "dictation", label: "Q1", prompt: "Write the sentence you hear first." },
    { questionId: "expression", label: "Q2", prompt: "Copy one useful expression from this lesson." },
    { questionId: "sentence", label: "Q3", prompt: "Write your own sentence using a new word or pattern." },
    { questionId: "note", label: "Q4", prompt: "Write one question or mistake to review later." }
  ];
}

export function createResourceRecord(file) {
  const relativePath = file.webkitRelativePath || file.relativePath || file.name;
  const normalizedPath = relativePath.replace(/\\/g, "/");
  return {
    key: normalizedPath,
    path: normalizedPath,
    name: file.name,
    type: file.type || extensionType(file.name),
    size: file.size,
    updatedAt: Date.now(),
    blob: file
  };
}

export function buildResourceIndex(records) {
  const pdfsByBook = new Map();
  const bookTitles = new Map();
  const lessonsByKey = new Map();

  for (const record of records) {
    const ext = extension(record.name);
    if (ext === "pdf") {
      const info = pdfInfo(record);
      if (info) {
        pdfsByBook.set(info.book, record.key);
        bookTitles.set(info.book, info.title);
      }
      continue;
    }

    if (ext !== "mp3" && ext !== "lrc") {
      continue;
    }

    const info = lessonInfo(record);
    if (!info) {
      continue;
    }

    const key = `${info.book}-${info.lesson}`;
    const draft = lessonsByKey.get(key) || {
      book: info.book,
      lesson: info.lesson,
      lessonEnd: info.lessonEnd,
      title: info.title,
      audioKey: null,
      subtitleKey: null
    };

    if (ext === "mp3") {
      draft.audioKey = record.key;
    } else {
      draft.subtitleKey = record.key;
    }

    lessonsByKey.set(key, draft);
  }

  const bookNumbers = new Set([...pdfsByBook.keys(), ...[...lessonsByKey.values()].map((lesson) => lesson.book)]);

  return [...bookNumbers].sort((a, b) => a - b).map((book) => {
    const lessons = [...lessonsByKey.values()]
      .filter((lesson) => lesson.book === book)
      .sort((a, b) => a.lesson - b.lesson)
      .map((lesson) => ({
        ...lesson,
        id: `${lesson.book}-${lesson.lesson}`,
        pageIndex: lessonPageIndex(lesson.book, lesson.lesson)
      }));

    return {
      book,
      title: bookTitles.get(book) || `Book ${book}`,
      pdfKey: pdfsByBook.get(book) || null,
      lessons
    };
  });
}

function lessonInfo(record) {
  const fullPath = record.path;
  const filename = basenameWithoutExtension(record.name);
  const book = firstInteger(fullPath, BOOK_PATTERN);
  const lesson = firstInteger(filename, LESSON_PATTERN);
  if (!book || !lesson) {
    return null;
  }

  const lessonEnd = firstInteger(filename, LESSON_RANGE_PATTERN) || lesson;
  const title = filename.replace(/^\d+(?:&\d+)?[－\-\s]*/, "").trim();
  if (!title) {
    return null;
  }

  return { book, lesson, lessonEnd, title };
}

function pdfInfo(record) {
  const filename = basenameWithoutExtension(record.name);
  const book = firstInteger(filename, PDF_PATTERN);
  if (!book) {
    return null;
  }

  return { book, title: filename.trim() || `Book ${book}` };
}

function firstInteger(value, pattern) {
  const match = value.match(pattern);
  if (!match) {
    return null;
  }

  for (let index = 1; index < match.length; index += 1) {
    const captured = match[index];
    if (captured) {
      return Number(captured);
    }
  }
  return null;
}

function basenameWithoutExtension(name) {
  return name.replace(/\.[^.]+$/, "");
}

function extension(name) {
  const parts = name.toLowerCase().split(".");
  return parts.length > 1 ? parts.pop() : "";
}

function extensionType(name) {
  const ext = extension(name);
  if (ext === "pdf") return "application/pdf";
  if (ext === "mp3") return "audio/mpeg";
  if (ext === "lrc") return "text/plain";
  return "application/octet-stream";
}
