const DB_NAME = "nce-pad-reader-web";
const DB_VERSION = 1;
const RESOURCE_STORE = "resources";
const META_STORE = "meta";

let dbPromise;

function openDatabase() {
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(RESOURCE_STORE)) {
        db.createObjectStore(RESOURCE_STORE, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: "key" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

async function withStore(storeName, mode, action) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    const result = action(store);

    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveResources(records) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(RESOURCE_STORE, "readwrite");
    const store = transaction.objectStore(RESOURCE_STORE);
    store.clear();
    for (const record of records) {
      store.put(record);
    }
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function getAllResources() {
  return withStore(RESOURCE_STORE, "readonly", (store) => requestToPromise(store.getAll()));
}

export async function getResource(key) {
  return withStore(RESOURCE_STORE, "readonly", (store) => requestToPromise(store.get(key)));
}

export async function saveMeta(key, value) {
  return withStore(META_STORE, "readwrite", (store) => store.put({ key, value }));
}

export async function getMeta(key, fallbackValue) {
  const record = await withStore(META_STORE, "readonly", (store) => requestToPromise(store.get(key)));
  return record ? record.value : fallbackValue;
}

export async function clearResources() {
  return withStore(RESOURCE_STORE, "readwrite", (store) => store.clear());
}
