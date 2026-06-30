const fs = require('fs');
const path = require('path');

exports.default = async function(context) {
  const appDir = path.join(context.appOutDir, 'resources', 'app');
  // Ищем main.cjs — сначала в electron-app, потом рядом с этим файлом
  const projectRoot = path.join(__dirname, '..', '..');
  const electronAppDir = path.join(projectRoot, 'electron-app');
  const sourceDir = fs.existsSync(path.join(electronAppDir, 'main.cjs')) ? electronAppDir : __dirname;
  console.log('[afterPack] source dir:', sourceDir);

  // Копируем main.cjs
  const src = path.join(sourceDir, 'main.cjs');
  const dst = path.join(appDir, 'main.cjs');
  fs.copyFileSync(src, dst);
  console.log('[afterPack] main.cjs copied');

  // Копируем preload.cjs  
  const src2 = path.join(sourceDir, 'preload.cjs');
  const dst2 = path.join(appDir, 'preload.cjs');
  fs.copyFileSync(src2, dst2);
  console.log('[afterPack] preload.cjs copied');

  // Перезаписываем package.json — убираем "type":"module", ставим main.cjs
  const pkgPath = path.join(appDir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  delete pkg.type;
  pkg.main = 'main.cjs';
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
  console.log('[afterPack] package.json fixed: type removed, main=main.cjs');

  // Перезаписываем main.js — делегируем на main.cjs
  const mainPath = path.join(appDir, 'main.js');
  fs.writeFileSync(mainPath, '// legacy entry\nrequire("./main.cjs");\n');
  console.log('[afterPack] main.js overwritten');
};