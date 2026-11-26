"use client";
import { useState } from "react";
export default function Login() {
  const [pw, setPw] = useState(""); const [err, setErr] = useState("");
  return (
    <div className="min-h-screen grid place-items-center bg-slate-50 px-4">
      <form className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-sm" onSubmit={async (e) => { e.preventDefault(); const r = await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: pw }) }); if (r.ok) location.href = "/"; else setErr("Wrong password"); }}>
        <h1 className="text-lg font-semibold text-slate-900">SponsorOS</h1>
        <p className="mb-4 text-sm text-slate-500">Enter the team password.</p>
        <input type="password" className="input w-full" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus aria-label="Password" />
        {err && <p className="mt-2 text-sm text-rose-600">{err}</p>}
        <button className="btn-primary mt-4 w-full">Sign in</button>
      </form>
    </div>
  );
}
