import { Redirect } from 'expo-router';

/**
 * Destino do `xiaolee://social/x?code&state` com que o X devolve o creator ao app. Quem conclui o login é a
 * Accounts (`openAuthSessionAsync` lê o code/state); esta rota só evita "Unmatched Route" e leva de volta para lá.
 */
export default function XLoginReturn() {
  return <Redirect href="/accounts" />;
}
