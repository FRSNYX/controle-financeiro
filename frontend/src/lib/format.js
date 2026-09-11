/**
 * Toda a API trafega dinheiro em CENTAVOS (inteiro).
 * A conversão para reais acontece só aqui, na hora de exibir.
 */

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const brlCompact = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  notation: 'compact',
  maximumFractionDigits: 1,
});
const decimal = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const toReais = (cents) => (Number(cents) || 0) / 100;

/** Centavos -> "R$ 1.234,56" */
export const money = (cents) => brl.format(toReais(cents));

/** Centavos -> "R$ 1,2 mil" — para eixos de gráfico e cards apertados. */
export const moneyShort = (cents) => {
  const v = toReais(cents);
  return Math.abs(v) >= 10000 ? brlCompact.format(v) : brl.format(v);
};

/** Sem o símbolo, para dentro de inputs. */
export const moneyPlain = (cents) => decimal.format(toReais(cents));

/** Sempre com sinal explícito — útil em extratos. */
export const moneySigned = (cents) => `${Number(cents) > 0 ? '+' : ''}${money(cents)}`;

export const percent = (value, digits = 1) =>
  `${(Number(value) || 0).toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;

export const number = (value) => new Intl.NumberFormat('pt-BR').format(Number(value) || 0);

/**
 * Converte texto digitado pelo usuário em centavos.
 * Aceita "1.234,56", "1234.56", "R$ 50" e "50".
 */
export function parseMoney(input) {
  if (input === null || input === undefined || input === '') return 0;
  if (typeof input === 'number') return Math.round(input * 100);

  const raw = String(input).trim().replace(/[R$\s]/g, '');
  const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
  const n = Number(normalized);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

// ---------------------------------------------------------------
// Datas — a API usa ISO 'AAAA-MM-DD'; a tela usa 'DD/MM/AAAA'.
// ---------------------------------------------------------------

/** 'AAAA-MM-DD' -> 'DD/MM/AAAA' */
export const date = (iso) =>
  iso ? `${String(iso).slice(8, 10)}/${String(iso).slice(5, 7)}/${String(iso).slice(0, 4)}` : '—';

/** 'DD/MM/AAAA' -> 'AAAA-MM-DD' */
export function dateToISO(br) {
  const m = String(br).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/** 'AAAA-MM-DD' -> '15 de mar' */
export function dateShort(iso) {
  if (!iso) return '—';
  const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  return `${iso.slice(8, 10)} de ${MESES[Number(iso.slice(5, 7)) - 1]}`;
}

/** 'AAAA-MM' -> 'Março de 2026' */
export function monthName(ym) {
  const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const [y, m] = String(ym).split('-');
  return `${MESES[Number(m) - 1]} de ${y}`;
}

export const pad = (n) => String(n).padStart(2, '0');

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const monthKey = (iso = todayISO()) => String(iso).slice(0, 7);

export function monthRange(ym) {
  const [y, m] = String(ym).split('-').map(Number);
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(new Date(y, m, 0).getDate())}` };
}

export function addMonthsISO(iso, months) {
  const [y, m, d] = String(iso).split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(Math.min(d, lastDay))}`;
}

export function addMonthKey(ym, months) {
  const [y, m] = String(ym).split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + months, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

/** "em 3 dias" / "há 2 dias" / "hoje" */
export function relativeDays(iso) {
  if (!iso) return '';
  const diff = Math.round(
    (new Date(`${iso}T00:00:00`).getTime() - new Date(`${todayISO()}T00:00:00`).getTime()) / 86400000,
  );
  if (diff === 0) return 'hoje';
  if (diff === 1) return 'amanhã';
  if (diff === -1) return 'ontem';
  return diff > 0 ? `em ${diff} dias` : `há ${Math.abs(diff)} dias`;
}

// ---------------------------------------------------------------
// Rótulos de domínio
// ---------------------------------------------------------------
export const ACCOUNT_TYPES = {
  checking: 'Conta corrente', savings: 'Poupança', wallet: 'Carteira',
  cash: 'Dinheiro', digital: 'Conta digital', broker: 'Corretora', other: 'Outra',
};

export const INVESTMENT_TYPES = {
  tesouro: 'Tesouro Direto', cdb: 'CDB', lci_lca: 'LCI/LCA', acoes: 'Ações',
  fiis: 'FIIs', etf: 'ETFs', fundos: 'Fundos', cripto: 'Criptomoedas',
  poupanca: 'Poupança', previdencia: 'Previdência', debenture: 'Debêntures', outros: 'Outros',
};

export const INCOME_TYPES = {
  salario: 'Salário', renda_extra: 'Renda extra', comissao: 'Comissão', venda: 'Venda',
  dividendos: 'Dividendos', juros: 'Juros', reembolso: 'Reembolso',
  aluguel: 'Aluguel', premio: 'Prêmio', outros: 'Outros',
};

export const PAYMENT_METHODS = {
  dinheiro: 'Dinheiro', pix: 'PIX', debito: 'Débito', credito: 'Crédito',
  boleto: 'Boleto', transferencia: 'Transferência', cheque: 'Cheque',
  vale: 'Vale', outros: 'Outros',
};

export const GOAL_TYPES = {
  reserva_emergencia: 'Reserva de emergência', viagem: 'Viagem', carro: 'Carro',
  imovel: 'Imóvel', notebook: 'Notebook', investimento: 'Investimento',
  educacao: 'Educação', casamento: 'Casamento', outros: 'Outros',
};

export const ASSET_TYPES = {
  imovel: 'Imóvel', veiculo: 'Veículo', equipamento: 'Equipamento',
  participacao: 'Participação societária', outros: 'Outros',
};

export const LIABILITY_TYPES = {
  financiamento: 'Financiamento', emprestimo: 'Empréstimo', cartao: 'Cartão',
  consorcio: 'Consórcio', outros: 'Outros',
};

export const FREQUENCIES = {
  daily: 'Diária', weekly: 'Semanal', biweekly: 'Quinzenal', monthly: 'Mensal',
  bimonthly: 'Bimestral', quarterly: 'Trimestral', semiannual: 'Semestral', annual: 'Anual',
};

/** Cor do status na UI. `settled` muda de rótulo conforme receita/despesa. */
export const STATUS_STYLES = {
  recebido: 'text-positive bg-positive/10',
  pago: 'text-positive bg-positive/10',
  previsto: 'text-info bg-info/10',
  pendente: 'text-warn bg-warn/10',
  atrasado: 'text-negative bg-negative/10',
  cancelado: 'text-muted bg-muted/10',
};

/**
 * Paleta categórica dos gráficos — 8 tons validados para daltonismo
 * (ΔE CVD ≥ 8 entre pares adjacentes) e contraste, em claro e escuro.
 * A ordem é FIXA: o tom acompanha a entidade, nunca a posição no ranking.
 * Acima de 8 séries nada é gerado: o excedente vira "Outras".
 */
export const CHART_COLORS = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
};

/** Cor neutra da fatia "Outras" — agrupamento não é uma categoria de verdade. */
export const OTHER_COLOR = { light: '#898781', dark: '#898781' };

/**
 * Séries de receita x despesa.
 * Azul/laranja em vez de verde/vermelho: o par verde-vermelho fica na faixa
 * de risco para daltonismo (ΔE ~6,9), enquanto azul/laranja passa folgado
 * (ΔE ~25). Verde e vermelho seguem valendo no TEXTO dos indicadores, onde
 * são cor de tipografia e não identidade de série.
 */
export const SERIES_COLORS = {
  light: { income: '#2a78d6', expense: '#eb6834', balance: '#4a3aa7', networth: '#1baf7a' },
  dark: { income: '#3987e5', expense: '#d95926', balance: '#9085e9', networth: '#199e70' },
};

/** Tinta do cromo do gráfico (eixos, grade, rótulos). */
export const CHART_INK = {
  light: { grid: '#e1e0d9', axis: '#c3c2b7', label: '#898781', text: '#0b0b0b', surface: '#ffffff' },
  dark: { grid: '#2c2c2a', axis: '#383835', label: '#898781', text: '#f1f5f9', surface: '#0f172a' },
};
