import { useEffect, useState } from 'react';
import { ArrowLeft, Download, ExternalLink, Smartphone, TabletSmartphone } from 'lucide-react';
import { Brand, Notice } from './components';
import { deviceKind, inMolaApp, molaAppVersion, standalone, type DeviceKind } from './molaApp';
import './install-page.css';

/*
 * /uygulama: how the staff put Mola on their phones and tablets (the café computer's Tabletler window and Ayarlar →
 * Cihazlar show a QR of this address). Android: the thin Mola app (APK) served by this café computer. iPhone/iPad: Safari
 * → Paylaş → Ana Ekrana Ekle. Café network only: from elsewhere /api/uygulama answers 404 and the page says so.
 */
type Info = { app: 'mola'; name: string | null; version: string; apk: { size: number; path: string } | null };
const size = (bytes: number) => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
/** The Android app opens with this café's address (mobile/android: intent filter mola://baglan). */
export const appLink = (origin: string) => `mola://baglan?u=${encodeURIComponent(origin)}`;

export function InstallPage() {
  const [info, setInfo] = useState<Info | null | 'off'>(null);
  const app = inMolaApp(), kind: DeviceKind = deviceKind();
  useEffect(() => {
    document.title = 'Mola · Telefona ve tablete kur';
    // Opened from the home screen already: nothing to install, straight to sign-in.
    if (standalone() && !app) { location.replace('/'); return; }
    let live = true;
    void fetch('/api/uygulama', { credentials: 'same-origin', signal: AbortSignal.timeout(8000) })
      .then(r => r.ok ? r.json() as Promise<Info> : Promise.reject(new Error(String(r.status))))
      .then(v => { if (live) setInfo(v.app === 'mola' ? v : 'off'); }, () => { if (live) setInfo('off'); });
    return () => { live = false; };
  }, []);
  const ready = info && info !== 'off' ? info : null;
  const android = <AndroidCard key="android" info={ready} loading={info === null} />, ios = <IosCard key="ios" />;
  return <main className="install-page">
    <header className="install-head"><Brand /><a className="install-back" href="/"><ArrowLeft size={16} aria-hidden="true" />Giriş ekranı</a></header>
    <h1>Mola'yı telefona ve tablete kurun</h1>
    <p className="install-lead">{ready?.name ? <><strong>{ready.name}</strong> · </> : null}Garson telefonu, mutfak ve kasa tableti: kurduktan sonra Mola ana ekrandan tek dokunuşla açılır.</p>
    {app ? <Notice tone="success">Mola uygulamasını kullanıyorsunuz{molaAppVersion() ? ` (sürüm ${molaAppVersion()})` : ''}. Bu cihazda başka bir şey kurmanız gerekmez.</Notice> : <>
      {info === 'off' && <Notice tone="error">Bu sayfa yalnız kafenin Wi-Fi ağında çalışır. Telefonu kafe bilgisayarıyla aynı Wi-Fi ağına bağlayıp QR kodunu yeniden okutun.</Notice>}
      {kind === 'ios' ? [ios, android] : [android, ios]}
    </>}
    <p className="install-foot muted small">Telefon ya da tablet kafe bilgisayarıyla aynı Wi-Fi ağında olmalı. Giriş için kullanıcı adınızı ve şifrenizi işletme sahibinden alın.</p>
  </main>;
}

function AndroidCard({ info, loading }: { info: Info | null; loading: boolean }) {
  return <section className="install-card" aria-labelledby="install-android">
    <div className="install-card-head"><TabletSmartphone size={20} aria-hidden="true" /><h2 id="install-android">Android telefon ve tablet</h2></div>
    {info?.apk ? <div className="install-download">
      <a className="btn primary" href={info.apk.path} download="Mola.apk"><Download size={18} aria-hidden="true" />Mola uygulamasını indir</a>
      <span className="muted small">Mola.apk · {size(info.apk.size)}</span>
    </div> : !loading && <Notice>Android uygulaması bu kafe bilgisayarında yok. Chrome'da sağ üstteki ⋮ menüsünden “Ana ekrana ekle”yi seçerek de kullanabilirsiniz.</Notice>}
    <ol className="install-steps">
      <li><strong>İndirin.</strong> “Mola uygulamasını indir”e dokunun. İndirme bitince bildirimden ya da Dosyalar → İndirilenler'den <b>Mola.apk</b> dosyasını açın.</li>
      <li><strong>Bu kaynağa izin verin.</strong> Telefon bilinmeyen uygulamalar için uyarırsa <b>Ayarlar</b>'a dokunun, <b>Bu kaynaktan izin ver</b>'i açın ve geri dönün. Bu izin yalnız bir kez sorulur.</li>
      <li><strong>Yükleyin ve açın.</strong> <b>Yükle</b>'ye, sonra <b>Aç</b>'a dokunun. Mola bu kafeyi kendisi bulur; bulamazsa aşağıdaki düğmeye dokunun.</li>
    </ol>
    <a className="btn secondary" href={appLink(location.origin)}><ExternalLink size={16} aria-hidden="true" />Uygulamada aç</a>
    <p className="muted small">Mola güncellendiğinde uygulamayı yeniden kurmanız gerekmez: ekranlar kafe bilgisayarından gelir.</p>
  </section>;
}

function IosCard() {
  return <section className="install-card" aria-labelledby="install-ios">
    <div className="install-card-head"><Smartphone size={20} aria-hidden="true" /><h2 id="install-ios">iPhone ve iPad</h2></div>
    <p className="install-card-note">Uygulama mağazası gerekmez: Mola, Safari'den ana ekrana eklenir ve kendi penceresinde açılır.</p>
    <ol className="install-steps illustrated">
      <li><StepPicture kind="safari" /><div><strong>Bu sayfayı Safari'de açın.</strong> QR kodunu iPhone'un kamerasıyla okuttuysanız sayfa zaten Safari'de açılır.</div></li>
      <li><StepPicture kind="share" /><div><strong>Paylaş'a dokunun.</strong> Ekranın altındaki (iPad'de sağ üstteki) yukarı oklu kare simge.</div></li>
      <li><StepPicture kind="add" /><div><strong>“Ana Ekrana Ekle”yi seçin.</strong> Listede görmüyorsanız biraz aşağı kaydırın.</div></li>
      <li><StepPicture kind="done" /><div><strong>Sağ üstte “Ekle”ye dokunun.</strong> Ana ekranda Mola simgesi belirir; Mola'yı hep oradan açın.</div></li>
    </ol>
  </section>;
}

/** Simple drawings of each step (no screenshots, no product logos): a phone with the part to touch in green. */
function StepPicture({ kind }: { kind: 'safari' | 'share' | 'add' | 'done' }) {
  const green = '#234c3e', soft = '#e3ece0', line = '#c9d2c5';
  return <svg className="install-picture" viewBox="0 0 72 112" width="72" height="112" aria-hidden="true" focusable="false">
    <rect x="3" y="2" width="66" height="108" rx="11" fill="#fff" stroke={line} strokeWidth="2" />
    <rect x="26" y="7" width="20" height="4" rx="2" fill={line} />
    {kind === 'safari' && <>
      <rect x="10" y="16" width="52" height="11" rx="5.5" fill={soft} stroke={green} strokeWidth="1.5" />
      <rect x="16" y="20.5" width="30" height="2" rx="1" fill={green} />
      {[36, 46, 56, 66].map(y => <rect key={y} x="12" y={y} width={y === 66 ? 30 : 48} height="4" rx="2" fill={soft} />)}
      <rect x="8" y="94" width="56" height="10" rx="3" fill={soft} />
    </>}
    {kind === 'share' && <>
      {[18, 28, 38, 48].map(y => <rect key={y} x="12" y={y} width={y === 48 ? 30 : 48} height="4" rx="2" fill={soft} />)}
      <rect x="8" y="92" width="56" height="13" rx="3" fill={soft} />
      <circle cx="36" cy="98.5" r="8.5" fill="#fff" stroke={green} strokeWidth="1.5" />
      <path d="M32.5 97.5v4.5h7v-4.5M36 93.5v6M33.6 95.6 36 93.2l2.4 2.4" fill="none" stroke={green} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </>}
    {kind === 'add' && <>
      <rect x="8" y="40" width="56" height="64" rx="6" fill={soft} />
      {[46, 72, 86].map(y => <rect key={y} x="13" y={y} width="46" height="9" rx="3" fill="#fff" />)}
      <rect x="11" y="57" width="50" height="12" rx="3.5" fill="#fff" stroke={green} strokeWidth="1.5" />
      <rect x="15" y="61.5" width="22" height="3" rx="1.5" fill={green} />
      <rect x="49" y="59.5" width="7" height="7" rx="1.8" fill="none" stroke={green} strokeWidth="1.2" />
      <path d="M52.5 61.3v3.4M50.8 63h3.4" stroke={green} strokeWidth="1.2" strokeLinecap="round" />
    </>}
    {kind === 'done' && <>
      {[0, 1, 2, 3, 4, 5, 6, 7].map(i => <rect key={i} x={12 + (i % 3) * 18} y={18 + Math.floor(i / 3) * 20} width="12" height="12" rx="3" fill={i === 7 ? green : soft} />)}
      <path d="M33.4 61.6h4.6v3.2a1.6 1.6 0 0 1-1.6 1.6H35a1.6 1.6 0 0 1-1.6-1.6zM38 62.3h.4a1 1 0 0 1 0 2.6H38" fill="none" stroke="#f3ebdd" strokeWidth=".8" strokeLinecap="round" strokeLinejoin="round" />
      <text x="36" y="79" fontSize="7" textAnchor="middle" fill={green} fontFamily="Arial, sans-serif">Mola</text>
    </>}
  </svg>;
}
