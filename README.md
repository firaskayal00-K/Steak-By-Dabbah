# Steak by Dabbah — Menu Admin Panel

Admin panel for the menu at https://www.steakbydabbah.com. It holds the full menu
(8 categories, 52 dishes), the restaurant details and every website text, in
Arabic, Hebrew and English. All of it was taken from the live site.

No installs needed: it runs on the Python 3 that ships with macOS.

## Start it

- **Mac:** double-click `Start Admin.command`. The admin panel opens in your browser.
- **Terminal:**

  ```bash
  python3 server.py --port 8080
  ```

  Then open http://127.0.0.1:8080/admin/

On first open you'll be asked to create the admin password (at least 8 characters).

| Address | What it is |
|---|---|
| `/admin/` | Admin panel (password protected) |
| `/menu/` | Menu preview in the site's style, showing saved data |
| `/api/menu` | Public JSON the website can read (hidden dishes, and categories with no visible dishes, removed) |

## What you can manage

- **Menu:** add, edit, duplicate, delete and hide/show dishes and categories.
  Reorder by drag-and-drop or with the up/down arrows. Move dishes between
  categories. Set names and descriptions in all 3 languages, price, badge
  (Signature / Most loved / For sharing) and category icon. Search works across
  all languages.
- **Restaurant info:** phone, WhatsApp, Instagram, Facebook, Google Maps,
  reviews link, rating, review count, currency.
- **Website texts:** all 35 labels on the site (tagline, opening hours, buttons,
  badges, search texts…) in AR / HE / EN.
- **Live preview:** a phone-sized preview of your edits before you save.
- **Backups:** every save keeps a backup of the previous version (the last 60),
  and you can restore any of them in one click. You can export and import JSON files.
- **Safety:** nothing goes live until you press **Save changes**. Undo/redo
  (Ctrl/Cmd+Z), Ctrl/Cmd+S to save. You get a warning before leaving with
  unsaved edits, and unsaved edits are recovered after a crash or closed tab.
  If someone else saved from another device, you'll be warned before overwriting.
- **Validation:** before saving, the panel checks that every name exists in all 3
  languages, prices are valid, IDs are unique, links start with https:// and the
  `{n}` placeholders are kept. It won't save until everything is correct.
- The panel's own interface can be switched between English, العربية and עברית.

## Files

```
server.py               the server (Python standard library only)
public/                 admin panel, preview page and shared code
data/original-menu.json the starting menu (tracked in Git)
data/menu.json          the live menu, created from the original on first run (NOT in Git)
data/auth.json          hashed admin password, created on first visit (NOT in Git)
data/backups/           automatic backups (NOT in Git)
Procfile, requirements.txt, .python-version   let hosting services start the app
```

Live data stays out of Git on purpose. Code updates (`git pull`) then never clash
with the menu edits the restaurant makes, and the password is never uploaded.

To reset the password, stop the server and delete `data/auth.json`.
The next visit will ask for a new one.

## Working with Git

Save a version after each finished change:

```bash
git add -A
git commit -m "Describe what you changed"
git push
```

`git status` shows what changed, and `git log --oneline` lists saved versions.
Share the project by inviting people to the private GitHub repository
(Settings → Collaborators) instead of sending zip files.

## Connecting the live website

The current site (Next.js) has the menu hardcoded in its code. To make it use
this panel, the site's developer needs to change it to load
`https://<admin-host>/api/menu` instead of the hardcoded array. The JSON has the
same structure the site already uses:

```json
{
  "restaurant": { "phone": "+97249922226", "whatsapp": "https://wa.me/…", "rating": 4.8, "reviewCount": 250, "currency": "₪", … },
  "texts": { "tagline": { "ar": "…", "he": "…", "en": "…" }, … },
  "categories": [
    { "id": "appetizers", "name_ar": "…", "name_en": "…", "name_he": "…", "icon": "appetizer",
      "items": [ { "id": "beef-carpaccio", "name_ar": "…", "name_en": "…", "name_he": "…", "price": 69, "tag": "signature" } ] }
  ]
}
```

## Putting it online

The server saves files, so it needs a host with a **persistent disk**. Vercel's
serverless hosting can't do that.

**Option A: Railway or Render (easiest, about $5–7/month)**
1. Connect your GitHub account and pick this repository. The `Procfile` tells the
   host how to start it: `python3 server.py --host 0.0.0.0 --port $PORT --trust-proxy`.
2. Add a persistent disk/volume (e.g. mounted at `/data`), and set the environment
   variable `SBD_DATA_DIR=/data`, so menu edits, backups and the password survive redeploys.
3. Open the URL the host gives you and create the admin password **right away**.
   The first visitor gets to set it. To avoid that race, set the environment variable
   `ADMIN_PASSWORD` before the first start.
4. Every `git push` to GitHub redeploys automatically.

**Option B: a small VPS (Hetzner / DigitalOcean, about $5/month)**
Clone the repository, run the server as a service, and put Caddy in front for
automatic HTTPS. Then start the server with `--trust-proxy`.

**Domain**
Buy a domain (Namecheap, Cloudflare, GoDaddy…), or add a subdomain such as
`admin.steakbydabbah.com` if the restaurant already owns its domain. Then add the
DNS record your host asks for (usually a `CNAME` for Railway/Render, or an `A`
record pointing to the VPS IP). The host issues the HTTPS certificate.

Always use HTTPS in production so the password isn't sent in plain text.
`--trust-proxy` should only be used behind such a proxy/host. It makes the login
limit count each visitor separately and marks the login cookie `Secure`.

Another option without hosting: use **Backups & export → Website data (.json)**
and give that file to the website developer.
