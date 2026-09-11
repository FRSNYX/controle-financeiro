import { useState, useRef } from 'react';
import {
  User, Lock, Palette, Database, Upload, Download, FileUp, AlertTriangle,
  Sun, Moon, Check, TrendingUp, ShieldCheck,
} from 'lucide-react';
import { api, download } from '../lib/api';
import { useAuth, useTheme, useToast } from '../context/AppProviders';
import {
  Card, CardHeader, Button, Input, Select, Field, Modal, PageHeader, Tabs,
  Table, Badge, EmptyState, cx,
} from '../components/ui';
import { useAccounts, accountOptions, useApiMutation } from '../hooks/useLookups';
import { percent } from '../lib/format';
import { InstalarAppCard } from '../components/InstalarApp';

function ProfileTab() {
  const { user, updateUser } = useAuth();
  const toast = useToast();

  const [name, setName] = useState(user?.name ?? '');
  const [rate, setRate] = useState(((user?.projection_rate ?? 0.008) * 100).toFixed(2));

  const [passwords, setPasswords] = useState({ current: '', next: '', confirm: '' });

  const profileMutation = useApiMutation({
    mutationFn: () =>
      api.patch('/auth/me', { name: name.trim(), projection_rate: Number(rate) / 100 }),
    successMessage: 'Perfil atualizado',
    onSuccess: (data) => updateUser(data.user),
  });

  const passwordMutation = useApiMutation({
    mutationFn: () =>
      api.post('/auth/change-password', {
        currentPassword: passwords.current,
        newPassword: passwords.next,
      }),
    successMessage: 'Senha alterada',
    onSuccess: () => setPasswords({ current: '', next: '', confirm: '' }),
  });

  const passwordsMatch = passwords.next === passwords.confirm;
  const canChangePassword =
    passwords.current && passwords.next.length >= 8 && passwordsMatch;

  const annualRate = ((1 + Number(rate) / 100) ** 12 - 1) * 100;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Dados pessoais" icon={User} />
        <div className="space-y-4 max-w-lg">
          <Field label="Nome">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="E-mail" hint="O e-mail de acesso não pode ser alterado">
            <Input disabled value={user?.email ?? ''} />
          </Field>
          <Field
            label="Rentabilidade esperada (% ao mês)"
            hint={`Usada nas projeções de patrimônio — equivale a ${annualRate.toFixed(2)}% ao ano`}
          >
            <Input
              type="number"
              step="0.01"
              min={0}
              max={5}
              value={rate}
              onChange={(e) => setRate(e.target.value)}
            />
          </Field>
          <Button
            onClick={() => profileMutation.mutate()}
            loading={profileMutation.isPending}
            disabled={name.trim().length < 2}
          >
            Salvar alterações
          </Button>
        </div>
      </Card>

      <Card>
        <CardHeader title="Alterar senha" subtitle="Trocar a senha encerra todas as sessões abertas" icon={Lock} />
        <div className="space-y-4 max-w-lg">
          <Field label="Senha atual" required>
            <Input
              type="password"
              autoComplete="current-password"
              value={passwords.current}
              onChange={(e) => setPasswords({ ...passwords, current: e.target.value })}
            />
          </Field>
          <Field label="Nova senha" required hint="Mínimo de 8 caracteres">
            <Input
              type="password"
              autoComplete="new-password"
              value={passwords.next}
              onChange={(e) => setPasswords({ ...passwords, next: e.target.value })}
            />
          </Field>
          <Field
            label="Confirmar nova senha"
            required
            error={passwords.confirm && !passwordsMatch ? 'As senhas não coincidem' : null}
          >
            <Input
              type="password"
              autoComplete="new-password"
              value={passwords.confirm}
              onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })}
            />
          </Field>
          <Button
            onClick={() => passwordMutation.mutate()}
            loading={passwordMutation.isPending}
            disabled={!canChangePassword}
          >
            Alterar senha
          </Button>
        </div>
      </Card>
    </div>
  );
}

function AppearanceTab() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="space-y-4">
    <Card>
      <CardHeader title="Aparência" subtitle="A escolha fica salva neste navegador" icon={Palette} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
        {[
          { value: 'light', label: 'Tema claro', icon: Sun, description: 'Fundo claro, ideal para ambientes iluminados' },
          { value: 'dark', label: 'Tema escuro', icon: Moon, description: 'Fundo escuro, mais confortável à noite' },
        ].map((option) => (
          <button
            key={option.value}
            onClick={() => setTheme(option.value)}
            className={cx(
              'rounded-xl border p-4 text-left transition-all',
              theme === option.value
                ? 'border-brand bg-brand/5 ring-2 ring-brand/20'
                : 'border-line hover:border-brand/40',
            )}
          >
            <div className="flex items-center justify-between mb-2">
              <option.icon size={20} className={theme === option.value ? 'text-brand' : 'text-muted'} />
              {theme === option.value && <Check size={16} className="text-brand" />}
            </div>
            <p className="font-medium text-ink">{option.label}</p>
            <p className="text-xs text-muted mt-1">{option.description}</p>
          </button>
        ))}
      </div>
    </Card>

    <InstalarAppCard />
    </div>
  );
}

function DataTab() {
  const toast = useToast();
  const importRef = useRef(null);
  const restoreRef = useRef(null);

  const [preview, setPreview] = useState(null);
  const [importFile, setImportFile] = useState(null);
  const [importAccount, setImportAccount] = useState('');
  const [importKind, setImportKind] = useState('');
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreFile, setRestoreFile] = useState(null);
  const [confirmText, setConfirmText] = useState('');

  const { data: accountsData } = useAccounts();

  const previewMutation = useApiMutation({
    mutationFn: (file) => {
      const fd = new FormData();
      fd.append('file', file);
      return api.upload('/data/import/preview', fd);
    },
    successMessage: null,
    onSuccess: (data) => setPreview(data),
  });

  const importMutation = useApiMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append('file', importFile);
      if (importAccount) fd.append('account_id', importAccount);
      if (importKind) fd.append('kind', importKind);
      return api.upload('/data/import', fd);
    },
    invalidate: ['transactions', 'accounts', 'dashboard'],
    successMessage: (r) => r.message,
    onSuccess: () => {
      setPreview(null);
      setImportFile(null);
    },
  });

  const restoreMutation = useApiMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append('file', restoreFile);
      fd.append('confirm', 'SUBSTITUIR');
      return api.upload('/data/restore', fd);
    },
    invalidate: ['transactions', 'accounts', 'cards', 'investments', 'goals', 'budgets', 'networth'],
    successMessage: (r) => r.message,
    onSuccess: () => {
      setRestoreOpen(false);
      setRestoreFile(null);
      setConfirmText('');
    },
  });

  const doBackup = async () => {
    try {
      toast.info('Gerando backup...');
      await download('/data/backup', {}, `backup-financeiro-${new Date().toISOString().slice(0, 10)}.json`);
      toast.success('Backup baixado');
    } catch (err) {
      toast.error(err.message);
    }
  };

  const getTemplate = async () => {
    try {
      await download('/data/import/template', {}, 'modelo-importacao.csv');
      toast.success('Modelo baixado');
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Importar lançamentos"
          subtitle="Traga extratos ou planilhas em CSV ou Excel"
          icon={FileUp}
          action={
            <Button size="sm" variant="outline" icon={Download} onClick={getTemplate}>
              Baixar modelo
            </Button>
          }
        />

        <div className="space-y-4">
          <input
            ref={importRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                setImportFile(file);
                previewMutation.mutate(file);
              }
            }}
          />

          <button
            onClick={() => importRef.current?.click()}
            className="w-full rounded-xl border-2 border-dashed border-line hover:border-brand p-8 text-center transition-colors"
          >
            <Upload size={24} className="mx-auto text-muted mb-2" />
            <p className="text-sm text-ink font-medium">
              {importFile ? importFile.name : 'Clique para escolher um arquivo'}
            </p>
            <p className="text-xs text-muted mt-1">CSV ou Excel (.xlsx), até 20 MB e 5.000 linhas</p>
          </button>

          {preview && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3 rounded-lg bg-brand/5 border border-brand/20 p-3 flex-wrap">
                <p className="text-sm text-ink">
                  <strong>{preview.total}</strong> linha(s) detectada(s) · campos reconhecidos:{' '}
                  <span className="text-muted">{preview.detected_fields.join(', ') || 'nenhum'}</span>
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Conta padrão" hint="Usada quando a linha não indica a conta">
                  <Select
                    value={importAccount}
                    onChange={(e) => setImportAccount(e.target.value)}
                    placeholder="Detectar pelo arquivo"
                    options={accountOptions(accountsData)}
                  />
                </Field>
                <Field label="Forçar tipo" hint="Em branco: valor negativo vira despesa">
                  <Select
                    value={importKind}
                    onChange={(e) => setImportKind(e.target.value)}
                    placeholder="Detectar automaticamente"
                    options={[
                      { value: 'expense', label: 'Tudo como despesa' },
                      { value: 'income', label: 'Tudo como receita' },
                    ]}
                  />
                </Field>
              </div>

              <div>
                <p className="text-xs font-medium text-muted mb-2">Prévia das primeiras linhas</p>
                <div className="overflow-x-auto rounded-lg border border-line">
                  <table className="w-full text-xs">
                    <thead className="bg-surface-2">
                      <tr>
                        {['date', 'description', 'amount', 'category', 'account'].map((field) => (
                          <th key={field} className="text-left px-3 py-2 font-medium text-muted">
                            {field}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.preview.slice(0, 5).map((row, i) => (
                        <tr key={i} className="border-t border-line/50">
                          {['date', 'description', 'amount', 'category', 'account'].map((field) => (
                            <td key={field} className="px-3 py-2 text-ink truncate max-w-[160px]">
                              {String(row[field] ?? '—')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex gap-2">
                <Button onClick={() => importMutation.mutate()} loading={importMutation.isPending}>
                  Importar {preview.total} lançamento(s)
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setPreview(null);
                    setImportFile(null);
                  }}
                >
                  Cancelar
                </Button>
              </div>

              {importMutation.data?.errors?.length > 0 && (
                <div className="rounded-lg border border-warn/40 bg-warn/10 p-3">
                  <p className="text-sm text-ink font-medium mb-1">
                    {importMutation.data.failed} linha(s) com erro
                  </p>
                  <ul className="text-xs text-muted space-y-0.5 max-h-32 overflow-y-auto">
                    {importMutation.data.errors.map((err, i) => (
                      <li key={i}>
                        Linha {err.linha}: {err.erro}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Backup dos dados" subtitle="Exporte tudo em um arquivo JSON" icon={Database} />
        <div className="flex flex-col sm:flex-row gap-3">
          <Button icon={Download} onClick={doBackup}>
            Baixar backup completo
          </Button>
          <Button variant="outline" icon={Upload} onClick={() => setRestoreOpen(true)}>
            Restaurar backup
          </Button>
        </div>
        <p className="text-xs text-muted mt-3">
          O backup inclui contas, categorias, lançamentos, cartões, faturas, investimentos,
          orçamentos, metas, bens e dívidas.
        </p>
      </Card>

      <Card className="border-negative/30">
        <CardHeader
          title="Restaurar backup"
          subtitle="Esta operação substitui todos os dados atuais"
          icon={AlertTriangle}
        />
        <div className="flex items-start gap-2 rounded-lg bg-negative/10 border border-negative/30 p-3">
          <AlertTriangle size={16} className="text-negative shrink-0 mt-0.5" />
          <p className="text-xs text-ink leading-relaxed">
            Restaurar apaga <strong>todos</strong> os seus dados atuais e coloca no lugar o
            conteúdo do arquivo. Faça um backup antes, por segurança.
          </p>
        </div>
      </Card>

      <Modal
        open={restoreOpen}
        onClose={() => setRestoreOpen(false)}
        title="Restaurar backup"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRestoreOpen(false)}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              loading={restoreMutation.isPending}
              disabled={!restoreFile || confirmText !== 'SUBSTITUIR'}
              onClick={() => restoreMutation.mutate()}
            >
              Restaurar e substituir
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="flex items-start gap-2 rounded-lg bg-negative/10 border border-negative/30 p-3">
            <AlertTriangle size={16} className="text-negative shrink-0 mt-0.5" />
            <p className="text-xs text-ink">
              Todos os seus dados atuais serão <strong>apagados</strong> e substituídos pelo backup.
            </p>
          </div>

          <input
            ref={restoreRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={(e) => setRestoreFile(e.target.files?.[0] ?? null)}
          />
          <button
            onClick={() => restoreRef.current?.click()}
            className="w-full rounded-lg border-2 border-dashed border-line hover:border-brand p-5 text-center"
          >
            <Upload size={20} className="mx-auto text-muted mb-1.5" />
            <p className="text-sm text-ink">{restoreFile ? restoreFile.name : 'Escolher arquivo de backup (.json)'}</p>
          </button>

          <Field label="Digite SUBSTITUIR para confirmar" required>
            <Input
              placeholder="SUBSTITUIR"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value.toUpperCase())}
            />
          </Field>
        </div>
      </Modal>
    </div>
  );
}

function SecurityTab() {
  const items = [
    {
      title: 'Senha protegida com scrypt',
      text: 'A senha nunca é guardada em texto puro. Usamos scrypt com sal aleatório de 16 bytes por usuário e comparação em tempo constante.',
    },
    {
      title: 'Sessões com token de curta duração',
      text: 'O token de acesso expira em 15 minutos e é renovado automaticamente por um token de atualização rotativo, válido por 7 dias.',
    },
    {
      title: 'Isolamento entre usuários',
      text: 'Toda consulta ao banco filtra pelo seu identificador. Um usuário nunca alcança dados de outro, mesmo informando um id existente.',
    },
    {
      title: 'Proteção contra força bruta',
      text: 'Login e recuperação de senha têm limite de 20 tentativas a cada 15 minutos por endereço.',
    },
    {
      title: 'Validação de toda entrada',
      text: 'Cada campo enviado passa por validação de esquema antes de tocar o banco, e os erros voltam campo a campo.',
    },
    {
      title: 'Exclusão reversível',
      text: 'Lançamentos excluídos vão para a lixeira em vez de sumir. O histórico nunca se perde na virada de mês ou de ano.',
    },
  ];

  return (
    <Card>
      <CardHeader title="Segurança dos dados" subtitle="Como suas informações são protegidas" icon={ShieldCheck} />
      <div className="space-y-4">
        {items.map((item) => (
          <div key={item.title} className="flex gap-3">
            <div className="h-8 w-8 rounded-lg bg-positive/10 flex items-center justify-center shrink-0">
              <Check size={15} className="text-positive" />
            </div>
            <div>
              <p className="text-sm font-medium text-ink">{item.title}</p>
              <p className="text-xs text-muted mt-0.5 leading-relaxed">{item.text}</p>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

export default function Settings() {
  const [tab, setTab] = useState('perfil');

  return (
    <div className="space-y-4">
      <PageHeader title="Preferências" subtitle="Conta, aparência, dados e segurança" />

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { value: 'perfil', label: 'Perfil', icon: User },
          { value: 'aparencia', label: 'Aparência', icon: Palette },
          { value: 'dados', label: 'Dados e backup', icon: Database },
          { value: 'seguranca', label: 'Segurança', icon: ShieldCheck },
        ]}
      />

      {tab === 'perfil' && <ProfileTab />}
      {tab === 'aparencia' && <AppearanceTab />}
      {tab === 'dados' && <DataTab />}
      {tab === 'seguranca' && <SecurityTab />}
    </div>
  );
}
