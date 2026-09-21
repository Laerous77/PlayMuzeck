<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/d25192d3-026f-4bea-8d4b-9f871e96ab4e

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

Developer console: open `http://localhost:3000/admin`  
Default password: `PlayMuzeck-admin` (set `ADMIN_PASSWORD` in `.env`)
Database: `data/PlayMuzeck.sqlite` — uploaded audio: `data/uploads`
