import { Router } from 'express';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { all, get, run, transaction } from '../../db/index.js';
import { env } from '../../config/env.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler, badRequest, notFound } from '../../utils/errors.js';
import { toCents } from '../../utils/money.js';
import { today } from '../../utils/dates.js';
import { logAudit } from '../../utils/audit.js';

const router = Router();

// Em serverless o disco é somente-leitura (e efêmero): criar pastas no boot
// derrubaria a função inteira. Só preparamos o disco onde ele existe de fato.
if (env.uploadsEnabled) {
  fs.mkdirSync(env.uploadDir, { recursive: true });
  fs.mkdirSync(env.backupDir, { recursive: true });
}

/**
 * Anexos dependem de disco persistente. Sem ele, a rota recusa o upload em vez
 * de aceitar um arquivo que desapareceria na próxima requisição.
 */
function requireUploads(_req, _res, next) {
  if (!env.uploadsEnabled) {
    return next(
      badRequest(
        'Anexos não estão disponíveis nesta instalação: o servidor não tem armazenamento permanente de arquivos.',
      ),
    );
  }
  next();
}

// ------------------------------------------------------------------
// Upload de anexos
// ------------------------------------------------------------------
const ALLOWED_MIME = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf',
  'text/csv', 'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

const storage = env.uploadsEnabled
  ? multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, env.uploadDir),
      // Nome gerado no servidor: o nome original do cliente nunca toca o filesystem.
      filename: (_req, file, cb) => cb(null, `${randomUUID()}${path.extname(file.originalname).slice(0, 10)}`),
    })
  : multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: env.maxUploadMb * 1024 * 1024, files: 5 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(new Error(`Tipo de arquivo não permitido: ${file.mimetype}`));
    }
    cb(null, true);
  },
});

router.post(
  '/attachments/:transactionId',
  requireUploads,
  upload.array('files', 5),
  asyncHandler(async (req, res) => {
    const tx = await get('SELECT * FROM transactions WHERE id = ? AND user_id = ?', [req.params.transactionId, req.user.id]);
    if (!tx) throw notFound('Lançamento não encontrado');
    if (!req.files?.length) throw badRequest('Nenhum arquivo enviado');

    // Insere em série: são no máximo 5 arquivos e a ordem do retorno importa.
    const created = [];
    for (const file of req.files) {
      const { lastInsertRowid } = await run(
        `INSERT INTO attachments (user_id, transaction_id, filename, original_name, mime_type, size_bytes)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [req.user.id, tx.id, file.filename, file.originalname, file.mimetype, file.size],
      );
      created.push(await get('SELECT * FROM attachments WHERE id = ?', [Number(lastInsertRowid)]));
    }

    res.status(201).json({ data: created });
  }),
);

router.get(
  '/attachments/:id/download',
  asyncHandler(async (req, res) => {
    const att = await get('SELECT * FROM attachments WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!att) throw notFound('Anexo não encontrado');

    const filePath = path.join(env.uploadDir, att.filename);
    // Confere que o caminho resolvido continua dentro da pasta de uploads.
    if (!filePath.startsWith(path.resolve(env.uploadDir)) || !fs.existsSync(filePath)) {
      throw notFound('Arquivo não encontrado no servidor');
    }

    res.setHeader('Content-Type', att.mime_type);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(att.original_name)}"`);
    fs.createReadStream(filePath).pipe(res);
  }),
);

router.delete(
  '/attachments/:id',
  asyncHandler(async (req, res) => {
    const att = await get('SELECT * FROM attachments WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!att) throw notFound('Anexo não encontrado');

    await run('DELETE FROM attachments WHERE id = ?', [att.id]);
    try {
      fs.unlinkSync(path.join(env.uploadDir, att.filename));
    } catch {
      // Arquivo já ausente no disco não impede remover o registro.
    }
    res.json({ ok: true });
  }),
);

// ------------------------------------------------------------------
// Importação de CSV / Excel
// ------------------------------------------------------------------
const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

/** Divide uma linha de CSV respeitando aspas e campos com separador dentro. */
function parseCsvLine(line, sep) {
  const out = [];
  let cur = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === sep && !inQuotes) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** Aceita DD/MM/AAAA, AAAA-MM-DD e o serial de data do Excel. */
function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);

  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);

  const br = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (br) {
    const [, d, m, y] = br;
    const year = y.length === 2 ? `20${y}` : y;
    return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  const serial = Number(s);
  if (Number.isFinite(serial) && serial > 20000 && serial < 60000) {
    // Serial do Excel: dias desde 30/12/1899.
    return new Date(Date.UTC(1899, 11, 30) + serial * 86400000).toISOString().slice(0, 10);
  }
  return null;
}

/** Mapeia cabeçalhos comuns (pt-BR e en) para os campos internos. */
const HEADER_ALIASES = {
  descricao: 'description', descrição: 'description', description: 'description', historico: 'description', histórico: 'description',
  valor: 'amount', amount: 'amount', value: 'amount',
  data: 'date', date: 'date', 'data da compra': 'date', competencia: 'date', competência: 'date',
  vencimento: 'due_date', 'data de vencimento': 'due_date', due_date: 'due_date',
  pagamento: 'settle_date', 'data de pagamento': 'settle_date', recebimento: 'settle_date',
  categoria: 'category', category: 'category',
  conta: 'account', account: 'account',
  tipo: 'kind', kind: 'kind', type: 'kind',
  status: 'status', situacao: 'status', situação: 'status',
  observacoes: 'notes', observações: 'notes', notes: 'notes', obs: 'notes',
  'forma de pagamento': 'payment_method', pagamento_forma: 'payment_method',
};

const normalizeHeader = (h) =>
  HEADER_ALIASES[String(h).trim().toLowerCase().replace(/\s+/g, ' ')] ?? null;

/** Lê CSV ou XLSX e devolve linhas já mapeadas para os campos internos. */
async function parseImportFile(file) {
  const isExcel = file.originalname.toLowerCase().endsWith('.xlsx') ||
    file.mimetype.includes('spreadsheetml');

  let rawRows = [];

  if (isExcel) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(file.buffer);
    const ws = wb.worksheets[0];
    if (!ws) throw badRequest('A planilha está vazia');

    const headers = [];
    ws.getRow(1).eachCell((cell, col) => { headers[col - 1] = cell.text ?? cell.value; });

    ws.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const obj = {};
      headers.forEach((h, i) => {
        const cell = row.getCell(i + 1);
        obj[h] = cell.value instanceof Date ? cell.value : (cell.text ?? cell.value);
      });
      rawRows.push(obj);
    });
  } else {
    const text = file.buffer.toString('utf8').replace(/^﻿/, '');
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) throw badRequest('O arquivo não possui linhas de dados');

    // Detecta o separador pela linha de cabeçalho.
    const sep = (lines[0].match(/;/g)?.length ?? 0) >= (lines[0].match(/,/g)?.length ?? 0) ? ';' : ',';
    const headers = parseCsvLine(lines[0], sep);

    rawRows = lines.slice(1).map((line) => {
      const cells = parseCsvLine(line, sep);
      return Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? '']));
    });
  }

  return rawRows.map((raw) => {
    const mapped = {};
    for (const [key, value] of Object.entries(raw)) {
      const field = normalizeHeader(key);
      if (field) mapped[field] = value;
    }
    return mapped;
  });
}

router.post(
  '/import/preview',
  importUpload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw badRequest('Envie um arquivo CSV ou XLSX');
    const rows = await parseImportFile(req.file);
    res.json({
      total: rows.length,
      preview: rows.slice(0, 20),
      detected_fields: [...new Set(rows.flatMap((r) => Object.keys(r)))],
    });
  }),
);

router.post(
  '/import',
  importUpload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw badRequest('Envie um arquivo CSV ou XLSX');

    const defaultAccountId = req.body.account_id ? Number(req.body.account_id) : null;
    const defaultKind = req.body.kind ?? null;

    if (defaultAccountId && !await get('SELECT id FROM accounts WHERE id = ? AND user_id = ?', [defaultAccountId, req.user.id])) {
      throw badRequest('Conta de destino não encontrada');
    }

    const rows = await parseImportFile(req.file);
    if (rows.length === 0) throw badRequest('Nenhuma linha encontrada no arquivo');
    if (rows.length > 5000) throw badRequest('Limite de 5.000 linhas por importação');

    // Índices por nome para resolver categoria/conta sem uma query por linha.
    const categories = new Map(
      (await all('SELECT id, name, kind FROM categories WHERE user_id = ?', [req.user.id]))
        .map((c) => [`${c.kind}:${c.name.toLowerCase()}`, c.id]),
    );
    const accounts = new Map(
      (await all('SELECT id, name FROM accounts WHERE user_id = ?', [req.user.id]))
        .map((a) => [a.name.toLowerCase(), a.id]),
    );

    const errors = [];
    let imported = 0;

    await transaction(async () => {
      // Laço `for` em vez de `forEach`: só ele permite aguardar cada inserção
      // dentro da transação (um `forEach` async dispararia tudo solto e o
      // COMMIT aconteceria antes das gravações terminarem).
      for (const [index, row] of rows.entries()) {
        const lineNo = index + 2; // +1 cabeçalho, +1 base 1

        const description = String(row.description ?? '').trim();
        if (!description) { errors.push({ linha: lineNo, erro: 'Descrição vazia' }); continue; }

        const rawAmount = String(row.amount ?? '').trim();
        if (!rawAmount) { errors.push({ linha: lineNo, erro: 'Valor vazio' }); continue; }

        // Valor negativo no extrato indica despesa.
        const isNegative = rawAmount.startsWith('-');
        const amount = Math.abs(toCents(rawAmount));
        if (amount <= 0) { errors.push({ linha: lineNo, erro: `Valor inválido: "${rawAmount}"` }); continue; }

        let kind = defaultKind;
        if (!kind) {
          const declared = String(row.kind ?? '').toLowerCase();
          if (declared.includes('receita') || declared.includes('income') || declared.includes('credito')) kind = 'income';
          else if (declared.includes('despesa') || declared.includes('expense') || declared.includes('debito')) kind = 'expense';
          else kind = isNegative ? 'expense' : 'income';
        }

        const date = parseDate(row.date) ?? parseDate(row.due_date) ?? today();
        const dueDate = parseDate(row.due_date) ?? date;
        const settleDate = parseDate(row.settle_date);

        const categoryName = String(row.category ?? '').trim().toLowerCase();
        const categoryId = categoryName ? (categories.get(`${kind}:${categoryName}`) ?? null) : null;

        const accountName = String(row.account ?? '').trim().toLowerCase();
        const accountId = (accountName ? accounts.get(accountName) : null) ?? defaultAccountId;

        const statusRaw = String(row.status ?? '').toLowerCase();
        const settled = !!settleDate || statusRaw.includes('pago') || statusRaw.includes('recebido');

        await run(
          `INSERT INTO transactions
             (user_id, kind, description, amount, status, category_id, account_id,
              competence_date, due_date, settle_date, expense_nature, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [req.user.id, kind, description.slice(0, 200), amount,
           settled ? 'settled' : 'pending', categoryId, accountId,
           date, dueDate, settled ? (settleDate ?? date) : null,
           kind === 'expense' ? 'variable' : null,
           row.notes ? String(row.notes).slice(0, 2000) : 'Importado de arquivo'],
        );
        imported++;
      }
    });

    await logAudit({
      userId: req.user.id, entity: 'transactions', action: 'import',
      summary: `${imported} lançamento(s) importado(s) de ${req.file.originalname}`,
    });

    res.json({
      ok: true,
      imported,
      failed: errors.length,
      errors: errors.slice(0, 50),
      message: `${imported} lançamento(s) importado(s)${errors.length ? `, ${errors.length} com erro` : ''}`,
    });
  }),
);

/** Modelo de planilha para o usuário preencher. */
router.get(
  '/import/template',
  asyncHandler(async (req, res) => {
    const headers = ['Data', 'Vencimento', 'Descrição', 'Valor', 'Tipo', 'Categoria', 'Conta', 'Status', 'Observações'];
    const example = ['01/03/2026', '10/03/2026', 'Supermercado', '-350,90', 'Despesa', 'Alimentação', 'Carteira', 'Pago', 'Compra do mês'];

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="modelo-importacao.csv"');
    res.send(`﻿${headers.join(';')}\r\n${example.join(';')}\r\n`);
  }),
);

// ------------------------------------------------------------------
// Backup e restauração
// ------------------------------------------------------------------
const BACKUP_TABLES = [
  'accounts', 'categories', 'credit_cards', 'card_invoices', 'recurrences', 'transfers',
  'transactions', 'investments', 'investment_movements', 'asset_valuations',
  'budgets', 'goals', 'goal_contributions', 'assets', 'liabilities',
];

router.get(
  '/backup',
  asyncHandler(async (req, res) => {
    const payload = {
      format: 'controle-financeiro-backup',
      version: 1,
      exported_at: new Date().toISOString(),
      user: { name: req.user.name, email: req.user.email },
      tables: {},
    };

    for (const table of BACKUP_TABLES) {
      payload.tables[table] = await all(`SELECT * FROM ${table} WHERE user_id = ?`, [req.user.id]);
    }

    const filename = `backup-financeiro-${today().replaceAll('-', '')}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(JSON.stringify(payload, null, 2));
  }),
);

router.post(
  '/restore',
  importUpload.single('file'),
  validate(z.object({ confirm: z.string().optional() }).passthrough()),
  asyncHandler(async (req, res) => {
    if (!req.file) throw badRequest('Envie o arquivo de backup (.json)');

    // Restaurar apaga os dados atuais — exige confirmação explícita.
    if (req.body.confirm !== 'SUBSTITUIR') {
      throw badRequest('Para restaurar, envie o campo "confirm" com o valor SUBSTITUIR. Todos os dados atuais serão apagados.');
    }

    let payload;
    try {
      payload = JSON.parse(req.file.buffer.toString('utf8'));
    } catch {
      throw badRequest('Arquivo de backup inválido (JSON malformado)');
    }
    if (payload.format !== 'controle-financeiro-backup') {
      throw badRequest('Este arquivo não é um backup deste sistema');
    }

    const userId = req.user.id;
    let restored = 0;

    await transaction(async () => {
      // Ordem inversa das dependências para não violar chave estrangeira.
      for (const table of [...BACKUP_TABLES].reverse()) {
        await run(`DELETE FROM ${table} WHERE user_id = ?`, [userId]);
      }

      for (const table of BACKUP_TABLES) {
        const rows = payload.tables?.[table] ?? [];
        for (const row of rows) {
          const data = { ...row, user_id: userId };
          const keys = Object.keys(data);
          // As linhas do usuário acabaram de ser apagadas, então um INSERT
          // simples basta; o ON CONFLICT protege contra ids repetidos no arquivo.
          await run(
            `INSERT INTO ${table} (${keys.join(', ')})
             VALUES (${keys.map(() => '?').join(', ')})
             ON CONFLICT (id) DO NOTHING`,
            keys.map((k) => data[k]),
          );
          restored++;
        }
      }

      // Os ids vieram prontos do backup, então as sequências continuam no valor
      // antigo. Sem reposicioná-las, o próximo cadastro colidiria com um id já
      // existente.
      for (const table of BACKUP_TABLES) {
        await run(
          `SELECT setval(
             pg_get_serial_sequence('${table}', 'id'),
             GREATEST((SELECT COALESCE(MAX(id), 0) FROM ${table}), 1)
           )`,
        );
      }
    });

    await logAudit({ userId, entity: 'backup', action: 'import', summary: `Backup restaurado: ${restored} registro(s)` });
    res.json({ ok: true, restored, message: `${restored} registro(s) restaurado(s)` });
  }),
);

export default router;
