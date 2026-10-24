import { Modal, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import QRCodeStyled from 'react-native-qrcode-styled';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconAlert, IconCheck, IconClose, IconCopy, IconQr, IconShare } from '@/components/icons';
import { NETWORK_LABEL } from '@/components/network-badge';
import { ChunkedAddress, useCopyAddress } from '@/components/wallet-address-card';
import { CardShadow, Fonts, Radius, Spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/use-theme';
import { ARC_NETWORK } from '@/lib/arc-network';

/**
 * "Receive USDC" — o QR e o endereço completo da carteira embutida, para quem
 * vai pagar o creator.
 *
 * Só leitura: mostra, copia e compartilha o endereço. Nada aqui assina nem
 * move dinheiro.
 */

/**
 * O QR fica sempre em placa clara com módulos escuros, em qualquer tema: leitor
 * de QR lê mal código invertido (claro sobre escuro). Por isso dois hex soltos
 * aqui, contra a regra dos tokens — são os da paleta clara, fixos de propósito.
 */
const QR_PLATE = '#ffffff';
const QR_INK = '#1a1917';
const QR_EYE = '#d81b78';

export function ReceiveSheet({
  visible,
  address,
  onClose,
}: {
  visible: boolean;
  address: string;
  onClose: () => void;
}) {
  const colors = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const { copied, copy } = useCopyAddress(address);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { paddingBottom: Spacing.four + insets.bottom }]}
          onPress={(event) => event.stopPropagation()}
        >
          <View style={styles.handleBar} />

          <View style={styles.header}>
            <View style={styles.icon}>
              <IconQr size={20} color={colors.accent} />
            </View>
            <View style={styles.headerText}>
              <Text style={styles.title}>Receive USDC</Text>
              <Text style={styles.subtitle}>Scan or share your address</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={Spacing.two} accessibilityLabel="Close">
              <IconClose size={18} color={colors.ink3} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <View style={styles.plate} accessible accessibilityLabel="QR code of your wallet address">
              <QRCodeStyled
                data={address}
                size={196}
                padding={0}
                color={QR_INK}
                pieceBorderRadius={2}
                isPiecesGlued
                outerEyesOptions={{ borderRadius: 6, color: QR_INK }}
                innerEyesOptions={{ borderRadius: 3, color: QR_EYE }}
              />
            </View>

            <ChunkedAddress address={address} centered />

            <View style={styles.facts}>
              <Fact label="Network" value={NETWORK_LABEL} />
              <Fact label="Chain ID" value={String(ARC_NETWORK.chainId)} />
              <Fact label="Token" value="USDC" last />
            </View>

            <View style={styles.warning}>
              <IconAlert size={16} color={colors.warn} />
              <Text style={styles.warningText}>
                Send only USDC on {NETWORK_LABEL}. Funds sent on any other network can&apos;t be recovered.
              </Text>
            </View>

            <View style={styles.actions}>
              <Pressable
                onPress={copy}
                style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={copied ? 'Address copied' : 'Copy address'}
              >
                {copied ? (
                  <IconCheck size={16} sw={2.2} color={colors.onAccent} />
                ) : (
                  <IconCopy size={16} color={colors.onAccent} />
                )}
                <Text style={styles.primaryText}>{copied ? 'Copied' : 'Copy address'}</Text>
              </Pressable>

              <Pressable
                // Fechar o seletor sem escolher app rejeita em algumas versões
                // do Android — não é erro para o usuário.
                onPress={() => Share.share({ message: address }).catch(() => {})}
                style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="Share address"
              >
                <IconShare size={16} color={colors.ink} />
              </Pressable>
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Fact({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  const styles = useStyles();
  return (
    <View style={[styles.fact, !last && styles.factDivider]}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  backdrop: { flex: 1, backgroundColor: colors.scrim, justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '94%',
    gap: Spacing.three - 4,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...CardShadow,
  },
  handleBar: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: colors.border,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three - 4 },
  icon: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
  },
  headerText: { flex: 1 },
  title: { fontFamily: Fonts.bold, fontSize: 17, color: colors.ink },
  subtitle: { fontFamily: Fonts.sans, fontSize: 13, color: colors.ink2, marginTop: 1 },

  content: { gap: Spacing.three + 4, paddingTop: Spacing.two, alignItems: 'stretch' },
  plate: {
    alignSelf: 'center',
    padding: Spacing.three + 4,
    borderRadius: Radius.xl,
    backgroundColor: QR_PLATE,
    // No tema claro a placa é branca sobre o cartão branco — o fio a separa.
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },

  facts: {
    borderRadius: Radius.md,
    backgroundColor: colors.bg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  fact: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    height: 44,
  },
  factDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  factLabel: { fontFamily: Fonts.medium, fontSize: 13, color: colors.ink2 },
  factValue: { fontFamily: Fonts.bold, fontSize: 13, color: colors.ink },

  warning: {
    flexDirection: 'row',
    gap: Spacing.two + 2,
    padding: Spacing.three - 2,
    borderRadius: Radius.md,
    backgroundColor: colors.warnSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.warnBorder,
  },
  warningText: { flex: 1, fontFamily: Fonts.medium, fontSize: 12, lineHeight: 18, color: colors.warn },

  actions: { flexDirection: 'row', gap: Spacing.two },
  primary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    height: 52,
    borderRadius: Radius.pill,
    backgroundColor: colors.accentFill,
  },
  primaryText: { fontFamily: Fonts.bold, fontSize: 15, color: colors.onAccent },
  secondary: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
    backgroundColor: colors.bg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  pressed: { opacity: 0.8 },
}));
