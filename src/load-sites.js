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
 *   Compact (top-level `languages` + `sites` with `{lang}` placeholder in URL):
 *     {
 *       "languages": ["en", "ar"],
 *       "sites": [
 *         { "name": "max", "page": "home", "url": "https://.../{lang}" }
 *       ]
 *     }
 *
 * Per-entry overrides in the compact shape:
 *   - `languages`: array on the entry overrides the top-level default.
 *   - If URL has no `{lang}` placeholder and only one language applies, the URL is used as-is.
 *
 * Returns a flat array of concrete audit entries: `{ name, language, page, url }`.
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

    const hasPlaceholder = entry.url.includes('{lang}');
    if (!hasPlaceholder && languages.length > 1) {
      throw new Error(
        `sites entry ${i} (${entry.name}/${entry.page}) has multiple languages ` +
        `(${languages.join(', ')}) but URL has no {lang} placeholder`
      );
    }

    for (const language of languages) {
      expanded.push({
        name: entry.name,
        language,
        page: entry.page,
        url: hasPlaceholder ? entry.url.replaceAll('{lang}', language) : entry.url,
      });
    }
  }

  return expanded;
}
