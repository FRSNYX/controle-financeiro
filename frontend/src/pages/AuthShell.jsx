import { Wallet, TrendingUp, ShieldCheck, PieChart } from 'lucide-react';

/** Moldura das telas públicas: formulário à esquerda, vitrine à direita. */
export default function AuthShell({ title, subtitle, children, footer }) {
  return (
    <div className="min-h-screen flex bg-bg">
      <div className="flex-1 flex items-center justify-center p-5">
        <div className="w-full max-w-sm">
          <div className="flex items-center gap-2.5 mb-8">
            <div className="h-10 w-10 rounded-xl bg-brand flex items-center justify-center">
              <Wallet size={20} className="text-white" />
            </div>
            <span className="text-lg font-semibold text-ink">
              Controle<span className="text-brand">Financeiro</span>
            </span>
          </div>

          <h1 className="text-2xl font-semibold text-ink tracking-tight">{title}</h1>
          {subtitle && <p className="text-sm text-muted mt-1.5 mb-6">{subtitle}</p>}

          {children}

          {footer && <div className="mt-6 text-sm text-center text-muted">{footer}</div>}
        </div>
      </div>

      {/* Vitrine some no mobile: ali o formulário precisa da tela inteira. */}
      <div className="hidden lg:flex flex-1 bg-brand/5 border-l border-line items-center justify-center p-10">
        <div className="max-w-md">
          <h2 className="text-2xl font-semibold text-ink leading-snug">
            Sua vida financeira inteira em um só lugar.
          </h2>
          <p className="text-muted mt-3 leading-relaxed">
            Receitas, despesas, cartões, investimentos e metas — com relatórios que mostram
            para onde o seu dinheiro realmente vai.
          </p>

          <div className="mt-8 space-y-4">
            {[
              { icon: PieChart, title: 'Relatórios que explicam', text: 'Gastos por categoria, evolução mensal e comparação com meses anteriores.' },
              { icon: TrendingUp, title: 'Patrimônio e projeções', text: 'Veja quanto você terá em 1, 5 e 10 anos mantendo o ritmo atual de aportes.' },
              { icon: ShieldCheck, title: 'Seus dados, seu servidor', text: 'Banco local, senha protegida por scrypt e backup completo quando quiser.' },
            ].map((item) => (
              <div key={item.title} className="flex gap-3">
                <div className="h-9 w-9 rounded-lg bg-surface border border-line flex items-center justify-center shrink-0">
                  <item.icon size={17} className="text-brand" />
                </div>
                <div>
                  <p className="font-medium text-ink text-sm">{item.title}</p>
                  <p className="text-sm text-muted mt-0.5 leading-relaxed">{item.text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
