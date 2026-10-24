import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';

import { completeXLogin } from '@/lib/x-login';

/**
 * Destino do `xiaolee://social/x?code&state` com que o X devolve o creator ao app. É transparente e não desenha
 * nada: a Accounts que abriu o login segue na tela, com o spinner no X, e atualiza no lugar. Aqui só conclui o
 * login (uma vez, `completeXLogin`) e volta para ela; criar uma Accounts nova buscava a lista antes de a conta ser
 * gravada e piscava em branco. Sem tela anterior (app aberto frio pelo link), cai na Accounts. O erro (se
 * houver) aparece na Accounts que abriu o login.
 */
export default function XLoginReturn() {
  const { code, state } = useLocalSearchParams<{ code?: string; state?: string }>();

  useEffect(() => {
    let live = true;
    const run = code && state ? completeXLogin(code, state) : Promise.resolve();
    run
      .catch(() => {})
      .then(() => {
        if (!live) return;
        if (router.canGoBack()) router.back();
        else router.replace('/accounts');
      });
    return () => {
      live = false;
    };
  }, [code, state]);

  return null;
}
