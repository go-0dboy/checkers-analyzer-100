/* ============================================================
 * apply-icons.mjs — фирменные иконки приложения.
 *
 * Рендерит resources/icon.svg во все размеры Android-лаунчера
 * (заменяет шаблонные файлы Capacitor один-в-один, сохраняя
 * формат png/webp), а также собирает веб-фавиконки в public/.
 *
 * Запуск: node scripts/apply-icons.mjs   (после npx cap add/sync)
 * ============================================================ */

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SVG_PATH = join(root, 'resources', 'icon.svg');
const RES_DIR = join(root, 'android', 'app', 'src', 'main', 'res');
const PUBLIC_DIR = join(root, 'public');

if (!existsSync(SVG_PATH)) {
  console.error('✗ resources/icon.svg не найден');
  process.exit(1);
}

let sharp;
try {
  ({ default: sharp } = await import('sharp'));
} catch {
  console.error('✗ пакет sharp не установлен: npm i -D sharp');
  process.exit(1);
}

const svg = readFileSync(SVG_PATH);
/* плотность 300 dpi — растеризация вектора без размытия на крупных размерах */
const raster = (size) => sharp(svg, { density: 300 }).resize(size, size).png();

const ANDROID_SIZES = {
  'mipmap-mdpi': 48,
  'mipmap-hdpi': 72,
  'mipmap-xhdpi': 96,
  'mipmap-xxhdpi': 144,
  'mipmap-xxxhdpi': 192,
};
const FOREGROUND_SIZES = {
  'mipmap-mdpi': 108,
  'mipmap-hdpi': 162,
  'mipmap-xhdpi': 216,
  'mipmap-xxhdpi': 324,
  'mipmap-xxxhdpi': 432,
};

let replaced = 0;
let created = 0;

async function writeIcon(file, size) {
  const ext = extname(file).toLowerCase();
  const dir = dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  let buf;
  if (ext === '.webp') {
    buf = await sharp(svg, { density: 300 }).resize(size, size).webp({ quality: 92 }).toBuffer();
  } else {
    buf = await raster(size);
  }
  writeFileSync(file, buf);
}

/* 1) заменяем все ic_launcher* файлы шаблона (png/webp, любые плотности) */
if (existsSync(RES_DIR)) {
  const walkAsync = async (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) { await walkAsync(p); continue; }
      if (/^ic_launcher.*\.(png|webp)$/i.test(name)) {
        const density = basename(dirname(p));
        const size =
          (name.includes('foreground') ? FOREGROUND_SIZES : ANDROID_SIZES)[density] ??
          (name.includes('foreground') ? 432 : 192);
        await writeIcon(p, size);
        replaced++;
      }
    }
  };
  await walkAsync(RES_DIR);

  /* 2) если шаблонных файлов нет — создаём классический набор */
  if (replaced === 0) {
    for (const [dir, size] of Object.entries(ANDROID_SIZES)) {
      for (const name of ['ic_launcher.png', 'ic_launcher_round.png']) {
        await writeIcon(join(RES_DIR, dir, name), size);
        created++;
      }
    }
    for (const [dir, size] of Object.entries(FOREGROUND_SIZES)) {
      await writeIcon(join(RES_DIR, dir, 'ic_launcher_foreground.png'), size);
      created++;
    }
  }
  console.log(`✓ Android-иконки: заменено ${replaced}, создано ${created}`);
} else {
  console.log('· android/ ещё нет — иконки будут применены после cap add/sync');
}

/* 3) веб-фавиконки */
mkdirSync(PUBLIC_DIR, { recursive: true });
copyFileSync(SVG_PATH, join(PUBLIC_DIR, 'icon.svg'));
writeFileSync(join(PUBLIC_DIR, 'icon-180.png'), await raster(180));
writeFileSync(join(PUBLIC_DIR, 'icon-512.png'), await raster(512));
console.log('✓ Веб-иконки: public/icon.svg, icon-180.png, icon-512.png');
