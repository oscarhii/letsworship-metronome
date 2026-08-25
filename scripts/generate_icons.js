const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');

const rootDir = path.join(__dirname, '..');
const svgPath = path.join(rootDir, 'public', 'icons', 'icon.svg');

if (!fs.existsSync(svgPath)) {
  console.error('icon.svg not found at:', svgPath);
  process.exit(1);
}

const svgContent = fs.readFileSync(svgPath, 'utf-8');

const targets = [
  { size: 512, name: 'icon-512.png' },
  { size: 192, name: 'icon-192.png' },
  { size: 180, name: 'apple-touch-icon.png' }
];

const outputDirs = [
  path.join(rootDir, 'public', 'icons'),
  path.join(rootDir, 'docs', 'icons')
];

outputDirs.forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

targets.forEach(({ size, name }) => {
  const resvg = new Resvg(svgContent, {
    fitTo: {
      mode: 'width',
      value: size
    }
  });
  const pngData = resvg.render();
  const pngBuffer = pngData.asPng();

  outputDirs.forEach((dir) => {
    const dest = path.join(dir, name);
    fs.writeFileSync(dest, pngBuffer);
    console.log(`Generated: ${dest} (${size}x${size}, ${pngBuffer.length} bytes)`);
  });
});

// Also copy icon.svg to docs/icons/ if needed
const docsSvg = path.join(rootDir, 'docs', 'icons', 'icon.svg');
fs.writeFileSync(docsSvg, svgContent);
console.log(`Synced: ${docsSvg}`);

console.log('All icons generated successfully.');
