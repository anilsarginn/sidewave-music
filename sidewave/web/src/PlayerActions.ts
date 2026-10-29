import { createContext, useContext } from 'react';
import type { Parca } from './api';

/** Queue actions available to every track list without threading props through each view. */
export type PlayerActions = {playNext: (track: Parca) => void; addToQueue: (track: Parca) => void; shuffleAll: (tracks: Parca[]) => void; smartShuffle?: (tracks: Parca[], recommended: Parca[]) => void; dismiss?: (track: Parca, scope?: "track" | "artist") => Promise<boolean>; owner: boolean};
export const PlayerActionsContext = createContext<PlayerActions | null>(null);
export const usePlayerActions = () => useContext(PlayerActionsContext);
