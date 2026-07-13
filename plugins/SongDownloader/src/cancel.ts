/*
 *  ┌──────────────────────────────────────────────────────────────┐
 *  │   Song Downloader (ElVigilante) — Luna Plugin Store          │
 *  └──────────────────────────────────────────────────────────────┘
 *  https://github.com/np3ir/songdownloader-store
 *  © ElVigilante · AGPL-3.0 · fork of Inrixia/luna-plugins (SongDownloader)
 */

/**
 * Estado de descarga COMPARTIDO por todos los flujos (colección y artista) para
 * poder cancelar cualquier descarga en curso. `active` = hay una corriendo;
 * `cancel` = se pidió detenerla. Los loops lo consultan entre cada track/álbum.
 * Objeto mutable compartido (sin React) para que el botón del menú y el botón
 * de Settings escriban el mismo flag.
 */
export const downloadState = {
	active: false,
	cancel: false,
};

/** Pide detener la descarga en curso (usado por el botón "Stop" de Settings y
 * por el re-click del botón del menú). */
export const requestStop = () => {
	if (downloadState.active) downloadState.cancel = true;
};
