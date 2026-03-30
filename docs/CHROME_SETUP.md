# Chrome setup (Phase A — `docs/ROADMAP.md`)

Automata drives **Google Chrome** via Playwright. You wanted **one real profile** with **full access to your data** — that means pointing `CHROME_USER_DATA_DIR` at Chrome’s **User Data** folder (or attaching with CDP to Chrome already using it).

**Precedence:** `CHROME_CDP_URL` → else `CHROME_USER_DATA_DIR` → else ephemeral launch (no saved logins).

---

## Your main Chrome profile (recommended for you)

Chrome stores everything under **User Data** on Windows:

`%LOCALAPPDATA%\Google\Chrome\User Data`

Inside it, the default signed-in surface is usually folder **`Default`**. Other profiles appear as **`Profile 1`**, **`Profile 2`**, etc.

1. **Quit Chrome completely** (tray included). Chrome locks this directory while open.
2. `.env`:

```env
CHROME_USER_DATA_DIR=C:\Users\<You>\AppData\Local\Google\Chrome\User Data
CHROME_PROFILE_DIRECTORY=Default
CHROME_CHANNEL=chrome
HEADLESS=false
```

Use `Profile 1` (etc.) instead of `Default` if that’s the profile you use daily.

**Risk (you accepted this):** The LLM proposes actions on **any** allowed site. With your real profile, that’s the same cookies, saved passwords, and extensions as your daily browser. Keep `allowedDomains` tight and treat runs as **high trust** in what you point the agent at.

---

## Attach to Chrome and leave it open (CDP)

You asked: **yes — on exit, Playwright disconnects; Chrome can stay running.**

1. Quit Chrome, then start it with debugging + **your** user data (example uses your real User Data + Default):

```bat
"C:\Program Files\Google\Chrome\Application\chrome.exe" ^
  --remote-debugging-port=9222 ^
  --user-data-dir="%LOCALAPPDATA%\Google\Chrome\User Data" ^
  --profile-directory=Default
```

2. `.env`:

```env
CHROME_CDP_URL=http://127.0.0.1:9222
```

3. Run automata. When the script ends, **`browser.close()` only disconnects** — it does **not** close Chrome.

**Security:** Do not expose port `9222` beyond localhost.

---

## Ephemeral Chrome (no profile — dev only)

No `CHROME_USER_DATA_DIR` / no `CHROME_CDP_URL`: Playwright starts Chrome with a **throwaway** profile. Fine for `example.com` demos; **no** your logins.

---

## Install

```bash
npm install
npm run install:chrome
```

If Playwright says Chrome is already installed, that’s normal. Use `npx playwright install --force chrome` only if you need a reinstall.

---

## Troubleshooting

| Issue | What to do |
|--------|------------|
| Profile locked | Close **all** Chrome windows; check Task Manager for `chrome.exe`. |
| Wrong profile | Set `CHROME_PROFILE_DIRECTORY` to `Default` vs `Profile 1` to match what you see in `chrome://version`. |
| Launch fails | Run `npm run install:chrome`; install [Google Chrome](https://www.google.com/chrome/). |
| CDP: no context | Wrong URL or Chrome started without `--remote-debugging-port`. |
