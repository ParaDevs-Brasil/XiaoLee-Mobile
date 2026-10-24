import { useVideoPlayer } from 'expo-video';
import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Easing,
  InteractionManager,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Circle, Defs, LinearGradient, RadialGradient, Rect, Stop, Svg } from 'react-native-svg';

import type { CreatorVoice } from '@/api/backend';
import { IconCheck, IconClose, IconHeart, IconPause, IconPlay, IconSearch, IconSliders } from '@/components/icons';
import { PressableScale, useBadgePop, useToggleProgress } from '@/components/touch-motion';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useKeyboard } from '@/hooks/use-keyboard';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import { makeStyles, useTheme } from '@/hooks/use-theme';
import { API_URL } from '@/lib/config';
import { loadVoiceFavorites, saveVoiceFavorites, toggleFavorite } from '@/lib/voice-favorites';
import {
  activeCount,
  matchesFilters,
  NO_FILTERS,
  type Accent,
  type GenderFilter,
  type Tone,
  type VoiceFilters,
} from '@/lib/voice-filters';

/**
 * "Choose a voice": a folha com a busca, as categorias (Brazilian, Narrators…) e uma linha por voz, cada uma com o botão
 * de ouvir a amostra. Tocar na linha escolhe; o botão redondo toca ou pausa; "Use <nome>" confirma e fecha. Um único
 * player (o do `expo-video`, que também toca áudio) serve todas as vozes.
 *
 * Movimento: a folha sobe com desaceleração e se fecha arrastando para baixo; a seleção, as categorias e o botão
 * fundem de um estado para o outro; e a voz que toca troca a linha de descrição por uma onda de som viva, com um halo
 * pulsando no botão. Tudo em `opacity` e `transform` (driver nativo) e parado com "Reduzir movimento".
 *
 * Quem usa monta a folha só enquanto ela está aberta, então o rascunho da escolha nasce de `value` a cada abertura.
 */

/** Pares de cores (claro → fundo) do rosto de cada voz — fixos por nome, para a mesma voz ter sempre o mesmo rosto. */
const ORB_GRADIENTS: [string, string][] = [
  ['#ff9a6c', '#d6336c'],
  ['#8b7dff', '#3b2fa8'],
  ['#35e0c4', '#0f766e'],
  ['#fbbf24', '#b45309'],
  ['#4cc2ff', '#1d4ed8'],
  ['#d09bff', '#7e22ce'],
  ['#ff8da1', '#be123c'],
  ['#4be0a6', '#047857'],
];
const nameHash = (name: string) => [...name].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7);

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const SAVED = 'Saved';
const TONES: { id: Tone; label: string }[] = [
  { id: 'deep', label: 'Deep' },
  { id: 'soft', label: 'Soft' },
  { id: 'bright', label: 'Bright' },
];
const ACCENTS: { id: Accent; label: string }[] = [
  { id: 'brazilian', label: 'Brazilian' },
  { id: 'british', label: 'British' },
  { id: 'other', label: 'Other' },
];
const GENDERS: { id: GenderFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'female', label: 'Female' },
  { id: 'male', label: 'Male' },
];

const SCREEN_H = Dimensions.get('window').height;
/** Arrastar além disto (ou rápido) fecha a folha. */
const DISMISS_DRAG = 110;
const EXPO_OUT = Easing.bezier(0.16, 1, 0.3, 1);

/** Pausa sem estourar: no desmonte (e no hot reload) o `useVideoPlayer` pode já ter liberado o player. */
function stop(player: { pause: () => void }) {
  try {
    player.pause();
  } catch {
    // já liberado — nada a pausar
  }
}

/** Contorno da onda: picos e vales determinísticos (soma de duas senoides), para parecer fala e não um equalizador aleatório. */
const WAVE_PEAKS = Array.from({ length: 26 }, (_, i) => 0.3 + 0.7 * Math.abs(Math.sin(i * 0.85 + 1) * Math.cos(i * 0.33)));
const WAVE_H = 22;
/** Anel de progresso em volta do botão de ouvir (o botão tem 40). */
const RING = 48;
const RING_R = 22;
const RING_C = 2 * Math.PI * RING_R;

export function VoiceSheet({
  voices,
  value,
  onConfirm,
  onClose,
}: {
  voices: CreatorVoice[];
  value: string | null;
  onConfirm: (id: string) => void;
  onClose: () => void;
}) {
  const colors = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboard();
  const reduce = useReduceMotion();
  const player = useVideoPlayer(null, (p) => {
    p.timeUpdateEventInterval = 0.1;
  });
  const [draft, setDraft] = useState<string | null>(value);
  const [playing, setPlaying] = useState<string | null>(null);
  // Quanto da amostra já tocou (0 → 1): o anel em volta do botão de ouvir.
  const [progress] = useState(() => new Animated.Value(0));
  const [loading, setLoading] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [filters, setFilters] = useState<VoiceFilters>(NO_FILTERS);
  const [panelOpen, setPanelOpen] = useState(false);
  const [favorites, setFavorites] = useState<string[]>([]);
  // As linhas só montam depois que a folha começou a subir: montar dezenas de views (avatar SVG, botões, animações) antes
  // do primeiro quadro era o que fazia o toque no botão "demorar" a responder.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => setReady(true));
    return () => task.cancel();
  }, []);

  const chosen = voices.find((v) => v.id === draft) ?? null;
  const favoriteVoices = voices.filter((v) => favorites.includes(v.id));
  const categories = [...(favoriteVoices.length ? [SAVED] : []), ...new Set(voices.map((v) => v.category))];
  const category = picked && categories.includes(picked) ? picked : (chosen?.category ?? categories[0]);
  const filterCount = activeCount(filters);
  const q = query.trim().toLowerCase();
  const listCategory = category;
  const listFilters = filters;
  const listQuery = q;
  // Buscando, vale o catálogo todo; sem busca, só a categoria aberta.
  const shown = voices.filter(
    (v) =>
      matchesFilters(v, listFilters) &&
      (listQuery
        ? `${v.name} ${v.description} ${v.category} ${v.gender}`.toLowerCase().includes(listQuery)
        : listCategory === SAVED
          ? favorites.includes(v.id)
          : v.category === listCategory),
  );

  // --- Favoritos ----------------------------------------------------------------------------------------------
  useEffect(() => {
    let alive = true;
    loadVoiceFavorites().then((ids) => alive && setFavorites(ids));
    return () => {
      alive = false;
    };
  }, []);

  const favorite = useCallback((id: string) => {
    setFavorites((cur) => {
      const next = toggleFavorite(cur, id);
      saveVoiceFavorites(next);
      return next;
    });
  }, []);

  // --- Entrada e saída da folha -------------------------------------------------------------------------------
  const [shownProgress] = useState(() => new Animated.Value(0));
  const [drag] = useState(() => new Animated.Value(0));
  const closing = useRef(false);

  useEffect(() => {
    if (reduce) {
      shownProgress.setValue(1);
      return;
    }
    const run = Animated.timing(shownProgress, {
      toValue: 1,
      duration: 420,
      easing: EXPO_OUT,
      useNativeDriver: true,
    });
    run.start();
    return () => run.stop();
  }, [reduce, shownProgress]);

  function dismiss() {
    if (closing.current) return;
    closing.current = true;
    stop(player);
    if (reduce) {
      onClose();
      return;
    }
    Animated.parallel([
      Animated.timing(shownProgress, { toValue: 0, duration: 220, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      Animated.timing(drag, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]).start(() => onClose());
  }

  // O gesto vive na alça e no cabeçalho — a lista tem a própria rolagem e não pode disputar o toque.
  const dismissRef = useRef(dismiss);
  useEffect(() => {
    dismissRef.current = dismiss;
  });
  // O responder nasce uma vez (trocá-lo no meio do gesto zeraria o arrasto) e lê `dismiss` pelo ref só nos eventos.
  // eslint-disable-next-line react-hooks/refs
  const [pan] = useState(() =>
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_e, g) => drag.setValue(Math.max(0, g.dy)),
      onPanResponderRelease: (_e, g) => {
        if (g.dy > DISMISS_DRAG || g.vy > 0.9) {
          dismissRef.current();
          return;
        }
        Animated.spring(drag, { toValue: 0, damping: 18, stiffness: 240, mass: 0.8, useNativeDriver: true }).start();
      },
      onPanResponderTerminate: () => {
        Animated.spring(drag, { toValue: 0, damping: 18, stiffness: 240, mass: 0.8, useNativeDriver: true }).start();
      },
    }),
  );

  const sheetY = Animated.add(
    shownProgress.interpolate({ inputRange: [0, 1], outputRange: [SCREEN_H, 0], extrapolate: 'clamp' }),
    drag,
  );
  // Escurece menos conforme a folha é puxada para baixo: o fundo "volta" junto com o dedo.
  const backdropOpacity = Animated.multiply(
    shownProgress,
    drag.interpolate({ inputRange: [0, 320], outputRange: [1, 0.3], extrapolate: 'clamp' }),
  );

  // --- Amostra de áudio ---------------------------------------------------------------------------------------
  useEffect(() => {
    const end = player.addListener('playToEnd', () => {
      // O anel fecha o círculo antes de a linha voltar ao repouso.
      Animated.timing(progress, { toValue: 1, duration: 120, easing: Easing.linear, useNativeDriver: false }).start(() => {
        setPlaying(null);
        progress.setValue(0);
      });
    });
    const time = player.addListener('timeUpdate', ({ currentTime }) => {
      const total = player.duration;
      if (total > 0) {
        Animated.timing(progress, {
          toValue: Math.min(1, currentTime / total),
          duration: 110,
          easing: Easing.linear,
          useNativeDriver: false,
        }).start();
      }
    });
    const status = player.addListener('statusChange', ({ status: s }) => {
      if (s !== 'loading') setLoading(null);
    });
    return () => {
      end.remove();
      time.remove();
      status.remove();
      stop(player);
    };
  }, [player, progress]);

  // Os callbacks das linhas precisam de identidade estável para o `memo` valer: quem toca fica num ref.
  const playingRef = useRef<string | null>(null);
  useEffect(() => {
    playingRef.current = playing;
  });
  const toggle = useCallback(
    (v: CreatorVoice) => {
      if (playingRef.current === v.id) {
        player.pause();
        setPlaying(null);
        progress.setValue(0);
        return;
      }
      progress.setValue(0);
      player.replace(`${API_URL}${v.sample_path}`);
      player.play();
      setPlaying(v.id);
      // Ouvir é o jeito de escolher: quem toca a amostra já deixa a voz marcada, sem um segundo toque na linha.
      setDraft(v.id);
      setLoading(v.id);
    },
    [player, progress],
  );
  const select = useCallback((id: string) => setDraft(id), []);

  const bottomInset = keyboard.visible ? 0 : insets.bottom;

  return (
    <Modal visible transparent animationType="none" onRequestClose={dismiss} statusBarTranslucent>
      <View style={[styles.root, { paddingBottom: keyboard.height }]}>
        <Animated.View style={[styles.scrim, { opacity: backdropOpacity }]}>
          <Pressable style={styles.flex} onPress={dismiss} accessibilityLabel="Close" />
        </Animated.View>

        <Animated.View
          style={[
            styles.sheet,
            keyboard.visible ? styles.sheetTyping : styles.sheetIdle,
            { paddingBottom: Spacing.three + bottomInset, transform: [{ translateY: sheetY }] },
          ]}
        >
          <View {...pan.panHandlers} style={styles.grab}>
            <View style={styles.handle} />
            <View style={styles.head}>
              <View style={styles.flex}>
                <Text style={styles.title}>Choose a voice</Text>
                <Text style={styles.sub}>Tap play to hear it</Text>
              </View>
              <PressableScale
                onPress={dismiss}
                scaleTo={0.88}
                style={styles.close}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <IconClose size={18} sw={2.2} color={colors.ink2} />
              </PressableScale>
            </View>
          </View>

          <View style={styles.searchRow}>
            <View style={styles.flex}>
              <SearchField value={query} onChange={setQuery} />
            </View>
            <FilterButton open={panelOpen} count={filterCount} onPress={() => setPanelOpen((o) => !o)} />
          </View>

          {q ? null : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.cats}
              style={styles.catsWrap}
              keyboardShouldPersistTaps="handled"
            >
              {categories.map((c) => (
                <CategoryChip key={c} label={c} on={c === category} onPress={() => setPicked(c)} />
              ))}
            </ScrollView>
          )}

          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            {ready && panelOpen ? <FilterPanel filters={filters} onChange={setFilters} /> : null}
            {ready && shown.length === 0 ? (
              <Text style={styles.empty}>
                {q
                  ? `No voice matches “${query.trim()}”.`
                  : filterCount
                    ? `No voice in ${category} fits these filters.`
                    : 'Nothing here yet.'}
              </Text>
            ) : null}
            {/* A chave troca com a categoria/filtro: a lista nova nasce do zero, com poucas linhas no primeiro quadro. */}
            <Rows key={`${listQuery ? 'search' : listCategory}-${listFilters.gender}-${listFilters.tone}-${listFilters.accent}`}>
              {(ready ? shown : []).map((v) => (
                <VoiceRow
                  key={v.id}
                  voice={v}
                  on={v.id === draft}
                  playing={playing === v.id}
                  loading={loading === v.id}
                  slot={voices.indexOf(v)}
                  progress={progress}
                  favorite={favorites.includes(v.id)}
                  onSelect={select}
                  onToggle={toggle}
                  onFavorite={favorite}
                />
              ))}
            </Rows>
          </ScrollView>

          <UseButton
            name={chosen?.name ?? null}
            onPress={() => {
              if (!chosen) return;
              onConfirm(chosen.id);
              dismiss();
            }}
          />
        </Animated.View>
      </View>
    </Modal>
  );
}

/** Quantas linhas entram no primeiro quadro; o resto monta logo depois, sem segurar o toque que trocou a lista. */
const FIRST_PAINT_ROWS = 3;

/**
 * As linhas da lista: monta só as primeiras de imediato e completa quando o JS respira — montar uma categoria inteira
 * de uma vez (cada linha tem ~12 valores animados) travava a troca de categoria. A lista sobe e aparece em bloco, com
 * um único valor animado, em vez de uma entrada por linha.
 */
function Rows({ children }: { children: ReactNode[] }) {
  const styles = useStyles();
  const reduce = useReduceMotion();
  const [limit, setLimit] = useState(FIRST_PAINT_ROWS);
  const [progress] = useState(() => new Animated.Value(0));
  const total = children.length;

  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => setLimit(total));
    return () => task.cancel();
  }, [total]);

  useEffect(() => {
    if (reduce) {
      progress.setValue(1);
      return;
    }
    const run = Animated.timing(progress, { toValue: 1, duration: 220, easing: EXPO_OUT, useNativeDriver: true });
    run.start();
    return () => run.stop();
  }, [reduce, progress]);

  return (
    <Animated.View
      style={[
        styles.rows,
        { opacity: progress, transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] },
      ]}
    >
      {children.slice(0, limit)}
    </Animated.View>
  );
}

/** Campo de busca que "acende" a borda ao receber foco e ganha um × para limpar. */
function SearchField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const colors = useTheme();
  const styles = useStyles();
  const [focused, setFocused] = useState(false);
  const focus = useToggleProgress(focused, 180);
  const clear = useToggleProgress(value.length > 0, 160);

  return (
    <View style={styles.search}>
      <Animated.View pointerEvents="none" style={[styles.searchFocusRing, { opacity: focus }]} />
      <IconSearch size={20} color={focused ? colors.accent : colors.ink2} />
      <TextInput
        value={value}
        onChangeText={onChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder="Search voices"
        placeholderTextColor={colors.ink3}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        submitBehavior="blurAndSubmit"
        style={styles.searchInput}
        accessibilityLabel="Search voices"
      />
      <Animated.View
        pointerEvents={value ? 'auto' : 'none'}
        style={{
          opacity: clear,
          transform: [{ scale: clear.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }],
        }}
      >
        <PressableScale
          onPress={() => onChange('')}
          scaleTo={0.85}
          hitSlop={Spacing.two}
          style={styles.clear}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
        >
          <IconClose size={12} sw={3} color={colors.bg} />
        </PressableScale>
      </Animated.View>
    </View>
  );
}

/**
 * O rosto da voz: uma esfera com degradê próprio, brilho no alto e a "impressão vocal" — cinco barras espelhadas cuja
 * altura nasce do nome. Substitui a inicial: cada voz fica reconhecível de relance e combina com a onda da linha.
 */
const VoiceOrb = memo(function VoiceOrb({ name, slot }: { name: string; slot: number }) {
  const h = nameHash(name);
  // A cor vem da posição no catálogo (não do nome): vozes vizinhas nunca repetem cor, e ela não muda com filtros.
  const [light, deep] = ORB_GRADIENTS[slot % ORB_GRADIENTS.length];
  const id = `orb${h}-${slot}`;
  const a = 10 + ((h >> 3) & 7) * 2.6;
  const b = 12 + ((h >> 6) & 7) * 3.2;
  const c = 14 + ((h >> 9) & 7) * 3.6;
  const heights = [a, b, c, b, a];
  return (
    <Svg width={52} height={52} viewBox="0 0 52 52">
      <Defs>
        <LinearGradient id={`${id}f`} x1="0.15" y1="0" x2="0.85" y2="1">
          <Stop offset="0" stopColor={light} />
          <Stop offset="1" stopColor={deep} />
        </LinearGradient>
        <RadialGradient id={`${id}g`} cx="0.3" cy="0.2" rx="0.7" ry="0.6">
          <Stop offset="0" stopColor="#ffffff" stopOpacity="0.5" />
          <Stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Circle cx={26} cy={26} r={26} fill={`url(#${id}f)`} />
      <Circle cx={26} cy={26} r={26} fill={`url(#${id}g)`} />
      {heights.map((bh, i) => (
        <Rect key={i} x={12.5 + i * 7.5} y={26 - bh / 2} width={4} height={bh} rx={2} fill="#ffffff" opacity={i === 2 ? 0.98 : 0.8} />
      ))}
      <Circle cx={26} cy={26} r={25.5} fill="none" stroke="#ffffff" strokeOpacity={0.28} strokeWidth={1} />
    </Svg>
  );
});

/** Botão de filtros ao lado da busca: acende quando o painel está aberto e mostra quantos filtros estão valendo. */
function FilterButton({ open, count, onPress }: { open: boolean; count: number; onPress: () => void }) {
  const colors = useTheme();
  const styles = useStyles();
  const on = useToggleProgress(open || count > 0, 180);
  const pop = useBadgePop(count > 0);
  return (
    <PressableScale
      onPress={onPress}
      scaleTo={0.92}
      style={styles.filterBtn}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityLabel={count ? `Filters, ${count} active` : 'Filters'}
    >
      <Animated.View pointerEvents="none" style={[styles.filterBtnOn, { opacity: on }]} />
      <IconSliders size={20} color={open || count > 0 ? colors.onAccent : colors.ink2} />
      <Animated.View pointerEvents="none" style={[styles.filterBadge, pop]}>
        <Text style={styles.filterBadgeText}>{count}</Text>
      </Animated.View>
    </PressableScale>
  );
}

/** A caixa de filtros: gênero, tom e sotaque. Tocar de novo no chip ligado o desliga. */
function FilterPanel({ filters, onChange }: { filters: VoiceFilters; onChange: (f: VoiceFilters) => void }) {
  const styles = useStyles();
  const [progress] = useState(() => new Animated.Value(0));
  const reduce = useReduceMotion();
  useEffect(() => {
    if (reduce) {
      progress.setValue(1);
      return;
    }
    const run = Animated.timing(progress, { toValue: 1, duration: 260, easing: EXPO_OUT, useNativeDriver: true });
    run.start();
    return () => run.stop();
  }, [reduce, progress]);

  return (
    <Animated.View
      style={[
        styles.panel,
        { opacity: progress, transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) }] },
      ]}
    >
      <Text style={styles.panelLabel}>Voice</Text>
      <GenderSwitch value={filters.gender} onChange={(gender) => onChange({ ...filters, gender })} />
      <Text style={styles.panelLabel}>Tone</Text>
      <View style={styles.panelChips}>
        {TONES.map((t) => (
          <FilterChip
            key={t.id}
            label={t.label}
            on={filters.tone === t.id}
            onPress={() => onChange({ ...filters, tone: filters.tone === t.id ? null : t.id })}
          />
        ))}
      </View>
      <Text style={styles.panelLabel}>Accent</Text>
      <View style={styles.panelChips}>
        {ACCENTS.map((a) => (
          <FilterChip
            key={a.id}
            label={a.label}
            on={filters.accent === a.id}
            onPress={() => onChange({ ...filters, accent: filters.accent === a.id ? null : a.id })}
          />
        ))}
      </View>
      {activeCount(filters) ? (
        <PressableScale onPress={() => onChange(NO_FILTERS)} scaleTo={0.95} style={styles.panelClear} accessibilityRole="button">
          <Text style={styles.panelClearText}>Clear filters</Text>
        </PressableScale>
      ) : null}
    </Animated.View>
  );
}

function FilterChip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const styles = useStyles();
  const fade = useToggleProgress(on, 160);
  return (
    <PressableScale
      onPress={onPress}
      scaleTo={0.94}
      style={styles.fchip}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
    >
      <Text style={styles.fchipText}>{label}</Text>
      <Animated.View pointerEvents="none" style={[styles.fchipOn, { opacity: fade }]}>
        <Text style={[styles.fchipText, styles.fchipTextOn]}>{label}</Text>
      </Animated.View>
    </PressableScale>
  );
}

/** Coração de favoritar: estoura com mola ao ligar. Fica fora do toque da linha (não escolhe a voz). */
function HeartButton({ on, name, onPress }: { on: boolean; name: string; onPress: () => void }) {
  const colors = useTheme();
  const styles = useStyles();
  const pop = useBadgePop(on);
  return (
    <PressableScale
      onPress={onPress}
      scaleTo={0.8}
      hitSlop={Spacing.one}
      style={styles.heart}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={`${on ? 'Remove' : 'Save'} ${name} ${on ? 'from' : 'to'} favorites`}
    >
      {on ? (
        <Animated.View style={pop}>
          <IconHeart size={20} sw={1.8} color={colors.accentFill} filled />
        </Animated.View>
      ) : (
        <IconHeart size={20} sw={1.8} color={colors.ink3} />
      )}
    </PressableScale>
  );
}

/** Filtro de voz: pílula segmentada (Todas · Feminina · Masculina) com o marcador deslizando sob o rótulo. */
function GenderSwitch({ value, onChange }: { value: GenderFilter; onChange: (g: GenderFilter) => void }) {
  const styles = useStyles();
  const reduce = useReduceMotion();
  const [width, setWidth] = useState(0);
  const [x] = useState(() => new Animated.Value(0));
  const index = GENDERS.findIndex((g) => g.id === value);
  const seg = width > 0 ? (width - 8) / GENDERS.length : 0;

  useEffect(() => {
    if (!seg) return;
    if (reduce) {
      x.setValue(index * seg);
      return;
    }
    const run = Animated.spring(x, { toValue: index * seg, damping: 18, stiffness: 260, mass: 0.7, useNativeDriver: true });
    run.start();
    return () => run.stop();
  }, [index, seg, reduce, x]);

  return (
    <View style={styles.gender} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} accessibilityRole="tablist">
      {seg ? <Animated.View pointerEvents="none" style={[styles.genderThumb, { width: seg, transform: [{ translateX: x }] }]} /> : null}
      {GENDERS.map((g) => (
        <Pressable
          key={g.id}
          onPress={() => onChange(g.id)}
          style={styles.genderItem}
          accessibilityRole="tab"
          accessibilityState={{ selected: g.id === value }}
        >
          <Text style={[styles.genderText, g.id === value && styles.genderTextOn]}>{g.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function CategoryChip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const styles = useStyles();
  const fade = useToggleProgress(on);
  return (
    <PressableScale
      onPress={onPress}
      scaleTo={0.94}
      style={styles.cat}
      accessibilityRole="tab"
      accessibilityState={{ selected: on }}
    >
      <Text style={styles.catText} numberOfLines={1}>
        {label}
      </Text>
      {/* O texto claro mora dentro da camada de fundo: os dois são centralizados pelo mesmo flex e não se desalinham. */}
      <Animated.View pointerEvents="none" style={[styles.catOnLayer, { opacity: fade }]}>
        <Text style={[styles.catText, styles.catTextOn]} numberOfLines={1}>
          {label}
        </Text>
      </Animated.View>
    </PressableScale>
  );
}

const VoiceRow = memo(function VoiceRow({
  voice: v,
  on,
  playing,
  loading,
  slot,
  progress,
  favorite,
  onSelect,
  onToggle,
  onFavorite,
}: {
  voice: CreatorVoice;
  slot: number;
  progress: Animated.Value;
  on: boolean;
  playing: boolean;
  loading: boolean;
  favorite: boolean;
  onSelect: (id: string) => void;
  onToggle: (v: CreatorVoice) => void;
  onFavorite: (id: string) => void;
}) {
  const colors = useTheme();
  const styles = useStyles();
  const select = useToggleProgress(on);
  const tick = useBadgePop(on);
  const live = useToggleProgress(playing, 260);
  // Enquanto carrega, o botão mostra o spinner e a onda ainda não começa — não há som para ela seguir.
  const waving = playing && !loading;

  return (
    <PressableScale
      onPress={() => onSelect(v.id)}
      scaleTo={0.985}
      style={styles.row}
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
      accessibilityLabel={`${v.name}, ${v.gender}, ${v.description}`}
    >
      <Animated.View pointerEvents="none" style={[styles.rowOnLayer, { opacity: select }]} />
      <View>
        <VoiceOrb name={v.name} slot={slot} />
        <Animated.View pointerEvents="none" style={[styles.tick, tick]}>
          <IconCheck size={10} sw={3.2} color={colors.onAccent} />
        </Animated.View>
      </View>
      <View style={styles.flex}>
        <Text style={styles.name}>{v.name}</Text>
        {/* A descrição e a onda dividem a mesma linha: uma some quando a outra aparece, sem a linha mudar de altura. */}
        <View style={styles.descSlot}>
          <Animated.Text
            style={[
              styles.desc,
              {
                opacity: live.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
                transform: [{ translateY: live.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) }],
              },
            ]}
            numberOfLines={1}
          >
            {v.gender === 'female' ? 'Female' : 'Male'} · {v.description}
          </Animated.Text>
          {/* A onda (26 barras animadas) só existe enquanto a voz toca: montá-la em toda linha pesava na abertura. */}
          {playing ? (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.waveSlot,
                {
                  opacity: live,
                  transform: [{ translateY: live.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }],
                },
              ]}
            >
              <Waveform active={waving} />
            </Animated.View>
          ) : null}
        </View>
      </View>
      <HeartButton on={favorite} name={v.name} onPress={() => onFavorite(v.id)} />
      <PlayButton playing={playing} loading={loading} progress={progress} name={v.name} onPress={() => onToggle(v)} />
    </PressableScale>
  );
});

/**
 * A onda: barras com contorno de voz que respiram em fases diferentes. Cada uma é uma escala vertical em laço (driver
 * nativo); ao pausar, assentam suavemente no repouso em vez de congelar no meio do pulo.
 */
function Waveform({ active }: { active: boolean }) {
  const reduce = useReduceMotion();
  const styles = useStyles();
  const [bars] = useState(() => WAVE_PEAKS.map(() => new Animated.Value(0.18)));

  useEffect(() => {
    if (!active || reduce) {
      const settle = Animated.parallel(
        bars.map((bar) =>
          Animated.timing(bar, { toValue: 0.18, duration: 260, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        ),
      );
      settle.start();
      return () => settle.stop();
    }
    const loops = bars.map((bar, i) => {
      const peak = 0.3 + WAVE_PEAKS[i] * 0.7;
      const low = 0.14 + ((i * 7) % 5) * 0.04;
      const half = 300 + ((i * 97) % 5) * 70;
      return Animated.sequence([
        Animated.delay(i * 55),
        Animated.loop(
          Animated.sequence([
            Animated.timing(bar, { toValue: peak, duration: half, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
            Animated.timing(bar, { toValue: low, duration: half * 1.1, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          ]),
        ),
      ]);
    });
    const all = Animated.parallel(loops);
    all.start();
    return () => all.stop();
  }, [active, reduce, bars]);

  return (
    <View style={styles.wave}>
      {bars.map((scaleY, i) => {
        // As pontas mais fracas e o miolo cheio dão à onda um "formato" de fala.
        const edge = 1 - Math.abs(i - (bars.length - 1) / 2) / ((bars.length - 1) / 2);
        return <Animated.View key={i} style={[styles.bar, { opacity: 0.45 + edge * 0.55, transform: [{ scaleY }] }]} />;
      })}
    </View>
  );
}

/** Botão de ouvir: o ícone troca com fundido, o fundo vira acento e um halo pulsa enquanto toca. */
function PlayButton({
  playing,
  loading,
  progress,
  name,
  onPress,
}: {
  playing: boolean;
  loading: boolean;
  progress: Animated.Value;
  name: string;
  onPress: () => void;
}) {
  const colors = useTheme();
  const styles = useStyles();
  const reduce = useReduceMotion();
  const on = useToggleProgress(playing, 200);
  const [halo] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!playing || loading || reduce) {
      halo.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(halo, { toValue: 1, duration: 1500, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [playing, loading, reduce, halo]);

  return (
    <View style={styles.playWrap}>
      {/* O anel e o halo só existem enquanto a voz toca: montá-los em toda linha pesava na troca de categoria. */}
      {playing ? (
        <>
        <Animated.View pointerEvents="none" style={[styles.ring, { opacity: on }]}>
          <Svg width={RING} height={RING} viewBox={`0 0 ${RING} ${RING}`}>
            <Circle cx={RING / 2} cy={RING / 2} r={RING_R} stroke={colors.accent} strokeOpacity={0.2} strokeWidth={3} fill="none" />
            <AnimatedCircle
              cx={RING / 2}
              cy={RING / 2}
              r={RING_R}
              stroke={colors.accent}
              strokeWidth={3}
              strokeLinecap="round"
              fill="none"
              strokeDasharray={RING_C}
              strokeDashoffset={progress.interpolate({ inputRange: [0, 1], outputRange: [RING_C, 0] })}
              transform={`rotate(-90 ${RING / 2} ${RING / 2})`}
            />
          </Svg>
        </Animated.View>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.halo,
            {
              opacity: halo.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.4, 0] }),
              transform: [{ scale: halo.interpolate({ inputRange: [0, 1], outputRange: [1, 1.7] }) }],
            },
          ]}
        />
        </>
      ) : null}
      <PressableScale
        onPress={onPress}
        scaleTo={0.88}
        hitSlop={Spacing.one}
        style={styles.play}
        accessibilityRole="button"
        accessibilityLabel={`${playing ? 'Pause' : 'Play'} ${name}`}
      >
        <Animated.View pointerEvents="none" style={[styles.playOnLayer, { opacity: on }]} />
        <Animated.View
          style={[
            styles.iconSlot,
            {
              opacity: on.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
              transform: [{ scale: on.interpolate({ inputRange: [0, 1], outputRange: [1, 0.5] }) }],
            },
          ]}
        >
          <IconPlay size={16} sw={2} color={colors.ink} />
        </Animated.View>
        <Animated.View
          style={[
            styles.iconSlot,
            { opacity: on, transform: [{ scale: on.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) }] },
          ]}
        >
          {loading ? (
            <ActivityIndicator size="small" color={colors.onAccent} />
          ) : (
            <IconPause size={16} sw={3} color={colors.onAccent} />
          )}
        </Animated.View>
      </PressableScale>
    </View>
  );
}

/** "Use <nome>": acende quando há voz escolhida e dá um pequeno pulo a cada troca de nome. */
function UseButton({ name, onPress }: { name: string | null; onPress: () => void }) {
  const styles = useStyles();
  const ready = useToggleProgress(name !== null, 240);
  const reduce = useReduceMotion();
  const [bump] = useState(() => new Animated.Value(1));
  const first = useRef(true);

  useEffect(() => {
    // Sem pulo na montagem, nem quando a pessoa pediu menos movimento.
    if (first.current) {
      first.current = false;
      return;
    }
    if (reduce || name === null) return;
    bump.setValue(0.94);
    const run = Animated.spring(bump, { toValue: 1, damping: 10, stiffness: 240, mass: 0.7, useNativeDriver: true });
    run.start();
    return () => run.stop();
  }, [name, reduce, bump]);

  return (
    <Animated.View
      style={{
        opacity: ready.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }),
        transform: [{ scale: bump }],
      }}
    >
      <PressableScale
        onPress={onPress}
        disabled={name === null}
        scaleTo={0.97}
        style={styles.use}
        accessibilityRole="button"
        accessibilityState={{ disabled: name === null }}
      >
        <Text style={styles.useText}>{name ? `Use ${name}` : 'Pick a voice'}</Text>
      </PressableScale>
    </Animated.View>
  );
}

const useStyles = makeStyles((colors) => ({
  flex: { flex: 1 },
  root: { flex: 1, justifyContent: 'flex-end' },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(26, 23, 20, 0.5)' },
  sheet: {
    maxHeight: '88%',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: colors.card,
    paddingHorizontal: 20,
    paddingTop: Spacing.two,
  },
  // Com o teclado aberto a folha encolhe para caber acima dele; fechado, ocupa a altura confortável de sempre.
  sheetIdle: { minHeight: '70%' },
  sheetTyping: { minHeight: 0 },
  grab: { paddingBottom: 2 },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, marginBottom: Spacing.three },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  title: { fontFamily: Fonts.bold, fontSize: 22, lineHeight: 28, color: colors.ink },
  sub: { fontFamily: Fonts.medium, fontSize: 13, color: colors.ink2 },
  close: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    height: 48,
    marginTop: Spacing.three,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.lg,
    backgroundColor: colors.bg,
  },
  // Cobre a borda toda do campo; só a opacidade anima.
  searchFocusRing: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderColor: colors.accent,
  },
  searchInput: { flex: 1, fontFamily: Fonts.medium, fontSize: 15, color: colors.ink, paddingVertical: 0 },
  clear: { width: 18, height: 18, borderRadius: 9, backgroundColor: colors.ink3, alignItems: 'center', justifyContent: 'center' },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  filterBtn: { width: 48, height: 48, marginTop: Spacing.three, borderRadius: Radius.lg, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', overflow: 'visible' },
  filterBtnOn: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: Radius.lg, backgroundColor: colors.accentFill },
  filterBadge: {
    position: 'absolute',
    top: -5,
    right: -5,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: colors.card,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBadgeText: { fontFamily: Fonts.bold, fontSize: 10, lineHeight: 12, color: colors.card },
  panel: { marginBottom: 12, padding: 14, gap: 8, borderRadius: Radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  panelLabel: { fontFamily: Fonts.bold, fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase', color: colors.ink3, marginTop: 4 },
  panelChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  panelClear: { alignSelf: 'flex-start', paddingVertical: 6 },
  panelClearText: { fontFamily: Fonts.bold, fontSize: 13, color: colors.accent },
  fchip: { height: 34, paddingHorizontal: 14, borderRadius: Radius.pill, borderWidth: 1, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  fchipOn: { position: 'absolute', top: -1, left: -1, right: -1, bottom: -1, borderRadius: Radius.pill, backgroundColor: colors.accentFill, alignItems: 'center', justifyContent: 'center' },
  fchipText: { fontFamily: Fonts.bold, fontSize: 13, color: colors.ink2 },
  fchipTextOn: { color: colors.onAccent },
  heart: { width: 32, height: 40, alignItems: 'center', justifyContent: 'center' },
  catsWrap: { flexGrow: 0, flexShrink: 0, height: 36, marginTop: 12 },
  cats: { gap: Spacing.two, paddingRight: Spacing.three },
  cat: {
    height: 36,
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // -1 cobre a borda do chip: posição absoluta começa por dentro dela.
  catOnLayer: {
    position: 'absolute',
    top: -1,
    left: -1,
    right: -1,
    bottom: -1,
    borderRadius: Radius.pill,
    backgroundColor: colors.accentFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  catText: { fontFamily: Fonts.bold, fontSize: 13, color: colors.ink2 },
  catTextOn: { color: colors.onAccent },
  list: { marginTop: 12 },
  listContent: { paddingBottom: Spacing.three },
  rows: { gap: 10 },
  empty: { fontFamily: Fonts.medium, fontSize: 14, color: colors.ink2, textAlign: 'center', paddingVertical: Spacing.four },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  rowOnLayer: {
    position: 'absolute',
    top: -1,
    left: -1,
    right: -1,
    bottom: -1,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  gender: { flexDirection: 'row', height: 40, padding: 4, borderRadius: Radius.pill, backgroundColor: colors.bg },
  genderThumb: {
    position: 'absolute',
    top: 4,
    left: 4,
    bottom: 4,
    borderRadius: Radius.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  genderItem: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  genderText: { fontFamily: Fonts.bold, fontSize: 13, color: colors.ink2 },
  genderTextOn: { color: colors.ink },
  tick: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.card,
    backgroundColor: colors.accentFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { fontFamily: Fonts.bold, fontSize: 16, lineHeight: 22, color: colors.ink },
  descSlot: { height: WAVE_H, justifyContent: 'center' },
  desc: { fontFamily: Fonts.medium, fontSize: 12, lineHeight: 16, color: colors.ink2 },
  waveSlot: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center' },
  wave: { flexDirection: 'row', alignItems: 'center', gap: 2.5, height: WAVE_H },
  bar: { width: 3, height: WAVE_H, borderRadius: 2, backgroundColor: colors.accent },
  playWrap: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', width: RING, height: RING },
  halo: { position: 'absolute', width: 40, height: 40, borderRadius: 20, backgroundColor: colors.accentFill },
  play: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  playOnLayer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 20, backgroundColor: colors.accentFill },
  iconSlot: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  use: { height: 52, marginTop: Spacing.two, borderRadius: Radius.lg, backgroundColor: colors.accentFill, alignItems: 'center', justifyContent: 'center' },
  useText: { fontFamily: Fonts.bold, fontSize: 15, color: colors.onAccent },
}));
