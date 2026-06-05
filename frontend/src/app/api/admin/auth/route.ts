import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const { username, password } = await req.json();

  const validUser = process.env.ADMIN_USERNAME;
  const validPass = process.env.ADMIN_PASSWORD;

  if (!validUser || !validPass) {
    return NextResponse.json(
      {
        error:
          "Admin auth non configurata. Imposta ADMIN_USERNAME e ADMIN_PASSWORD in .env.local",
      },
      { status: 503 }
    );
  }

  if (username === validUser && password === validPass) {
    const session = {
      username,
      loggedAt: new Date().toISOString(),
      token: crypto.randomUUID(),
    };
    return NextResponse.json({ success: true, session });
  }

  return NextResponse.json(
    { error: "Credenziali non valide" },
    { status: 401 }
  );
}
