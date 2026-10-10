# Login e gate de acesso — Mobile (Privy)

> **Status:** mesclado na `develop` pelo PR #3; documentação revisada em 2026-10-09.
> **Contexto:** o app não tinha tela de login: quem não tinha conta entrava como convidado e só via
> a opção de conectar pelo menu de perfil. Agora o app abre na tela de login e só libera o resto
> depois que existe uma sessão do backend. Task: XIAOLEEACE-9.
> **O que exige ação fora do código** está na seção 4 — sem ela ninguém consegue entrar em
> produção.

---

## 1. Decisão: e-mail com código (OTP), não e-mail + senha

O critério da task dizia "e-mail + senha". **O Privy não tem login por senha** — a documentação
deles descarta senha de propósito. O e-mail funciona por código de 6 dígitos enviado à caixa de
entrada, e o cadastro é o primeiro código aceito.

| opção | custo | escolhida |
|---|---|---|
| E-mail com código (Privy) | pequeno; reaproveita a carteira embutida e a troca de token já pronta | **sim** |
| Firebase Auth (senha) ligado ao Privy por JWT próprio | refazer a troca de token e o Google, login nativo do Google, rebuild do dev client | não |
| Senha própria no backend | hash, reset de senha, rate limit — mais superfície de segurança | não |

O Google continua: o critério 1 não mudou, e o botão usa o mesmo Privy.

**Se o produto exigir senha de verdade**, a decisão cai e o caminho é o da segunda linha da tabela.
Isso precisa de decisão de produto antes de qualquer código.

---

## 2. Como funciona

O gate usa `Stack.Protected` do expo-router (`mobile/src/app/_layout.tsx`): a rota `login` só
existe para quem **não** tem sessão, e todas as outras só existem para quem tem. O redirecionamento
nos dois sentidos é do próprio expo-router, inclusive para deep link.

A fonte da verdade é a **sessão do backend** (guardada no SecureStore, validade de 30 dias), não o
Privy. É isso que faz o login persistir entre aberturas: quem reabre o app entra direto, sem esperar
o Privy restaurar a dele.

| estado (`lib/auth-state.ts`) | quando | o que aparece |
|---|---|---|
| `loading` | o storage da sessão ainda não foi lido | nada (a intro cobre isso) |
| `signedOut` | sem sessão e sem conta Privy | formulário de login |
| `signingIn` | o Privy autenticou; carteira e sessão estão sendo criadas | "Setting up your account" |
| `error` | o Privy autenticou, mas o backend não emitiu sessão | "We couldn't finish signing you in" + Try again |
| `signedIn` | há sessão real do backend | o app |

Fluxo de um login novo:

1. A pessoa entra por Google ou por e-mail + código (`hooks/use-privy-login.ts`).
2. O Privy cria a conta e, junto, a carteira embutida na Arc (`createOnLogin`).
3. O `WalletProvider` (`lib/wallet.tsx`) pega o access token do Privy e chama
   `POST /auth/session` com `{ "provider": "privy", "id_token": <token> }`.
4. O backend valida a assinatura do token contra o JWKS do Privy, cria o usuário e devolve
   `session_id` + `twitter_user_id` (`privy_<did>`).
5. O app grava a sessão; o estado vira `signedIn` e o gate troca de lado sozinho.

**Sessão expirada ou rejeitada:** qualquer 401 numa chamada autenticada apaga a sessão guardada
(`api/client.ts`). Se o Privy ainda está logado, o `WalletProvider` troca o token por uma sessão nova
em silêncio; se não, a pessoa volta ao login.

**Sessão legada:** versões antigas gravavam o endereço da carteira como `sessionId` e como
`twitterUserId` quando a troca de token falhava. O backend aceita Bearer desconhecido sem dar 401,
então essa sessão passaria pelo gate. `isRealSession` a descarta (sessão real tem
`sessionId !== twitterUserId`) e o app emite uma de verdade.

**Sair da conta:** `Sign out` no menu de perfil chama `disconnect()` — logout no Privy, limpa
carteira e sessão, e o gate devolve à tela de login.

---

## 3. Arquivos

| arquivo | papel |
|---|---|
| `mobile/src/app/login.tsx` | tela de login e os estados `signingIn` / `error` |
| `mobile/src/app/_layout.tsx` | `RootNavigator` com os dois `Stack.Protected` |
| `mobile/src/lib/auth-state.ts` | regra pura do estado, `isRealSession`, validação de e-mail e código |
| `mobile/src/lib/auth-state.test.ts` | testes da regra acima (`npm test`) |
| `mobile/src/hooks/use-auth-state.ts` | junta sessão + Privy + erro da troca de token |
| `mobile/src/hooks/use-privy-login.ts` | e-mail/código e Google; compartilhado com o sheet de carteira |
| `mobile/src/lib/wallet.tsx` | troca o token do Privy por sessão; `sessionError` / `retrySession` |
| `mobile/src/api/client.ts` | 401 com Bearer guardado apaga a sessão |
| `mobile/src/components/profile-menu.tsx` | botão Sign out |
| `backend/server/token_auth.py` | `verify_privy_token` |
| `backend/server/campaigns_routes.py` | `POST /auth/session`, provedor `privy` |

> **Toda rota nova em `mobile/src/app/` precisa ser declarada em um dos dois `Stack.Protected`.** O
> expo-router acrescenta rotas não declaradas à pilha **sem guarda**, e uma rota esquecida fica
> acessível sem login.

---

## 4. Configuração obrigatória (fora do código)

### 4.1 Backend — variável `PRIVY_APP_ID`

**Prioridade: bloqueante.** Sem ela o app não loga em produção.

O backend valida o token do Privy contra `https://auth.privy.io/api/v1/apps/<PRIVY_APP_ID>/jwks.json`,
com `iss = privy.io` e `aud = <PRIVY_APP_ID>`. Sem a variável, `verify_privy_token` recusa **todo**
login (falha fechada: sem saber para qual app o token foi emitido, "verificar" não significa nada).

| variável | valor | onde |
|---|---|---|
| `PRIVY_APP_ID` | o mesmo de `EXPO_PUBLIC_PRIVY_APP_ID` (`mobile/eas.json`) | serviço do backend no Railway |

Não é segredo — o valor já vai embutido no bundle do app —, mas é obrigatório. Está documentada no
`.env.example`.

### 4.2 Banco — migração

A migração `20261001_onboarding` adiciona colunas **nullable** em `users` (`full_name`, `state`,
`city`, `bio`, `social_links`, `interest_profile`). O `railway.toml` roda `alembic upgrade head` em
`preDeployCommand`, então ela se aplica sozinha no deploy. Há uma única head.

### 4.3 Painel do Privy

**A conferir** — não há como validar isso pelo código.

| item | o que deve estar |
|---|---|
| Login methods | **Email** e **Google** habilitados |
| App identifiers / URL scheme | o scheme `xiaolee` (`mobile/app.json`) e os identificadores do app Android/iOS, para o Google voltar ao app |
| Embedded wallets | criação automática habilitada (o app pede `createOnLogin: users-without-wallets`) |

### 4.4 Build do app

O gate é do cliente: ele só chega aos usuários com um **build novo** (EAS). Publicar o build antes
de a seção 4.1 estar feita deixa o app preso na tela de login para todo mundo.

### 4.5 Ordem de publicação

1. Definir `PRIVY_APP_ID` no Railway e fazer o deploy do backend.
2. Conferir a seção 5.
3. Só então gerar e distribuir o build do app.

---

## 5. Verificação e diagnóstico

**Smoke do backend** (substitua `$API` pela URL do serviço):

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$API/auth/session" \
  -H 'Content-Type: application/json' \
  -d '{"provider":"privy","id_token":"x"}'
```

Deve responder `401`. **Atenção:** `401` também é a resposta quando `PRIVY_APP_ID` está faltando, então
o status sozinho não prova nada. A diferença está no log do serviço:

| log (`login social recusado (privy): …`) | significado |
|---|---|
| `PRIVY_APP_ID não configurado — login social desabilitado` | falta a variável — voltar à 4.1 |
| `token inválido: …` | variável ok; o token é que não vale (esperado neste smoke) |

**Sintomas no app:**

| sintoma | causa provável |
|---|---|
| depois de logar, cai em "We couldn't finish signing you in" e Try again não resolve | `PRIVY_APP_ID` faltando ou diferente do app do Privy usado no build |
| Google abre e não volta ao app | seção 4.3 (scheme / identificadores) |
| volta ao login de tempos em tempos | sessão de 30 dias expirou e o Privy também; esperado |

---

## 6. Testes

**Automáticos** (passam em 2026-10-04): `npx tsc --noEmit`, `npm run lint` e `npm test` em `mobile/`;
no backend, `pytest` completo (546 passam, 6 são pulados), incluindo `test_auth_session_route.py`,
`test_token_auth.py`, `test_profile_routes.py` e `test_chat_identity.py`.

**Manual, em aparelho** — nada abaixo foi exercitado num dispositivo real até aqui:

- [ ] instalação limpa abre direto no login, mesmo por deep link
- [ ] Google cria a conta e entra
- [ ] e-mail: código chega, valida, entra; código errado mostra erro e permite corrigir
- [ ] reenviar código e "Use another email"
- [ ] teclado não cobre os campos (Android e iOS)
- [ ] fechar e reabrir o app não pede login
- [ ] Sign out volta ao login, e **entrar de novo** funciona
- [ ] backend fora do ar durante o login mostra "couldn't finish" e Try again funciona depois

---

## 7. Limitações conhecidas

| item | detalhe |
|---|---|
| Bearer desconhecido no backend | `GET/PATCH /user/me/profile` exigem sessão emitida (`strict=True`, commit `01fd528`). `/chat` e `/v1/chat/sessions` ainda aceitam um Bearer desconhecido como `twitter_user_id` — escolha explícita para não quebrar builds antigos (review do PR #3). Sem Bearer, `/chat` usa o `user_id` do corpo da requisição. Enquanto o fallback existir (remover quando as sessões legadas de 30 dias expirarem), o gate de login nessas rotas é garantia de UX, não de segurança do servidor. |
| `social_links` sem validação de esquema | o `PATCH` do perfil só faz `strip()[:255]` e não limita o número de chaves. Nenhum componente lê o campo hoje; antes de renderizar num `href`, aceitar só `https?://` e limitar as chaves. |
| Sem senha | ver a seção 1. |
| Cores fixas na tela de login | `login.tsx` usa hex direto (do Figma) em vez dos tokens de `constants/theme.ts`; se o tema do app mudar (há a flag `DARK_MODE`), a tela de login não acompanha. |
| Teclado no Android (a verificar) | `login.tsx` usa `KeyboardAvoidingView` com `behavior` indefinido no Android, enquanto o chat e o sheet de carteira usam `padding` (por causa do edge-to-edge). Provável que o teclado cubra os campos; falta testar em aparelho e, se confirmar, usar `padding` nas duas plataformas. |
| Erro de sessão após sair e entrar (a verificar) | a troca de token em `lib/wallet.tsx` não exige usuário Privy autenticado. Se a carteira sobreviver um render ao logout, uma troca dispararia sem token e deixaria um `sessionError` velho que faria o próximo login cair em "couldn't finish". Mitigação: incluir `user` na condição do efeito. Não reproduzido. |
| Mensagens do código (OTP) | falha ao reenviar o código mostra "That code didn't work", e digitar o 6º dígito e tocar em Verify logo em seguida pode disparar duas verificações. |
| Pontos de entrada antigos | "Connect Wallet" no menu de perfil, em `wallet.tsx` e em `feedback.tsx` ficam obsoletos com o gate — limpeza futura. |
| Onboarding (PR #1) | a rota `onboarding` fica dentro do `Stack.Protected`, mas a checagem `onboarded` vive só em `index.tsx`: quem abre outra rota por deep link não passa pelo questionário, e o chat aparece por um instante antes do redirect. Mover para um segundo guard no layout (login → onboarding → app). |
