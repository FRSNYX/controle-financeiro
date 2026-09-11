/**
 * Ponto de entrada da aplicação em produção.
 *
 * Fica na raiz de propósito: a Vercel executa os comandos de instalação e
 * build a partir da pasta do entrypoint, e daqui os caminhos `frontend/` e
 * `backend/` resolvem naturalmente.
 *
 * O processo serve as duas coisas no mesmo endereço — a interface (build do
 * frontend) e a API em /api —, o que dispensa CORS e roteamento externo.
 */
import './backend/src/server.js';
