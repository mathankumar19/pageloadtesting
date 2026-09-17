import { readFile } from 'node:fs/promises';

/**
 * Load and expand sites.json.
 *
 * Accepts two shapes:
 *
 *   Legacy (array of concrete entries — one per language):
 *     [
 *       { "name": "max", "language": "en", "page": "home", "url": "https://.../en" },
 *       { "name": "max", "language": "ar", "page": "home", "url": "https://.../ar" }
 *     ]
 *
 *   Compact (top-level `languages`/`territories` + `sites` with `{lang}`/`{territory}` placeholders):
 *     {
 *       "languages":    ["en", "ar"],
 *       "territories":  ["ae", "sa"],
 *       "sites": [
 *         { "name": "max", "page": "home", "url": "https://.../{territory}/{lang}" }
 *       ]
 *     }
 *
 * Per-entry overrides in the compact shape:
 *   - `languages` / `territories`: arrays on the entry override the top-level defaults.
 *   - If a URL lacks `{lang}` and only one language applies, the URL is used as-is.
 *   - Same for `{territory}` — omit the placeholder if only one territory applies to the entry.
 *
 * Returns a flat array of concrete audit entries: `{ name, territory, language, page, url }`.
 * `territory` is `null` on entries that do not opt in to the territory axis.
 */
export async function loadSites(sitesJsonPath) {
  const raw = await readFile(sitesJsonPath, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`sites.json is not valid JSON: ${e.message}`);
  }

  let sitesData;
  let defaultLanguages = null;
  let defaultTerritories = null;
  if (Array.isArray(parsed)) {
    sitesData = parsed;
  } else if (parsed && typeof parsed === 'object' && Array.isArray(parsed.sites)) {
    sitesData = parsed.sites;
    if (parsed.languages !== undefined) {
      if (!Array.isArray(parsed.languages) || parsed.languages.length === 0) {
        throw new Error('sites.json top-level `languages` must be a non-empty array');
      }
      defaultLanguages = parsed.languages;
    }
    if (parsed.territories !== undefined) {
      if (!Array.isArray(parsed.territories) || parsed.territories.length === 0) {
        throw new Error('sites.json top-level `territories` must be a non-empty array');
      }
      defaultTerritories = parsed.territories;
    }
  } else {
    throw new Error('sites.json must be an array or an object with a `sites` array');
  }

  if (sitesData.length === 0) {
    throw new Error('sites.json contains no entries');
  }

  const expanded = [];
  for (const [i, entry] of sitesData.entries()) {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`sites entry ${i} must be an object`);
    }
    if (!entry.name || !entry.page || !entry.url) {
      throw new Error(`sites entry ${i} is missing name/page/url`);
    }

    let languages;
    if (Array.isArray(entry.languages) && entry.languages.length > 0) {
      languages = entry.languages;
    } else if (entry.language) {
      languages = [entry.language];
    } else if (defaultLanguages) {
      languages = defaultLanguages;
    } else {
      throw new Error(
        `sites entry ${i} (${entry.name}/${entry.page}) has no language — ` +
        `set entry.language, entry.languages, or top-level languages`
      );
    }

    const hasLangPlaceholder = entry.url.includes('{lang}');
    if (!hasLangPlaceholder && languages.length > 1) {
      throw new Error(
        `sites entry ${i} (${entry.name}/${entry.page}) has multiple languages ` +
        `(${languages.join(', ')}) but URL has no {lang} placeholder`
      );
    }

    let territories;
    if (Array.isArray(entry.territories) && entry.territories.length > 0) {
      territories = entry.territories;
    } else if (entry.territory) {
      territories = [entry.territory];
    } else if (defaultTerritories) {
      territories = defaultTerritories;
    } else {
      territories = [null];
    }

    const hasTerritoryPlaceholder = entry.url.includes('{territory}');
    if (!hasTerritoryPlaceholder && territories.length > 1) {
      throw new Error(
        `sites entry ${i} (${entry.name}/${entry.page}) has multiple territories ` +
        `(${territories.join(', ')}) but URL has no {territory} placeholder`
      );
    }
    if (hasTerritoryPlaceholder && territories.some((t) => t == null)) {
      throw new Error(
        `sites entry ${i} (${entry.name}/${entry.page}) has {territory} placeholder ` +
        `but no territories were declared (set entry.territories or top-level territories)`
      );
    }

    for (const territory of territories) {
      for (const language of languages) {
        let url = entry.url;
        if (hasLangPlaceholder) url = url.replaceAll('{lang}', language);
        if (hasTerritoryPlaceholder) url = url.replaceAll('{territory}', territory);
        expanded.push({
          name: entry.name,
          territory: territory ?? null,
          language,
          page: entry.page,
          url,
        });
      }
    }
  }

  return expanded;
}
