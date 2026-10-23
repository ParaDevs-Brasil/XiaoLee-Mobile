import { Text, View } from 'react-native';

import { ScreenShell } from '@/components/screen-shell';

export default function StudioScreen() {
  return (
    <ScreenShell>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Text>Studio</Text>
      </View>
    </ScreenShell>
  );
}
