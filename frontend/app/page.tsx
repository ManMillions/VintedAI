"use client";

import { AuthBox } from "../components/AuthBox";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useDropzone } from "react-dropzone";
import { supabase } from "../lib/supabase";

type ResultatArticle = { article: number; photos: number; annonce: string };
type ApiResponse = { articles_detectes?: number; resultats?: ResultatArticle[]; error?: string };
type HistoriqueItem = { id: string; date: string; data: ApiResponse };
type PreviewFile = { file: File; url: string; isSeparator: boolean };
type ArticlePreview = { article: number; coverUrl: string | null; photos: number };

async function detecterPhotoNoire(file: File): Promise<boolean> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 200;
      canvas.height = 200;  

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        resolve(false);
        return;
      }

      ctx.drawImage(img, 0, 0, 200, 200);

     function moyenneZone(x1: number, y1: number, x2: number, y2: number) {
       if (!ctx) return 255;

       const data = ctx.getImageData(x1, y1, x2 - x1, y2 - y1).data;
       let total = 0;
       let count = 0;

    for (let i = 0; i < data.length; i += 4) {
    const gris = (data[i] + data[i + 1] + data[i + 2]) / 3;
    total += gris;
    count++;
  }

  return total / count;
}

      const zones = [
        moyenneZone(0, 0, 50, 50),
        moyenneZone(150, 0, 200, 50),
        moyenneZone(0, 150, 50, 200),
        moyenneZone(150, 150, 200, 200),
        moyenneZone(70, 70, 130, 130),
      ];

      const coinsSombres = zones.slice(0, 4).every((z) => z < 45);
      const centreSombre = zones[4] < 65;
      const moyenneTotale = zones.reduce((a, b) => a + b, 0) / zones.length;

      URL.revokeObjectURL(url);
      resolve(coinsSombres && centreSombre && moyenneTotale < 45);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(false);
    };

    img.src = url;
  });
}

export default function Home() {
  const [items, setItems] = useState<PreviewFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [analyzingSeparators, setAnalyzingSeparators] = useState(false);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const [historique, setHistorique] = useState<HistoriqueItem[]>([]);
  const [solde, setSolde] = useState(0);
  const [rechargeOpen, setRechargeOpen] = useState(false);
  const [montantRecharge, setMontantRecharge] = useState("5");
  const prixParArticle = 0.05;
  const [stats, setStats] = useState<any>(null);

  useEffect(() => {
  async function chargerSolde() {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return;

    const { data } = await supabase
      .from("profiles")
      .select("balance")
      .eq("id", user.id)
      .single();

    if (data) {
      setSolde(Number(data.balance));
    }
  }
  async function chargerStats() {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return;

  const { data } = await supabase
    .from("user_stats")
    .select("*")
    .eq("id", user.id)
    .single();

  if (data) {
    setStats(data);
  }
}

chargerSolde();
chargerStats();
}, []);

  useEffect(() => {
    const saved = localStorage.getItem("vinted-history");
    if (saved) setHistorique(JSON.parse(saved));
  }, []);

  const files = useMemo(() => items.map((item) => item.file), [items]);

  const separatorCount = useMemo(
    () => items.filter((item) => item.isSeparator).length,
    [items]
  );

  const articlePreviews = useMemo<ArticlePreview[]>(() => {
    const previews: ArticlePreview[] = [];
    let currentPhotos: PreviewFile[] = [];

    function pushArticle() {
      if (currentPhotos.length === 0) return;

      previews.push({
        article: previews.length + 1,
        coverUrl: currentPhotos[0]?.url ?? null,
        photos: currentPhotos.length,
      });

      currentPhotos = [];
    }

    for (const item of items) {
      if (item.isSeparator) pushArticle();
      else currentPhotos.push(item);
    }

    pushArticle();
    return previews;
  }, [items]);

  const articlesDetectesAvantEnvoi = articlePreviews.length;
  const coutGeneration = articlesDetectesAvantEnvoi * prixParArticle;

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    setAnalyzingSeparators(true);
    setData(null);
    setCopied(null);

    const sortedFiles = [...acceptedFiles].sort((a, b) =>
      a.name.localeCompare(b.name)
    );

    const previews: PreviewFile[] = [];

    for (const file of sortedFiles) {
      previews.push({
        file,
        url: URL.createObjectURL(file),
        isSeparator: await detecterPhotoNoire(file),
      });
    }

    setItems(previews);
    setAnalyzingSeparators(false);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "image/*": [] },
  });

 async function sauvegarderSolde(nouveauSolde: number) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    alert("Tu dois être connecté.");
    return;
  }

  const arrondi = Math.round(nouveauSolde * 100) / 100;

  const { error } = await supabase
    .from("profiles")
    .update({
      balance: arrondi,
    })
    .eq("id", user.id);

  if (error) {
    console.error("Erreur sauvegarde solde :", error);
    alert("Erreur sauvegarde solde : " + error.message);
    return;
  }

  setSolde(arrondi);
}

  async function envoyer() {
    if (files.length === 0) return;

    if (solde < coutGeneration) {
      alert("Solde insuffisant");
      return;
    }

   const formData = new FormData();
files.forEach((file) => formData.append("files", file));

const {
  data: { user },
} = await supabase.auth.getUser();

if (!user) {
  alert("Tu dois être connecté pour générer.");
  return;
}

formData.append("user_id", user.id);

    setLoading(true);
    setData(null);
    setCopied(null);

    try {
      const response = await fetch("https://vintedai-luo0.onrender.com/analyser", {
        method: "POST",
        body: formData,
      });

      const json = await response.json();
      setData(json);
      const {
  data: { user },
} = await supabase.auth.getUser();

      if (json.resultats) {
        await sauvegarderSolde(solde - coutGeneration);

        const nouvelHistorique = [
          { id: Date.now().toString(), date: new Date().toLocaleString("fr-FR"), data: json },
          ...historique,
        ].slice(0, 20);

        setHistorique(nouvelHistorique);
        localStorage.setItem("vinted-history", JSON.stringify(nouvelHistorique));
      }
    } catch (err) {
      setData({ error: "Erreur de connexion avec l'API. Vérifie que le backend FastAPI est lancé." });
      console.error(err);
    }

    setLoading(false);
  }

  async function copierAnnonce(article: number, annonce: string) {
    await navigator.clipboard.writeText(annonce);
    setCopied(article);
    setTimeout(() => setCopied(null), 1800);
  }

  function telechargerTout() {
    if (!data?.resultats) return;

    const contenu = data.resultats
      .map((item) => `========================\nARTICLE ${item.article}\n========================\n\n${item.annonce}`)
      .join("\n\n\n");

    const blob = new Blob([contenu], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");

    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `annonces-vinted-${date}.txt`;
    a.click();

    URL.revokeObjectURL(url);
  }

  function viderPhotos() {
    items.forEach((item) => URL.revokeObjectURL(item.url));
    setItems([]);
    setData(null);
    setCopied(null);
  }

  function rechargerHistorique(item: HistoriqueItem) {
    setData(item.data);
    setCopied(null);
    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
  }

  function supprimerHistorique() {
    setHistorique([]);
    localStorage.removeItem("vinted-history");
  }

async function payerRechargeFictive() {
  const montant = parseFloat(montantRecharge.replace(",", "."));

  if (Number.isNaN(montant) || montant < 1) {
    alert("Montant minimum : 1 €");
    return;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    alert("Tu dois être connecté pour recharger.");
    return;
  }

  const response = await fetch(
    "https://vintedai-luo0.onrender.com/create-checkout-session",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: montant,
        user_id: user.id,
      }),
    }
  );

  const data = await response.json();

  if (data.url) {
    window.location.href = data.url;
  } else {
    alert("Erreur Stripe : " + data.error);
  }
}

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      {rechargeOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-950 p-6 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-2xl font-bold">Recharger le solde</h2>
              <button
                onClick={() => setRechargeOpen(false)}
                className="rounded-full border border-slate-700 px-3 py-1 text-slate-300 hover:bg-slate-800"
              >
                ✕
              </button>
            </div>

            <p className="mb-5 text-sm text-slate-400">
              Choisis un montant ou entre le montant que tu veux. Plus tard, ce bouton ouvrira Stripe.
            </p>

            <div className="mb-5 grid grid-cols-4 gap-3">
              {[5, 10, 20, 50].map((montant) => (
                <button
                  key={montant}
                  onClick={() => setMontantRecharge(montant.toString())}
                  className={`rounded-2xl border px-4 py-3 font-bold ${
                    montantRecharge === montant.toString()
                      ? "border-cyan-400 bg-cyan-400/20 text-cyan-200"
                      : "border-slate-800 bg-slate-900 text-slate-300 hover:border-cyan-400/50"
                  }`}
                >
                  {montant} €
                </button>
              ))}
            </div>

            <label className="mb-2 block text-sm font-semibold text-slate-300">
              Montant libre
            </label>

            <div className="mb-5 flex items-center rounded-2xl border border-slate-800 bg-slate-900 px-4">
              <input
                value={montantRecharge}
                onChange={(e) => setMontantRecharge(e.target.value)}
                className="w-full bg-transparent py-4 text-2xl font-bold outline-none"
                placeholder="1"
                inputMode="decimal"
              />
              <span className="text-2xl font-bold text-slate-400">€</span>
            </div>

            <button
              onClick={payerRechargeFictive}
              className="w-full rounded-2xl bg-cyan-400 px-6 py-4 font-bold text-slate-950 hover:bg-cyan-300"
            >
              Payer {Number.parseFloat(montantRecharge || "0").toFixed(2)} €
            </button>

            <p className="mt-4 text-xs text-slate-500">
              Mode test : aucun vrai paiement n&apos;est effectué pour l&apos;instant.
            </p>
          </div>
        </div>
      )}

      <section className="mx-auto max-w-6xl px-6 py-12">
        <div className="mb-10">
          <div className="mb-6 space-y-3">
  <div className="flex items-center gap-3">
    <div className="inline-flex rounded-full bg-emerald-500/15 px-4 py-2 text-emerald-300">
      💶 {solde.toFixed(2)} €
    </div>

    <button
      onClick={() => setRechargeOpen(true)}
      className="rounded-full bg-cyan-500/20 px-4 py-2 text-cyan-300 hover:bg-cyan-500/30"
    >
      Recharger
    </button>
  </div>

  {stats && (
    <div className="max-w-md rounded-2xl bg-slate-900/70 p-4 text-sm text-slate-300">
      <div>📦 Articles générés : {stats.articles_generated}</div>
      <div>💸 Dépensé : {Number(stats.total_spent).toFixed(2)} €</div>
      <div>
        📅 Compte créé :{" "}
        {new Date(stats.created_at).toLocaleDateString("fr-FR")}
      </div>
    </div>
  )}
</div>

          <div className="mb-3 inline-flex rounded-full border border-cyan-400/30 bg-cyan-400/10 px-4 py-2 text-sm text-cyan-300">
            Générateur d&apos;annonces Vinted par IA
          </div>

          <h1 className="mb-4 text-5xl font-bold tracking-tight md:text-7xl">
            VintedAI
          </h1>

          <p className="max-w-2xl text-lg text-slate-400">
            Glisse tes photos, mets une photo noire entre chaque article,
            et vérifie les séparateurs avant de lancer l&apos;analyse.
          </p>
        </div>

        <div className="grid gap-8 lg:grid-cols-[1fr_420px]">
          <div className="rounded-3xl border border-slate-800 bg-slate-900/70 p-6 shadow-2xl">
            <div
              {...getRootProps()}
              className={`flex min-h-56 cursor-pointer items-center justify-center rounded-3xl border-2 border-dashed p-10 text-center transition ${
                isDragActive
                  ? "border-cyan-300 bg-cyan-400/10"
                  : "border-cyan-500/70 bg-slate-950 hover:bg-slate-900"
              }`}
            >
              <input {...getInputProps()} />

              {isDragActive ? (
                <div>
                  <p className="text-2xl font-semibold text-cyan-300">
                    Dépose les photos ici
                  </p>
                  <p className="mt-2 text-slate-400">
                    Les séparateurs noirs seront détectés automatiquement.
                  </p>
                </div>
              ) : (
                <div>
                  <p className="text-2xl font-semibold">📷 Glisse tes photos ici</p>
                  <p className="mt-2 text-slate-400">
                    ou clique pour sélectionner plusieurs fichiers
                  </p>
                </div>
              )}
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-4">
              <div className="rounded-2xl bg-slate-950 p-4">
                <p className="text-sm text-slate-400">Photos</p>
                <p className="text-2xl font-bold">{items.length}</p>
              </div>
              <div className="rounded-2xl bg-slate-950 p-4">
                <p className="text-sm text-slate-400">Séparateurs</p>
                <p className="text-2xl font-bold text-cyan-300">{separatorCount}</p>
              </div>
              <div className="rounded-2xl bg-slate-950 p-4">
                <p className="text-sm text-slate-400">Articles</p>
                <p className="text-2xl font-bold text-emerald-300">{articlesDetectesAvantEnvoi}</p>
              </div>
              <div className="rounded-2xl bg-slate-950 p-4">
                <p className="text-sm text-slate-400">Prix</p>
                <p className="text-2xl font-bold text-yellow-300">{coutGeneration.toFixed(2)} €</p>
              </div>
            </div>

            {articlePreviews.length > 0 && (
              <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-950 p-4">
                <p className="mb-3 text-sm font-semibold text-slate-300">
                  Aperçu des articles détectés
                </p>

                <div className="flex gap-4 overflow-x-auto pb-2">
                  {articlePreviews.map((article) => (
                    <div
                      key={article.article}
                      className="min-w-32 rounded-2xl border border-slate-800 bg-slate-900 p-3"
                    >
                      <div className="aspect-square overflow-hidden rounded-xl bg-slate-950">
                        {article.coverUrl ? (
                          <img src={article.coverUrl} alt={`Article ${article.article}`} className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full items-center justify-center text-slate-500">—</div>
                        )}
                      </div>
                      <p className="mt-2 text-sm font-bold">Article {article.article}</p>
                      <p className="text-xs text-slate-400">{article.photos} photo(s)</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {analyzingSeparators && (
              <div className="mt-6 rounded-2xl border border-cyan-400/30 bg-cyan-400/10 p-4 text-cyan-200">
                Détection des séparateurs noirs...
              </div>
            )}

            <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
              <p className="text-sm text-slate-400">Ordre utilisé : noms de fichiers croissants.</p>

              <div className="flex gap-3">
                {items.length > 0 && (
                  <button
                    onClick={viderPhotos}
                    className="rounded-2xl border border-slate-700 px-5 py-3 font-bold text-slate-300 hover:bg-slate-800"
                  >
                    Vider
                  </button>
                )}

                <button
                  onClick={envoyer}
                  disabled={loading || items.length === 0 || analyzingSeparators}
                  className="rounded-2xl bg-cyan-400 px-6 py-3 font-bold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? "Analyse en cours..." : `Générer les annonces — ${coutGeneration.toFixed(2)} €`}
                </button>
              </div>
            </div>

            {items.length > 0 && (
              <div className="mt-6 max-h-[520px] overflow-auto rounded-2xl border border-slate-800 bg-slate-950 p-4">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {items.map((item, index) => (
                    <div
                      key={`${item.file.name}-${index}`}
                      className={`overflow-hidden rounded-2xl border ${
                        item.isSeparator ? "border-cyan-400 bg-cyan-400/10" : "border-slate-800 bg-slate-900"
                      }`}
                    >
                      <div className="relative aspect-square bg-slate-950">
                        <img src={item.url} alt={item.file.name} className="h-full w-full object-cover" />
                        {item.isSeparator && (
                          <div className="absolute inset-0 flex items-center justify-center bg-black/70">
                            <span className="rounded-full bg-cyan-400 px-3 py-1 text-sm font-bold text-slate-950">
                              Séparateur
                            </span>
                          </div>
                        )}
                      </div>
                      <div className="p-3">
                        <p className="truncate text-sm text-slate-300">{index + 1}. {item.file.name}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <aside className="space-y-6">
            <AuthBox />
            
            <div className="rounded-3xl border border-slate-800 bg-slate-900/70 p-6">
              <h2 className="mb-4 text-xl font-bold">Contrôle avant envoi</h2>
              <p className="text-slate-400">
                Avant de payer une requête API, vérifie que le nombre d&apos;articles estimés correspond bien à ton lot.
              </p>
              <div className="mt-6 space-y-3 rounded-2xl bg-slate-950 p-4 text-sm text-slate-300">
                <p>✅ Les photos normales restent en aperçu.</p>
                <p>⬛ Les photos noires sont marquées comme séparateurs.</p>
                <p>🖼️ Chaque article détecté a une miniature.</p>
                <p>💶 1 annonce = 0,05 €.</p>
              </div>
              <div className="mt-6 rounded-2xl bg-slate-950 p-4 text-sm text-slate-400">
                Limites actuelles : 20 photos maximum par article et 50 articles maximum par lot.
              </div>
            </div>

            <div className="rounded-3xl border border-slate-800 bg-slate-900/70 p-6">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-xl font-bold">Historique récent</h2>
                {historique.length > 0 && (
                  <button
                    onClick={supprimerHistorique}
                    className="rounded-xl border border-red-500/30 px-3 py-2 text-xs font-bold text-red-300 hover:bg-red-500/10"
                  >
                    Vider
                  </button>
                )}
              </div>

              {historique.length === 0 ? (
                <p className="text-sm text-slate-400">Aucune génération sauvegardée pour l&apos;instant.</p>
              ) : (
                <div className="max-h-96 space-y-3 overflow-auto">
                  {historique.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => rechargerHistorique(item)}
                      className="w-full rounded-2xl border border-slate-800 bg-slate-950 p-4 text-left hover:border-cyan-400/50"
                    >
                      <p className="font-bold text-white">{item.data.articles_detectes ?? 0} article(s)</p>
                      <p className="text-sm text-slate-400">{item.date}</p>
                      <p className="mt-2 text-xs text-cyan-300">Recharger cette génération</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </aside>
        </div>

        {loading && (
          <div className="mt-8 rounded-3xl border border-cyan-400/30 bg-cyan-400/10 p-6">
            <p className="font-semibold text-cyan-200">Analyse en cours...</p>
            <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-800">
              <div className="h-full w-1/2 animate-pulse rounded-full bg-cyan-400" />
            </div>
            <p className="mt-3 text-sm text-slate-400">Garde la page ouverte pendant la génération.</p>
          </div>
        )}

        {data?.error && (
          <div className="mt-8 rounded-3xl border border-red-500/40 bg-red-500/10 p-6 text-red-200">
            {data.error}
          </div>
        )}

        {data?.resultats && (
          <section className="mt-10">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-3xl font-bold">{data.articles_detectes} article(s) détecté(s)</h2>
                <p className="text-slate-400">Tes annonces sont prêtes à copier.</p>
              </div>

              <button
                onClick={telechargerTout}
                className="rounded-2xl border border-cyan-400/40 bg-cyan-400/10 px-5 py-3 font-bold text-cyan-200 hover:bg-cyan-400/20"
              >
                Télécharger tout en .txt
              </button>
            </div>

            <div className="space-y-6">
              {data.resultats.map((item) => {
                const preview = articlePreviews[item.article - 1];

                return (
                  <article key={item.article} className="rounded-3xl border border-slate-800 bg-slate-900/70 p-6">
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
                      <div className="flex items-center gap-4">
                        <div className="h-20 w-20 overflow-hidden rounded-2xl bg-slate-950">
                          {preview?.coverUrl ? (
                            <img src={preview.coverUrl} alt={`Article ${item.article}`} className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full items-center justify-center text-slate-500">—</div>
                          )}
                        </div>
                        <div>
                          <h3 className="text-2xl font-bold">Article {item.article}</h3>
                          <p className="text-sm text-slate-400">{item.photos} photo(s)</p>
                        </div>
                      </div>

                      <button
                        onClick={() => copierAnnonce(item.article, item.annonce)}
                        className="rounded-2xl bg-cyan-400 px-5 py-3 font-bold text-slate-950 hover:bg-cyan-300"
                      >
                        {copied === item.article ? "Copié !" : "Copier"}
                      </button>
                    </div>

                    <textarea
                      readOnly
                      value={item.annonce}
                      className="h-96 w-full rounded-2xl border border-slate-700 bg-slate-950 p-4 text-sm leading-relaxed text-white outline-none"
                    />
                  </article>
                );
              })}
            </div>
          </section>
        )}
      </section>
    </main>
  );
}
