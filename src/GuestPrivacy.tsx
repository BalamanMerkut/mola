import { ArrowLeft } from 'lucide-react';
import { Brand } from './components';

/*
 * "Gizlilik" at the foot of the guest menu (8 Ekim): what this menu processes, in plain words. TASLAK: the lawyer completes the
 * bracketed parts (docs/PDF_ICERIK_LISTESI.md, Avukat dosyası). The business is the party responsible for its guests' data
 * (veri sorumlusu); Mola (Merkut Studios) provides the software and Mola Merkez (hizmet sağlayıcı). Same text on the café's
 * Wi-Fi address and on the internet address (Mola Merkez, also from its menu copy); no extra request, nothing is loaded.
 */
const LAWYER = 'Avukat dolduracak';
export function GuestPrivacy({ name, en, onEn, onClose }: { name: string; en: boolean; onEn: (en: boolean) => void; onClose: () => void }) {
  return <div className="customer guest-privacy" data-testid="guest-privacy">
    <header className="customer-header"><Brand name={name} en={en} /><div className="customer-header-right"><button className="language-btn" onClick={() => onEn(!en)}>{en ? 'TR' : 'EN'}</button></div></header>
    <main className="customer-main guest-privacy-main">
      <button type="button" className="btn secondary guest-privacy-back" onClick={onClose}><ArrowLeft size={16} aria-hidden="true" />{en ? 'Back to the menu' : 'Menüye dön'}</button>
      <p className="guest-privacy-draft" role="note">{en ? 'DRAFT: this text is being reviewed by a lawyer.' : 'TASLAK: bu metin avukat kontrolündedir.'}</p>
      {en ? <article>
        <h1>Privacy</h1>
        <p>This menu is offered by <strong>{name}</strong>, which is responsible for your data. Mola (Merkut Studios) provides the menu software and the Mola Merkez service.</p>
        <h2>What is processed</h2>
        <ul>
          <li>Your order: products, options, your note, the table and the time; a waiter call or bill request.</li>
          <li>A small cookie (<code>mola_browser</code>, 30 days) so “My orders” shows the orders from this phone and the business can stop orders from it if needed. No advertising or tracking.</li>
          <li>We do not ask for your name, phone or e-mail; there is no account.</li>
        </ul>
        <h2>Over the internet</h2>
        <p>When you open the menu with mobile data or another Wi-Fi, it is served through Mola Merkez, which passes your requests to the business without storing them. A copy of the menu (products, prices, photos) is kept at Mola Merkez so you can see it even when the business’s computer is off; it holds nothing about you. Your IP address is only counted in memory to stop floods.</p>
        <p>Your orders stay on the business’s own computer. Your rights under the Turkish data protection law (KVKK, art. 11): ask the business [{LAWYER}].</p>
      </article> : <article>
        <h1>Gizlilik</h1>
        <p>Bu menüyü <strong>{name}</strong> sunar. Sipariş verirken paylaştığınız bilgilerden <strong>işletme sorumludur</strong> (veri sorumlusu). Menü yazılımını ve Mola Merkez hizmetini Mola (Merkut Studios) sağlar (hizmet sağlayıcı) [{LAWYER}: unvan, adres, iletişim].</p>
        <h2>Ne işlenir?</h2>
        <ul>
          <li><strong>Siparişiniz:</strong> seçtiğiniz ürünler ve seçenekler, yazdığınız not, masanız ve saat; garson çağrısı ya da hesap isteği.</li>
          <li><strong>Bir çerez:</strong> <code>mola_browser</code> (30 gün). “Siparişlerim”de bu telefondan verilen siparişleri göstermek ve gerekirse işletmenin bu telefondan gelen siparişleri durdurabilmesi için. Reklam ya da izleme yoktur.</li>
          <li>Adınız, telefonunuz ya da e-postanız istenmez; hesap açılmaz.</li>
        </ul>
        <h2>İnternetten açılan menü</h2>
        <p>Menüyü mobil veriyle ya da başka bir Wi-Fi'den açtığınızda sayfa <strong>Mola Merkez üzerinden</strong> gelir. Mola Merkez isteklerinizi işletmenin bilgisayarına iletir; <strong>saklamaz ve kaydetmez</strong>. IP adresiniz yalnız aşırı istekleri durdurmak için bellekte sayılır.</p>
        <p>İşletmenin bilgisayarı kapalıyken de menüyü görebilmeniz için <strong>menünün bir kopyası</strong> (ürünler, fiyatlar, fotoğraflar) Mola Merkez'de durur; bu kopyada sizinle ilgili hiçbir bilgi yoktur.</p>
        <h2>Ne kadar saklanır?</h2>
        <p>Siparişler yalnız işletmenin kendi bilgisayarında, işletmenin yasal saklama süresince durur [{LAWYER}: süre]. Bir telefonun engeli 90 gün sonra kalkar. Kapanan yılın kayıtlarında sipariş notları ve telefonunuzun çerez kimliği silinir.</p>
        <h2>Haklarınız</h2>
        <p>KVKK madde 11'deki haklarınız için işletmeye başvurabilirsiniz [{LAWYER}: başvuru yolu].</p>
      </article>}
      <button type="button" className="btn primary guest-privacy-back" onClick={onClose}>{en ? 'Back to the menu' : 'Menüye dön'}</button>
    </main>
  </div>;
}
