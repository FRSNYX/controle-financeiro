/**
 * Gera os ícones do aplicativo a partir de um único SVG.
 *
 * Uso: node scripts/gerar-icones.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DESTINO = path.join(RAIZ, 'public', 'icones');
fs.mkdirSync(DESTINO, { recursive: true });

const MARCA = '#4f46e5';

/**
 * Carteira estilizada com uma moeda — a mesma linguagem visual do ícone
 * usado dentro do sistema, para o app na tela inicial ser reconhecível.
 *
 * `preencherFundo` controla a variante "maskable": o Android recorta o
 * ícone em formatos variados (círculo, gota), então essa versão pinta a
 * arte toda e mantém a marca dentro da zona segura central (~80%).
 */
function svg({ lado, preencherFundo, margem }) {
  const raio = preencherFundo ? 0 : lado * 0.22;
  const escala = 1 - margem * 2;
  const deslocamento = lado * margem;

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${lado}" height="${lado}" viewBox="0 0 ${lado} ${lado}">
  <defs>
    <linearGradient id="fundo" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#6366f1"/>
      <stop offset="100%" stop-color="#4338ca"/>
    </linearGradient>
  </defs>

  <rect width="${lado}" height="${lado}" rx="${raio}" fill="url(#fundo)"/>

  <g transform="translate(${deslocamento} ${deslocamento}) scale(${escala})">
    <!-- corpo da carteira -->
    <rect x="${lado * 0.16}" y="${lado * 0.27}" width="${lado * 0.68}" height="${lado * 0.46}"
          rx="${lado * 0.08}" fill="#ffffff"/>
    <!-- aba superior -->
    <path d="M ${lado * 0.16} ${lado * 0.36}
             L ${lado * 0.16} ${lado * 0.33}
             a ${lado * 0.06} ${lado * 0.06} 0 0 1 ${lado * 0.05} -${lado * 0.06}
             L ${lado * 0.66} ${lado * 0.2}
             a ${lado * 0.05} ${lado * 0.05} 0 0 1 ${lado * 0.06} ${lado * 0.05}
             L ${lado * 0.74} ${lado * 0.29} Z"
          fill="#ffffff" opacity="0.88"/>
    <!-- compartimento do fecho -->
    <rect x="${lado * 0.57}" y="${lado * 0.42}" width="${lado * 0.27}" height="${lado * 0.17}"
          rx="${lado * 0.045}" fill="${MARCA}" opacity="0.22"/>
    <!-- moeda -->
    <circle cx="${lado * 0.695}" cy="${lado * 0.505}" r="${lado * 0.052}" fill="${MARCA}"/>
  </g>
</svg>`.trim();
}

const ARQUIVOS = [
  { nome: 'icone-192.png', lado: 192, preencherFundo: false, margem: 0.0 },
  { nome: 'icone-512.png', lado: 512, preencherFundo: false, margem: 0.0 },
  { nome: 'icone-maskable-192.png', lado: 192, preencherFundo: true, margem: 0.1 },
  { nome: 'icone-maskable-512.png', lado: 512, preencherFundo: true, margem: 0.1 },
  { nome: 'apple-touch-icon.png', lado: 180, preencherFundo: true, margem: 0.04 },
  { nome: 'favicon-32.png', lado: 32, preencherFundo: false, margem: 0.0 },
];

for (const { nome, lado, preencherFundo, margem } of ARQUIVOS) {
  const fonte = Buffer.from(svg({ lado, preencherFundo, margem }));
  await sharp(fonte, { density: 384 }).png({ compressionLevel: 9 }).toFile(path.join(DESTINO, nome));
  console.log(`  ${nome}  (${lado}x${lado})`);
}

// O favicon vetorial fica nítido em qualquer tamanho de aba.
fs.writeFileSync(path.join(RAIZ, 'public', 'favicon.svg'), svg({ lado: 64, preencherFundo: false, margem: 0 }));
console.log('  favicon.svg');
