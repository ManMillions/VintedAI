"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export function AuthBox() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [message, setMessage] = useState("");

  useEffect(() => {
    async function initUser() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      setUserEmail(user?.email ?? null);
    }

    initUser();

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserEmail(session?.user?.email ?? null);
    });

    return () => {
      data.subscription.unsubscribe();
    };
  }, []);

  async function handleAuth() {
    setMessage("");

    if (!email || !password) {
      setMessage("Entre un email et un mot de passe.");
      return;
    }

    if (mode === "signup") {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
      });

      if (error) {
        setMessage(error.message);
        return;
      }

      if (data.user) {
        await supabase.from("profiles").upsert(
          {
            id: data.user.id,
            balance: 10,
          },
          { onConflict: "id" }
        );

        await supabase.from("user_stats").upsert(
          {
            id: data.user.id,
            articles_generated: 0,
            total_spent: 0,
          },
          { onConflict: "id" }
        );
      }

      setMessage("Compte créé. Vérifie tes emails si Supabase demande confirmation.");
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setMessage(error.message);
    } else {
      setMessage("Connecté !");
      window.location.reload();
    }
  }

  async function resetPassword() {
    setMessage("");

    if (!email) {
      setMessage("Entre ton email avant de demander un reset.");
      return;
    }

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });

    if (error) {
      setMessage(error.message);
    } else {
      setMessage("Email de réinitialisation envoyé.");
    }
  }

  async function logout() {
    await supabase.auth.signOut();
    setUserEmail(null);
  }

  if (userEmail) {
    return (
      <div className="rounded-3xl border border-slate-800 bg-slate-900/70 p-5">
        <p className="text-sm text-slate-400">Connecté avec</p>
        <p className="font-bold text-white">{userEmail}</p>

        <button
          onClick={logout}
          className="mt-4 rounded-2xl border border-red-500/30 px-4 py-2 text-sm font-bold text-red-300 hover:bg-red-500/10"
        >
          Déconnexion
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-900/70 p-5">
      <h2 className="mb-4 text-xl font-bold">
        {mode === "login" ? "Connexion" : "Créer un compte"}
      </h2>

      <input
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email"
        className="mb-3 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 outline-none"
      />

      <input
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Mot de passe"
        type="password"
        className="mb-4 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 outline-none"
      />

      <button
        onClick={handleAuth}
        className="w-full rounded-2xl bg-cyan-400 px-5 py-3 font-bold text-slate-950 hover:bg-cyan-300"
      >
        {mode === "login" ? "Se connecter" : "Créer le compte"}
      </button>

      <button
        onClick={() => setMode(mode === "login" ? "signup" : "login")}
        className="mt-3 w-full text-sm text-cyan-300"
      >
        {mode === "login"
          ? "Pas encore de compte ? S'inscrire"
          : "Déjà un compte ? Se connecter"}
      </button>

      {mode === "login" && (
        <button
          onClick={resetPassword}
          className="mt-2 w-full text-sm text-slate-400 hover:text-cyan-300"
        >
          Mot de passe oublié ?
        </button>
      )}

      {message && <p className="mt-3 text-sm text-slate-400">{message}</p>}
    </div>
  );
}
