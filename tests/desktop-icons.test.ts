// Windows icons and the Mola window's taskbar identity (10 Ekim; the owner: the installers' icon was sharp, the installed Mola
// window's taskbar icon blurry). scripts/mola-icons.mjs makes the multi-size .ico, scripts/build-installer.mjs embeds it,
// scripts/desktop/Ortak.cs (Taskbar) gives the Edge/Chrome app window and the shortcuts the same identity.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { ICO_SIZES, MOLA_GREEN, YONETIM_BLACK, exeIconImages, icoFile, icoImages, iconImagePng, iconSvg, renderPng } from '../scripts/mola-icons.mjs';

const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
async function pixels(png: Buffer) { const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); return { data, width: info.width }; }

test('the .ico has every Windows size, each image its real size; café green and Mola Yönetim near-black', async () => {
  for (const [fill, other] of [[MOLA_GREEN, YONETIM_BLACK], [YONETIM_BLACK, MOLA_GREEN]]) {
    const images = icoImages(await icoFile(fill));
    assert.deepEqual(images.map(i => i.size), ICO_SIZES);
    assert.deepEqual(ICO_SIZES, [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]);
    for (const image of images) {
      const png = await iconImagePng(image.data), meta = await sharp(png).metadata();
      assert.equal(meta.width, image.size); assert.equal(meta.height, image.size);
      // Below the cup, in the middle: the background colour of this product, never the other one's.
      const { data, width } = await pixels(png), at = (Math.round(image.size * 0.94) * width + Math.round(image.size / 2)) * 4;
      assert.deepEqual([...data.subarray(at, at + 3)], rgb(fill), `${fill} ${image.size}`);
      assert.notDeepEqual([...data.subarray(at, at + 3)], rgb(other));
    }
    assert.equal(images.at(-1)!.data.subarray(1, 4).toString('latin1'), 'PNG', '256 px stored as PNG');
  }
  assert.equal(readFileSync('scripts/desktop/mola-yonetim-icon.svg', 'utf8'), iconSvg.rounded(YONETIM_BLACK), 'Mola Yönetim is the same drawing on near-black');
});

test('16/20/24/32 px are drawn on the pixel grid: crisp lines, not the 256 drawing scaled down', async () => {
  // Pixels that are neither background nor cup colour (anti-aliasing): the pixel-grid drawing has a few (rounded corners,
  // the cup's lower corners); the 256 drawing scaled to the same size is mostly soft edges.
  const cream = rgb('#f3ebdd'), green = rgb(MOLA_GREEN);
  const soft = async (png: Buffer, size: number) => {
    const { data } = await pixels(png); let mixed = 0, inside = 0;
    for (let y = 2; y < size - 2; y++) for (let x = 2; x < size - 2; x++) {
      const p = [...data.subarray((y * size + x) * 4, (y * size + x) * 4 + 3)]; inside++;
      if (!p.every((v, i) => Math.abs(v - cream[i]) <= 6) && !p.every((v, i) => Math.abs(v - green[i]) <= 6)) mixed++;
    }
    return mixed / inside;
  };
  // Measured 10 Ekim: grid 8.3 / 8.6 / 7.5 / 7.5 %, scaled 40 / 33 / 24 / 17 % (16 / 20 / 24 / 32 px).
  for (const size of [16, 20, 24, 32]) {
    const grid = await soft(await renderPng(iconSvg.forSize(size), size), size), scaled = await soft(await renderPng(iconSvg.rounded(), size), size);
    assert.ok(grid < 0.1, `${size} px: ${(grid * 100).toFixed(1)} % soft pixels`);
    assert.ok(scaled > grid * 2, `${size} px: the scaled drawing (${(scaled * 100).toFixed(1)} %) is much softer`);
  }
  assert.equal(iconSvg.forSize(32), iconSvg.small(), '32 px: the browser tab drawing');
  assert.equal(iconSvg.forSize(48), iconSvg.rounded(), '40 px and up: the detailed drawing');
});

test('the launchers embed the icon and give the Mola window and the shortcuts one taskbar identity', () => {
  const build = readFileSync('scripts/build-installer.mjs', 'utf8');
  assert.match(build, /\/win32icon:\$\{icon\}`, `\/resource:\$\{icon\},mola\.ico`/);
  assert.match(build, /checkIcon\(exe\)/);
  const ortak = readFileSync('scripts/desktop/Ortak.cs', 'utf8'), mola = readFileSync('scripts/desktop/Mola.cs', 'utf8'), setup = readFileSync('scripts/desktop/Kurulum.cs', 'utf8');
  assert.match(ortak, /SHGetPropertyStoreForWindow/); assert.match(ortak, /GetManifestResourceStream\("mola\.ico"\)/);
  assert.match(mola, /Taskbar\.TagWindows\(root, 20000\)/); assert.match(mola, /Taskbar\.ForProcess\(root\)/); assert.match(mola, /Taskbar\.TagShortcuts\(root\)/);
  assert.match(setup, /Identity\(menu\)/); assert.match(setup, /Identity\(onDesktop\)/);
  for (const source of ['Mola.cs', 'Kurulum.cs', 'Kaldir.cs']) assert.doesNotMatch(readFileSync(`scripts/desktop/${source}`, 'utf8'), /ExtractAssociatedIcon/, `${source}: windows use Ui.AppIcon (every size)`);
});

const csc = join(process.env.WINDIR ?? 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
test('Taskbar (Ortak.cs) really writes the identity into a shortcut and a window (Windows; skipped without the C# compiler)', t => {
  if (process.platform !== 'win32' || !existsSync(csc)) return t.skip('Windows C# derleyicisi yok');
  mkdirSync('.local/tests', { recursive: true });
  const dir = mkdtempSync(resolve('.local/tests/gorev-cubugu-')), root = join(dir, 'Mola Kurulu'), link = join(dir, 'Mola.lnk');
  mkdirSync(root); writeFileSync(join(root, 'Mola.exe'), '');
  // Only this test's own folder: a shortcut there, and a window of the harness itself that is never shown.
  writeFileSync(join(dir, 'Deneme.cs'), `using System; using System.IO; using System.Reflection; using System.Windows.Forms;
static class Deneme { [STAThread] static int Main(string[] a) {
  string root = a[0], link = a[1];
  Type type = Type.GetTypeFromProgID("WScript.Shell", true); object shell = Activator.CreateInstance(type);
  object l = type.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { link });
  l.GetType().InvokeMember("TargetPath", BindingFlags.SetProperty, null, l, new object[] { Path.Combine(root, P.Launcher) });
  l.GetType().InvokeMember("Save", BindingFlags.InvokeMethod, null, l, null);
  Console.WriteLine("id=" + Taskbar.Id(root));
  Console.WriteLine("baska=" + Taskbar.TagShortcut(link, root, Path.Combine(root, "Baska.exe")));
  Console.WriteLine("kisayol=" + Taskbar.TagShortcut(link, root, Path.Combine(root, P.Launcher)));
  Form f = new Form(); IntPtr h = f.Handle;
  Console.WriteLine("once=" + (Taskbar.IdOf(h) ?? ""));
  Console.WriteLine("pencere=" + Taskbar.TagWindow(h, root));
  Console.WriteLine("sonra=" + (Taskbar.IdOf(h) ?? ""));
  f.Dispose(); return 0;
} }`);
  const exe = join(dir, 'Deneme.exe');
  execFileSync(csc, ['/nologo', '/codepage:65001', '/target:exe', `/out:${exe}`, '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll', '/r:System.Management.dll',
    join(dir, 'Deneme.cs'), resolve('scripts/desktop/Urun.cs'), resolve('scripts/desktop/Ortak.cs')], { stdio: 'pipe' });
  const out = Object.fromEntries(execFileSync(exe, [root, link], { encoding: 'utf8' }).trim().split(/\r?\n/).map(l => l.split('=') as [string, string]));
  assert.match(out.id, /^MerkutStudios\.Mola\.[0-9a-f]{12}$/);
  assert.equal(out.baska, 'False', 'a shortcut to another program is left alone');
  assert.equal(out.kisayol, 'True');
  assert.equal(out.once, '', 'a fresh window has no identity of its own');
  assert.equal(out.pencere, 'True'); assert.equal(out.sonra, out.id);
  // Read back by Windows' own shell, the way the taskbar finds the shortcut for the window.
  const read = execFileSync('powershell.exe', ['-NoProfile', '-Command', `(New-Object -ComObject Shell.Application).NameSpace('${dir.replaceAll("'", "''")}').ParseName('Mola.lnk').ExtendedProperty('System.AppUserModel.ID')`], { encoding: 'utf8' }).trim();
  assert.equal(read, out.id);
});

test('built Windows programs carry every icon size (skipped before npm run installer)', async t => {
  const version = JSON.parse(readFileSync('package.json', 'utf8')).version, base = resolve('.local/installer', `Mola-${version}`);
  const programs = [[join(base, 'Windows', 'program', 'Mola.exe'), MOLA_GREEN], [join(base, 'Windows', 'Mola Kurulum.exe'), MOLA_GREEN], [join(base, 'Windows', 'program', 'Mola-Kaldir.exe'), MOLA_GREEN],
    [join(base, 'Mola-Yonetim', 'program', 'Mola Yönetim.exe'), YONETIM_BLACK], [join(base, 'Mola-Yonetim', 'Mola Yönetim Kurulum.exe'), YONETIM_BLACK], [join(base, 'Mola-Yonetim', 'program', 'Mola-Yonetim-Kaldir.exe'), YONETIM_BLACK]] as const;
  if (!programs.some(([p]) => existsSync(p))) return t.skip('Önce npm run installer');
  for (const [program, fill] of programs) {
    if (!existsSync(program)) continue;
    const images = exeIconImages(readFileSync(program));
    if (images.length < ICO_SIZES.length) return t.skip(`${program}: eski derleme (${images.map(i => i.size).join(', ')} px); npm run installer`);
    assert.deepEqual(images.map(i => i.size).sort((a, b) => a - b), ICO_SIZES, program);
    const big = await pixels(await iconImagePng(images.find(i => i.size === 256)!.data)), at = (240 * 256 + 128) * 4;
    assert.deepEqual([...big.data.subarray(at, at + 3)], rgb(fill), program);
  }
});
