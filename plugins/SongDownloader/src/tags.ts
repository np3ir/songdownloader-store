/*
 *  ┌──────────────────────────────────────────────────────────────┐
 *  │   Song Downloader (ElVigilante) — Luna Plugin Store          │
 *  └──────────────────────────────────────────────────────────────┘
 *  https://github.com/np3ir/songdownloader-store
 *  © ElVigilante · AGPL-3.0 · fork of Inrixia/luna-plugins (SongDownloader)
 */
/**
 * Convenciones de tags/nombres PROPIAS del usuario, portadas de su fork
 * `tiddl-elvigilante` (mods hechos con AI — NO existen en el tiddl upstream),
 * para que SongDownloader produzca archivos idénticos a los de ese fork:
 *   - Sanitización FULLWIDTH (reemplaza caracteres prohibidos por sus gemelos
 *     de ancho completo en vez de borrarlos)
 *   - Orden de artistas: MAIN ordenados + FEATURED ordenados
 *   - Separador de artistas configurable (default " / ")
 *   - Nombre de archivo con artistas capados a N + " & others"
 *   - Título limpiado de fragmentos "feat." + sufijo de versión
 *
 * Las referencias a rutas (core/utils/strings.py, core/metadata/track.py) apuntan
 * al fork propio del usuario en C:\!z\home\tiddl-elvigilante-main, no a upstream.
 * Nota: es un subconjunto pragmático de la sanitización del fork. Se porta la
 * parte que define cómo se VEN los nombres (fullwidth + limpieza), no el blindaje
 * anti-zalgo/translit que el fork aplica para casos extremos.
 */

// Mapa fullwidth del fork del usuario (tiddl-elvigilante core/utils/strings.py)
const CHAR_TO_FULL_WIDTH: Record<string, string> = {
	"<": "＜", // U+FF1C
	">": "＞", // U+FF1E
	":": "：", // U+FF1A
	'"': "＂", // U+FF02
	"/": "／", // U+FF0F
	"\\": "＼", // U+FF3C
	"|": "｜", // U+FF5C
	"?": "？", // U+FF1F
	"*": "＊", // U+FF0A
};

// _RESERVED_NAMES (Windows) — del fork tiddl-elvigilante
const RESERVED_NAMES = new Set<string>([
	"CON",
	"PRN",
	"AUX",
	"NUL",
	...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
	...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`),
]);

/** Quita diacríticos para comparar nombres que Tidal escribe inconsistentemente
 * ('Raúl' vs 'Raül'). Equivale a _fold_accents del fork (NFKD + strip combining). */
export const foldAccents = (s: string): string => s.normalize("NFKD").replace(/\p{M}/gu, "");

/**
 * Sanitiza UN componente de ruta con la convención fullwidth del fork.
 * No toca los separadores de subcarpeta del template (esos se manejan aparte);
 * esta función recibe solo el VALOR de un tag.
 */
export const sanitizeFullwidth = (value: string): string => {
	if (!value) return "";
	let s = value.normalize("NFC");
	// Normaliza guiones Unicode lookalike a "-" (U+2010..U+2015, U+2212) para que
	// TIDAL "Z‐Sides" y "Z-Sides" produzcan el MISMO archivo, igual que tiddl.
	s = s.replace(/[‐-―−]/gu, "-");
	// Quita controles/format/surrogate (el fork elimina categorías Cc/Cf/Cs)
	s = s.replace(/[\p{Cc}\p{Cf}\p{Cs}]/gu, "");
	// Regla principal: caracteres prohibidos -> ancho completo
	for (const [ch, full] of Object.entries(CHAR_TO_FULL_WIDTH)) {
		s = s.split(ch).join(full);
	}
	// Cosmético: colapsa espacios y underscores repetidos
	s = s.replace(/\s+/g, " ").replace(/_+/g, "_");
	// Windows: quita puntos/espacios SOLO al final (preserva ".Flakes")
	s = s.replace(/[. ]+$/g, "");
	if (!s) return "";
	// Guard de nombres reservados
	const base = s.toUpperCase().split(".")[0].trim();
	if (RESERVED_NAMES.has(base)) s = `_${s}`;
	return s;
};

/** Sanitización ASCII básica (fallback cuando useFullwidth=false): reemplaza
 * prohibidos por guiones, estilo sanitize-filename. */
export const sanitizeAscii = (value: string): string => {
	if (!value) return "";
	return value
		.replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
		.replace(/\s+/g, " ")
		.replace(/[. ]+$/g, "");
};

/**
 * Ordena artistas según la convención del fork (core/metadata/track.py
 * add_track_metadata en tiddl-elvigilante): MAIN ordenados alfabéticamente,
 * luego FEATURED ordenados alfabéticamente.
 * Devuelve la lista de nombres completa (para el tag ARTIST multi-valor).
 */
export const orderArtists = (
	artists: { name: string; type?: string }[],
	featuredExtra: string[] = [],
): { all: string[]; main: string[]; featured: string[] } => {
	const clean = (n: string) => n.trim();
	const main = artists
		.filter((a) => a.type !== "FEATURED")
		.map((a) => clean(a.name))
		.filter(Boolean);
	const featured = artists
		.filter((a) => a.type === "FEATURED")
		.map((a) => clean(a.name))
		.filter(Boolean);

	// Fusiona featured extra de /contributors con dedup (enrich_track_artists del fork)
	const known = new Set<string>([...main, ...featured].map((n) => foldAccents(n.toLowerCase())));
	const existingNames = [...main, ...featured];
	for (const raw of featuredExtra) {
		const name = clean(raw);
		if (!name) continue;
		const folded = foldAccents(name.toLowerCase());
		if (known.has(folded)) continue;
		// Salta si el nombre ya está embebido en un nombre compuesto existente
		// (p.ej. "Macaco feat. Niño De Elche, ..." como UNA entrada de artist).
		const wordRe = new RegExp(`\\b${folded.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
		if (existingNames.some((en) => wordRe.test(foldAccents(en.toLowerCase())))) continue;
		featured.push(name);
		existingNames.push(name);
		known.add(folded);
	}

	// Orden por code point (equivale al sorted() por defecto de Python en ASCII)
	main.sort();
	featured.sort();
	return { all: [...main, ...featured], main, featured };
};

/**
 * Carpeta de inicial ("alpha bucket") del artista: primera letra A–Z, o "#"
 * para números/símbolos/otros scripts. Quita diacríticos (É → E, Ñ → N).
 * Equivale a get_alpha_bucket del fork tiddl-elvigilante (usado para el
 * placeholder {artist_initials}).
 */
export const alphaBucket = (name: string): string => {
	const s = (name ?? "").trim();
	if (!s) return "#";
	const first = s[0].toUpperCase().normalize("NFD").replace(/\p{Mn}/gu, "")[0] ?? "";
	return first >= "A" && first <= "Z" ? first : "#";
};

/** Une artistas para el NOMBRE de archivo, colapsando la cola en "& others"
 * pasado `limit` (_join_artists_capped del fork, MAX_ARTISTS_IN_NAME=3). */
export const joinArtistsCapped = (names: string[], separator: string, limit = 3): string => {
	const ns = names.filter(Boolean);
	if (ns.length <= limit) return ns.join(separator);
	return ns.slice(0, limit).join(separator) + " & others";
};

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Palabras clave de colaboración (feat, ft, with, w/, con, y, x, …) — port de
// _KEYWORDS_PATTERN del fork tiddl-elvigilante.
const KW =
	"f(?:ea)?t(?:\\.|uring)?|with|w/|starring|guest(?: vocals:?)?|vocals?(?::| by)|" +
	"prod(?:\\.|uced by)|(?:remix|edit|mix) by|vs\\.?|x|×|pres(?:en)?t(?:s|a|e)?|" +
	"collab(?:oration)?|con|junto a|y|col(?:\\.|aboraci[oó]n)?|invitado|voz(?: de)?|" +
	"producido por|remix de|mit|avec|et";

// _RE_ANTI_FEAT del fork: 3 formas — (paréntesis/corchetes), " - dash", "feat" pelado.
const RE_ANTI_FEAT = new RegExp(
	`(?:\\s*[\\(\\[\\{]\\s*(?:${KW})\\s+([^)\\}\\]]+?)\\s*[\\)\\]\\}])` +
		`|(?:\\s+[-\\u2013]\\s+\\s*(?:${KW})\\s+(.*))` +
		`|(?:\\s+f(?:ea)?t(?:\\.|uring)?\\s+(.*))`,
	"gi",
);

/**
 * Limpia el título quitando los sufijos de colaborador ("(with X)", "(feat. Y)",
 * "- con Z"…) PERO SOLO si ese colaborador ya está en la lista de artistas
 * (`artistNames`), para no duplicarlo en {artist} y en {title} y a la vez no
 * romper títulos legítimos (p.ej. "6 Ft. 7 Ft."). Añade "(version)" si existe.
 * Port fiel de clean_track_title del fork tiddl-elvigilante (con protección is_known).
 */
export const cleanTitle = (title: string, version?: string | null, artistNames: string[] = []): string => {
	const t = version ? `${title} (${version})` : title;

	const metaArtists = artistNames.map((a) => foldAccents(a.trim().toLowerCase())).filter(Boolean);
	const isKnown = (name: string): boolean => {
		const n = foldAccents(name.trim().toLowerCase());
		if (!n) return true; // ignora partes vacías
		if (metaArtists.includes(n)) return true;
		const re = new RegExp(`\\b${escapeRegex(n)}\\b`);
		return metaArtists.some((ma) => re.test(ma)); // word-boundary dentro de un artista
	};

	const cleaned = t.replace(RE_ANTI_FEAT, (full: string, g1?: string, g2?: string, g3?: string) => {
		const content = g1 || g2 || g3;
		if (!content) return full;
		const parts = content
			.split(/\s*(?:,|&|\+| and | y | et | und | con | with )\s*/i)
			.map((p) => p.trim())
			.filter(Boolean);
		const unknown = parts.filter((p) => !isKnown(p));
		if (unknown.length === 0) return ""; // todos conocidos -> quitar el sufijo entero
		if (unknown.length === parts.length) return full; // ninguno conocido -> dejar tal cual
		return full.replace(content, unknown.join(", ")); // parcial -> reconstruir con los desconocidos
	});

	return cleaned.trim();
};
