import { finishXLogin } from '@/api/backend';

const inflight = new Map<string, Promise<void>>();

/**
 * Conclui o login do X uma única vez por `state`. O retorno chega por dois caminhos ao mesmo tempo — o
 * `openAuthSessionAsync` da Accounts e a rota `social/x` do deep link — e o `code` só vale uma vez.
 * Quem chamar de novo recebe a mesma promessa e espera a conta estar gravada.
 */
export function completeXLogin(code: string, state: string): Promise<void> {
  let run = inflight.get(state);
  if (!run) {
    run = finishXLogin(code, state).then(() => undefined);
    inflight.set(state, run);
  }
  return run;
}
