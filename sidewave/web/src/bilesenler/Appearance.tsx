import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Check, ImagePlus, Upload, X } from "lucide-react";

export const BACKGROUNDS=[
 {id:'midnight-coast',name:'Midnight Coast'},
 {id:'analog-drift',name:'Analog Drift'},
 {id:'desert-afterglow',name:'Desert Afterglow'},
 {id:'deep-orbit',name:'Deep Orbit'},
].map(p=>({...p,url:'/artwork/wallpapers/'+p.id+'-v1.webp'}));

const imageKey = "sidewave-wallpaper";
const settingsKey = "sidewave-appearance";
const defaults = { dim: 35, transparency: 70 };
function readImage() {
  try {
    const local=localStorage.getItem(imageKey);
    const value=local!==null ? local : JSON.parse(localStorage.getItem("sidewave-appearance-server") || "null")?.wallpaperUrl;
    return typeof value==="string" && (BACKGROUNDS.some(p=>p.url===value)||value.startsWith("data:image/jpeg;base64,") || /^\/api\/v1\/appearance\/wallpaper\/[a-f0-9]{64}\.jpg$/.test(value)) ? value : "";
  } catch { return ""; }
}

function readSettings() {
  try {
    const value = JSON.parse(localStorage.getItem(settingsKey) || "null");
    return {
      dim: Number.isFinite(value?.dim) ? Math.max(0, Math.min(80, value.dim)) : defaults.dim,
      transparency: Number.isFinite(value?.transparency) ? Math.max(20, Math.min(90, value.transparency)) : defaults.transparency,
    };
  } catch { return defaults; }
}

export function useAppearance() {
  const [wallpaper,setWallpaper]=useState(readImage);
  const [settings,setSettings]=useState(readSettings);
  const [error,setError]=useState("");
  const saveImage=async(value:string)=>{
    try {localStorage.setItem(imageKey,value);setWallpaper(value);setError("");}
    catch {const message="Could not save this image. Try a smaller file or check your browser storage.";setError(message);throw new Error(message);}
  };
  const change=(key:keyof typeof defaults,value:number)=>{
    const next={...settings,[key]:value};
    try {localStorage.setItem(settingsKey,JSON.stringify(next));setSettings(next);setError("");}
    catch {setError("Could not save these settings in this browser.");}
  };
  useEffect(()=>{
    // Pin the last displayed choice locally once; no shared appearance requests are made.
    try {if(localStorage.getItem(imageKey)===null)localStorage.setItem(imageKey,readImage());} catch { /* Selection remains usable in memory. */ }
    const sync=(event:StorageEvent)=>{if(event.key===imageKey||event.key===null)setWallpaper(readImage());if(event.key===settingsKey||event.key===null)setSettings(readSettings());};
    window.addEventListener("storage",sync);return()=>window.removeEventListener("storage",sync);
  },[]);
  const style={"--wallpaper-image":wallpaper?`url("${wallpaper}")`:"none","--wallpaper-dim":settings.dim/100,"--glass-opacity":1-settings.transparency/100} as CSSProperties;
  return {wallpaper,settings,style,error,saving:false,saveImage,change};
}

async function prepareImage(file: File) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Choose a JPG, PNG or WebP image.");
  if (file.size > 25 * 1024 * 1024) throw new Error("Images must be smaller than 25 MB.");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url;
    await image.decode();
    const scale = Math.min(1, 1920 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Your browser could not prepare this image.");
    context.fillStyle = "#101513"; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", .85);
  } finally { URL.revokeObjectURL(url); }
}

export function AppearanceSettings({ appearance, onClose }: { appearance: ReturnType<typeof useAppearance>; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const active = useRef(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    active.current = true;
    const previous = document.activeElement;
    dialog.current?.showModal();
    return () => { active.current = false; if (previous instanceof HTMLElement) previous.focus(); };
  }, []);
  const choose = async (file?: File) => {
    if (!file) return;
    setBusy(true); setError("");
    try { const result = await prepareImage(file); if (active.current) await appearance.saveImage(result); }
    catch (e) { if (active.current) setError(e instanceof Error && e.name !== "EncodingError" ? e.message : "Could not open this image. Choose another file."); }
    finally { if (active.current) setBusy(false); }
  };
  return <dialog ref={dialog} onClose={onClose} className="experience-dialog appearance-dialog" aria-labelledby="appearance-title">
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between gap-3"><div><p className="eyebrow mb-2">MAKE IT YOURS</p><h2 id="appearance-title" className="text-xl font-semibold">Appearance</h2></div><button className="utility-button" aria-label="Close appearance" onClick={onClose}><X size={20} /></button></div>
      <p className="text-sm text-muted-foreground">Set the mood. Choose a background that feels like you.</p>
      <div className="background-gallery" role="group" aria-label="Signature backgrounds">{BACKGROUNDS.map(p=><button key={p.id} disabled={busy} aria-label={p.name} aria-pressed={appearance.wallpaper===p.url} onClick={()=>{setError('');void appearance.saveImage(p.url).catch(()=>{});}}><img src={p.url} alt="" loading="lazy"/><span>{p.name}</span>{appearance.wallpaper===p.url&&<i><Check size={14}/></i>}</button>)}</div>
      <div className="wallpaper-preview" style={{ backgroundImage: appearance.wallpaper ? `linear-gradient(oklch(0 0 0 / ${appearance.settings.dim / 100}), oklch(0 0 0 / ${appearance.settings.dim / 100})), url("${appearance.wallpaper}")` : undefined }}>
        {appearance.wallpaper ? <div className="wallpaper-preview-card" style={{ background: `oklch(.16 .01 160 / ${1 - appearance.settings.transparency / 100})` }}><ImagePlus size={20} /><span>Your music. Your space.</span></div> : <div className="flex flex-col items-center gap-3 text-muted-foreground"><ImagePlus size={32} /><span className="text-sm">Your background will appear here</span></div>}
      </div>
      <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" aria-label="Background image file" className="sr-only" disabled={busy} onChange={e => { void choose(e.target.files?.[0]); e.target.value = ""; }} />
      <div className="flex flex-wrap gap-2"><button className="button-primary inline-flex items-center gap-2" disabled={busy} onClick={() => fileInput.current?.click()}><Upload size={16} />{busy ? "Preparing image…" : appearance.wallpaper ? "Change image" : "Upload an image"}</button><button className="button-secondary disabled:opacity-40" disabled={busy || appearance.saving || !appearance.wallpaper} onClick={() => { setError(""); void appearance.saveImage("").catch(() => {}); }}>Remove</button></div>
      <p className="text-xs text-muted-foreground">JPG, PNG or WebP · Up to 25 MB. Saved on this device.</p>
      <fieldset disabled={!appearance.wallpaper || busy} className="space-y-5 disabled:opacity-40">
        <label className="block text-sm"><span className="flex justify-between mb-3"><span>Background dimming</span><span>{appearance.settings.dim}%</span></span><input aria-label="Background dimming" className="appearance-range" type="range" min="0" max="80" value={appearance.settings.dim} onChange={e => appearance.change("dim", Number(e.target.value))} /></label>
        <label className="block text-sm"><span className="flex justify-between mb-3"><span>Panel transparency</span><span>{appearance.settings.transparency}%</span></span><input aria-label="Panel transparency" className="appearance-range" type="range" min="20" max="90" value={appearance.settings.transparency} onChange={e => appearance.change("transparency", Number(e.target.value))} /></label>
      </fieldset>
      {(error || appearance.error) && <p role="alert" className="text-sm text-destructive">{error || appearance.error}</p>}
      <p className="text-xs text-muted-foreground">Your phone and desktop can each have their own look.</p>
    </div>
  </dialog>;
}
