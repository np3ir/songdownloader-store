import { ByteVector, File as TagFile, Picture, PictureType } from "node-taglib-sharp";

/**
 * Tagging POST-descarga para m4a/MP4 (rama DASH `application/dash+xml`).
 *
 * El FlacStreamTagger de Luna solo taggea la rama FLAC (`application/vnd.tidal.bts`);
 * el stream DASH sale crudo. Esto lo cubre replicando el add_m4a_metadata del
 * fork propio del usuario (tiddl-elvigilante core/metadata/track.py): mismos
 * atoms iTunes (©nam, ©alb, aART, ©ART multi, ©day, cprt, ©cmt, ©gen, trkn, disk,
 * tmpo, covr, ©lyr). Usa node-taglib-sharp (JS puro, sin binarios ni ffmpeg).
 *
 * Best-effort: si un campo falla no aborta el resto (paridad con el fork, que
 * también tolera fallos de escritura de metadata).
 */

type TagMap = Record<string, string | string[] | undefined | null>;

const first = (v: string | string[] | undefined | null): string | undefined => {
	if (v === undefined || v === null) return undefined;
	return Array.isArray(v) ? v[0] : v;
};
const arr = (v: string | string[] | undefined | null): string[] => {
	if (v === undefined || v === null) return [];
	return (Array.isArray(v) ? v : [v]).filter((x) => x !== undefined && x !== null && x !== "");
};
const toInt = (v: string | undefined): number | undefined => {
	if (v === undefined) return undefined;
	const n = parseInt(v, 10);
	return Number.isFinite(n) ? n : undefined;
};

/** Extrae el año de tags.year o del prefijo de tags.date (igual que el fork). */
const yearFrom = (tags: TagMap): number | undefined => {
	const y = toInt(first(tags.year));
	if (y && y >= 1 && y <= 9999) return y;
	const date = first(tags.date);
	if (date && date.length >= 4) {
		const dy = toInt(date.slice(0, 4));
		if (dy && dy >= 1 && dy <= 9999) return dy;
	}
	return undefined;
};

export const tagM4a = async (path: string, tags: TagMap, coverUrl?: string): Promise<void> => {
	// Carátula (fetch fuera del try de taglib para no romper el archivo si falla la red)
	let picture: Picture | undefined;
	if (coverUrl) {
		try {
			const res = await fetch(coverUrl);
			if (res.ok) {
				const buf = Buffer.from(await res.arrayBuffer());
				picture = Picture.fromData(ByteVector.fromByteArray(buf));
				picture.type = PictureType.FrontCover;
				picture.mimeType = "image/jpeg";
			}
		} catch {
			/* sin carátula si falla */
		}
	}

	let file: TagFile | undefined;
	try {
		file = TagFile.createFromPath(path);
		const t = file.tag;

		const setSafe = (fn: () => void) => {
			try {
				fn();
			} catch {
				/* campo individual falló, seguimos */
			}
		};

		const title = first(tags.title);
		if (title) setSafe(() => (t.title = title));

		const performers = arr(tags.artist);
		if (performers.length) setSafe(() => (t.performers = performers));

		const albumArtists = arr(tags.albumArtist);
		if (albumArtists.length) setSafe(() => (t.albumArtists = albumArtists));

		const album = first(tags.album);
		if (album) setSafe(() => (t.album = album));

		const year = yearFrom(tags);
		if (year) setSafe(() => (t.year = year));

		const copyright = first(tags.copyright);
		if (copyright) setSafe(() => (t.copyright = copyright));

		const comment = first(tags.comment);
		if (comment) setSafe(() => (t.comment = comment));

		const genres = arr(tags.genres);
		if (genres.length) setSafe(() => (t.genres = genres));

		const track = toInt(first(tags.trackNumber));
		if (track) setSafe(() => (t.track = track));

		const disc = toInt(first(tags.discNumber));
		if (disc) setSafe(() => (t.disc = disc));

		const bpm = toInt(first(tags.bpm));
		if (bpm) setSafe(() => (t.beatsPerMinute = bpm));

		const lyrics = first(tags.lyrics);
		if (lyrics) setSafe(() => (t.lyrics = lyrics));

		if (picture) setSafe(() => (t.pictures = [picture!]));

		file.save();
	} finally {
		file?.dispose();
	}
};
