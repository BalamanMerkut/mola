import { useEffect, useState } from 'react';
import { api } from './api';
import type { UpdateView } from './UpdateBanner';
import { APP_VERSION, STUDIO, versionLine } from './version';
import './app-version.css';

/** Otomatik güncelleme in a few words (GET /api/staff/update, owner only). */
const updateText = (v: UpdateView) => ({
  idle: 'güncel', downloading: `${v.version} indiriliyor`, ready: `${v.version} hazır, kapanışta kurulacak`, installing: 'kuruluyor', installed: `${v.version} kuruldu`,
  failed: v.from ? `${v.version} kurulamadı, önceki sürümde` : 'indirilemedi, yeniden denenecek', rolled_back: `${v.version} açılamadı, önceki sürümde`,
} as Record<UpdateView['state'], string>)[v.state] ?? '';

/**
 * "Mola 0.1.0 · Merkut Studios" under Hesabım, Ayarlar and the sign-in. Mola Yönetim's one footer (every page, Ayarlar too):
 * "Mola Yönetim 0.1.0 · Merkez 0.1.0 · Merkut Studios" (`merkez`: the server's version from /state).
 * `update` (the owner's pages): adds "Güncelleme: güncel / … hazır" when the update agent answers; nothing otherwise.
 */
export function AppVersion({ product = 'Mola', update = false, merkez }: { product?: 'Mola' | 'Mola Yönetim'; update?: boolean; merkez?: string }) {
  const [status, setStatus] = useState('');
  useEffect(() => {
    if (!update) return;
    let live = true;
    api<UpdateView>('/api/staff/update').then(v => { if (live) setStatus(updateText(v)); }, () => undefined);
    return () => { live = false; };
  }, [update]);
  const line = merkez ? `${product} ${APP_VERSION} · Merkez ${merkez} · ${STUDIO}` : versionLine(product);
  return <p className="app-version" data-testid="app-version">{line}{status && <span className="app-version-update">&nbsp;· Güncelleme: {status}</span>}</p>;
}
