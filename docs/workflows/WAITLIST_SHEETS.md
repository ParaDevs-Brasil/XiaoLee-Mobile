# Waitlist → Google Sheets (Apps Script)

O formulário **Join waitlist** da landing (`landing/index.html`) envia direto para um
**Google Apps Script** vinculado à planilha (`landing/apps-script/waitlist.gs`), que grava na
aba **Registration**. Não passa pela API nem pelo Railway, e não precisa de Google Cloud nem cartão:
só uma conta Google comum.

- O formulário tem **duas etapas**. Etapa 1: nome, e-mail e perfil — ao enviar, a pessoa já está
  na lista. Etapa 2 (opcional, com barra de progresso e "Skip for now"): redes, audiência, empresa,
  público, país e origem. Se ela tentar salvar sem nenhuma rede social, aparece um lembrete
  ("Add a profile" / "Save without it") — nunca bloqueia.
- Uma linha por e-mail: a etapa 2 (ou um reenvio) atualiza a mesma linha
  ("Last updated" muda, "Signed up" fica).
- Planilha toda em inglês, horário de Brasília (BRT). Campo que a pessoa não preencheu aparece
  como **"—"** (em cinza).
- A aba **Summary** é montada pelo próprio script: números do topo, tabelas e gráficos que se
  atualizam sozinhos a cada inscrição.

> Por que Apps Script e não a API: gravar pela API exigiria variáveis de ambiente e liberar a origem
> da landing no CORS do serviço no Railway. O Apps Script não depende de nada disso. Se um dia a
> waitlist precisar morar no banco, dá para trocar o destino do `fetch` na landing sem mudar o formulário.

---

## Instalação (uma vez, ~5 min)

### 1. Planilha

1. Crie uma planilha no Google Sheets com a conta que vai ser **dona** da waitlist
   (o script roda como essa conta).
2. Abas: **`Registration`** (primeira) e **`Summary`**. Se não existirem, o script cria.
3. **Não compartilhe por link público.** A planilha tem e-mails de pessoas: compartilhe só com o
   time, por e-mail.

### 2. Script

1. Na planilha: **Extensões → Apps Script**.
2. Apague o conteúdo de `Código.gs` e cole **todo** o conteúdo de `landing/apps-script/waitlist.gs`.
3. Salve (ícone de disquete).
4. **Implantar → Nova implantação** → engrenagem → **App da Web**:
   - Executar como: **Eu**
   - Quem pode acessar: **Qualquer pessoa**
5. **Implantar** → **Autorizar acesso** → escolha a conta.
   O Google avisa *"O Google não verificou este app"* — é o aviso padrão para script próprio:
   **Avançado → Acessar (não seguro)** → **Permitir**. O script só pede acesso a esta planilha.
6. Copie a **URL do app da Web** (termina em `/exec`) e coloque no lugar de
   `COLE_AQUI_A_URL_DO_APPS_SCRIPT` em `landing/index.html`.

### 3. Layout e Summary

No editor do Apps Script, escolha a função **`setup`** no seletor ao lado de **Executar** e clique
em **Executar** (autorize de novo se pedir). Isso:

- formata a aba Registration (cabeçalho, cores alternadas, larguras, filtro, perfil colorido,
  "—" em cinza, "Yes" em verde);
- traduz linhas antigas para inglês e preenche vazios com "—";
- cria as colunas do time **Contacted** (checkbox — a linha fica verde quando marcada) e **Notes**;
- monta a aba Summary inteira.

Depois disso aparece o menu **Waitlist → Refresh layout & summary** na própria planilha (recarregue
a página). Use quando quiser refazer o layout; não apaga inscrições nem as colunas do time.

### Atualizar o script depois

Cole o código novo, salve e use **Implantar → Gerenciar implantações → lápis (editar) →
Versão: Nova versão → Implantar**. Assim a URL **continua a mesma**. ("Nova implantação" gera outra
URL e a landing teria que ser atualizada.)

> **Importante:** o formulário só passa a usar o código novo depois desse passo. Salvar no editor
> não basta.

---

## Aba `Registration`

| | Coluna | Valores |
|---|---|---|
| A | Signed up (BRT) | `2026-10-10 14:03` |
| B | Last updated (BRT) | `2026-10-12 09:20` |
| C | Name | |
| D | Email | |
| E | Profile | Content creator · Brand / company · Agency · Other (com cor) |
| F | Main network | X · Instagram · TikTok · YouTube · Telegram · Other |
| G–K | X · Instagram · TikTok · Telegram · YouTube | `@handle` |
| L | Audience size | < 1K · 1K–10K · 10K–100K · 100K–1M · 1M+ |
| M | Has company | Yes · No |
| N | Company | |
| O | Target audience | texto livre |
| P | Country | lista fixa do formulário |
| Q | Referral source | lista fixa do formulário |
| R | **Contacted** | checkbox do time |
| S | **Notes** | anotações do time |

- **A–Q** são preenchidas pelo formulário. Editar à mão mostra um aviso (não bloqueia).
- **R e S** (e qualquer coluna que vocês criarem depois) são do time; o script nunca escreve nelas.
- Ordenar e filtrar pode à vontade (setinhas no cabeçalho): o script acha cada pessoa pelo e-mail.
- Não renomeie a aba `Registration` nem reordene/apague as colunas A–Q.

## Aba `Summary`

Montada pelo `setup` — não precisa colar fórmula nenhuma:

- **Números:** total de inscritos, hoje, últimos 7 dias, criadores de conteúdo, com empresa, já contatados.
- **Tabelas:** por perfil, rede principal, tamanho de audiência, país, origem e empresa;
  inscrições por dia; e a lista **Creators with 10K+ audience** (nome, e-mail, rede, audiência,
  TikTok, Instagram, X) para contato.
- **Gráficos** (à direita das tabelas): perfil, rede principal, audiência e origem.

"—" nas tabelas = quantas pessoas deixaram aquele campo em branco.

**Mais adiante:** a mesma planilha pode ser fonte de um painel no Looker Studio
(<https://lookerstudio.google.com>, "Adicionar dados → Google Sheets"), sem mudar código.

---

## Segurança

A URL do script é pública por natureza (o navegador de qualquer visitante chama ela), então o
script trata toda requisição como hostil:

| Proteção | O que faz |
|---|---|
| **Interruptor** | Propriedade `WAITLIST_OPEN=false` fecha a waitlist na hora (o formulário mostra "closed"), sem reimplantar |
| **Anti-bot** | Campo escondido (honeypot) e tempo mínimo de preenchimento: bot é descartado em silêncio |
| **Validação** | Só campos conhecidos; perfil, rede, audiência, país e origem só aceitam as opções do formulário; limite de tamanho por campo; e-mail validado; link no nome é recusado; caracteres invisíveis/de controle removidos; corpo acima de 6 KB recusado |
| **Limites** | Por e-mail (5 envios/hora), global (60 envios/minuto — cada pessoa envia até 2x) e teto diário (1000/dia). Um ataque no máximo esgota o teto do dia; nunca enche a planilha |
| **Concorrência** | Lock: dois envios ao mesmo tempo não duplicam nem se sobrescrevem |
| **Anti-fórmula** | Todo valor entra com apóstrofo (marcador de texto do Sheets, invisível): nada digitado vira fórmula, número ou data |
| **Sem leitura** | O script só escreve. Não existe forma de ler a planilha pela URL; erros internos não voltam para o navegador |
| **Acesso mínimo** | `@OnlyCurrentDoc`: a autorização vale só para esta planilha |

**Limites ajustáveis** — Apps Script → **Configurações do projeto** (engrenagem) →
**Propriedades do script** → adicionar:

| Propriedade | Padrão | Quando mexer |
|---|---|---|
| `WAITLIST_OPEN` | `true` | `false` para pausar a waitlist (ex.: sob ataque) |
| `GLOBAL_PER_MINUTE` | `60` | subir antes de um evento/divulgação grande |
| `DAILY_LIMIT` | `1000` | subir se a waitlist bombar de verdade |
| `PER_EMAIL_PER_HOUR` | `5` | — |
| `MIN_FILL_MS` | `3000` | tempo mínimo (ms) entre abrir o formulário e enviar |

Valor inválido (texto, zero, negativo) volta para o padrão — não desliga a proteção.

**Acompanhar:** Apps Script → **Execuções** mostra cada envio; recusas aparecem como avisos
(`[waitlist] recusado…`, `[waitlist] limite atingido…`), sem dados pessoais.

**O que o script não consegue fazer:** limitar por IP (o Apps Script não recebe o IP de quem
chama). Por isso o limite é da waitlist inteira, com teto diário.

**Testes da lógica:** `node --test landing/apps-script/` (serviços do Google simulados).
