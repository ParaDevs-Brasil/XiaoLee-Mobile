import { Text, View } from 'react-native';

import { ScreenShell } from '@/components/screen-shell';

export default function GrowScreen() {
  return (
    <ScreenShell>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Text>Grow</Text>
      </View>
    </ScreenShell>
  );
}
