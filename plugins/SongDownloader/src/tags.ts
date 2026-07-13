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

/**
 * Limpia el título para el tag/nombre: añade "(version)" si existe y elimina
 * los fragmentos "feat." (que ya viven en el tag ARTIST). Equivale a
 * clean_title_for_metadata + sufijo de versión de add_track_metadata (fork).
 */
export const cleanTitle = (title: string, version?: string | null): string => {
	let t = version ? `${title} (${version})` : title;
	t = t.replace(/\s*\(feat\.?[^)]*\)/gi, "");
	t = t.replace(/\s*\[feat\.?[^\]]*\]/gi, "");
	t = t.replace(/\s*-\s*feat\.?.*$/gi, "");
	return t.trim();
};
