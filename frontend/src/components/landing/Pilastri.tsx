export default function Pilastri() {
  return (
    <section className="pilastri-section">
      {/* Titolo con linee luminose */}
      <div className="pilastri-title-row">
        <span className="pilastri-line" />
        <h2 className="pilastri-title">LE FONDAMENTA DELL&rsquo;ECOSÍNOSTRA</h2>
        <span className="pilastri-line" />
      </div>

      {/* Griglia 3 card */}
      <div className="pilastri-grid">
        {/* COMUNITÀ */}
        <div className="pilastro-card">
          <svg className="pilastro-icon" fill="none" stroke="currentColor" strokeWidth={1.2} viewBox="0 0 24 24">
            <circle cx="12" cy="8" r="3.5" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 20.5c0-3.5 3.2-6 7.5-6s7.5 2.5 7.5 6" />
            <circle cx="5" cy="10" r="2" />
            <circle cx="19" cy="10" r="2" />
            <path strokeLinecap="round" d="M2 18c0-2 1.5-3.5 3-3.5M22 18c0-2-1.5-3.5-3-3.5" />
          </svg>
          <h3 className="pilastro-title">COMUNITÀ</h3>
          <p className="pilastro-text">
            Costruiamo insieme un&rsquo;ecosínostra partecipativa basata sulla fiducia,
            la collaborazione e il dono.
          </p>
        </div>

        {/* VALORE */}
        <div className="pilastro-card">
          <svg className="pilastro-icon" fill="none" stroke="currentColor" strokeWidth={1.2} viewBox="0 0 24 24">
            <path strokeLinejoin="round" d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.27 5.82 22 7 14.14l-5-4.87 6.91-1.01L12 2z" />
            <path strokeLinejoin="round" d="M12 6l1.76 3.57 3.94.57-2.85 2.78.67 3.93L12 14.77l-3.52 2.08.67-3.93-2.85-2.78 3.94-.57L12 6z" />
          </svg>
          <h3 className="pilastro-title">VALORE</h3>
          <p className="pilastro-text">
            Creiamo e distribuiamo valore reale in modo equo,
            trasparente e sostenibile.
          </p>
        </div>

        {/* TECNOLOGIA */}
        <div className="pilastro-card">
          <svg className="pilastro-icon" fill="none" stroke="currentColor" strokeWidth={1.2} viewBox="0 0 24 24">
            <path strokeLinejoin="round" d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12" />
            <circle cx="12" cy="12" r="2.5" />
          </svg>
          <h3 className="pilastro-title">TECNOLOGIA</h3>
          <p className="pilastro-text">
            Sfruttiamo la tecnologia blockchain per garantire sicurezza,
            libertà e innovazione continua.
          </p>
        </div>
      </div>
    </section>
  );
}
