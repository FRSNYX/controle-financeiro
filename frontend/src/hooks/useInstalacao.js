import { useEffect, useState } from 'react';

/**
 * Estado de instalação do aplicativo.
 *
 * Android/Chrome disparam `beforeinstallprompt` e permitem instalar com um
 * clique. O iPhone não expõe nada disso: lá a instalação é manual, pelo menu
 * Compartilhar, então o que resta é explicar o caminho.
 */
export function useInstalacao() {
  const [evento, setEvento] = useState(null);
  const [instalado, setInstalado] = useState(false);

  useEffect(() => {
    const jaInstalado =
      window.matchMedia?.('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;
    setInstalado(jaInstalado);

    const aoPoderInstalar = (e) => {
      e.preventDefault(); // segura o banner nativo para oferecer no nosso lugar
      setEvento(e);
    };
    const aoInstalar = () => {
      setInstalado(true);
      setEvento(null);
    };

    window.addEventListener('beforeinstallprompt', aoPoderInstalar);
    window.addEventListener('appinstalled', aoInstalar);
    return () => {
      window.removeEventListener('beforeinstallprompt', aoPoderInstalar);
      window.removeEventListener('appinstalled', aoInstalar);
    };
  }, []);

  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);

  /** Abre a caixa de instalação. Devolve true se a pessoa aceitou. */
  const instalar = async () => {
    if (!evento) return false;
    evento.prompt();
    const { outcome } = await evento.userChoice;
    setEvento(null);
    return outcome === 'accepted';
  };

  return {
    instalado,
    podeInstalar: !!evento,
    /** No iPhone não há botão: só dá para ensinar o caminho. */
    precisaInstrucoes: isIOS && !instalado,
    isIOS,
    instalar,
  };
}
