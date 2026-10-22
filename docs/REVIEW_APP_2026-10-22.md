# Revisão do app XiaoLee — 2026-10-22

Feita rodando o app no celular (12 telas, com prints) e lendo o código de cada tela, do chat e das ferramentas do backend.
Foco: experiência do criador e o que agregaria mais valor. Ambiente: backend local, dados de teste, `develop` 468ac25 + `feat/creators-studio`.

## Veredito em uma frase

O app tem boas peças (Chat, Clips, AI Creators, Wallet, Reports), mas hoje são **dois produtos colados**: um agente DeFi (chat, dashboard, traction, swaps) e um kit de criador (clips, vídeos de IA, relatórios). **O ciclo do criador não está fechado**: criar → publicar → ganhar → medir. Cada peça funciona sozinha; nenhuma leva à seguinte.

## P0 — Corrigir antes do dia 26 (pequenos, de alto impacto na primeira impressão)

1. **Testnet e mainnet misturados no texto.** Dashboard diz "registered on Arc Testnet"; Campaigns diz "Join campaigns on Arc Testnet"; Wallet tem "Get testnet USDC" e, no meu ambiente, o aviso **"Wrong network"** (o app em testnet falando com servidor em mainnet, e a carteira escondeu o saldo). O aviso foi culpa do meu Metro sem `EXPO_PUBLIC_ARC_NETWORK=mainnet`, mas mostra o risco: **conferir que o build da demo sobe em mainnet** e padronizar os textos.
2. **Dashboard mostra números de sandbox** ("$1,000.00 USDC in portfolio · SANDBOX", "Arc DISABLED", "$0.00 settled · 0 creators"). É o que o júri e o criador veem. Esconder o sandbox ou trocar por dados reais do criador (ver P1-3).
3. **Accounts diz "Posting is not available yet".** É o elo que falta do ciclo, e hoje é um beco sem saída. A publicação existe na branch `feat/social-accounts`, que não está na `develop`.
4. **History mostra markdown cru** (`**85.1 USDC**`, `` `0xe8ECA…` ``) e vem em **"Oldest first"**: com 121 mensagens, o criador tem que rolar 16 dias para achar a de hoje. Trocar para mais recentes primeiro, com busca.
5. **A Xiaolee responde misturando inglês e português** na mesma resposta ("…todas com zero participantes… não é hora boa de entrar!"). Definir o idioma pela preferência do usuário.
6. **O botão flutuante do Chat cobre o fim das listas** (em Clips o "Your uploads show up here" fica cortado). Falta margem inferior nas telas.
7. **"PREVIEW STATE · DEV ONLY"** aparece na Wallet. Confirmar que não vai no build de release.
8. **Marketplace abre em branco**, só com a caixa de busca. Sem sugestões, sem exemplos, sem nada.

## P1 — O que mais agregaria ao criador

1. **Fechar o ciclo criar → publicar → ganhar → medir.** Quando um vídeo de IA ou um clip fica pronto, oferecer na mesma tela: **Postar no X/Telegram**, **Usar numa campanha**, **Baixar/Compartilhar**. Hoje o criador gera e não tem o que fazer em seguida.
2. **A Xiaolee (a "home") só sabe DeFi.** As ferramentas dela são swap, saque, transferência e campanhas; **nenhuma** para AI Creators, Clips, Relatórios ou publicação. Ensinar o chat a fazer o que o app faz: "faz um vídeo de 10 s do Joel dizendo X", "corta esse vídeo em clips", "posta no X", "como foi meu mês?". E trocar os atalhos da home (hoje: Make a swap, Create a campaign, View dashboard, Check balance) por ações de criador.
3. **Dashboard do criador, não da economia.** Mostrar: ganhos em USDC, vídeos gerados, clips feitos, gasto com IA, progresso nas campanhas, saldo.
4. **Avisar quando o vídeo fica pronto.** A geração leva alguns minutos e o usuário sai da tela. Falta notificação (push ou pelo menos um aviso dentro do app). Hoje Notifications só mostra "receipts".
5. **Pacotes de crédito.** Pagar em USDC com assinatura a cada vídeo é atrito. Um saldo de créditos comprado uma vez (por Pix, com o on/off que já existe) e gasto por vídeo seria bem mais fluido.
6. **Reports vazio por 30 dias.** O criador novo vê "No report yet" durante um mês. Mostrar "dia X de 30" e um botão **"Ideias de IA agora"**, com o que já dá para dizer dos dados existentes.
7. **Onboarding com primeira ação.** Uma lista "Comece por aqui" (conectar X, criar o primeiro personagem, fazer o primeiro clip), adaptada ao perfil que ele escolheu.

## P2 — Por tela

**AI Creators** (a que mais evoluiu hoje; ainda falta):
- Galeria de **exemplos e modelos** para quem chega pela primeira vez (hoje é um formulário vazio).
- Vídeos prontos com **miniatura** e botões salvar, compartilhar e refazer (hoje são linhas de texto).
- Personalidade do personagem, voz por vídeo, **3 quadros candidatos** e várias referências no Swap, análise da cena com avisos.
- **Selo "feito com IA"** e botão de denúncia/remoção. Consentimento verificado (cameo) para rosto real.
- Lista de personagens como **galeria de fotos grandes**.

**Clips:**
- Sempre **3 clips**. Dar controle de quantidade, duração e estilo de legenda, kit de marca (logo/cores), prévia do trecho escolhido, formatos por rede e publicação direta.
- "Words to get right" é uma ótima ideia; vale destacar mais.

**Campaigns:**
- Vazio sem saída ("New campaigns coming soon"): ofertar **"Criar campanha"** ou **"Avise-me"**.
- Formulário: **"Tweet to engage" pede o ID numérico** — aceitar a URL do tweet. **"Reward token" é texto livre** — trocar por lista (USDC, etc.).
- Faixa verde "Wallet Connected / Sync Wallet" com ícone de relógio é confusa.

**Wallet / on-off ramp:** já tem Activity e os fluxos novos. Faltam: **gastos com vídeos** na Activity, saque para Pix quando o provedor existir, e esconder "Get testnet USDC" em mainnet.

**Traction:** é tela para o júri (crypto/nanopagamentos). Está boa para isso, mas não é do criador. Não precisa estar no menu principal para quem cria.

**Transactions e Notifications:** só têm vazios ("Claim a campaign reward…", "Join a campaign…"), que só fazem sentido para quem usa campanhas. Para criador, deveria listar **ganhos, gastos e vídeos**.

**Chat:** o card "Make a swap / Check balance" fala de DeFi. O avatar grande fica cortado pelo cabeçalho do card.

## P3 — Transversal

- **Idioma:** UI em inglês, erros de rede e respostas da Xiaolee em português. Para o público brasileiro, oferecer PT-BR completo.
- **Confiança e segurança:** termos de direitos de imagem/vídeo precisam de revisão jurídica; consentimento verificado para pessoa real; denúncia e remoção.
- **Métricas:** instrumentar funil (prévia → pagar, vídeo criado → publicado). Hoje não dá para saber o que o criador realmente usa.
- **Tema escuro e telas pequenas:** não testei.

## O que não consegui ver (para a próxima passada)

Onboarding e login (exigem sair/entrar), o fluxo de Clips depois de enviar um vídeo, a geração de um vídeo de IA de ponta a ponta (sem saldo), formulário de campanha e diagnóstico (a segunda passada foi interrompida por uma notificação), tema escuro.
