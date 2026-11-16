// ~1 s brand animation on launch.
export function Splash() {
  return (
    <div className="splash">
      <div className="splash-mark">🗝</div>
      <div className="splash-word">
        {"Sectauri".split("").map((ch, i) => (
          <span key={i} style={{ animationDelay: `${i * 45}ms` }}>
            {ch}
          </span>
        ))}
      </div>
    </div>
  );
}
