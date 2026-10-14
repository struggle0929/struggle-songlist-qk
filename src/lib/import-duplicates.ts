type TrackIdentity = { title: string; artist: string };
export type DuplicateReason = 'existing' | 'batch';

// Keep version suffixes and punctuation: a live/cover version is not the same recording.
const normalize = (value: string) => value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
const identity = (song: TrackIdentity) =>
  JSON.stringify([normalize(song.title), normalize(song.artist).replace(/\s*[\/、]\s*/gu, '/')]);

export function markImportDuplicates<T extends TrackIdentity>(songs: T[], existingSongs: TrackIdentity[]) {
  const existing = new Set(existingSongs.map(identity));
  const seen = new Set<string>();
  return songs.map((song): T & { duplicateReason?: DuplicateReason } => {
    const key = identity(song);
    const duplicateReason = existing.has(key) ? 'existing' : seen.has(key) ? 'batch' : undefined;
    seen.add(key);
    return { ...song, duplicateReason };
  });
}
