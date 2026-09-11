import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { useAuth, useToast } from '../context/AppProviders';
import { Button, Input, Field } from '../components/ui';
import AuthShell from './AuthShell';

export default function Login() {
  const { login } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  const [form, setForm] = useState({ email: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(form.email.trim(), form.password);
      toast.success('Bem-vindo de volta!');
      // Devolve o usuário para a tela que ele tentou abrir antes do login.
      navigate(location.state?.from?.pathname ?? '/', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="Entrar na sua conta"
      subtitle="Informe seus dados para acessar o painel financeiro."
      footer={
        <>
          Ainda não tem conta?{' '}
          <Link to="/cadastro" className="text-brand font-medium hover:underline">
            Criar conta gratuita
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="E-mail" required>
          <Input
            type="email"
            autoComplete="email"
            autoFocus
            required
            placeholder="voce@email.com"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </Field>

        <Field label="Senha" required>
          <div className="relative">
            <Input
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              required
              placeholder="********"
              className="pr-10"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-ink"
              aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </Field>

        <div className="flex justify-end">
          <Link to="/recuperar-senha" className="text-xs text-brand hover:underline">
            Esqueci minha senha
          </Link>
        </div>

        {error && (
          <div className="rounded-lg border border-negative/40 bg-negative/10 px-3 py-2.5">
            <p className="text-sm text-negative">{error}</p>
          </div>
        )}

        <Button type="submit" size="lg" className="w-full justify-center" loading={loading}>
          Entrar
        </Button>
      </form>
    </AuthShell>
  );
}
