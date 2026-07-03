import Link from "next/link";

// Route DEMO — anteprima visiva dei popup del gate ROG (non collegata al backend).
export default function PopupIndex() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 22,
        background: "#020711",
        color: "#c8e0ff",
        fontFamily: "sans-serif",
        padding: 24,
      }}
    >
      <h1 style={{ letterSpacing: 4, textTransform: "uppercase", fontSize: 22 }}>
        Demo Popup — Gate ROG
      </h1>
      <p style={{ opacity: 0.6, fontSize: 13, textAlign: "center", maxWidth: 420 }}>
        Anteprima visiva dei popup mostrati durante il flusso d&apos;ingresso URANUS.
      </p>
      <Link
        href="/popup/not-community"
        style={{
          padding: "16px 30px",
          borderRadius: 14,
          border: "1.5px solid rgba(255,68,68,.6)",
          color: "#ff6363",
          textDecoration: "none",
          fontWeight: 700,
          letterSpacing: 2,
          textTransform: "uppercase",
        }}
      >
        Popup ROSSO — not-community
      </Link>
      <Link
        href="/popup/need-rog-small"
        style={{
          padding: "16px 30px",
          borderRadius: 14,
          border: "1.5px solid rgba(255,171,0,.6)",
          color: "#ffcc00",
          textDecoration: "none",
          fontWeight: 700,
          letterSpacing: 2,
          textTransform: "uppercase",
        }}
      >
        Popup GIALLO — need-rog-small
      </Link>
    </main>
  );
}
