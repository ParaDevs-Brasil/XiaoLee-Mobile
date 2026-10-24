import { Fragment, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { PressableScale } from '@/components/touch-motion';

import type { Campaign, CampaignParticipant, UserCampaignParticipation } from '@/api/backend';
import {
  approveCampaignParticipant,
  claimCampaignReward,
  joinCampaign,
  listCampaignParticipants,
  verifyCampaignTasks,
} from '@/api/backend';
import { ApiError } from '@/api/client';
import { IconList } from '@/components/icons';
import { CardShadow, Fonts, Radius, Spacing } from '@/constants/theme';
import { useSession } from '@/hooks/use-session';
import { makeStyles, useTheme } from '@/hooks/use-theme';
import { formatDate, formatTokenAmount } from '@/lib/format';
import { getSessionToken } from '@/lib/session';
import { usePrivyWallet } from '@/lib/wallet';

/**
 * Cartão de campanha — porta de `frontend/src/components/campaigns/CampaignCard.tsx`.
 *
 * A ordem dos blocos é a do web: cabeçalho, descrição, números com barra de
 * progresso, recompensa, tarefas exigidas, os três botões e o rodapé.
 *
 * Os textos vêm de `frontend/src/locales/en.json` (chaves `campaign_card.*`),
 * copiados em vez de reescritos — o mobile ainda não tem i18n, e inventar
 * outra redação faria as duas plataformas dizerem coisas diferentes sobre a
 * mesma campanha.
 */

/**
 * Faixas da barra de vagas, iguais às do web (`CampaignCard.tsx:28`): verde
 * até 60%, âmbar entre 60 e 90, vermelho a partir de 90.
 *
 * O mobile ficou só com verde e vermelho porque o design system não tinha
 * âmbar na época. Tem desde `3f74248`, então as três faixas voltam — e a do
 * meio importa: "enchendo" e "praticamente sem vaga" são decisões diferentes
 * para quem está pensando em entrar.
 */
const FILLING_PCT = 60;
const NEARLY_FULL_PCT = 90;

/**
 * Em que passo da jornada esta campanha está para ESTE usuário.
 *
 * Sai do `participation_status` que `/campaigns/me` devolve, e não de estado
 * local: recarregar o app, trocar de aparelho ou entrar pelo chat tem que
 * mostrar o mesmo passo, e a verdade disso mora no banco.
 */
type Step = 'join' | 'verify' | 'claim' | 'done';

function stepOf(participation?: UserCampaignParticipation): Step {
  if (!participation) return 'join';
  if (participation.tasks_claimed) return 'done';
  if (participation.participation_status === 'tasks_verified') return 'claim';
  return 'verify';
}

const STEP_LABEL: Record<Step, string> = {
  join: 'Join',
  verify: 'Verify tasks',
  claim: 'Claim reward',
  done: 'Reward claimed',
};

interface CampaignCardProps {
  campaign: Campaign;
  /**
   * Entrar, verificar e resgatar dependem de carteira conectada. Sem ela os
   * três botões ficam travados com o mesmo aviso, em vez de falharem no toque.
   */
  hasSession: boolean;
  /** Participação do usuário nesta campanha, se já entrou. */
  participation?: UserCampaignParticipation;
  /**
   * Chamado quando join/verify/claim muda algo no servidor, para a tela
   * recarregar `/campaigns` e `/campaigns/me`. Sem isto o cartão avançaria só
   * na memória e discordaria do banco no próximo refresh.
   */
  onChanged?: () => void;
}

export function CampaignCard({
  campaign,
  hasSession,
  participation,
  onChanged,
}: CampaignCardProps) {
  const colors = useTheme();
  const styles = useStyles();
  // `completed_participants` conta **todo mundo inscrito**, não quem concluiu:
  // o backend preenche esse campo com um `count` de `CampaignParticipant` sem
  // filtrar por status (`campaigns_routes.py::list_campaigns`). O rótulo segue
  // o do web, "Enrolled", que é o que o número realmente significa.
  const enrolled = campaign.completed_participants || 0;
  const spotsLeft = Math.max(0, campaign.max_participants - enrolled);
  const pct =
    campaign.max_participants > 0
      ? Math.min(100, Math.round((enrolled / campaign.max_participants) * 100))
      : 0;

  const hasTasks = Boolean(campaign.profile_to_follow || campaign.tweet_id_to_engage);

  const step = stepOf(participation);
  const { session } = useSession();
  const isCreator = Boolean(session) && session?.twitterUserId === campaign.creator_twitter_user_id;
  const { address, signMessage } = usePrivyWallet();
  const [busy, setBusy] = useState(false);
  // Uma linha só de retorno. `tone` separa "a verificação reprovou" (informação
  // legítima, o usuário ainda não fez a tarefa) de "a chamada falhou".
  const [notice, setNotice] = useState<{ text: string; tone: 'info' | 'error' } | null>(null);

  async function runStep() {
    if (busy || step === 'done') return;
    setBusy(true);
    setNotice(null);

    try {
      if (step === 'join') {
        setNotice({ text: await joinCampaign(campaign.id), tone: 'info' });
      } else if (step === 'verify') {
        const result = await verifyCampaignTasks(campaign.id);
        setNotice({ text: result.message, tone: result.allTasksCompleted ? 'info' : 'error' });
      } else {
        // A conta é a carteira agora — sem uma conectada não há quem provar
        // posse nem para onde pagar.
        if (!address) {
          setNotice({ text: 'Connect a wallet to receive the reward.', tone: 'error' });
          return;
        }
        // `session` é o mesmo valor que `apiFetch` já manda como Bearer
        // (`getSessionToken`, gravado em minúsculas por `lib/wallet.tsx`
        // ao conectar) — a prova precisa citar exatamente esse texto, não o
        // endereço com o casing original, ou o backend recusa com 400 por não
        // bater com o prefixo esperado.
        const session = await getSessionToken();
        if (!session) {
          setNotice({ text: 'Connect a wallet to claim.', tone: 'error' });
          return;
        }
        const proofMessage = `XiaoLee claim|campaign:${campaign.id}|session:${session}|wallet:${address}|ts:${Date.now()}`;
        let signature: string;
        try {
          signature = await signMessage(proofMessage);
        } catch {
          setNotice({ text: 'Wallet signature was cancelled or failed.', tone: 'error' });
          return;
        }
        const result = await claimCampaignReward(campaign.id, address, proofMessage, signature);
        // `paidOnchain` distingue USDC de verdade saindo da tesouraria (Circle
        // W3S no Arc) de um resgate só registrado — hoje só EVM+USDC paga de
        // verdade (`campaigns_routes.py::claim_reward`); o resto (ex. wallet
        // Solana legada) grava o resgate sem mover token nenhum.
        setNotice({
          text: result.paidOnchain
            ? `${result.message} USDC sent to your wallet.`
            : `${result.message} Recorded — no on-chain transfer for this wallet/token yet.`,
          tone: 'info',
        });
      }

      onChanged?.();
    } catch (err) {
      setNotice({
        text: err instanceof ApiError ? err.message : String(err),
        tone: 'error',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.name}>{campaign.name}</Text>
        <View style={styles.typeChip}>
          <Text style={styles.typeText}>{campaign.campaign_type}</Text>
        </View>
      </View>

      <View style={styles.body}>
        <Text style={styles.description} numberOfLines={3}>
          {campaign.description}
        </Text>

        <View style={styles.statsBox}>
          <View style={styles.statsGrid}>
            <Stat label="Max." value={String(campaign.max_participants)} />
            <Stat
              label="Pool"
              value={`${formatTokenAmount(campaign.reward_pool)} ${campaign.reward_token}`}
            />
            <Stat label="Enrolled" value={String(enrolled)} />
            <Stat
              label="Spots"
              value={spotsLeft === 0 ? 'Sold out' : String(spotsLeft)}
              alert={spotsLeft === 0}
            />
          </View>

          <View style={styles.progressHeader}>
            <Text style={styles.progressLabel}>Spots filled</Text>
            <Text style={styles.progressPct}>{pct}%</Text>
          </View>
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                { width: `${pct}%` },
                pct >= FILLING_PCT && styles.progressFillFilling,
                pct >= NEARLY_FULL_PCT && styles.progressFillFull,
              ]}
            />
          </View>
        </View>

        <View style={styles.rewardBox}>
          <Text style={styles.rewardLabel}>Reward per participant</Text>
          <View style={styles.rewardValue}>
            <Text style={styles.rewardAmount}>
              {formatTokenAmount(campaign.reward_per_participant)}
            </Text>
            <Text style={styles.rewardToken}>{campaign.reward_token}</Text>
          </View>
        </View>

        {hasTasks ? (
          <View style={styles.tasksBox}>
            <View style={styles.tasksHeader}>
              <IconList size={13} color={colors.ink2} />
              <Text style={styles.tasksTitle}>Required tasks</Text>
            </View>

            {campaign.profile_to_follow ? (
              <Task
                label="Follow:"
                value={campaign.profile_to_follow}
                url={`https://x.com/${campaign.profile_to_follow.replace(/^@/, '')}`}
              />
            ) : null}
            {campaign.tweet_id_to_engage ? (
              <Task
                label="Engage:"
                value={campaign.tweet_id_to_engage}
                url={campaign.tweet_id_to_engage}
              />
            ) : null}
          </View>
        ) : null}

        <View style={styles.actions}>
          <StepRail step={step} />
          {notice ? (
            <Text
              style={[styles.notice, notice.tone === 'error' && styles.noticeError]}
              accessibilityLiveRegion="polite"
            >
              {notice.text}
            </Text>
          ) : null}
          <Action
            label={hasSession ? STEP_LABEL[step] : 'Connect a wallet to continue'}
            disabled={!hasSession || step === 'done'}
            busy={busy}
            onPress={runStep}
          />
        </View>

        {isCreator ? <CreatorParticipants campaignId={campaign.id} onChanged={onChanged} /> : null}
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>@{campaign.creator_twitter_user_id}</Text>
        <Text style={styles.footerText}>{formatDate(campaign.created_at)}</Text>
      </View>
    </View>
  );
}

function Stat({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  const styles = useStyles();
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, alert && styles.statValueAlert]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

/** Tarefa exigida. Abre no navegador — o alvo é sempre um link do X. */
function Task({ label, value, url }: { label: string; value: string; url: string }) {
  const styles = useStyles();
  return (
    <View style={styles.task}>
      <Text style={styles.taskLabel}>{label}</Text>
      <Pressable
        onPress={() => {
          // Sem `catch` o app cai se não houver navegador para o esquema —
          // uma tarefa que não abre não justifica derrubar a tela.
          Linking.openURL(url).catch(() => {});
        }}
        accessibilityRole="link"
        hitSlop={Spacing.two}
        style={styles.taskLinkWrap}
      >
        <Text style={styles.taskLink} numberOfLines={1}>
          {value}
        </Text>
      </Pressable>
    </View>
  );
}

/**
 * A jornada da campanha: entrar, verificar as tarefas, resgatar.
 *
 * No web isto são três botões, cada um guiado por estado de participação real
 * (`isEnrolled`, `isTasksVerified`, `isPaid`). O mobile não tem esse estado —
 * sem sessão não existe participação para consultar —, então lá os três
 * ficavam `disabled` fixo: ~142px no rodapé de todo cartão que nunca dispara
 * nada, num carrossel que já não conseguia mostrar um cartão inteiro.
 *
 * O trilho conta a mesma progressão em ~18px e deixa uma única ação viva. Os
 * passos voltam a ser botões quando houver estado de participação para guiá-los.
 */
const STEPS = ['Join', 'Verify', 'Claim'] as const;

/** Índice do passo atual no trilho; `done` deixa os três preenchidos. */
const STEP_INDEX: Record<Step, number> = { join: 0, verify: 1, claim: 2, done: 3 };

function StepRail({ step }: { step: Step }) {
  const styles = useStyles();
  const current = STEP_INDEX[step];

  return (
    // `accessible` no contêiner: o leitor de tela anuncia a jornada como uma
    // frase, em vez de soletrar seis nós soltos ("1", "Join", "2"…).
    <View
      style={styles.rail}
      accessible
      accessibilityLabel={`Join, then verify tasks, then claim the reward. Current step: ${STEP_LABEL[step]}`}
    >
      {STEPS.map((label, i) => {
        const doneStep = i < current;
        const activeStep = i === current;
        return (
          <Fragment key={label}>
            {i > 0 ? <View style={[styles.railLine, doneStep && styles.railLineDone]} /> : null}
            <View style={styles.railStep}>
              <View
                style={[
                  styles.railDot,
                  doneStep && styles.railDotDone,
                  activeStep && styles.railDotActive,
                ]}
              >
                <Text
                  style={[
                    styles.railDotText,
                    (doneStep || activeStep) && styles.railDotTextOn,
                  ]}
                >
                  {doneStep ? '✓' : i + 1}
                </Text>
              </View>
              <Text style={[styles.railLabel, activeStep && styles.railLabelActive]}>{label}</Text>
            </View>
          </Fragment>
        );
      })}
    </View>
  );
}

/**
 * Painel do criador: quem entrou e em que passo está, com "Approve" para quem ainda não foi verificado.
 * É o caminho para tarefas que a API do X não confere (ou janelas que a checagem automática não alcança).
 * Carrega só ao abrir: a lista é por criador e não pesa no carrossel de quem só participa.
 */
function CreatorParticipants({ campaignId, onChanged }: { campaignId: number; onChanged?: () => void }) {
  const colors = useTheme();
  const styles = useStyles();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<CampaignParticipant[] | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string>();

  async function load() {
    setError(undefined);
    try {
      setRows(await listCampaignParticipants(campaignId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  async function approve(userId: number) {
    setBusyId(userId);
    setError(undefined);
    try {
      await approveCampaignParticipant(campaignId, userId);
      await load();
      onChanged?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <View style={styles.tasksBox}>
      <Pressable
        onPress={() => {
          const next = !open;
          setOpen(next);
          if (next) load();
        }}
        accessibilityRole="button"
        style={styles.tasksHeader}
      >
        <IconList size={13} color={colors.ink2} />
        <Text style={styles.tasksTitle}>{open ? 'Hide participants' : 'Participants (creator)'}</Text>
      </Pressable>
      {open && rows === null && !error ? <ActivityIndicator size="small" color={colors.accent} /> : null}
      {open && rows?.length === 0 ? <Text style={styles.taskLabel}>Nobody joined yet.</Text> : null}
      {open
        ? rows?.map((row) => (
            <View key={row.user_id} style={styles.task}>
              <Text style={[styles.taskLabel, styles.taskLinkWrap]} numberOfLines={1}>
                {row.handle ? `@${row.handle.replace(/^@/, '')}` : `User ${row.user_id}`} · {PARTICIPANT_STATUS[row.status] ?? row.status}
              </Text>
              {row.status === 'enrolled' ? (
                <Pressable
                  onPress={() => approve(row.user_id)}
                  disabled={busyId !== null}
                  accessibilityRole="button"
                  hitSlop={Spacing.two}
                >
                  {busyId === row.user_id ? (
                    <ActivityIndicator size="small" color={colors.accent} />
                  ) : (
                    <Text style={styles.taskLink}>Approve</Text>
                  )}
                </Pressable>
              ) : null}
            </View>
          ))
        : null}
      {error ? <Text style={[styles.notice, styles.noticeError]}>{error}</Text> : null}
    </View>
  );
}

const PARTICIPANT_STATUS: Record<string, string> = {
  enrolled: 'joined',
  tasks_verified: 'approved',
  paid: 'paid',
};

/**
 * Ação primária do cartão. O web pinta o primário com um gradiente rosa→roxo;
 * aqui ele é o acento chapado — o mobile não tem `expo-linear-gradient`, e o
 * design system define o primário como cor sólida.
 */
function Action({
  label,
  disabled,
  busy,
  onPress,
}: {
  label: string;
  disabled?: boolean;
  busy?: boolean;
  onPress?: () => void;
}) {
  const colors = useTheme();
  const styles = useStyles();
  // Durante a chamada o botão fica inerte: dois toques em `Join` renderiam um
  // 409 do backend como erro na tela, sendo que o primeiro deu certo.
  const blocked = Boolean(disabled) || Boolean(busy);

  return (
    <PressableScale
      onPress={onPress}
      disabled={blocked}
      scaleTo={0.97}
      style={[styles.action, blocked && styles.actionDisabled]}
      accessibilityRole="button"
      accessibilityState={{ disabled: blocked, busy: Boolean(busy) }}
    >
      {busy ? (
        <ActivityIndicator size="small" color={colors.onAccent} />
      ) : (
        <Text style={styles.actionText}>{label}</Text>
      )}
    </PressableScale>
  );
}

const useStyles = makeStyles((colors) => ({
  card: {
    borderRadius: Radius.lg,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
    ...CardShadow,
  },

  // ── Cabeçalho ──────────────────────────────────────────────────────────
  header: {
    gap: Spacing.two - 2,
    alignItems: 'flex-start',
    paddingHorizontal: Spacing.three - 2,
    paddingVertical: Spacing.two + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  name: { fontFamily: Fonts.bold, fontSize: 15, lineHeight: 21, color: colors.ink },
  typeChip: {
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: 2,
    borderRadius: Radius.pill,
    backgroundColor: colors.accentSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  typeText: {
    fontFamily: Fonts.bold,
    fontSize: 9,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.accent,
  },

  body: { padding: Spacing.three - 2, gap: Spacing.two + 2 },
  description: { fontFamily: Fonts.sans, fontSize: 13, lineHeight: 20, color: colors.ink2 },

  // ── Números e progresso ────────────────────────────────────────────────
  statsBox: {
    gap: Spacing.two,
    padding: Spacing.two + 2,
    borderRadius: Radius.md,
    backgroundColor: colors.bg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  // Duas colunas com `wrap`: os quatro números viram 2x2 sem grid.
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: Spacing.two - 2 },
  stat: {
    width: '50%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingRight: Spacing.two,
  },
  statLabel: { fontFamily: Fonts.medium, fontSize: 12, color: colors.ink3 },
  statValue: { fontFamily: Fonts.bold, fontSize: 12, color: colors.ink, flexShrink: 1 },
  statValueAlert: { color: colors.danger },

  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: Spacing.two - 2,
  },
  progressLabel: { fontFamily: Fonts.medium, fontSize: 11, color: colors.ink3 },
  progressPct: { fontFamily: Fonts.bold, fontSize: 11, color: colors.ink2 },
  progressTrack: {
    height: 6,
    borderRadius: Radius.pill,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: Radius.pill, backgroundColor: colors.success },
  progressFillFilling: { backgroundColor: colors.warn },
  progressFillFull: { backgroundColor: colors.danger },

  // ── Recompensa ─────────────────────────────────────────────────────────
  rewardBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three - 2,
    paddingVertical: Spacing.two + 2,
    borderRadius: Radius.md,
    backgroundColor: colors.accentSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  rewardLabel: { flex: 1, fontFamily: Fonts.semibold, fontSize: 12, color: colors.ink2 },
  rewardValue: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.two - 2 },
  rewardAmount: { fontFamily: Fonts.bold, fontSize: 18, color: colors.accent },
  rewardToken: { fontFamily: Fonts.bold, fontSize: 12, color: colors.accent },

  // ── Tarefas ────────────────────────────────────────────────────────────
  tasksBox: {
    gap: Spacing.two - 2,
    padding: Spacing.two + 2,
    borderRadius: Radius.md,
    backgroundColor: colors.bg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  tasksHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two - 2 },
  tasksTitle: {
    fontFamily: Fonts.bold,
    fontSize: 10,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.ink2,
  },
  task: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two - 2 },
  taskLabel: { fontFamily: Fonts.sans, fontSize: 12, color: colors.ink2 },
  taskLinkWrap: { flex: 1 },
  taskLink: {
    fontFamily: Fonts.medium,
    fontSize: 12,
    color: colors.accent,
    textDecorationLine: 'underline',
  },

  // ── Ações ──────────────────────────────────────────────────────────────
  actions: { gap: Spacing.two + 2 },
  rail: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two - 2 },
  railStep: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two - 3 },
  // `flex: 1` no conector: são as linhas que absorvem a sobra, então os três
  // passos ficam distribuídos sem conta de largura.
  railLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  railDot: {
    width: 18,
    height: 18,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  railDotText: { fontFamily: Fonts.bold, fontSize: 9, color: colors.ink3 },
  railDotDone: { backgroundColor: colors.successFill, borderColor: colors.successFill },
  railDotActive: { backgroundColor: colors.accentFill, borderColor: colors.accentFill },
  railDotTextOn: { color: colors.onAccent },
  railLineDone: { backgroundColor: colors.success },
  railLabelActive: { color: colors.accent },
  // Uma linha de retorno entre o trilho e o botão. `info` herda o cinza do
  // corpo; só o erro puxa cor, para não pintar de vermelho uma verificação que
  // apenas ainda não passou.
  notice: {
    fontFamily: Fonts.sans,
    fontSize: 12,
    lineHeight: 17,
    color: colors.ink2,
    marginBottom: Spacing.two,
  },
  noticeError: { color: colors.danger },
  railLabel: {
    fontFamily: Fonts.bold,
    fontSize: 10,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: colors.ink3,
  },
  action: {
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.md,
    backgroundColor: colors.accentFill,
  },
  actionDisabled: { opacity: 0.45 },
  actionText: { fontFamily: Fonts.semibold, fontSize: 13, color: colors.onAccent },

  // ── Rodapé ─────────────────────────────────────────────────────────────
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three - 2,
    paddingVertical: Spacing.two + 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  footerText: { fontFamily: Fonts.sans, fontSize: 11, color: colors.ink3 },
}));
