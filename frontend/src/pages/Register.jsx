import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Check, X } from 'lucide-react';
import { useAuth, useToast } from '../context/AppProviders';
import { Button, Input, Field, cx } from '../components/ui';
import AuthShell from './AuthShell';

/** Exigências mostradas ao vivo — o usuário não descobre o erro só ao enviar. */
const RULES = [
  { test: (p) => p.length >= 8, label: 'Ao menos 8 caracteres' },
  { test: (p) => /[a-zA-Z]/.test(p), label: 'Ao menos uma letra' },
  { test: (p) => /\d/.test(p), label: 'Ao menos um número' },
];

export default function Register() {
  const { register } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const passwordOk = RULES.every((r) => r.test(form.password));
  const matches = form.password === form.confirm;
  const canSubmit = form.name.trim().length >= 2 && form.email.includes('@') && passwordOk && matches;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!matches) return setError('As senhas não coincidem.');

    setLoading(true);
    try {
      await register(form.name.trim(), form.email.trim(), form.password);
      toast.success('Conta criada! Suas categorias padrão já estão prontas.');
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="Criar sua conta"
      subtitle="Leva menos de um minuto. As categorias padrão já vêm prontas."
      footer={
        <>
          Já tem conta?{' '}
          <Link to="/login" className="text-brand font-medium hover:underline">
            Entrar
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Nome completo" required>
          <Input
            autoFocus
            required
            placeholder="Seu nome"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </Field>

        <Field label="E-mail" required>
          <Input
            type="email"
            autoComplete="email"
            required
            placeholder="voce@email.com"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </Field>

        <Field label="Senha" required>
          <Input
            type="password"
            autoComplete="new-password"
            required
            placeholder="********"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
        </Field>

        {form.password && (
          <ul className="space-y-1">
            {RULES.map((rule) => {
              const ok = rule.test(form.password);
              return (
                <li
                  key={rule.label}
                  className={cx('flex items-center gap-1.5 text-xs', ok ? 'text-positive' : 'text-muted')}
                >
                  {ok ? <Check size={13} /> : <X size={13} />}
                  {rule.label}
                </li>
              );
            })}
          </ul>
        )}

        <Field
          label="Confirmar senha"
          required
          error={form.confirm && !matches ? 'As senhas não coincidem' : null}
        >
          <Input
            type="password"
            autoComplete="new-password"
            required
            placeholder="********"
            value={form.confirm}
            onChange={(e) => setForm({ ...form, confirm: e.target.value })}
          />
        </Field>

        {error && (
          <div className="rounded-lg border border-negative/40 bg-negative/10 px-3 py-2.5">
            <p className="text-sm text-negative">{error}</p>
          </div>
        )}

        <Button type="submit" size="lg" className="w-full justify-center" loading={loading} disabled={!canSubmit}>
          Criar conta
        </Button>
      </form>
    </AuthShell>
  );
}
