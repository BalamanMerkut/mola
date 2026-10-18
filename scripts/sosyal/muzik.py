"""Sosyal medya videoları için sakin, telifsiz arka plan melodisi (sıfırdan sentez; hazır müzik ya da örnek kullanılmaz).

Kullanım: python scripts/sosyal/muzik.py <çıktı.wav> [saniye] [sakin|canli|canli-uzun] [bölüm geçişleri: 12.5,85,…]
Yumuşak elektrik piyano + arkada hafif pad + bas; 80 BPM, Fmaj7 - Em7 - Dm7 - Cmaj7 - Fmaj7.
"""
import sys
import wave
import numpy as np

SR = 44100
BPM = 80
VURUS = 60 / BPM
OLCU = 4 * VURUS
rng = np.random.default_rng(7)


def nota(ad: str) -> float:
    """'A4' → Hz."""
    sira = {'C': -9, 'D': -7, 'E': -5, 'F': -4, 'G': -2, 'A': 0, 'B': 2}
    yari = sira[ad[0]] + (1 if '#' in ad else 0)
    return 440.0 * 2 ** ((yari + 12 * (int(ad[-1]) - 4)) / 12)


def piyano(f: float, sure: float, guc: float) -> np.ndarray:
    t = np.arange(int(SR * (sure + 2.5))) / SR
    ses = np.zeros_like(t)
    for h, (a, tau) in enumerate([(1, 1.6), (.32, .9), (.1, .5), (.04, .3)], 1):
        for sapma in (-.0015, .0015):  # hafif koro: iki teli az farkla çal
            ses += a * np.sin(2 * np.pi * f * h * (1 + sapma) * t) * np.exp(-t / tau)
    atak = np.minimum(1, t / .008)
    birak = np.where(t > sure, np.exp(-(t - sure) / .35), 1)
    return guc * ses * atak * birak / 2


def pad(fler, sure: float, guc: float) -> np.ndarray:
    t = np.arange(int(SR * (sure + 1.2))) / SR
    ses = sum(np.sin(2 * np.pi * f * t) + .25 * np.sin(2 * np.pi * 2 * f * t + .3) for f in fler)
    zarf = np.minimum(1, t / .9) * np.where(t > sure, np.exp(-(t - sure) / .4), 1)
    titresim = 1 + .08 * np.sin(2 * np.pi * .25 * t)
    return guc * ses * zarf * titresim / len(fler)


def ekle(iz: np.ndarray, parca: np.ndarray, bas: float) -> None:
    i = int(bas * SR)
    son = min(len(iz), i + len(parca))
    iz[i:son] += parca[:son - i]


def yanki(kuru: np.ndarray, sure=2.2, oran=.28) -> np.ndarray:
    """Yapay oda yankısı: üstel sönen gürültüyle evrişim (FFT)."""
    t = np.arange(int(SR * sure)) / SR
    ir = rng.standard_normal(len(t)) * np.exp(-t / .55)
    ir[:int(.012 * SR)] = 0  # ilk yansımadan önce kısa boşluk
    ir /= np.sqrt(np.sum(ir ** 2))
    n = len(kuru) + len(ir)
    islak = np.fft.irfft(np.fft.rfft(kuru, n) * np.fft.rfft(ir, n), n)[:len(kuru)]
    return (1 - oran) * kuru + oran * islak


def uret(saniye: float) -> np.ndarray:
    iz = np.zeros(int(SR * (saniye + 3)))
    akorlar = [('F3', ['F3', 'A3', 'C4', 'E4']), ('E3', ['E3', 'G3', 'B3', 'D4']),
               ('D3', ['D3', 'F3', 'A3', 'C4']), ('C3', ['C3', 'E3', 'G3', 'B3']), ('F3', ['F3', 'A3', 'C4', 'E4'])]
    # Ezgi: (ölçü, vuruş, uzunluk vuruş, nota)
    ezgi = [(0, 0, 1, 'A4'), (0, 1, 1, 'C5'), (0, 2, 2, 'E5'),
            (1, 0, 1, 'D5'), (1, 1, 1, 'B4'), (1, 2, 2, 'G4'),
            (2, 0, 1, 'A4'), (2, 1, 1, 'C5'), (2, 2, 1, 'D5'), (2, 3, 1, 'E5'),
            (3, 0, 2, 'G5'), (3, 2, 2, 'E5'),
            (4, 0, 1.5, 'A4'), (4, 1.5, .5, 'G4'), (4, 2, 3, 'C5')]
    olcu_sayisi = int(np.ceil(saniye / OLCU))
    for o in range(olcu_sayisi):
        kok, ak = akorlar[o % len(akorlar)]
        b = o * OLCU
        ekle(iz, pad([nota(n) for n in ak], OLCU, .10), b)
        for v in (0, 2):  # bas: 1. ve 3. vuruş
            ekle(iz, piyano(nota(kok[0] + '2'), 2 * VURUS, .30), b + v * VURUS)
        for k, n in enumerate(ak):  # akor: yavaşça açılan arpej
            ekle(iz, piyano(nota(n), 3 * VURUS, .10), b + k * .06 + VURUS * 0)
            ekle(iz, piyano(nota(n), VURUS, .06), b + 2 * VURUS + k * .05)
    for o, v, u, n in ezgi:
        if o < olcu_sayisi:
            ekle(iz, piyano(nota(n), u * VURUS, .22 * rng.uniform(.9, 1.0)), o * OLCU + v * VURUS + rng.uniform(0, .012))
    iz = iz[:int(SR * saniye)]
    sol, sag = yanki(iz), yanki(np.roll(iz, int(.004 * SR)))
    st = np.stack([sol, sag], axis=1)
    t = np.arange(len(st)) / SR
    st *= np.minimum(1, t / .4)[:, None] * np.clip((saniye - t) / 2.0, 0, 1)[:, None]  # 0,4 sn giriş, 2 sn çıkış
    return st / np.max(np.abs(st)) * 10 ** (-3 / 20)


def gurultu(sure: float, tau: float, tiz: bool) -> np.ndarray:
    t = np.arange(int(SR * sure)) / SR
    g = rng.standard_normal(len(t))
    if tiz:
        g = np.diff(g, prepend=0)  # kabaca yüksek geçiren: shaker
    else:
        g = np.convolve(g, np.ones(6) / 6, mode='same')  # kabaca bant: alkış
    return g * np.exp(-t / tau) * np.minimum(1, t / .002)


def davul(sure=.35) -> np.ndarray:
    t = np.arange(int(SR * sure)) / SR
    f = 50 + 70 * np.exp(-t / .04)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / .12)


def uret_canli(saniye: float, bpm: float = 100) -> np.ndarray:
    """Daha canlı ama sakin: 100 BPM, C - G - Am - F, hafif davul, shaker ve parmak şıklatması."""
    vurus = 60 / bpm
    olcu = 4 * vurus
    iz = np.zeros(int(SR * (saniye + 3)))
    akorlar = [('C', ['C4', 'E4', 'G4']), ('G', ['B3', 'D4', 'G4']), ('A', ['C4', 'E4', 'A4']), ('F', ['C4', 'F4', 'A4']),
               ('C', ['C4', 'E4', 'G4']), ('G', ['B3', 'D4', 'G4']), ('C', ['C4', 'E4', 'G4'])]
    ezgi = [(0, 0, .5, 'E5'), (0, .5, .5, 'G5'), (0, 1, 1, 'E5'), (0, 2, .5, 'C5'), (0, 2.5, .5, 'D5'), (0, 3, 1, 'E5'),
            (1, 0, .5, 'D5'), (1, .5, .5, 'G4'), (1, 1, 1, 'B4'), (1, 2, 1.5, 'D5'),
            (2, 0, .5, 'C5'), (2, .5, .5, 'E5'), (2, 1, 1, 'A5'), (2, 2, .5, 'G5'), (2, 2.5, .5, 'E5'), (2, 3, 1, 'C5'),
            (3, 0, 1, 'A4'), (3, 1, .5, 'C5'), (3, 1.5, .5, 'F5'), (3, 2, 1, 'E5'), (3, 3, 1, 'D5'),
            (4, 0, .5, 'E5'), (4, .5, .5, 'G5'), (4, 1, 1, 'E5'), (4, 2, .5, 'C5'), (4, 2.5, .5, 'D5'), (4, 3, 1, 'E5'),
            (5, 0, .5, 'D5'), (5, .5, .5, 'G5'), (5, 1, 1, 'G5'), (5, 2, .5, 'F5'), (5, 2.5, .5, 'E5'), (5, 3, 1, 'D5'),
            (6, 0, .5, 'E5'), (6, .5, .5, 'D5'), (6, 1, 3, 'C5')]
    olcu_sayisi = int(np.ceil(saniye / olcu))
    for o in range(olcu_sayisi):
        kok, ak = akorlar[o % len(akorlar)]
        b = o * olcu
        son = o == olcu_sayisi - 1
        ekle(iz, pad([nota(n) for n in ak], olcu, .05), b)
        for v, u in ([(0, 1)] if son else [(0, 1), (1.5, .5), (2, 1), (3, .5)]):  # bas: hafif kaydırmalı
            ekle(iz, piyano(nota(kok + '2'), u * vurus, .28), b + v * vurus)
        for v, u, g in ([(0, 3, .09)] if son else [(0, 1, .09), (1.5, .4, .06), (2.5, .4, .06), (3.5, .4, .05)]):  # akor vuruşları
            for k, n in enumerate(ak):
                ekle(iz, piyano(nota(n), u * vurus, g), b + v * vurus + k * .012)
        if son:
            ekle(iz, davul() * .5, b)
            continue
        for v in (0, 2, 2.5):
            ekle(iz, davul() * (.55 if v != 2.5 else .3), b + v * vurus)
        for v in (1, 3):
            ekle(iz, gurultu(.15, .045, False) * .12, b + v * vurus)
        for k in range(8):
            ekle(iz, gurultu(.06, .015, True) * (.05 if k % 2 else .025), b + k * vurus / 2)
    for o, v, u, n in ezgi:
        if o < olcu_sayisi:
            ekle(iz, piyano(nota(n), u * vurus * .9, .2 * rng.uniform(.9, 1.0)), o * olcu + v * vurus + rng.uniform(0, .008))
    iz = iz[:int(SR * saniye)]
    sol, sag = yanki(iz, oran=.18), yanki(np.roll(iz, int(.004 * SR)), oran=.18)
    st = np.stack([sol, sag], axis=1)
    t = np.arange(len(st)) / SR
    st *= np.minimum(1, t / .08)[:, None] * np.clip((saniye - t) / 1.5, 0, 1)[:, None]
    return st / np.max(np.abs(st)) * 10 ** (-3 / 20)


def uret_uzun(saniye: float, aralar=(), bpm: float = 100) -> np.ndarray:
    """canli tarzının uzun hâli (YouTube): C - G - Am - F, 4 ölçülük cümleler. Cümle sırası A · B · A' · ara (ezgisiz, hafif
    arpej) ve yeniden; `aralar` (saniye) bölüm geçişlerinde bir ölçülük yumuşak ara (davulsuz, uzun akor). Sonda C'ye
    çözülür ve 3 sn'de kısılır."""
    vurus = 60 / bpm
    olcu = 4 * vurus
    iz = np.zeros(int(SR * (saniye + 4)))
    akorlar = [('C', ['C4', 'E4', 'G4']), ('G', ['B3', 'D4', 'G4']), ('A', ['C4', 'E4', 'A4']), ('F', ['C4', 'F4', 'A4'])]
    A = [[(0, .5, 'E5'), (.5, .5, 'G5'), (1, 1, 'E5'), (2, .5, 'C5'), (2.5, .5, 'D5'), (3, 1, 'E5')],
         [(0, .5, 'D5'), (.5, .5, 'G4'), (1, 1, 'B4'), (2, 1.5, 'D5')],
         [(0, .5, 'C5'), (.5, .5, 'E5'), (1, 1, 'A5'), (2, .5, 'G5'), (2.5, .5, 'E5'), (3, 1, 'C5')],
         [(0, 1, 'A4'), (1, .5, 'C5'), (1.5, .5, 'F5'), (2, 1, 'E5'), (3, 1, 'D5')]]
    B = [[(0, .5, 'E5'), (.5, .5, 'G5'), (1, 1, 'E5'), (2, .5, 'C5'), (2.5, .5, 'D5'), (3, 1, 'E5')],
         [(0, .5, 'D5'), (.5, .5, 'G5'), (1, 1, 'G5'), (2, .5, 'F5'), (2.5, .5, 'E5'), (3, 1, 'D5')],
         [(0, .5, 'C5'), (.5, .5, 'E5'), (1, 1, 'A5'), (2, 1, 'G5'), (3, 1, 'E5')],
         [(0, 1, 'F5'), (1, .5, 'E5'), (1.5, .5, 'D5'), (2, 2, 'C5')]]
    A2 = A[:3] + [[(0, 1, 'A4'), (1, .5, 'C5'), (1.5, .5, 'D5'), (2, 1, 'E5'), (3, .5, 'G5'), (3.5, .5, 'E5')]]
    olcu_sayisi = int(np.ceil(saniye / olcu))
    ara_olculer = {int(round(a / olcu)) for a in aralar if 0 < a < saniye - olcu}
    cumle = -1
    for o in range(olcu_sayisi):
        b = o * olcu
        son = o == olcu_sayisi - 1
        if o % 4 == 0:
            cumle += 1
        ara = o in ara_olculer or o == 0
        kok, ak = ('C', ['C4', 'E4', 'G4']) if son else akorlar[o % 4]
        ekle(iz, pad([nota(n) for n in ak], olcu, .06 if ara else .05), b)
        if ara or son:  # yumuşak ara: tek bas, uzun akor, hafif arpej; davul yok
            ekle(iz, piyano(nota(kok + '2'), 3 * vurus, .22), b)
            for k, n in enumerate(ak):
                ekle(iz, piyano(nota(n), 3 * vurus, .08), b + k * .09)
            if not son:
                for k, n in enumerate(ak + [ak[0][0] + '5']):
                    ekle(iz, piyano(nota(n.replace('4', '5').replace('3', '4')), vurus, .05), b + (2 + k * .5) * vurus)
            continue
        for v, u in [(0, 1), (1.5, .5), (2, 1), (3, .5)]:
            ekle(iz, piyano(nota(kok + '2'), u * vurus, .28), b + v * vurus)
        for v, u, g in [(0, 1, .09), (1.5, .4, .06), (2.5, .4, .06), (3.5, .4, .05)]:
            for k, n in enumerate(ak):
                ekle(iz, piyano(nota(n), u * vurus, g), b + v * vurus + k * .012)
        for v in (0, 2, 2.5):
            ekle(iz, davul() * (.55 if v != 2.5 else .3), b + v * vurus)
        for v in (1, 3):
            ekle(iz, gurultu(.15, .045, False) * .12, b + v * vurus)
        for k in range(8):
            ekle(iz, gurultu(.06, .015, True) * (.05 if k % 2 else .025), b + k * vurus / 2)
        tur = cumle % 4
        if tur == 3:  # ezgisiz cümle: akor seslerinden yumuşak arpej
            for k in range(8):
                n = ak[k % 3].replace('4', '5').replace('3', '4')
                ekle(iz, piyano(nota(n), .45 * vurus, .06 * rng.uniform(.85, 1)), b + k * vurus / 2 + rng.uniform(0, .006))
            continue
        ezgi = (A, B, A2)[tur][o % 4]
        for v, u, n in ezgi:
            ekle(iz, piyano(nota(n), u * vurus * .9, .2 * rng.uniform(.9, 1.0)), b + v * vurus + rng.uniform(0, .008))
    iz = iz[:int(SR * saniye)]
    sol, sag = yanki(iz, oran=.18), yanki(np.roll(iz, int(.004 * SR)), oran=.18)
    st = np.stack([sol, sag], axis=1)
    t = np.arange(len(st)) / SR
    st *= np.minimum(1, t / .3)[:, None] * np.clip((saniye - t) / 3.0, 0, 1)[:, None]
    return st / np.max(np.abs(st)) * 10 ** (-3 / 20)


if __name__ == '__main__':
    cikti = sys.argv[1]
    saniye = float(sys.argv[2]) if len(sys.argv) > 2 else 17
    tarz = sys.argv[3] if len(sys.argv) > 3 else 'sakin'
    # canli-uzun: 4. bağımsız değişken bölüm geçişleri (saniye, virgülle), ör. 12.5,85,150
    aralar = [float(a) for a in sys.argv[4].split(',') if a] if len(sys.argv) > 4 else []
    ses = uret_uzun(saniye, aralar) if tarz == 'canli-uzun' else uret_canli(saniye) if tarz == 'canli' else uret(saniye)
    veri = (ses * 32767).astype('<i2')
    with wave.open(cikti, 'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(veri.tobytes())
    print('yazıldı', cikti, saniye, 'sn')
