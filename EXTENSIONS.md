# Yomi source extensions

Yomi can load extra sites from **extensions**. This is optional: the built-in sources and any site you add yourself keep working exactly as they do today. Nothing is installed or enabled until you choose it.

## Where files live

Installed extensions are stored in the app data folder:

- Windows: `%APPDATA%\manga-reader\extensions`
- Each extension is one file named `<id>.json` or `<id>.js`.

You can also drop a file there yourself and restart Yomi, or use **Settings → Extensions**.

## JSON format

A JSON extension is a manifest plus a source definition. The source uses the same fields as Yomi's built-in `SourceDef` (list template, series/chapter regexes, optional sitemaps or a series feed). Built-ins and extensions then go through the same catalog, health checks, and auto-repair path.

```json
{
  "manifestVersion": 1,
  "id": "my-source",
  "name": "My Source",
  "version": "1.0.0",
  "lang": "en",
  "description": "Optional short description.",
  "source": {
    "id": "ext-my-source",
    "name": "My Source",
    "baseUrl": "https://example.com/",
    "listTemplate": "https://example.com/manga/page/{n}/",
    "seriesRe": "^https://example\\.com/manga/[^/?#]+/?$",
    "chapterRe": "/manga/[^/]+/chapter-",
    "maxPages": 100,
    "lang": "en"
  }
}
```

Rules:

- `manifestVersion` must be `1`.
- `id` is a short safe name (`a-z`, `0-9`, dot, dash, underscore). It is also the file name.
- `lang` is `en`, `ar`, or `other`.
- `source.baseUrl` and `source.listTemplate` must be `http` or `https` URLs. Put `{n}` in the list template where the page number goes.
- `source.seriesRe` and `source.chapterRe` must be valid regular expressions.
- Optional: `listTemplates`, `sitemaps`, and `api: { "kind": "series-feed", "base": "https://..." }`.
- Use a `source.id` that does not collide with a built-in source (`mangafreak`, `manhwatop`, `baetoon`, …).

A worked example (a port of the built-in MangaFreak definition) is in [`examples/extensions/mangafreak.json`](examples/extensions/mangafreak.json).

## JavaScript format

A `.js` extension is run in a sandbox: [QuickJS](https://bellard.org/quickjs/), a separate JavaScript engine compiled to WebAssembly. Nothing from Yomi is shared with it (no `require`, no `process`, no Node or Electron APIs, no host objects), it has a time limit and a 32 MB memory limit, and the only thing that comes back out is the exported manifest, as plain JSON. `console` is there but prints nothing. **The script never runs in Yomi's own JavaScript engine.** It must assign a manifest object to `module.exports`:

```js
module.exports = {
  manifestVersion: 1,
  id: 'my-source',
  name: 'My Source',
  version: '1.0.0',
  lang: 'en',
  source: {
    /* same fields as the JSON format */
  }
}
```

The sandbox is only used to read that definition. Listing titles, opening a series, and grabbing chapter pages still use Yomi's existing source code path.

## Extension repos

A repo is a URL to an `index.json`:

```json
{
  "name": "My extension repo",
  "extensions": [
    {
      "id": "my-source",
      "name": "My Source",
      "version": "1.0.0",
      "lang": "en",
      "url": "https://example.com/extensions/my-source.json",
      "sha256": "64-character lowercase or uppercase hex SHA-256 of the file body"
    }
  ]
}
```

In **Settings → Extensions**, paste the index URL and press **Add repo**. Yomi lists what the repo offers. Install or update downloads the file, checks the SHA-256, and only then stores it. A file that does not match the hash is rejected.

A sample index (with a placeholder URL) is in [`examples/extensions/index.json`](examples/extensions/index.json). Host the JSON yourself and put the real file URL in the index; keep the published SHA-256 in sync when you change the file (`sha256sum mangafreak.json`).

## Settings

- **Add repo**: register an index URL (nothing is installed automatically).
- Installed extensions can be **enabled** or **disabled**. Disabling hides the site but keeps its saved titles. Removing the extension deletes the file and that site's catalog rows.
- Yomi will not install an extension whose site address is already used by a built-in or a site you added yourself.

Built-in sources are not migrated and do not need an extension to keep working.
