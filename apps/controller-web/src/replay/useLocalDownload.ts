import { useCallback, useEffect, useRef } from 'react';

export function useLocalDownload() {
  const urls = useRef(new Map<string, number>());
  const clear = useCallback(() => {
    for (const [url, timer] of urls.current) { clearTimeout(timer); URL.revokeObjectURL(url); }
    urls.current.clear();
  }, []);
  useEffect(() => clear, [clear]);
  const download = useCallback((blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    try {
      link.href = url; link.download = filename; document.body.append(link); link.click();
    } finally {
      link.remove();
      urls.current.set(url, window.setTimeout(() => { URL.revokeObjectURL(url); urls.current.delete(url); }, 1000));
    }
  }, []);
  return { download, clear };
}
