import { useEffect } from 'react';
import { create } from 'zustand';

import { useWallet } from '@/hooks/use-wallet';
import { pickProfilePhoto, savedProfilePhoto } from '@/lib/profile-photo';

/**
 * Foto de perfil do usuário, a mesma em todo lugar: o "Edit profile", o
 * avatar do `ProfileMenu` e o card de compartilhar.
 *
 * Store global (zustand) e não estado local: trocar a foto na edição tem
 * que refletir no menu e no card sem esperar remontar nenhum dos dois. O
 * disco (`lib/profile-photo`) continua sendo a fonte — a store só lembra o
 * que já foi lido para cada carteira.
 */

interface PhotoState {
  /** Endereço → URI da foto (`null` = já lido, sem foto). */
  byAddress: Record<string, string | null>;
  busy: boolean;
  set: (address: string, uri: string | null) => void;
  setBusy: (busy: boolean) => void;
}

const usePhotoStore = create<PhotoState>((set) => ({
  byAddress: {},
  busy: false,
  set: (address, uri) =>
    set((state) => ({ byAddress: { ...state.byAddress, [address.toLowerCase()]: uri } })),
  setBusy: (busy) => set({ busy }),
}));

export function useProfilePhoto(): {
  /** URI da foto escolhida no aparelho, ou `null`. */
  photo: string | null;
  busy: boolean;
  /** Abre a galeria; `false` se o usuário cancelou ou não há carteira. */
  pick: () => Promise<boolean>;
  canPick: boolean;
} {
  const { address } = useWallet();
  const key = address?.toLowerCase();
  const photo = usePhotoStore((s) => (key ? s.byAddress[key] : undefined));
  const busy = usePhotoStore((s) => s.busy);

  // Primeira leitura do disco para esta carteira.
  useEffect(() => {
    if (!address || photo !== undefined) return;
    usePhotoStore.getState().set(address, savedProfilePhoto(address));
  }, [address, photo]);

  async function pick(): Promise<boolean> {
    if (!address) return false;
    const { set, setBusy } = usePhotoStore.getState();
    setBusy(true);
    try {
      const uri = await pickProfilePhoto(address);
      if (uri) set(address, uri);
      return Boolean(uri);
    } finally {
      setBusy(false);
    }
  }

  return { photo: photo ?? null, busy, pick, canPick: Boolean(address) };
}
