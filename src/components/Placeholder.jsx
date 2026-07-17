export default function Placeholder({ eyebrow, title, desc, phase, note }) {
  return (
    <div>
      <div className="page-head">
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h2 className="page-title">{title}</h2>
        {desc && <p className="page-desc">{desc}</p>}
      </div>
      <div className="card">
        <span className="badge badge-soon">{phase || 'Coming soon'}</span>
        {note && <div className="placeholder-note">{note}</div>}
      </div>
    </div>
  )
}
