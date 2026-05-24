import { useListMembers, type Member } from "@workspace/api-client-react";
import { Loader2 } from "lucide-react";

const ROLE_LABEL: Record<Member["role"], string> = {
  producer:   "Producer",
  engineer:   "Engineer",
  it:         "IT",
  integrator: "Integrator",
  manager:    "Manager",
  contractor: "Contractor",
};

// Stable per-name gradient so avatars don't reshuffle on refresh.
const GRADIENTS: Array<[string, string]> = [
  ["#a99bff", "#6d5cff"],
  ["#7cc1ff", "#3a7bff"],
  ["#5ce8ac", "#1ec98a"],
  ["#ffd97f", "#ffaa2b"],
  ["#ff9bb4", "#ff5d85"],
  ["#9ee9e0", "#2fded0"],
];

function pickGradient(seed: string): [string, string] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return GRADIENTS[Math.abs(h) % GRADIENTS.length];
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");
}

export default function MobileTeam() {
  const { data: members, isLoading } = useListMembers();

  return (
    <>
      <div className="mhead">
        <div className="k">Personnel Roster</div>
        <h2>Active crew</h2>
        <p>{isLoading ? "Loading…" : `${members?.length ?? 0} members`}</p>
      </div>

      {isLoading ? (
        <div className="m-glass" style={{ padding: 32, textAlign: "center" }}>
          <Loader2 className="w-5 h-5 animate-spin inline" />
        </div>
      ) : (members ?? []).length === 0 ? (
        <div className="mempty m-glass">
          <div className="orb" />
          <b>No crew yet</b>
          <span>Add members on a desktop to invite them.</span>
        </div>
      ) : (
        <div className="mteam">
          {(members ?? []).map((m) => {
            const [g1, g2] = pickGradient(m.name || String(m.id));
            return (
              <div key={m.id} className="row m-glass" data-testid={`mobile-member-${m.id}`}>
                {m.avatarUrl ? (
                  <div className="av" style={{ background: "none", padding: 0 }}>
                    <img src={m.avatarUrl} alt="" className="w-full h-full object-cover rounded-[13px]" />
                  </div>
                ) : (
                  <div className="av" style={{ ["--g1" as any]: g1, ["--g2" as any]: g2 }}>
                    {initials(m.name) || "?"}
                  </div>
                )}
                <div className="nm">
                  <b>{m.name}</b>
                  <span>
                    <span className="r">{ROLE_LABEL[m.role]}</span>
                    {m.title && <> · {m.title}</>}
                    {m.department && <> · {m.department}</>}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
