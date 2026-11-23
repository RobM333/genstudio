# GenStudio

Create images and videos with the best AI models, in one place.
Built for creators and marketers.

![GenStudio screenshot](docs/screenshot.png)

## What it does today

- **Prompt to image** with 4 models: FLUX Schnell (cheap drafts), FLUX 1.1 Pro Ultra, Google Imagen 4, Recraft V3.
- **Prompt to video** with 3 models: Hailuo 02, Kling 2.5 Turbo Pro, Google Veo 3 Fast.
- Pick the shape (square, wide, tall) and the video length. Each model shows a rough price.
- **Gallery** of everything you made, saved in your browser, with download, reuse prompt, and delete.
- **Demo mode**: with no AI key, the app makes free placeholder results so you can try everything.

Accounts, payments, and a shared cloud gallery come later.

## The three modes

| Settings present | Mode | What happens |
| --- | --- | --- |
| No `FAL_KEY` | Demo | Free placeholder images and animations. |
| `FAL_KEY` but no `APP_PASSWORD` | Needs password | Real generation stays off, so strangers can't spend your credit. |
| `FAL_KEY` and `APP_PASSWORD` | Live | Real AI results. Visitors must type the password first. |

## Putting it online (Vercel)

1. Go to https://vercel.com, sign in with GitHub, click **Add New → Project**, and pick the `genstudio` repository.
2. Leave every setting as it is and click **Deploy**. In about a minute you get a web address. It runs in demo mode.

## Switching on real AI (later)

Your fal.ai key is like a credit card number. **Never paste it into chat, code, or GitHub.**
It goes only into Vercel's secret settings:

1. Create an account at https://fal.ai, add some credit, and create an API key (Dashboard → Keys).
2. In Vercel, open the project → **Settings → Environment Variables**.
3. Add `FAL_KEY` with your key as the value.
4. Add `APP_PASSWORD` with a password of your choice.
5. Go to **Deployments**, click the three dots on the newest one, and choose **Redeploy**.

The badge in the top right of the app turns green and says **Live**.

## For developers

```bash
npm install
cp .env.example .env.local   # optional: add FAL_KEY and APP_PASSWORD
npm run dev                  # http://localhost:3000
```

- `lib/models.ts` is the model catalogue. Update model ids and prices here when fal.ai changes them.
- `app/api/generate` submits jobs to the fal.ai queue; `app/api/status` is polled until the result is ready, so long video jobs don't hit server time limits.
- `proxy.ts` is the password gate. The fal.ai key is only ever used on the server.
