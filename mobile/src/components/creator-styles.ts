import { StyleSheet } from 'react-native';

import { Fonts, Radius, Spacing } from '@/constants/theme';
import { makeStyles } from '@/hooks/use-theme';

/** Estilos das telas de criadores sintéticos (`app/creators/*`). */
export const useCreatorStyles = makeStyles((colors) => ({
  content: { paddingHorizontal: Spacing.three - 4, paddingTop: Spacing.four, gap: Spacing.three - 4 },
  input: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.pill,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    fontFamily: Fonts.sans,
    fontSize: 14,
    color: colors.ink,
  },
  primary: {
    alignItems: 'center',
    paddingVertical: Spacing.two + 2,
    borderRadius: Radius.pill,
    backgroundColor: colors.accentFill,
  },
  disabled: { opacity: 0.5 },
  btnText: { fontFamily: Fonts.bold, fontSize: 13, color: colors.onAccent },
  cancel: { fontFamily: Fonts.bold, fontSize: 12, color: colors.ink3, textAlign: 'center' },
  error: { fontFamily: Fonts.sans, fontSize: 13, color: colors.ink2 },
  note: { fontFamily: Fonts.sans, fontSize: 13, color: colors.ink2, textAlign: 'center' },
  label: { fontFamily: Fonts.bold, fontSize: 12, color: colors.ink2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one + 2,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  chipActive: { backgroundColor: colors.accentFill, borderColor: colors.accentFill },
  chipText: { fontFamily: Fonts.sans, fontSize: 12, color: colors.ink },
  chipTextActive: { color: colors.onAccent, fontFamily: Fonts.bold },
  photoPick: {
    height: 220,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    overflow: 'hidden',
  },
  photo: { width: '100%', height: '100%' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
    padding: Spacing.two + 2,
    borderRadius: Radius.md,
    backgroundColor: colors.bg,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  rowBody: { flex: 1, gap: 2 },
  thumb: { width: 44, height: 64, borderRadius: Radius.sm, backgroundColor: colors.border },
  provider: { fontFamily: Fonts.bold, fontSize: 14, color: colors.ink },
  desc: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 18, color: colors.ink2 },
}));
