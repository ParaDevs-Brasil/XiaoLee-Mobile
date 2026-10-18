import { Text, View } from 'react-native';

import { Fonts, Spacing } from '@/constants/theme';
import { makeStyles } from '@/hooks/use-theme';

/**
 * Sparkline de barras para o rodapé de um `StatCard` — o "trend" do contrato de
 * stat tile: um valor grande, e embaixo dele a forma dos últimos pontos.
 *
 * É um gráfico de **ênfase**, não categórico: a série toda é contexto em cinza
 * e só o ponto mais recente usa o acento. Isso resolve duas coisas de uma vez —
 * o olho vai para a liquidação de agora (que é o que dá sensação de "ao vivo")
 * e o resto das barras não compete com o número herói logo acima.
 *
 * Sem legenda de propósito: com uma série só, a legenda repetiria a `caption`
 * e custaria altura que o cartão não tem.
 *
 * Sobre contraste: o cinza de contexto fica em 2.94:1 contra o branco do
 * cartão, logo abaixo do piso de 3:1 para objeto gráfico. O alívio previsto
 * nesse caso é a tabela — e ela existe na mesma tela, é o feed de pagamentos
 * logo abaixo, com cada valor e horário escritos. Nenhum dado vive só aqui.
 */

/** Teto das barras. Alto o bastante para ter forma, baixo para caber no cartão. */
const BAR_MAX_HEIGHT = 32;
/** Uma liquidação de valor baixo ainda precisa deixar traço, senão some. */
const MIN_BAR_HEIGHT = 3;

interface SparklineProps {
  /** Do mais antigo para o mais recente — o último é o que ganha o acento. */
  values: number[];
  /** Faz o papel do título: com uma série só, é o que diz o que está plotado. */
  caption: string;
}

export function Sparkline({ values, caption }: SparklineProps) {
  const styles = useStyles();
  const max = Math.max(...values);

  return (
    <View style={styles.wrap}>
      <View style={styles.bars}>
        {values.map((value, index) => {
          // O array é posicional e os valores repetem (vários pagamentos saem
          // pelo mesmo valor), então o índice é a identidade estável aqui.
          const isLatest = index === values.length - 1;
          // Guarda o caso de todas as liquidações terem saído por zero, que
          // faria a divisão virar NaN e a barra sumir.
          const ratio = max > 0 ? value / max : 0;

          return (
            <View
              key={index}
              style={[
                styles.bar,
                isLatest ? styles.barLatest : styles.barContext,
                { height: Math.max(MIN_BAR_HEIGHT, ratio * BAR_MAX_HEIGHT) },
              ]}
            />
          );
        })}
      </View>

      <Text style={styles.caption} numberOfLines={1}>
        {caption}
      </Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  wrap: { gap: Spacing.one + 2 },
  // `flex-end` ancora tudo numa linha de base só, que é o que torna as alturas
  // comparáveis entre si.
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: BAR_MAX_HEIGHT },
  bar: {
    flex: 1,
    // Ponta arredondada em cima, quadrada na base: a base é a linha zero e
    // arredondá-la faria a barra parecer flutuar acima dela.
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
  },
  barContext: { backgroundColor: colors.ink3 },
  barLatest: { backgroundColor: colors.accentFill },
  // O rótulo usa token de texto, nunca a cor da série: cor de dado em texto
  // fica ilegível e rouba a identidade da barra que está do lado.
  caption: { fontFamily: Fonts.sans, fontSize: 10, color: colors.ink3 },
}));
