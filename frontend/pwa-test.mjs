/**
 * Verifica se a aplicação é realmente instalável no celular.
 *
 * Checa os requisitos que os sistemas exigem — manifest válido, ícones nos
 * tamanhos certos, service worker, tags do iPhone — e também que a API NÃO
 * está sendo guardada em cache.
 *
 * Uso: node frontend/pwa-test.mjs [url]
 */
const BASE = (process.argv[2] ?? 'https://controle-financeiro-five-swart.vercel.app').replace(/\/$/, '');

let ok = 0;
let falhas = 0;

const check = async (label, fn) => {
  try {
    await fn();
    ok++;
    console.log(`  ok     ${label}`);
  } catch (err) {
    falhas++;
    console.log(`  FALHA  ${label}\n         ${err.message}`);
  }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

console.log(`\nApp instalável — ${BASE}\n`);

const html = await fetch(`${BASE}/`).then((r) => r.text());

// ---------- Página ----------
await check('HTML declara o manifest', async () => {
  assert(/<link[^>]+rel="manifest"/.test(html), 'sem <link rel="manifest">');
});

await check('HTML tem ícone para o iPhone', async () => {
  assert(/<link[^>]+rel="apple-touch-icon"/.test(html), 'sem apple-touch-icon');
});

await check('HTML marca o modo aplicativo no iPhone', async () => {
  assert(/apple-mobile-web-app-capable"\s+content="yes"/.test(html), 'sem apple-mobile-web-app-capable');
});

await check('HTML define a cor da barra do sistema', async () => {
  assert(/name="theme-color"/.test(html), 'sem theme-color');
});

await check('HTML pede para buscadores não indexarem', async () => {
  assert(/name="robots"[^>]+noindex/.test(html), 'sem noindex — dados financeiros não devem ser indexados');
});

// ---------- Manifest ----------
const caminhoManifest = html.match(/<link[^>]+rel="manifest"[^>]+href="([^"]+)"/)?.[1]
  ?? html.match(/href="([^"]+)"[^>]+rel="manifest"/)?.[1];

let manifest = null;

await check('manifest é servido com o tipo correto', async () => {
  assert(caminhoManifest, 'manifest não referenciado no HTML');
  const res = await fetch(`${BASE}${caminhoManifest}`);
  assert(res.status === 200, `status ${res.status}`);
  const tipo = res.headers.get('content-type') ?? '';
  assert(
    tipo.includes('manifest+json') || tipo.includes('application/json'),
    `Content-Type "${tipo}" — o celular exige application/manifest+json`,
  );
  manifest = await res.json();
});

await check('manifest tem os campos exigidos', async () => {
  for (const campo of ['name', 'short_name', 'start_url', 'display', 'icons']) {
    assert(manifest?.[campo], `faltando "${campo}"`);
  }
  assert(manifest.display === 'standalone', `display é "${manifest.display}", deveria ser standalone`);
});

await check('manifest está em português', async () => {
  assert(manifest.lang === 'pt-BR', `lang é "${manifest.lang}"`);
});

await check('ícones de 192 e 512 existem e abrem', async () => {
  for (const tamanho of ['192x192', '512x512']) {
    const icone = manifest.icons.find((i) => i.sizes === tamanho && i.purpose !== 'maskable');
    assert(icone, `sem ícone ${tamanho}`);
    const res = await fetch(new URL(icone.src, BASE));
    assert(res.status === 200, `ícone ${tamanho} devolveu ${res.status}`);
    assert((res.headers.get('content-type') ?? '').includes('image/png'), `ícone ${tamanho} não é PNG`);
  }
});

await check('existe ícone adaptável (o Android recorta o ícone)', async () => {
  const maskable = manifest.icons.filter((i) => i.purpose === 'maskable');
  assert(maskable.length >= 1, 'sem ícone com purpose "maskable" — o Android cortaria a arte');
  const res = await fetch(new URL(maskable[0].src, BASE));
  assert(res.status === 200, `status ${res.status}`);
});

await check('ícone do iPhone abre', async () => {
  const caminho = html.match(/rel="apple-touch-icon"[^>]+href="([^"]+)"/)?.[1];
  const res = await fetch(new URL(caminho, BASE));
  assert(res.status === 200, `status ${res.status}`);
});

// ---------- Service worker ----------
await check('service worker é servido', async () => {
  const res = await fetch(`${BASE}/sw.js`);
  assert(res.status === 200, `status ${res.status}`);
  const tipo = res.headers.get('content-type') ?? '';
  assert(tipo.includes('javascript'), `Content-Type "${tipo}"`);
});

await check('service worker pode controlar o site inteiro', async () => {
  const res = await fetch(`${BASE}/sw.js`);
  const escopo = res.headers.get('service-worker-allowed');
  assert(escopo === '/', `Service-Worker-Allowed = "${escopo}"`);
});

await check('service worker não é guardado em cache', async () => {
  const res = await fetch(`${BASE}/sw.js`);
  const cache = res.headers.get('cache-control') ?? '';
  assert(/no-cache|no-store|max-age=0/.test(cache), `Cache-Control "${cache}" impediria atualizações`);
});

await check('a interface é pré-carregada para abrir offline', async () => {
  const sw = await fetch(`${BASE}/sw.js`).then((r) => r.text());
  assert(/precache/i.test(sw), 'o service worker não pré-carrega a interface');
});

await check('respostas da API NÃO são guardadas em cache', async () => {
  const sw = await fetch(`${BASE}/sw.js`).then((r) => r.text());
  const temRegra = /NetworkOnly/.test(sw) || /workbox/.test(sw);
  assert(temRegra, 'sem regra explícita para /api');
  assert(
    !/CacheFirst[^]{0,200}api/.test(sw),
    'a API está sendo guardada em cache — mostraria saldo desatualizado',
  );
});

console.log(`\n  ${ok} ok, ${falhas} com problema\n`);
process.exit(falhas ? 1 : 0);
