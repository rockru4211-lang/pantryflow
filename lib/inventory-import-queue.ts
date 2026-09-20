export type ImportQueueEntry = {
  id: string;
  file: File;
  status: 'pending' | 'processing' | 'done' | 'failed';
  error?: string;
};

// Keep successful files when another file fails; a retry visits only unfinished files.
export async function runInventoryImportQueue(
  entries: ImportQueueEntry[],
  processFile: (file: File) => Promise<void>,
  onChange: (entries: ImportQueueEntry[]) => void,
  describeError: (error: unknown) => string,
) {
  const next = entries.map(entry => ({...entry}));
  const publish = () => onChange(next.map(entry => ({...entry})));
  for (const entry of next) {
    if (entry.status === 'done') continue;
    entry.status = 'processing';
    entry.error = undefined;
    publish();
    try {
      await processFile(entry.file);
      entry.status = 'done';
    } catch (error) {
      entry.status = 'failed';
      entry.error = describeError(error);
    }
    publish();
  }
  return next;
}

export function replaceImportedFile<T extends {file: {file_sha256: string}}>(
  current: T[], hash: string, incoming: T[],
): T[] {
  return [...current.filter(item => item.file.file_sha256 !== hash), ...incoming];
}
