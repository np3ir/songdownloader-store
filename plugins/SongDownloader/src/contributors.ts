import { TidalApi, type redux } from "@luna/lib";

import { trace } from "./index";

type ContributorItem = { name?: string; role?: string };
type ContributorsResponse = { items?: ContributorItem[] };

/**
 * Devuelve los nombres de Featured Artists del endpoint /contributors.
 *
 * Tidal a veces elimina los featured del array artists[] principal pero los
 * mantiene en /contributors. Equivale a get_featured_from_contributors del fork
 * propio del usuario tiddl-elvigilante (role == "Featured Artist").
 *
 * Usa la MISMA sesión autenticada del cliente de escritorio (desktop.tidal.com),
 * así que no añade una superficie de red distinta a la del propio TIDAL.
 */
export const getFeaturedContributors = async (trackId: redux.ItemId): Promise<string[]> => {
	try {
		const url = `https://desktop.tidal.com/v1/tracks/${trackId}/contributors?${TidalApi.queryArgs()}`;
		const resp = await TidalApi.fetch<ContributorsResponse>(url);
		if (resp?.items === undefined) return [];
		return resp.items
			.filter((i) => i.role === "Featured Artist" && !!i.name)
			.map((i) => i.name!.trim())
			.filter(Boolean);
	} catch (err) {
		trace.err.withContext(`getFeaturedContributors(${trackId})`)(err);
		return [];
	}
};
