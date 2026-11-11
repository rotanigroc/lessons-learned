# lessons-learned

Blog-style notes from a home lab and a few small tools, written as **old vs new** config changes with the reasons behind them.

**Read it as a blog:** https://rotanigroc.github.io/lessons-learned/ (newest first, timestamped).

## Layout

This repo is a Jekyll site built by GitHub Pages (theme `minima`).

| Path | What |
|---|---|
| `_posts/YYYY-MM-DD-slug.md` | One post each. Front matter `title` and `date` (with time and UTC offset) drive the ordering. |
| `about.md` | About page, including the sanitization rules. |
| `index.md` | Home page: the post list, newest first. |
| `_config.yml` | Site settings (date format, permalinks, plugins). |
| `_layouts/post.html`, `_data/corgis.yml`, `assets/corgis/` | The post corgi shown on the rule under each title. Rules and the pose list: [STYLE_GUIDE.md](STYLE_GUIDE.md). |
| `assets/main.scss`, `_includes/head.html`, `_includes/header.html` | Theme overrides: dark mode (follows the OS, header toggle, saved per browser) with all colours in CSS variables so dark-mode extensions like Dark Reader re-map cleanly. |

Preview locally: `bundle install && bundle exec jekyll serve`, then open http://localhost:4000/lessons-learned/.

## Adding a post

1. Create `_posts/YYYY-MM-DD-short-slug.md` with:
   ```yaml
   ---
   title: "Your Title"
   date: 2026-11-05 14:30:00 -0600
   corgi: magnifier
   ---
   ```
   Do not repeat the title as a `#` heading; the layout prints it. Pick the `corgi` pose that fits the post from [STYLE_GUIDE.md](STYLE_GUIDE.md).
2. Link to other posts with `[text]({% post_url 2026-11-02-slug %})`.
3. Check it against the sanitization table on the [About page](about.md): IPs, hostnames, domains, IDs, account and vault names, and anything secret. If in doubt, leave it out.
