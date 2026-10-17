# XiaoLee Design System & Guidelines

Atualizado em: **2026-10-17** — Revisão v5 (variante escura e ajustes de contraste; XIAOLEEACE-13). Revisão v4 em 2026-07-04 (paleta neutra + acento único; sprint Arc Lepton)

Este documento detalha a linguagem visual, padrões e especificações técnicas para a interface premium do XiaoLee, focada em transmitir uma estética moderna, limpa e sofisticada, alinhada aos melhores produtos DeFi.

---

## 1. Princípios de Design

1. **Elegância Limpa (Clean Elegance):** Menos ruído visual, mais respiro (whitespace). Cards de conteúdo (seção 3.2) usam tons pastéis sutis e bordas uniformes — mas fundo de página, botões e títulos **seguem usando gradiente de 3 cores de propósito** (`from-pink-500 via-fuchsia-500 to-purple-600`, texto via `bg-clip-text`) em todas as páginas do app. Isso não mudou na prática apesar do que uma versão anterior deste documento dizia — é a identidade visual atual, não um desvio a corrigir.
2. **Tipografia Premium:** Uso da fonte **Inter** (sans-serif) para legibilidade, seriedade e modernidade.
3. **Ícones Vetoriais SVG Inline:** Emojis de UI foram substituídos por SVGs inline customizados (stroke-based, `strokeWidth={1.8}`), garantindo consistência visual cross-platform sem dependência de biblioteca externa.
4. **Paleta Unificada:** Todas as páginas compartilham a mesma base neutra quente com **um único acento de marca** (`#d81b78`), evitando que cada seção pareça um produto diferente. Regra de ouro: **acento só em botão primário, avatar e destaques — o resto neutro.**
5. **Hierarquia Natural:** Títulos concisos, subtítulos em `text-gray-400`, valores em negrito — sem `animate-pulse` em textos, sem gradientes clip-text desnecessários.
6. **Responsividade Tátil (Mobile-First):** `max-w-2xl mx-auto` como container padrão para mobile, `100dvh` para evitar sobreposição de teclado virtual.

---

## 2. Tipografia

> **Correção (2026-07-01):** esta seção descrevia **Inter**, que nunca foi implementada — não há
> nenhuma referência a "Inter" no código do frontend. A fonte real, carregada em `layout.tsx` via
> `next/font/google` e usada em `--font-sans` (`globals.css`), é **Quicksand**.

A família tipográfica principal do projeto é a **Quicksand**.

- **Font-family:** `'Quicksand', system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
- **Pesos disponíveis:** 300 (Light), 400 (Regular), 500 (Medium), 600 (Semi-Bold), 700 (Bold) — Quicksand não tem peso 900 (Black); títulos que precisam de mais peso visual usam `.font-display` (`globals.css`), que aplica `font-weight: 700` + `letter-spacing: -0.01em` por cima do 700 normal.
- **Uso sugerido:**
  - Regular (400): Corpo de texto e descrições.
  - Medium (500): Subtítulos de seções, labels de UI.
  - Semi-Bold (600): Itens de navegação, botões secundários.
  - Bold (700) + `.font-display`: Títulos principais (H1), valores numéricos (saldos, contadores).

**Ajustes de implementação:** A fonte é carregada via `next/font/google` no arquivo `layout.tsx` (`Quicksand`, variável `--font-quicksand`) e aplicada globalmente via `--font-sans` em `globals.css`.

---

## 3. Paleta de Cores

Paleta **neutra quente com acento único de marca** (revisão v4, 04 jul 2026). Os valores vivem como CSS custom properties em `frontend/src/app/globals.css` — nos componentes, use sempre os tokens (`var(--accent)`, `border-[var(--border)]`, etc.), nunca hex solto ou classes de cor do Tailwind (`pink-*`, `fuchsia-*`, `purple-*` estão proibidas fora da landing).

> **Nota (v5):** o **mobile** tem tema claro, escuro e do sistema (seletor no painel de perfil), com a variante escura da seção 3.6; os valores vivem em `mobile/src/constants/theme.ts`. O **web** continua só no claro (`theme-context.tsx` força `light`; toggle removido da Navbar).
>
> **Pendência web:** `frontend/src/app/globals.css` ainda usa os valores da v4 para `--ink-3` (`#9a968f`) e `--success` (`#1f8a5b`). Atualizar para os da v5 abaixo, senão web e mobile divergem.

### 3.1. Tokens Base

| Token | Hex | Uso |
|---|---|---|
| `--bg` / `--main-bg` | `#f6f4f1` | Fundo do app (sólido — sem gradientes de fundo) |
| `--card` | `#ffffff` | Cards e painéis |
| `--border` | `#ece9e4` | Todas as bordas |
| `--ink` / `--text-primary` | `#1a1917` | Texto primário, títulos, valores |
| `--ink-2` / `--text-secondary` | `#6b6862` | Texto secundário, descrições |
| `--ink-3` / `--text-placeholder` | `#736f68` | Muted: metadados, placeholders, timestamps. Era `#9a968f` (v4), que dava 2.9:1 sobre `--card` e 2.7:1 sobre `--bg`; o novo dá 5.0:1 / 4.6:1 (AA) e continua mais claro que `--ink-2` |

### 3.2. Acento de Marca

| Token | Hex | Uso |
|---|---|---|
| `--accent` | `#d81b78` | **Só** botão primário, avatar, logo e micro-destaques (ícones de seção, links ativos) |
| `--accent-hover` | `#c0166a` | Hover do acento |
| `--accent-soft` | `#fdf0f6` | Fundo suave: chips, moldura do avatar, ícones de sugestão |

Contraste verificado: branco sobre `--accent` = **4.8:1** (AA). O acento como **texto** sobre `--bg` dá 4.4:1, um pouco abaixo de AA para texto comum: **mantido de propósito** (é a cor da marca e aparece quase sempre em negrito, onde o mínimo é 3:1). Regra de ouro: **acento só em botão primário, avatar e destaques — o resto neutro.**

### 3.3. Cores Semânticas

| Estado | Token / Classe | Uso |
|---|---|---|
| Sucesso | `--success` `#1a7a50` (+ `bg-emerald-50`, `border-emerald-100` como soft). Era `#1f8a5b` (v4): 4.3:1 sobre `--card`, abaixo de AA; o novo dá 5.3:1 | Badges Online/Verified, métricas de dinheiro (USDC pago, TVL, volume) |
| Negativo / Erro | `--danger` `#c23a3a` (+ `bg-red-50`, `border-red-100`) | Erros de API, logout |
| Pendente | `text-amber-600`, `bg-amber-50`, `border-amber-100` | Status "pending", latência degradada |

### 3.4. Cards / Painéis

| Elemento | Classes | Uso |
|---|---|---|
| Card padrão | `bg-white border border-[var(--border)] rounded-2xl shadow-sm` | Todos os cards de conteúdo |
| Card stat | Branco + número colorido por **significado** (sucesso verde, acento p/ marca, resto neutro) | Métricas |
| Input | `bg-white border border-[var(--border)]`; foco `ring-[rgba(216,27,120,0.35)]` | Formulários |
| Chip suave | `bg-[var(--accent-soft)] border border-[var(--border)] text-[var(--accent)]` | Destaques leves (rail x402, CTA de criador) |

### 3.5. Textos

| Papel | Classe |
|---|---|
| Título principal | `text-[var(--text-primary)] font-extrabold` — **sem gradiente clip-text** |
| Subtítulo / desc | `text-[var(--text-secondary)]` ou `text-gray-500` |
| Label seção | `text-gray-500 uppercase tracking-widest text-xs font-bold` |
| Valor de destaque | `text-[var(--text-primary)] font-black`; se for dinheiro/positivo, `text-[var(--success)]` |

### 3.6. Variante escura e tokens do mobile (v5)

Derivada da paleta clara (mesmo hue de cada token, luminância invertida). Contraste conferido com a fórmula WCAG contra `card` e `bg` de cada tema.

| Token (`theme.ts`) | Claro | Escuro | Uso |
|---|---|---|---|
| `bg` | `#f6f4f1` | `#141316` | Fundo do app |
| `card` | `#ffffff` | `#1f1c20` | Cards e painéis |
| `border` | `#ece9e4` | `#332f34` | Bordas |
| `borderStrong` | `#d4d0ca` | `#4d474e` | Borda que precisa aparecer mais (caixa preenchida do OTP) |
| `popover` / `popoverBorder` | `#ffffff` / `#ece9e4` | `#2a262c` / `#45404a` | Painéis flutuantes (menu, perfil). No escuro a sombra não aparece, por isso um degrau mais claro e borda visível |
| `ink` | `#1a1917` | `#f5f2f0` | Texto primário (15.1:1 no escuro) |
| `ink2` | `#6b6862` | `#b7b2ac` | Texto secundário (8.0:1) |
| `ink3` | `#736f68` | `#8c8781` | Muted (4.7:1) |
| `accent` | `#d81b78` | `#f0509a` | Acento como texto e ícone (5.1:1 no escuro) |
| `accentSoft` | `#fdf0f6` | `#3a1428` | Fundo suave do acento |
| `accentFill` / `onAccent` | `#d81b78` / `#ffffff` | `#d81b78` / `#ffffff` | **Preenchimento** com texto branco (botão primário, chip ativo, avatar). Igual nos dois temas: branco sobre o `accent` escuro daria só 3.3:1 |
| `success` / `successSoft` | `#1a7a50` / `#ecfdf5` | `#34c98a` / `#0f2b20` | Sucesso como texto |
| `successFill` / `dangerFill` | `#1a7a50` / `#c23a3a` | `#1a7a50` / `#c23a3a` | Fundo verde/vermelho com texto branco (ack, badge do sino, excluir) |
| `danger` / `dangerSoft` | `#c23a3a` / `#fef2f2` | `#e2665f` / `#301414` | Erro |
| `warn` / `warnSoft` | `#b45309` / `#fffbeb` | `#e0a840` / `#2e2210` | Degradado / pendente |
| `media` / `onMedia` | `#1a1917` / `#ffffff` | `#000000` / `#ffffff` | Fundo atrás de vídeo e thumbnail e o texto por cima; escuro nos dois temas |
| `scrim` | `rgba(26,25,23,0.35)` | `rgba(0,0,0,0.6)` | Fundo escurecido atrás dos sheets |
| `arc` | `#7c3aed` | `#a78bfa` | Roxo da Arc, só no "Arc." do slogan do login. Era `#8b5cf6` (3.9:1 sobre `bg`) |
| `chartCampaign` / `chartPurchase` / `chartTransfer` | `#d81b78` / `#2a78d6` / `#c98500` | `#e5418d` / `#3987e5` / `#c98500` | Origem do dinheiro nos gráficos da carteira |

Regras:
- Preenchimento com o acento usa `accentFill` + `onAccent`; texto e ícone em rosa usam `accent`. No claro os dois são o mesmo rosa; no escuro, não.
- O cartão de compartilhar perfil é **sempre claro**: vira imagem e vai para as redes, então sai igual em qualquer tema.
- Teclado e alertas nativos seguem o tema do celular, não o do app (forçar o tema nativo quebraria a opção "System").

---

## 4. Iconografia

### Regra Principal: SVG Inline, sem emojis de UI

Emojis de UI (🔒, 👥, 🎁, 🔥, ✅, etc.) foram removidos de todos os componentes de layout, substituídos por SVGs inline `stroke-based` com as seguintes especificações:

```tsx
// Padrão de ícone SVG inline
const IconExample = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    className="w-4 h-4"  // ou w-5 h-5 conforme contexto
  >
    {/* paths */}
  </svg>
);
```

**Por que inline e não biblioteca?** Evita bundle overhead, permite treeshaking natural do Next.js, e garante que a cor herde de `currentColor` (controlável via tokens como `text-[var(--accent)]`).

### Tamanhos Padrão

| Contexto | Classe |
|---|---|
| Ícone em label/header de seção | `w-4 h-4` |
| Ícone em card de stat pequeno | `w-4 h-4` |
| Ícone em card de stat grande (Economia Global) | `w-5 h-5` |
| Ícone de estado vazio (empty state) | `w-6 h-6` |
| Ícone de estado desconectado | `w-5 h-5` |

### Mapeamento de Ícones por Contexto

| Contexto | Ícone |
|---|---|
| Campanhas / Target | Circle + inner circles (target) |
| Verificadas / Check | Polyline `20 6 9 17 4 12` |
| Premiadas / Award | Circle + ribbon path |
| $XLEE Token | Circle com `+` interno |
| Wallet desconectada | Wallet outline |
| Swaps / Bar chart | `IconBarChart` (3 linhas verticais) |
| Total Value Locked | Lock / cadeado |
| Active Users | Users (dois avatares) |
| Rewards | Gift box |
| Campaigns Created | `TrendingUp` |
| Atividade Recente | Polyline tipo ECG |
| Arquitetura / CPU | `IconCpu` (retângulo com linhas) |
| Wallet-first (arch) | Shield |
| x402 (arch) | Zap/relâmpago |
| Circle W3S (arch) | Wifi signal |
| Reward (feed) | Trophy |
| Swap (feed) | Refresh circular |
| Campaign (feed) | Target |
| Info (feed) | Bell |
| Empty state (feed) | Inbox |

> **Exceção permitida:** Emojis reativos nas mensagens de chat da Xiaolee (💕, 👏, 😊) e os decorativos do Avatar são mantidos — são parte da personalidade da IA, não da UI de layout.

---

## 5. Estrutura de Layout

### Container Principal

```tsx
<main className="container mx-auto px-4 py-10 max-w-2xl">
```

O `max-w-2xl` (672px) garante que o layout seja consistente mobile-first, com padding lateral de `px-4`.

### Cards

Todos os cards seguem o mesmo padrão base, com variações de cor apenas nas bordas/backgrounds semânticos:

```tsx
// Card padrão
<div className="rounded-2xl border border-[var(--border)] bg-white shadow-sm p-5">

// Card de stat — branco, número colorido por significado
<div className="rounded-2xl border border-[var(--border)] bg-white p-4 text-center">
```

**Proibido:** bordas gradiente (`bg-gradient-to-r ... p-[2px]`) nos cards de conteúdo — cria inconsistência visual e "caráter de IA".

### Espaçamento entre Seções

```tsx
// Espaçamento vertical entre blocos
<div className="mb-6"> // entre seções
<div className="space-y-3"> // entre rows dentro de um card
<div className="gap-3"> // entre cards em grid
```

---

## 6. Navbar

A Navbar é neutra (fundo branco, borda `--navbar-border`); o único elemento no acento é o CTA Dashboard (`btn-primary`) e o logo:

| Aba | Estilo | Motivo |
|---|---|---|
| Camp / Traction / Alerts | neutro (`text-[var(--text-secondary)]`; ativo `bg-white text-[var(--text-primary)] shadow-e1`) | Links quietos — não competem com o CTA |
| Dash | `btn-primary` (acento sólido `--accent`) | Único CTA primário da Navbar |

Hierarquia: um único elemento chama atenção (Dashboard). Idioma ativo no LangToggle também usa o acento.

---

## 7. Página de Notificações

**Padrão adotado:** layout single-column `max-w-2xl`, sem grid de 2 colunas.

### Estrutura da página:

1. **Header** — Ícone box no acento sólido + título "Notification Center" + desc curta
2. **Stats row** — Grid 3 colunas (Total / Entregues / Pendentes) com cores semânticas
3. **Devnet Context** — Card compacto com session/wallet truncados (`truncate`)
4. **Lista de notificações** — Card container com header (título + botão Refresh) e lista com `divide-y`

### Item de notificação:

```
[dot status] [título + badge] [botão ação]
             [body text]
             [receipt block] (se existir)
             [metadata] (se existir)
```

---

## 8. Dashboard

**Padrão adotado:** layout single-column `max-w-2xl`, sem sidebar.

### Estrutura da página:

1. **Header** — Título "Dashboard" + desc curta (sem emoji, sem pulse)
2. **Campaign Stats** — Grid 3 colunas (Campanhas / Verificadas / Premiadas) com SVG icons
3. **Tokenomics Card** — Rows key/value com separadores `border-b border-gray-100/80`
4. **User Stats Card** — Estado desconectado limpo (SVG wallet icon) / grid 2 colunas quando conectado
5. **Economia Global** — Grid 2x2 com `EconomyStat` (icon box + valor + label)
6. **Atividade Recente** — ActivityFeed com SVG icons por tipo de evento
7. **Arquitetura Descentralizada** — Grid 2x2 de tech badges com SVG icons

---

## 9. Contraste e Legibilidade de Texto

**Regra:** nenhum texto de UI usa modificadores de opacidade Tailwind (`/60`, `/70`, `/80`). Opacidade em texto gera ilegibilidade em fundos claros e não passa em WCAG AA.

| Papel | Classe correta | Classe proibida |
|---|---|---|
| Subtítulo / descrição | `text-gray-400` | `text-gray-400/70` |
| Rodapé de modal | `text-[var(--accent)] font-semibold` | `text-[var(--text-placeholder)]` |
| Timestamp / meta | `text-gray-500 font-medium` | `text-gray-500/80` |
| Corpo de item | `text-gray-600` | `text-gray-700/70` |

**Tamanho mínimo em cards de conteúdo:** `text-sm` (14px). `text-xs` (12px) é permitido apenas em labels de badge, timestamps e metadados secundários. `text-[10px]` é reservado exclusivamente a badges de status compactos.

---

## 10. Internacionalização (i18n)

### Abordagem

React Context nativo — sem biblioteca externa. Escolha justificada pelo tamanho do bundle e prazo de hackathon.

### Estrutura

```
src/
├── locales/
│   ├── en.json   ← inglês (padrão)
│   └── pt.json   ← português (pt-BR)
└── contexts/
    └── LanguageContext.tsx
```

### API

```tsx
const { t, lang, setLang } = useLanguage();

// Chave simples
t('wallet.title')                          // "My Wallet" / "Minha Carteira"

// Dot-path (aninhado)
t('activity_feed.more_notifications', { count: 3 })  // "+3 previous notifications"
```

### Regras

- **Idioma padrão:** inglês (`"en"`).
- **Persistência:** `localStorage` com chave `xiaolee_lang`.
- **`document.documentElement.lang`** atualizado a cada troca (`"en"` / `"pt-BR"`).
- **Fallback:** se a chave não existir no JSON, a própria chave é retornada — nunca `undefined`.
- **Interpolação:** `{{var}}` substituído via `String.replace` — sem dependência de parser.

### LangToggle

Componente pill localizado na Navbar, antes do ThemeToggle:

```tsx
<div className="flex items-center gap-0.5 bg-white/20 border border-white/30 rounded-xl p-0.5">
  {["en", "pt"].map((l) => (
    <button key={l} onClick={() => setLang(l)}
      className={lang === l
        ? "bg-[var(--accent)] text-white ..."
        : "text-white/70 hover:text-white ..."}>
      {l === "en" ? "EN" : "PT"}
    </button>
  ))}
</div>
```

---

## 11. Referências Web3 / DeFi

Este design system busca inspiração em interfaces reconhecidas por sua excelência visual no ecossistema cripto:
- **Phantom Wallet:** Limpeza, botões arredondados, tons de roxo/azul.
- **Jupiter Exchange:** Foco na área principal de ação, modais clean com glassmorphism.
- **Backpack:** Tipografia forte (Inter/sans), alto contraste entre fundo e painéis.
