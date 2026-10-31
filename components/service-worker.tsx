'use client';
import { useEffect } from 'react';

// Production only: a worker registered on localhost outlives the dev server and
// keeps answering for whichever project next uses that port.
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, []);
  return null;
}
