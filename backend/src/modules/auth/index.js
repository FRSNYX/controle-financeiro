import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { get, run, transaction } from '../../db/index.js';
import { seedUserDefaults } from '../../db/defaults.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth, signAccessToken } from '../../middleware/auth.js';
import { hashPassword, verifyPassword, randomToken } from '../../utils/password.js';
import { asyncHandler, badRequest, conflict, unauthorized } from '../../utils/errors.js';
import { logAudit } from '../../utils/audit.js';
import { env, isProd } from '../../config/env.js';

const router = Router();

// Freio contra força bruta. Janela curta o bastante para não punir o usuário legítimo.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' },
});

const passwordRule = z
  .string()
  .min(8, 'A senha deve ter ao menos 8 caracteres')
  .max(128, 'Senha muito longa');

const registerSchema = z.object({
  name: z.string().trim().min(2, 'Informe seu nome').max(120),
  email: z.string().trim().toLowerCase().email('E-mail inválido'),
  password: passwordRule,
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('E-mail inválido'),
  password: z.string().min(1, 'Informe a senha'),
});

async function issueRefresh(userId) {
  const token = randomToken(48);
  const expires = new Date(Date.now() + env.refreshTtlDays * 86400_000).toISOString();
  await run('INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES (?, ?, ?)', [
    userId,
    token,
    expires,
  ]);
  return token;
}

const publicUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  theme: u.theme,
  currency: u.currency,
  projection_rate: u.projection_rate,
});

// ------------------------------------------------------------------
// POST /api/auth/register
// ------------------------------------------------------------------
router.post(
  '/register',
  authLimiter,
  validate(registerSchema),
  asyncHandler(async (req, res) => {
    const { name, email, password } = req.body;

    if (await get('SELECT id FROM users WHERE email = ?', [email])) {
      throw conflict('Já existe uma conta com este e-mail');
    }

    const { hash, salt } = hashPassword(password);

    const user = await transaction(async () => {
      const { lastInsertRowid: id } = await run(
        'INSERT INTO users (name, email, password_hash, password_salt) VALUES (?, ?, ?, ?)',
        [name, email, hash, salt],
      );
      // Categorias e carteira padrão: o usuário entra com o sistema já utilizável.
      await seedUserDefaults(Number(id));
      return await get('SELECT * FROM users WHERE id = ?', [Number(id)]);
    });

    await logAudit({ userId: user.id, entity: 'users', entityId: user.id, action: 'create', summary: 'Conta criada' });

    res.status(201).json({
      user: publicUser(user),
      accessToken: signAccessToken(user),
      refreshToken: await issueRefresh(user.id),
    });
  }),
);

// ------------------------------------------------------------------
// POST /api/auth/login
// ------------------------------------------------------------------
router.post(
  '/login',
  authLimiter,
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const user = await get('SELECT * FROM users WHERE email = ?', [email]);

    // Mesma mensagem para e-mail inexistente e senha errada: não revela cadastros.
    if (!user || !verifyPassword(password, user.password_hash, user.password_salt)) {
      throw unauthorized('E-mail ou senha incorretos');
    }

    await logAudit({ userId: user.id, entity: 'users', entityId: user.id, action: 'login', summary: 'Login realizado' });

    res.json({
      user: publicUser(user),
      accessToken: signAccessToken(user),
      refreshToken: await issueRefresh(user.id),
    });
  }),
);

// ------------------------------------------------------------------
// POST /api/auth/refresh — rotação: o token antigo é revogado no uso.
// ------------------------------------------------------------------
router.post(
  '/refresh',
  validate(z.object({ refreshToken: z.string().min(10) })),
  asyncHandler(async (req, res) => {
    const stored = await get('SELECT * FROM refresh_tokens WHERE token = ?', [req.body.refreshToken]);
    if (!stored || stored.revoked_at || new Date(stored.expires_at) < new Date()) {
      throw unauthorized('Sessão expirada. Faça login novamente.');
    }

    await run("UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = ?", [stored.id]);

    const user = await get('SELECT * FROM users WHERE id = ?', [stored.user_id]);
    if (!user) throw unauthorized('Usuário não encontrado');

    res.json({
      user: publicUser(user),
      accessToken: signAccessToken(user),
      refreshToken: await issueRefresh(user.id),
    });
  }),
);

router.post(
  '/logout',
  validate(z.object({ refreshToken: z.string().optional() })),
  asyncHandler(async (req, res) => {
    if (req.body.refreshToken) {
      await run("UPDATE refresh_tokens SET revoked_at = NOW() WHERE token = ?", [
        req.body.refreshToken,
      ]);
    }
    res.json({ ok: true });
  }),
);

// ------------------------------------------------------------------
// Recuperação de senha
// ------------------------------------------------------------------
router.post(
  '/forgot-password',
  authLimiter,
  validate(z.object({ email: z.string().trim().toLowerCase().email() })),
  asyncHandler(async (req, res) => {
    const user = await get('SELECT * FROM users WHERE email = ?', [req.body.email]);

    // Resposta idêntica exista ou não o e-mail — não confirma cadastros a terceiros.
    const response = {
      ok: true,
      message: 'Se o e-mail estiver cadastrado, enviaremos as instruções de recuperação.',
    };

    if (!user) return res.json(response);

    const token = randomToken(32);
    const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hora
    run('UPDATE users SET reset_token = ?, reset_expires = ? WHERE id = ?', [token, expires, user.id]);

    // Sem servidor de e-mail configurado, o token sai no log do servidor.
    // Em produção, plugue aqui o envio real (SMTP/serviço transacional).
    console.log(`\n[recuperacao de senha] ${user.email} -> token: ${token}\n`);

    res.json(isProd ? response : { ...response, devToken: token });
  }),
);

router.post(
  '/reset-password',
  authLimiter,
  validate(z.object({ token: z.string().min(10), password: passwordRule })),
  asyncHandler(async (req, res) => {
    const user = await get('SELECT * FROM users WHERE reset_token = ?', [req.body.token]);
    if (!user || !user.reset_expires || new Date(user.reset_expires) < new Date()) {
      throw badRequest('Token inválido ou expirado. Solicite uma nova recuperação.');
    }

    const { hash, salt } = hashPassword(req.body.password);
    await transaction(async () => {
      await run(
        `UPDATE users SET password_hash = ?, password_salt = ?, reset_token = NULL,
                          reset_expires = NULL, updated_at = NOW()
         WHERE id = ?`,
        [hash, salt, user.id],
      );
      // Trocar a senha derruba todas as sessões abertas.
      run("UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = ?", [user.id]);
    });

    await logAudit({ userId: user.id, entity: 'users', entityId: user.id, action: 'update', summary: 'Senha redefinida' });
    res.json({ ok: true, message: 'Senha alterada com sucesso.' });
  }),
);

// ------------------------------------------------------------------
// Perfil
// ------------------------------------------------------------------
router.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

router.patch(
  '/me',
  requireAuth,
  validate(
    z.object({
      name: z.string().trim().min(2).max(120).optional(),
      theme: z.enum(['light', 'dark']).optional(),
      projection_rate: z.number().min(0).max(1).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const { name, theme, projection_rate } = req.body;
    await run(
      `UPDATE users SET name = COALESCE(?, name),
                        theme = COALESCE(?, theme),
                        projection_rate = COALESCE(?, projection_rate),
                        updated_at = NOW()
       WHERE id = ?`,
      [name ?? null, theme ?? null, projection_rate ?? null, req.user.id],
    );
    res.json({ user: await get('SELECT id, name, email, theme, currency, projection_rate FROM users WHERE id = ?', [req.user.id]) });
  }),
);

router.post(
  '/change-password',
  requireAuth,
  validate(z.object({ currentPassword: z.string().min(1), newPassword: passwordRule })),
  asyncHandler(async (req, res) => {
    const user = await get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!verifyPassword(req.body.currentPassword, user.password_hash, user.password_salt)) {
      throw badRequest('Senha atual incorreta');
    }
    const { hash, salt } = hashPassword(req.body.newPassword);
    await run(
      `UPDATE users SET password_hash = ?, password_salt = ?, updated_at = NOW()
       WHERE id = ?`,
      [hash, salt, user.id],
    );
    await logAudit({ userId: user.id, entity: 'users', entityId: user.id, action: 'update', summary: 'Senha alterada' });
    res.json({ ok: true });
  }),
);

export default router;
