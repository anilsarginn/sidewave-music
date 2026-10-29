import { useCallback } from "react";
import { api, type Parca } from "../api";
import { useToast } from "./Toast";

/** Share a song: the phone share sheet on touch devices, otherwise copy the link. */
export function useShareTrack() {
  const toast = useToast();
  return useCallback(async (track: Parca) => {
    try {
      const {url} = await api.trackShare(track);
      if (navigator.share && matchMedia("(pointer:coarse)").matches) { try { await navigator.share({title: `${track.baslik} · ${track.sanatci}`, url}); return; } catch { /* Fall back to copying. */ } }
      await navigator.clipboard.writeText(url); toast("Song link copied.");
    } catch (e) { toast((e as Error).message || "Could not create a link."); }
  }, [toast]);
}
