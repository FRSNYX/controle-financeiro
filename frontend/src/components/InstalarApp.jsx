import { useState } from 'react';
import { Smartphone, Check, Share, SquarePlus, Download, X } from 'lucide-react';
import { useInstalacao } from '../hooks/useInstalacao';
import { Card, CardHeader, Button, Badge, cx } from './ui';

/** Passo a passo do iPhone, onde não existe instalação com um clique. */
function PassosIOS() {
  const passos = [
    { icone: Share, texto: 'Toque no botão Compartilhar, na barra do Safari' },
    { icone: SquarePlus, texto: 'Escolha "Adicionar à Tela de Início"' },
    { icone: Check, texto: 'Confirme em "Adicionar"' },
  ];

  return (
    <ol className="space-y-3">
      {passos.map((passo, i) => (
        <li key={passo.texto} className="flex items-center gap-3">
          <span className="h-7 w-7 rounded-full bg-brand/10 text-brand text-xs font-semibold flex items-center justify-center shrink-0">
            {i + 1}
          </span>
          <passo.icone size={17} className="text-muted shrink-0" />
          <span className="text-sm text-ink">{passo.texto}</span>
        </li>
      ))}
    </ol>
  );
}

/** Cartão completo, usado na tela de Preferências. */
export function InstalarAppCard() {
  const { instalado, podeInstalar, precisaInstrucoes, isIOS, instalar } = useInstalacao();

  return (
    <Card>
      <CardHeader
        title="Instalar no celular"
        subtitle="Abre em tela cheia, com ícone próprio, como um aplicativo"
        icon={Smartphone}
        action={instalado ? <Badge tone="positive">Instalado</Badge> : null}
      />

      {instalado ? (
        <p className="text-sm text-muted">
          Você já está usando o aplicativo instalado. Para abrir, use o ícone{' '}
          <strong className="text-ink">Finanças</strong> na tela inicial.
        </p>
      ) : podeInstalar ? (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            O sistema fica com ícone próprio na tela inicial, abre sem a barra de endereço e
            carrega instantâneo.
          </p>
          <Button icon={Download} onClick={instalar}>
            Instalar aplicativo
          </Button>
        </div>
      ) : precisaInstrucoes ? (
        <div className="space-y-4">
          <p className="text-sm text-muted">
            No iPhone a instalação é manual e leva três toques:
          </p>
          <PassosIOS />
          <p className="text-xs text-muted">
            Precisa ser pelo <strong className="text-ink">Safari</strong> — outros navegadores no
            iPhone não oferecem essa opção.
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted">
          Abra este endereço no celular para instalar. {isIOS ? '' : 'No computador, procure o '}
          {isIOS ? '' : 'ícone de instalar na barra de endereço do navegador.'}
        </p>
      )}
    </Card>
  );
}

/**
 * Convite discreto, exibido no rodapé da barra lateral.
 * Some assim que o app é instalado ou quando a pessoa dispensa.
 */
export function ConviteInstalacao({ recolhido }) {
  const { instalado, podeInstalar, precisaInstrucoes, instalar } = useInstalacao();
  const [dispensado, setDispensado] = useState(
    () => localStorage.getItem('fin.conviteInstalacao') === 'dispensado',
  );
  const [mostrandoPassos, setMostrandoPassos] = useState(false);

  const dispensar = () => {
    localStorage.setItem('fin.conviteInstalacao', 'dispensado');
    setDispensado(true);
  };

  if (instalado || dispensado || recolhido || (!podeInstalar && !precisaInstrucoes)) return null;

  return (
    <div className="mx-2.5 mb-2 rounded-lg border border-brand/30 bg-brand/5 p-3 animate-in">
      <div className="flex items-start gap-2">
        <Smartphone size={15} className="text-brand shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-ink">Instalar como aplicativo</p>
          <p className="text-[11px] text-muted mt-0.5 leading-snug">
            Ícone na tela inicial e abertura em tela cheia.
          </p>
        </div>
        <button onClick={dispensar} className="text-muted hover:text-ink shrink-0" aria-label="Dispensar">
          <X size={13} />
        </button>
      </div>

      {mostrandoPassos && (
        <div className="mt-3 pt-3 border-t border-brand/20">
          <PassosIOS />
        </div>
      )}

      <Button
        size="sm"
        className="w-full justify-center mt-2.5"
        onClick={() => (podeInstalar ? instalar() : setMostrandoPassos((v) => !v))}
      >
        {podeInstalar ? 'Instalar' : mostrandoPassos ? 'Fechar' : 'Como instalar'}
      </Button>
    </div>
  );
}
