import {
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  X,
} from "lucide-react";
import AeroShards from "@/components/AeroShards";
import type { IconType, Lead } from "@/mock/pipeline";

export function Logo({ compact = false }: { compact?: boolean }) {
  return <div className={`brand-lockup ${compact ? "compact" : ""}`}>
    <span className="brand-mark"><span>M</span></span>
    {!compact && <span className="brand-name">MadVoice <b>AI</b></span>}
  </div>;
}

export function AmbientShards({ variant = "dashboard" }: { variant?: "dashboard" | "agent" | "auth" }) {
  const settings = variant === "agent"
    ? { placement: "full" as const, flow: "vortex" as const, speed: 0.72, density: 0.9, shardSize: 0.9, interactionStrength: 0.28, bloom: 0.34 }
    : variant === "auth"
      ? { placement: "left" as const, flow: "ribbon" as const, speed: 0.5, density: 0.78, shardSize: 0.8, interactionStrength: 0.22, bloom: 0.28 }
      : { placement: "right" as const, flow: "stream" as const, speed: 0.65, density: 1.1, shardSize: 1, interactionStrength: 0.35, bloom: 0.45 };
  return <div className={`ambient-shards ambient-shards-${variant}`} aria-hidden="true"><AeroShards backgroundColor="#050608" shardColor="#334155" accentColor="#00F0FF" material="chrome" detail="balanced" effect="none" scale={1} spread={1} depth={1} speed={settings.speed} spin={0.8} interaction="repel" density={settings.density} shardSize={settings.shardSize} stretch={1} turbulence={0.8} glow={1} edgeSoftness={2} bloom={settings.bloom} grain={0.025} chromaticAberration={0.004} interactionRadius={1.5} interactionStrength={settings.interactionStrength} rippleIntensity={0.7} holdToGather paused={false} placement={settings.placement} flow={settings.flow} onError={() => undefined} /></div>;
}

export function Button({ children, variant = "secondary", onClick, icon: Icon, className = "", disabled = false, "aria-label": ariaLabel }: { children: React.ReactNode; variant?: "primary" | "secondary" | "ghost" | "danger"; onClick?: () => void; icon?: IconType; className?: string; disabled?: boolean; "aria-label"?: string }) {
  return <button disabled={disabled} onClick={onClick} aria-label={ariaLabel} className={`btn btn-${variant} ${className}`}>{Icon && <Icon size={15} />}{children}</button>;
}

export function IconView({ icon: Icon, size = 15 }: { icon: IconType; size?: number }) {
  return <Icon size={size} />;
}

export function Card({ children, className = "", glow = false, style }: { children: React.ReactNode; className?: string; glow?: boolean; style?: React.CSSProperties }) {
  return <section className={`card ${glow ? "card-glow" : ""} ${className}`} style={style}>{children}</section>;
}

export function TierBadge({ tier }: { tier: Lead["tier"] }) {
  return <span className={`tier tier-${tier.toLowerCase()}`}><i />{tier}</span>;
}

export function MetricCard({ label, value, delta, note, accent = "cyan", icon: Icon }: { label: string; value: string; delta: string; note: string; accent?: string; icon: IconType }) {
  return <Card className="metric-card">
    <div className="metric-top"><span className="metric-label">{label}</span><span className={`metric-icon metric-${accent}`}><Icon size={16} /></span></div>
    <div className="metric-value-row"><strong>{value}</strong><span className={`delta ${delta.startsWith("-") ? "down" : ""}`}>{delta.startsWith("-") ? <ArrowDownRight size={13} /> : <ArrowUpRight size={13} />}{delta.replace("-", "")}</span></div>
    <span className="metric-note">{note}</span>
  </Card>;
}

export function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return <div className="toast"><CheckCircle2 size={16} /><span>{message}</span><button onClick={onClose}><X size={14} /></button></div>;
}
