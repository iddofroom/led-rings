/**
 * Local audio cache (IndexedDB). Browsers can't re-open a disk file by path on reload,
 * so when the user picks an MP3 via Browse we stash the bytes here keyed by filename.
 * On startup the app re-opens the exact file from this cache — so "the last song I worked
 * on" comes back with its audio, not just the timeline.
 */
const DB_NAME = 'led-audio-cache'
const STORE = 'audio'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** Store an audio blob under `key` (the filename / audioFilePath). Best-effort. */
export async function putAudio(key: string, blob: Blob): Promise<void> {
  if (!key || !blob) return
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(blob, key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch (e) {
    console.warn('audioCache.putAudio failed', e)
  }
}

/** Retrieve a cached audio blob by `key`, or null. Never throws. */
export async function getAudio(key: string): Promise<Blob | null> {
  if (!key) return null
  try {
    const db = await openDb()
    const blob = await new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const rq = tx.objectStore(STORE).get(key)
      rq.onsuccess = () => resolve(rq.result instanceof Blob ? rq.result : null)
      rq.onerror = () => reject(rq.error)
    })
    db.close()
    return blob
  } catch {
    return null
  }
}
