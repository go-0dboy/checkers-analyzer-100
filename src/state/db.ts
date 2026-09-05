/* ============================================================
 * База партий в IndexedDB. Каждая партия хранится как JSON:
 * заголовки, стартовый FEN и сериализованное дерево ходов
 * (ветвления, комментарии, NAG) — формат PDN 3.0 внутри.
 * ============================================================ */

export interface DbGame {
  id: string;
  name: string;
  date: string;
  white: string;
  black: string;
  event: string;
  result: string;
  startFen: string;
  /** сериализованное дерево (serializeTree) */
  treeJson: string;
  /** полуходов в основной линии — для списка */
  moves: number;
  /** есть ли варианты/комментарии — для бейджа */
  annotated: boolean;
}

const DB_NAME = 'sk100.db';
const DB_VER = 1;
const STORE = 'games';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB недоступен'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('не удалось открыть базу'));
  });
}

function tx<T>(db: IDBDatabase, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error ?? new Error('ошибка операции с базой'));
  });
}

export async function listGames(): Promise<DbGame[]> {
  const db = await open();
  const all = await tx<DbGame[]>(db, 'readonly', (s) => s.getAll());
  db.close();
  return all.sort((a, b) => (a.date < b.date ? 1 : -1));
}

export async function saveGame(g: DbGame): Promise<void> {
  const db = await open();
  await tx(db, 'readwrite', (s) => s.put(g));
  db.close();
}

export async function deleteGame(id: string): Promise<void> {
  const db = await open();
  await tx(db, 'readwrite', (s) => s.delete(id));
  db.close();
}
