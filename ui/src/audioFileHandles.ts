/**
 * Persists FileSystemFileHandle objects (File System Access API) in IndexedDB so a
 * picked audio file can be silently reopened on the next visit instead of re-prompting.
 * Only supported in Chromium-based browsers; callers must handle `null`/unsupported gracefully.
 */

const DB_NAME = 'kivsee-audio-handles'
const STORE_NAME = 'handles'
const DB_VERSION = 1

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function saveHandle(key: string, handle: unknown): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(handle, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

async function loadHandle(key: string): Promise<any | null> {
  const db = await openDb()
  const handle = await new Promise<any | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).get(key)
    req.onsuccess = () => resolve(req.result ?? null)
    req.onerror = () => reject(req.error)
  })
  db.close()
  return handle
}

export function supportsFileHandles(): boolean {
  return typeof (window as any).showOpenFilePicker === 'function'
}

export type HandleReuseResult =
  | { status: 'resolved'; file: File }
  | { status: 'needs-permission'; handle: any }

/** Silent check only — never prompts. Safe to call from a useEffect with no user gesture. */
export async function tryReuseHandle(key: string): Promise<HandleReuseResult | null> {
  if (!supportsFileHandles()) return null
  const handle = await loadHandle(key).catch(() => null)
  if (!handle) return null
  try {
    const perm = await handle.queryPermission({ mode: 'read' })
    if (perm === 'granted') {
      const file = await handle.getFile()
      return { status: 'resolved', file }
    }
    return { status: 'needs-permission', handle }
  } catch {
    return null
  }
}

/** Must be called from a user gesture (click handler) — re-requests permission on a stored handle. */
export async function grantPermissionAndGetFile(handle: any): Promise<File | null> {
  try {
    const perm = await handle.requestPermission({ mode: 'read' })
    if (perm !== 'granted') return null
    return await handle.getFile()
  } catch {
    return null
  }
}

/**
 * Opens the native file picker (must be called from a user gesture) and remembers the
 * chosen file's handle under its own name, so it can be silently reopened next time the
 * song's audioFilePath references that same name.
 */
export async function pickAndRememberAudioFile(): Promise<{ file: File; name: string } | null> {
  if (!supportsFileHandles()) return null
  try {
    const [handle] = await (window as any).showOpenFilePicker({
      types: [{ description: 'Audio', accept: { 'audio/*': ['.wav', '.mp3', '.ogg', '.m4a', '.flac'] } }],
    })
    const file = await handle.getFile()
    await saveHandle(handle.name, handle)
    return { file, name: handle.name }
  } catch {
    return null
  }
}
