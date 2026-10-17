import { useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { Fonts } from '@/constants/theme';
import { makeStyles } from '@/hooks/use-theme';

interface OtpInputProps {
  value: string;
  onChangeText: (text: string) => void;
  onSubmitEditing?: (code?: string) => void;
  disabled?: boolean;
  hasError?: boolean;
  autoFocus?: boolean;
}

export function OtpInput({
  value,
  onChangeText,
  onSubmitEditing,
  disabled = false,
  hasError = false,
  autoFocus = true,
}: OtpInputProps) {
  const styles = useStyles();
  const inputRef = useRef<TextInput>(null);
  const [isInputFocused, setIsInputFocused] = useState(autoFocus);

  const digits = value.split('').slice(0, 6);
  while (digits.length < 6) {
    digits.push('');
  }

  const focusInput = () => {
    if (!disabled) {
      inputRef.current?.focus();
    }
  };

  return (
    <Pressable onPress={focusInput} style={styles.container}>
      {/* Input real invisível que recebe toques e teclado */}
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={(val) => {
          const cleaned = val.replace(/\D/g, '').slice(0, 6);
          onChangeText(cleaned);
          if (cleaned.length === 6) {
            onSubmitEditing?.(cleaned);
          }
        }}
        onSubmitEditing={() => onSubmitEditing?.(value)}
        onFocus={() => setIsInputFocused(true)}
        onBlur={() => setIsInputFocused(false)}
        autoFocus={autoFocus}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        maxLength={6}
        editable={!disabled}
        returnKeyType="go"
        style={styles.hiddenInput}
        accessibilityLabel="Verification code"
      />

      {/* 6 caixinhas visuais separadas */}
      <View style={styles.boxesRow} pointerEvents="none">
        {digits.map((digit, index) => {
          const isFocused = isInputFocused && value.length === index && !disabled;
          const isFilled = digit !== '';

          return (
            <View
              key={index}
              style={[
                styles.box,
                isFilled && styles.boxFilled,
                isFocused && styles.boxFocused,
                hasError && styles.boxError,
              ]}
            >
              <Text style={[styles.digit, hasError && styles.digitError]}>
                {digit}
              </Text>
            </View>
          );
        })}
      </View>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    width: '100%',
    alignItems: 'center',
    marginVertical: 4,
  },
  hiddenInput: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    opacity: 0.01,
    zIndex: 2,
  },
  boxesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    gap: 8,
  },
  box: {
    flex: 1,
    maxWidth: 48,
    height: 56,
    borderRadius: 14,
    borderWidth: 1.2,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxFilled: {
    borderColor: colors.borderStrong,
    backgroundColor: colors.card,
  },
  boxFocused: {
    borderColor: colors.accent,
    borderWidth: 1.8,
    backgroundColor: colors.accentSoft,
  },
  boxError: {
    borderColor: colors.danger,
    backgroundColor: colors.dangerSoft,
  },
  digit: {
    fontFamily: Fonts.bold,
    fontSize: 22,
    color: colors.ink,
    textAlign: 'center',
  },
  digitError: {
    color: colors.danger,
  },
}));
