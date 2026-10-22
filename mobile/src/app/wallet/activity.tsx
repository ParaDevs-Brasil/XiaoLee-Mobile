import { useRouter } from 'expo-router';

import { OnoffActivityView } from '@/components/onoff-activity-view';
import { ScreenShell } from '@/components/screen-shell';

/** Depósitos e saques do on/off-ramp — o tile "Activity" da Wallet. A lista vive em `components/onoff-activity-view.tsx`. */
export default function ActivityScreen() {
  const router = useRouter();
  return (
    <ScreenShell>
      <OnoffActivityView onBack={() => (router.canGoBack() ? router.back() : router.replace('/wallet'))} />
    </ScreenShell>
  );
}
