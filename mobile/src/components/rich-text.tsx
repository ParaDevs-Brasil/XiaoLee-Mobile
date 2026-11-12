import { Text, type StyleProp, type TextStyle } from 'react-native';

import { Fonts, Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { parseInline } from '@/lib/rich-text-core';

/**
 * Texto de uma resposta da Xiaolee com **negrito**, `código` e *itálico* já formatados (a IA responde em markdown).
 * Só para o que a IA escreve: o que o usuário digita fica como foi digitado.
 */
export function RichText({ text, style }: { text: string; style?: StyleProp<TextStyle> }) {
  const colors = useTheme();
  return (
    <Text style={style}>
      {parseInline(text).map((span, i) => (
        <Text
          key={i}
          style={[
            span.bold && { fontFamily: Fonts.bold },
            span.italic && { fontStyle: 'italic' },
            span.code && { fontFamily: Fonts.mono, backgroundColor: colors.bg, borderRadius: Radius.sm - 2 },
          ]}
        >
          {span.text}
        </Text>
      ))}
    </Text>
  );
}
