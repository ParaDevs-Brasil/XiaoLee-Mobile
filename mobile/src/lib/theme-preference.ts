/**
 * Só lógica pura — o storage fica em `lib/theme.tsx`. Assim o teste roda no
 * `node` direto, sem React Native (ver `npm test`).
 */
type ColorScheme = 'light' | 'dark';

/**
 * Preferência de tema escolhida no painel de perfil (XIAOLEEACE-13).
 *
 * `system` segue o aparelho e é o padrão — quem nunca abriu o seletor vê o
 * app no tema do celular. `light`/`dark` fixam o tema independente dele.
 */
export type ThemePreference = 'system' | 'light' | 'dark';

export const THEME_PREFERENCES: readonly ThemePreference[] = ['light', 'dark', 'system'];

/**
 * Tema efetivo. `system` vem do RN como `'light' | 'dark' | 'unspecified'`
 * (ou `null` no web antes de hidratar); qualquer coisa que não seja `dark`
 * cai no claro, que é o tema de origem do design system.
 */
export function resolveScheme(
  preference: ThemePreference,
  system: string | null | undefined,
): ColorScheme {
  if (preference !== 'system') return preference;
  return system === 'dark' ? 'dark' : 'light';
}

export function parsePreference(value: string | null | undefined): ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
}
