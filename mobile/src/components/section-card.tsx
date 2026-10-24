import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { CardShadow, Fonts, Radius, Spacing } from '@/constants/theme';
import { makeStyles } from '@/hooks/use-theme';

/**
 * Cartão de seção — mesma anatomia do card do chat (`app/index.tsx`): borda de
 * um fio, raio 16 e um cabeçalho separado do corpo por uma linha.
 *
 * `overflow: 'hidden'` é o que faz o conteúdo respeitar o raio nos cantos;
 * sem ele uma lista com fundo próprio vaza pelas quinas no Android.
 */

interface SectionCardProps {
  title: string;
  subtitle?: string;
  /** Ícone à esquerda do título. */
  icon?: ReactNode;
  /** Canto direito do cabeçalho — normalmente um botão de recarregar. */
  action?: ReactNode;
  children: ReactNode;
}

export function SectionCard({ title, subtitle, icon, action, children }: SectionCardProps) {
  const styles = useStyles();
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        {icon}
        <View style={styles.headerText}>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        {action}
      </View>

      <View style={styles.body}>{children}</View>
    </View>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three - 2,
    paddingVertical: Spacing.two + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerText: { flex: 1 },
  title: { fontFamily: Fonts.bold, fontSize: 15, color: colors.ink },
  subtitle: { fontFamily: Fonts.sans, fontSize: 12, color: colors.ink2, marginTop: 1 },
  body: { padding: Spacing.two + 2, gap: Spacing.two },
}));
