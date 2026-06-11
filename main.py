from fastapi import FastAPI, UploadFile, File
from fastapi.responses import HTMLResponse
from typing import List
from openai import OpenAI
from PIL import Image
from dotenv import load_dotenv
from supabase import create_client
from fastapi import FastAPI, UploadFile, File, Form, Request
import base64
import os
import tempfile
import html
import stripe

load_dotenv()

stripe.api_key = os.getenv("STRIPE_SECRET_KEY")

supabase_admin = create_client(
    os.getenv("SUPABASE_URL"),
    os.getenv("SUPABASE_SERVICE_ROLE_KEY")
)

app = FastAPI()
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "https://vinted-ai-self.vercel.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))


def est_photo_noire(chemin):
    img = Image.open(chemin).convert("L")
    img = img.resize((200, 200))

    pixels = img.load()

    def moyenne_zone(x1, y1, x2, y2):
        valeurs = []
        for x in range(x1, x2):
            for y in range(y1, y2):
                valeurs.append(pixels[x, y])
        return sum(valeurs) / len(valeurs)

    zones = [
        moyenne_zone(0, 0, 50, 50),
        moyenne_zone(150, 0, 200, 50),
        moyenne_zone(0, 150, 50, 200),
        moyenne_zone(150, 150, 200, 200),
        moyenne_zone(70, 70, 130, 130),
    ]

    coins_sombres = all(z < 45 for z in zones[:4])
    centre_sombre = zones[4] < 65
    moyenne_totale = sum(zones) / len(zones)

    return coins_sombres and centre_sombre and moyenne_totale < 45


def compresser_image(chemin):
    img = Image.open(chemin).convert("RGB")

    max_size = 1600
    largeur, hauteur = img.size

    if largeur > max_size or hauteur > max_size:
        img.thumbnail((max_size, max_size))

    chemin_compresse = chemin + "_compressed.jpg"
    img.save(chemin_compresse, "JPEG", quality=85, optimize=True)

    return chemin_compresse


def encoder_image(chemin):
    with open(chemin, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")


def analyser_article(photos_article):
    content = [{
        "type": "input_text",
        "text": """
Tu es un expert Vinted.

Analyse toutes les photos comme UN SEUL article.

Objectif : créer une annonce Vinted propre, vendeuse, naturelle et honnête.

Règles importantes :
- Lis la marque si visible.
- Lis la taille si visible.
- Lis la matière/composition si visible sur l'étiquette.
- Si tu vois 100% coton, écris 100% coton.
- Lis les mesures si un mètre/ruban est visible.
- Ne jamais inventer une mesure.
- Ne jamais inventer une marque.
- Si une information n'est pas visible, écris "Non indiqué".
- Détecte les défauts : taches, trous, usure, bouloches, décoloration, imprimé abîmé.
- Très bon état = aucun trou, aucune tache visible, aucune déchirure.
- Les peluches, fibres, poussières ou légère usure normale restent en Très bon état.
- Bon état = tache visible, trou, déchirure, décoloration importante ou défaut marqué.
- Continue à détailler les imperfections même si l'état reste Très bon état.
- Si tache visible, trou, déchirure, décoloration importante ou défaut marqué : Bon état.
- Les petites traces d'usure doivent être signalées dans la description mais ne font pas forcément passer l'article en Bon état.
- Si défaut visible, le préciser clairement dans la description.
- Ne mets pas de crochets autour du titre.
- N'écris pas "voir photos".
- Fais des hashtags utiles.
- Ne jamais écrire seulement "Pull Nike noir M".
- Compatible vêtements, sacs, accessoires, objets, vaisselle, décoration.
- Ne crée jamais un lot sauf si plusieurs objets sont clairement vendus ensemble sur les photos.
- Si plusieurs articles différents semblent mélangés dans le même groupe, écrire : ERREUR : plusieurs articles détectés.
- Ne recopie jamais les consignes dans le résultat.

Règles Titre:
-Crée un titre long et optimisé SEO Vinted (80 à 100 caractères si possible).
-Ne jamais commencer par la marque.
-Structure recommandée : Type d'article + synonymes pertinents + marque + couleur + taille + matière si 100% coton.
-Ajouter des synonymes utiles à la recherche (hoodie, sweat, pull ; jean, denim ; short de bain, maillot de bain ; veste, blouson, etc.).
-Si la taille est inconnue : ne rien écrire concernant la taille.
-Si la marque est inconnue : ne pas inventer.
-Si la couleur est identifiable : l'ajouter.
-Écrire "100% coton" dans le titre uniquement si c'est réellement visible ou certain.
-Ne jamais écrire "taille non trouvée", "marque inconnue", "couleur inconnue" ou tout texte similaire.
-Le titre doit être naturel, lisible et optimisé pour apparaître dans un maximum de recherches Vinted.


Barème prix :
- Ne jamais afficher de prix.
- Ne jamais estimer de prix.

Format EXACT :

TITRE


✅ État : ...
🏷️ Taille : ...
📏 Longueur environ ... cm
📐 Largeur environ ... cm
🧵 Matière : ...
🎨 Détails visuels : ...
🌈 Couleur : ...
🔥 Style : ...

Petit paragraphe naturel qui décrit le vêtement et la vibe. 😊🌸

🧼 Vêtement lavé et prêt à porter
📦 Expédition rapide sous 24/48h
🤝 Réduction possible en lot

#hashtags
"""
    }]

    for photo in photos_article:
        photo_compressee = compresser_image(photo)

        content.append({
            "type": "input_image",
            "image_url": f"data:image/jpeg;base64,{encoder_image(photo_compressee)}"
        })

    response = client.responses.create(
        model="gpt-5-mini",
        input=[{"role": "user", "content": content}]
    )

    return response.output_text


@app.get("/", response_class=HTMLResponse)
async def home():
    return """
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <title>Vinted AI Generator</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            background: #0f172a;
            color: white;
            margin: 0;
            padding: 40px;
        }
        .box {
            max-width: 850px;
            margin: auto;
            background: #111827;
            padding: 35px;
            border-radius: 20px;
            box-shadow: 0 0 40px rgba(0,0,0,0.4);
        }
        h1 {
            font-size: 38px;
            margin-bottom: 10px;
        }
        p {
            color: #cbd5e1;
            line-height: 1.5;
        }
        .upload {
            border: 2px dashed #38bdf8;
            padding: 30px;
            border-radius: 16px;
            margin-top: 25px;
            background: #020617;
        }
        input {
            margin-top: 15px;
        }
        button {
            margin-top: 25px;
            padding: 15px 25px;
            border: none;
            border-radius: 12px;
            background: #38bdf8;
            color: #020617;
            font-weight: bold;
            cursor: pointer;
            font-size: 16px;
        }
        button:hover {
            background: #7dd3fc;
        }
        .hint {
            font-size: 14px;
            color: #94a3b8;
            margin-top: 15px;
        }
    </style>
</head>
<body>
    <div class="box">
        <h1>Générateur d’annonces Vinted</h1>
        <p>Importe tes photos dans l’ordre. Mets une photo noire entre chaque article.</p>

        <div class="upload">
            <form action="/analyser" enctype="multipart/form-data" method="post">
                <label>Sélectionne toutes tes photos :</label><br>
                <input name="files" type="file" multiple required>
                <br>
                <button type="submit">Générer les annonces</button>
            </form>

            <div class="hint">
                Exemple : article 1 → photo noire → article 2 → photo noire.
            </div>
        </div>
    </div>
</body>
</html>
"""


@app.post("/analyser")
async def analyser(user_id: str = Form(...), files: List[UploadFile] = File(...)):
    print("USER_ID RECU PAR ANALYSER =", user_id)

    prix_par_article = 0.05

    with tempfile.TemporaryDirectory() as tmp:
        chemins = []

        for file in files:
            chemin = os.path.join(tmp, file.filename)

            with open(chemin, "wb") as f:
                f.write(await file.read())

            chemins.append(chemin)

        chemins.sort(key=lambda p: os.path.basename(p).lower())

        groupes = []
        groupe_actuel = []

        for chemin in chemins:
            if est_photo_noire(chemin):
                if groupe_actuel:
                    groupes.append(groupe_actuel)
                    groupe_actuel = []
            else:
                groupe_actuel.append(chemin)

        if groupe_actuel:
            groupes.append(groupe_actuel)

        if not groupes:
            return {"error": "Aucun article détecté"}

        if len(groupes) > 50:
            return {"error": "Maximum 50 articles par lot"}

        for i, groupe in enumerate(groupes, start=1):
            if len(groupe) > 20:
                return {"error": f"Article {i} contient plus de 20 photos"}

        cout_total = round(len(groupes) * prix_par_article, 2)

        profile = (
            supabase_admin
            .table("profiles")
            .select("balance")
            .eq("id", user_id)
            .execute()
        )

        print("PROFILE TROUVE =", profile.data)

        if profile.data and len(profile.data) > 0:
            balance = float(profile.data[0]["balance"])
        else:
            return {"error": "Profil utilisateur introuvable. Déconnecte-toi puis reconnecte-toi."}

        if balance < cout_total:
            return {"error": "Solde insuffisant"}

        resultats = []

        for i, groupe in enumerate(groupes, start=1):
            annonce = analyser_article(groupe)
            resultats.append({
                "article": i,
                "photos": len(groupe),
                "annonce": annonce
            })

        nouveau_solde = round(balance - cout_total, 2)

        supabase_admin.table("profiles").update({
            "balance": nouveau_solde
        }).eq("id", user_id).execute()

        stats = (
            supabase_admin
            .table("user_stats")
            .select("articles_generated,total_spent")
            .eq("id", user_id)
            .execute()
        )

        if stats.data and len(stats.data) > 0:
            current_stats = stats.data[0]

            supabase_admin.table("user_stats").update({
                "articles_generated": current_stats["articles_generated"] + len(groupes),
                "total_spent": float(current_stats["total_spent"]) + cout_total
            }).eq("id", user_id).execute()
        else:
            supabase_admin.table("user_stats").insert({
                "id": user_id,
                "articles_generated": len(groupes),
                "total_spent": cout_total
            }).execute()

        return {
            "articles_detectes": len(groupes),
            "cout_total": cout_total,
            "nouveau_solde": nouveau_solde,
            "resultats": resultats
        }

@app.post("/create-checkout-session")
async def create_checkout_session(data: dict):
    try:
        amount = float(data["amount"])
        user_id = data["user_id"]

        session = stripe.checkout.Session.create(
            payment_method_types=["card"],
            mode="payment",
            line_items=[
                {
                    "price_data": {
                        "currency": "eur",
                        "product_data": {
                            "name": "Recharge VintedAI",
                        },
                        "unit_amount": int(amount * 100),
                    },
                    "quantity": 1,
                }
            ],
            metadata={
                "user_id": user_id,
                "amount": str(amount),
            },
            success_url="https://vinted-ai-self.vercel.app?payment=success",
            cancel_url="https://vinted-ai-self.vercel.app?payment=cancel",
        )

        return {"url": session.url}

    except Exception as e:
        return {"error": str(e)}
    
@app.post("/stripe-webhook")
async def stripe_webhook(request: Request):
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature")

    try:
        event = stripe.Webhook.construct_event(
            payload,
            sig_header,
            os.getenv("STRIPE_WEBHOOK_SECRET")
        )
    except Exception as e:
        return {"error": str(e)}

    if event["type"] == "checkout.session.completed":
        session = event["data"]["object"]

        user_id = session["metadata"]["user_id"]
        amount = float(session["metadata"]["amount"])
        session_id = session["id"]

        profile = supabase_admin.table("profiles").select("balance").eq("id", user_id).single().execute()
        old_balance = float(profile.data["balance"])
        new_balance = round(old_balance + amount, 2)

        supabase_admin.table("profiles").update({
            "balance": new_balance
        }).eq("id", user_id).execute()

        supabase_admin.table("payments").insert({
            "user_id": user_id,
            "stripe_session_id": session_id,
            "amount": amount
        }).execute()

    return {"received": True}