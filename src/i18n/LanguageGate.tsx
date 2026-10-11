/** Applies the saved language before the first screen renders (avoids an English flash for Hindi users). */
import React, { useEffect, useState } from 'react';
import { loadStoredLanguage } from './index';

export function LanguageGate({ children, fallback = null }: { children: React.ReactNode; fallback?: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    loadStoredLanguage().finally(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, []);
  return <>{ready ? children : fallback}</>;
}
