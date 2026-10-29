import { describe, expect, it } from "vitest";
import { kapakSrc } from "./api";

describe("artwork for imported and recently played recordings", () => {
  it("uses the exact YouTube recording thumbnail when artwork metadata is missing", () => {
    const src = kapakSrc({ id: "zdOLaYSgkSM", kaynak: "youtube" });
    expect(src).toBe("/api/yt/kapak?u=" + encodeURIComponent("https://i.ytimg.com/vi/zdOLaYSgkSM/hqdefault.jpg"));
  });
  it("keeps supplied album artwork and local cover IDs", () => {
    const url = "https://lh3.googleusercontent.com/album-cover";
    expect(kapakSrc({ id: "zdOLaYSgkSM", kaynak: "youtube", kapakUrl: url })).toBe("/api/yt/kapak?u=" + encodeURIComponent(url));
    expect(kapakSrc({ id: "track", kaynak: "kutuphane", kapakId: "album" }, 96)).toBe("/api/cover/album?size=96");
  });
  it("does not treat an artist, release ID or malformed ID as a video", () => {
    for (const id of ["MPREb_piinMLxuFsh", "UCEjV3Q-KQmjxSBpYFIAbISw", "bad/id?x=1"]) expect(kapakSrc({ id, kaynak: "youtube" })).toBeNull();
  });
  it("requests detailed album art at the displayed size while retaining crop and format", () => {
    const url = "https://lh3.googleusercontent.com/album=w120-h120-l90-rj";
    expect(decodeURIComponent(kapakSrc({ kapak: url }, 800)!)).toBe("/api/yt/kapak?u=https://lh3.googleusercontent.com/album=w800-h800-l90-rj");
    expect(decodeURIComponent(kapakSrc({ kapak: "https://yt3.ggpht.com/album=s120-c-k-c0x00ffffff-no-rj" }, 5000)!)).toContain("album=s1200-c-k-c0x00ffffff-no-rj");
  });
  it("keeps fixed thumbnail variants and unrelated image URLs unchanged", () => {
    for (const url of ["https://i.ytimg.com/vi/zdOLaYSgkSM/hqdefault.jpg", "https://example.com/album=w120-h120", "https://googleusercontent.com.example.org/album=s120"]) {
      expect(kapakSrc({ kapak: url }, 800)).toBe("/api/yt/kapak?u=" + encodeURIComponent(url));
    }
  });
});
