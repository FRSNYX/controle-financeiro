import { useState } from 'react';
import { Link } from 'react-router-dom';
import { MailCheck, ArrowLeft } from 'lucide-react';
import { api } from '../lib/api';
import { useToast } from '../context/AppProviders';
import { Button, Input, Field } from '../components/ui';
import AuthShell from './AuthShell';

/**
 * Dois passos na mesma tela: pedir o token e usá-lo para trocar a senha.
 * Sem servidor de e-mail configurado, o backend devolve o token em `devToken`
 * (só fora de produção) para o fluxo poder ser concluído.
 */
export default function ForgotPassword() {
  const toast = useToast();
  const [step, setStep] = useState('request');
  const [email, setEmail] = useState('');
  const [devToken, setDevToken] = useState(null);
  const [form, setForm] = useState({ token: '', password: '', confirm: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const requestToken = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.post('/auth/forgot-password', { email: email.trim() });
      setDevToken(res.devToken ?? null);
      if (res.devToken) setForm((f) => ({ ...f, token: res.devToken }));
      setStep('reset');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const resetPassword = async (e) => {
    e.preventDefault();
    setError('');
    if (form.password !== form.confirm) return setError('As senhas não coincidem.');

    setLoading(true);
    try {
      await api.post('/auth/reset-password', { token: form.token.trim(), password: form.password });
      toast.success('Senha alterada. Faça login com a nova senha.');
      setStep('done');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const backLink = (
    <Link to="/login" className="inline-flex items-center gap-1.5 text-brand font-medium hover:underline">
      <ArrowLeft size={14} />
      Voltar para o login
    </Link>
  );

  if (step === 'done') {
    return (
      <AuthShell title="Senha alterada" subtitle="Tudo certo. Você já pode entrar com a nova senha.">
        <div className="rounded-lg border border-positive/40 bg-positive/10 p-4 flex gap-3">
          <MailCheck size={20} className="text-positive shrink-0 mt-0.5" />
          <p className="text-sm text-ink">
            Por segurança, todas as sessões abertas foram encerradas.
          </p>
        </div>
        <div className="mt-6 text-center">{backLink}</div>
      </AuthShell>
    );
  }

  if (step === 'reset') {
    return (
      <AuthShell
        title="Definir nova senha"
        subtitle="Informe o código que você recebeu e escolha a nova senha."
        footer={backLink}
      >
        {devToken && (
          <div className="rounded-lg border border-info/40 bg-info/10 p-3 mb-4">
            <p className="text-xs text-ink">
              <strong>Ambiente de desenvolvimento:</strong> o envio de e-mail não está
              configurado, então o código foi preenchido automaticamente. Em produção ele
              chega por e-mail.
            </p>
          </div>
        )}

        <form onSubmit={resetPassword} className="space-y-4">
          <Field label="Código de recuperação" required>
            <Input
              required
              placeholder="Cole aqui o código recebido"
              value={form.token}
              onChange={(e) => setForm({ ...form, token: e.target.value })}
            />
          </Field>

          <Field label="Nova senha" required hint="Mínimo de 8 caracteres">
            <Input
              type="password"
              required
              minLength={8}
              placeholder="********"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </Field>

          <Field label="Confirmar nova senha" required>
            <Input
              type="password"
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

          <Button type="submit" size="lg" className="w-full justify-center" loading={loading}>
            Alterar senha
          </Button>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Recuperar senha"
      subtitle="Informe seu e-mail e enviaremos as instruções de recuperação."
      footer={backLink}
    >
      <form onSubmit={requestToken} className="space-y-4">
        <Field label="E-mail cadastrado" required>
          <Input
            type="email"
            autoFocus
            required
            placeholder="voce@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>

        {error && (
          <div className="rounded-lg border border-negative/40 bg-negative/10 px-3 py-2.5">
            <p className="text-sm text-negative">{error}</p>
          </div>
        )}

        <Button type="submit" size="lg" className="w-full justify-center" loading={loading}>
          Enviar instruções
        </Button>

        <button
          type="button"
          onClick={() => setStep('reset')}
          className="w-full text-xs text-muted hover:text-ink"
        >
          Já tenho um código de recuperação
        </button>
      </form>
    </AuthShell>
  );
}
