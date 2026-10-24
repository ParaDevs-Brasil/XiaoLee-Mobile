import { ActivityIndicator, ScrollView, Text, View, useWindowDimensions } from 'react-native';

import { fetchCampaignsAndParticipation } from '@/app/campaigns/index';
import { CampaignCard } from '@/components/campaign-card';
import { Fonts, Spacing } from '@/constants/theme';
import { useBackendData } from '@/hooks/use-backend-data';
import { useSession } from '@/hooks/use-session';
import { makeStyles } from '@/hooks/use-theme';
import type { CardCampaigns } from '@/lib/chat-cards';

/**
 * As campanhas que a Xiaolee acabou de listar, como os mesmos cartões da tela de Campaigns (Join, Verify, Claim):
 * o creator entra sem sair do chat. Só os ids vêm da conversa; os dados são buscados ao vivo, então o passo de cada
 * campanha (entrar, verificar, resgatar) está sempre em dia.
 */
export function CampaignsCard({ campaigns }: { campaigns: CardCampaigns }) {
  const styles = useStyles();
  const { width } = useWindowDimensions();
  const { hasSession } = useSession();
  const { data, loading, reload } = useBackendData(fetchCampaignsAndParticipation);

  const byId = new Map((data?.campaigns ?? []).map((c) => [c.id, c]));
  const shown = campaigns.ids.map((id) => byId.get(id)).filter((c) => c !== undefined);
  const participation = new Map((data?.mine ?? []).map((item) => [item.id, item]));
  const cardWidth = width - Spacing.three * 4;

  if (loading && !data) return <ActivityIndicator style={styles.loading} />;
  if (!shown.length) return <Text style={styles.empty}>Those campaigns are no longer open.</Text>;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      snapToInterval={cardWidth + Spacing.two}
      decelerationRate="fast"
      contentContainerStyle={styles.row}
    >
      {shown.map((campaign) => (
        <View key={campaign.id} style={{ width: cardWidth }}>
          <CampaignCard
            campaign={campaign}
            hasSession={hasSession}
            participation={participation.get(campaign.id)}
            onChanged={reload}
          />
        </View>
      ))}
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  row: { gap: Spacing.two, paddingRight: Spacing.three },
  loading: { padding: Spacing.three },
  empty: { fontFamily: Fonts.sans, fontSize: 13, color: colors.ink3, padding: Spacing.two },
}));
