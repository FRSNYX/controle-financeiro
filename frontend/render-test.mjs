/**
 * Renderiza cada tela num DOM de verdade, contra uma API real, e reporta o
 * erro exato quando alguma quebra.
 *
 * Existe porque erro de renderização não aparece na compilação: a tela
 * simplesmente fica em branco no navegador, sem aviso nenhum.
 *
 * Uso: node frontend/render-test.mjs [url-da-api]
 */
import { JSDOM } from 'jsdom';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const BASE = process.argv[2] ?? 'https://controle-financeiro-five-swart.vercel.app';

// ---------- DOM montado antes de qualquer componente ----------
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: `${BASE}/`,
  pretendToBeVisual: true,
});

// `navigator` e `location` são somente-leitura no Node: exigem defineProperty.
const definir = (nome, valor) => {
  try {
    globalThis[nome] = valor;
  } catch {
    Object.defineProperty(globalThis, nome, { value: valor, configurable: true, writable: true });
  }
};

for (const nome of ['window', 'document', 'navigator', 'location', 'HTMLElement', 'Element',
  'Node', 'getComputedStyle', 'localStorage', 'SVGElement', 'Image', 'DOMParser']) {
  definir(nome, dom.window[nome]);
}
definir('requestAnimationFrame', (cb) => setTimeout(() => cb(Date.now()), 0));
definir('cancelAnimationFrame', clearTimeout);

dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
definir('matchMedia', dom.window.matchMedia);

// Recharts mede o container; no JSDOM tudo tem tamanho zero.
class ObservadorDeTamanho {
  constructor(cb) { this.cb = cb; }
  observe(alvo) {
    this.cb([{ target: alvo, contentRect: { width: 800, height: 400 } }], this);
  }
  unobserve() {}
  disconnect() {}
}
definir('ResizeObserver', ObservadorDeTamanho);
dom.window.ResizeObserver = ObservadorDeTamanho;

for (const prop of ['offsetWidth', 'offsetHeight', 'clientWidth', 'clientHeight']) {
  Object.defineProperty(dom.window.HTMLElement.prototype, prop, {
    configurable: true,
    get() { return prop.includes('Width') ? 800 : 400; },
  });
}

// O app chama /api/... relativo; aqui apontamos para a API real.
const fetchOriginal = globalThis.fetch;
definir('fetch', (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  return fetchOriginal(url.startsWith('/') ? `${BASE}${url}` : url, init);
});

// ---------- Sessão de teste ----------
const reg = await fetchOriginal(`${BASE}/api/auth/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Render Teste', email: `render${Date.now()}@teste.com`, password: 'senha1234' }),
}).then((r) => r.json());

if (!reg.accessToken) {
  console.error('  Não foi possível criar a conta de teste:', JSON.stringify(reg).slice(0, 200));
  process.exit(1);
}

dom.window.localStorage.setItem('fin.accessToken', reg.accessToken);
dom.window.localStorage.setItem('fin.refreshToken', reg.refreshToken);
dom.window.localStorage.setItem('fin.user', JSON.stringify(reg.user));

// ---------- Vite transforma o JSX para o Node conseguir importar ----------
const vite = await createServer({
  // Fixa a raiz na pasta do frontend para o teste funcionar de qualquer lugar.
  root: path.dirname(fileURLToPath(import.meta.url)),
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
  ssr: {
    // As bibliotecas são carregadas pelo Node, não pelo Vite: assim o React
    // usado pelas telas é o MESMO desta execução. Duas instâncias fariam
    // todo hook falhar com "invalid hook call".
    external: ['react', 'react-dom', 'react-dom/client', 'react-router-dom',
      '@tanstack/react-query', 'recharts', 'lucide-react'],
  },
});

const React = (await import('react')).default;
const { createRoot } = await import('react-dom/client');
const { MemoryRouter } = await import('react-router-dom');
const { AppProviders } = await vite.ssrLoadModule('/src/context/AppProviders.jsx');

const TELAS = [
  ['Dashboard', '/src/pages/Dashboard.jsx', {}],
  ['Receitas', '/src/pages/Transactions.jsx', { kind: 'income' }],
  ['Despesas', '/src/pages/Transactions.jsx', { kind: 'expense' }],
  ['Contas', '/src/pages/Accounts.jsx', {}],
  ['Transferências', '/src/pages/Transfers.jsx', {}],
  ['Cartões', '/src/pages/Cards.jsx', {}],
  ['Investimentos', '/src/pages/Investments.jsx', {}],
  ['Orçamento', '/src/pages/Budgets.jsx', {}],
  ['Metas', '/src/pages/Goals.jsx', {}],
  ['Calendário', '/src/pages/Calendar.jsx', {}],
  ['Relatórios', '/src/pages/Reports.jsx', {}],
  ['Histórico', '/src/pages/History.jsx', {}],
  ['Vida financeira', '/src/pages/NetWorth.jsx', {}],
  ['Categorias', '/src/pages/Categories.jsx', {}],
  ['Preferências', '/src/pages/Settings.jsx', {}],
];

const originalErro = console.error;
const originalAviso = console.warn;
let falhas = 0;

console.log(`\nRenderizando as telas contra ${BASE}\n`);

for (const [nome, caminho, props] of TELAS) {
  const container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);

  let capturado = null;
  const silenciar = (...args) => {
    const texto = args.map((a) => a?.stack ?? String(a)).join(' ');
    if (/not wrapped in act|validateDOMNesting|defaultProps|useLayoutEffect/i.test(texto)) return;
    if (!capturado) capturado = texto;
  };
  console.error = silenciar;
  console.warn = () => {};

  try {
    const { default: Tela } = await vite.ssrLoadModule(caminho);

    const root = createRoot(container);
    root.render(
      React.createElement(
        MemoryRouter,
        null,
        React.createElement(AppProviders, null, React.createElement(Tela, props)),
      ),
    );

    // Espera o conteúdo aparecer em vez de cravar um tempo: telas com
    // consultas pesadas demoram mais, e um tempo fixo geraria alarme falso.
    const LIMITE = 20000;
    const inicio = Date.now();
    while (Date.now() - inicio < LIMITE) {
      if (capturado) break;
      if ((container.textContent ?? '').trim().length >= 10) break;
      await new Promise((r) => setTimeout(r, 250));
    }

    const texto = (container.textContent ?? '').trim();

    if (capturado) {
      falhas++;
      const primeira = capturado.split('\n').find((l) => l.trim()) ?? '';
      console.log(`  QUEBROU  ${nome}`);
      console.log(`           ${primeira.trim().slice(0, 200)}`);
      const local = capturado.split('\n').find((l) => /\/src\/(pages|components|lib|hooks)\//.test(l));
      if (local) console.log(`           ${local.trim().slice(0, 170)}`);
    } else if (texto.length < 10) {
      falhas++;
      console.log(`  VAZIA    ${nome}  (renderizou sem conteúdo)`);
    } else {
      console.log(`  ok       ${nome}`);
    }

    root.unmount();
  } catch (err) {
    falhas++;
    console.log(`  QUEBROU  ${nome}\n           ${String(err.message).split('\n')[0].slice(0, 200)}`);
  } finally {
    console.error = originalErro;
    console.warn = originalAviso;
    container.remove();
  }
}

await vite.close();
console.log(`\n  ${TELAS.length - falhas} ok, ${falhas} com problema\n`);
process.exit(falhas ? 1 : 0);
