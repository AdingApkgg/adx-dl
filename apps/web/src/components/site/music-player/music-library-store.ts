import { create } from "zustand";

export type LocalPlaylist = { id: string; name: string; tracks: string[] };
export const MUSIC_LIBRARY_KEY = "astrodx-music-library-v1";
const ids = (value: unknown) =>
	Array.isArray(value)
		? [
				...new Set(
					value.filter(
						(id): id is string =>
							typeof id === "string" && id.length > 0 && id.length < 200,
					),
				),
			].slice(0, 500)
		: [];
export function parseLocalPlaylists(value: unknown): LocalPlaylist[] {
	if (!Array.isArray(value)) return [];
	const seen = new Set<string>();
	return value
		.flatMap((item) => {
			if (
				!item ||
				typeof item !== "object" ||
				typeof item.id !== "string" ||
				!item.id ||
				seen.has(item.id) ||
				typeof item.name !== "string" ||
				!item.name.trim()
			)
				return [];
			seen.add(item.id);
			return [
				{
					id: item.id.slice(0, 200),
					name: item.name.trim().slice(0, 80),
					tracks: ids(item.tracks),
				},
			];
		})
		.slice(0, 50);
}
export const useMusicLibraryStore = create<{
	playlists: LocalPlaylist[];
	storageProblem: boolean;
	createPlaylist: (name: string) => string | null;
	renamePlaylist: (id: string, name: string) => void;
	deletePlaylist: (id: string) => void;
	addTracks: (id: string, tracks: readonly string[]) => void;
	removeTrack: (id: string, track: string) => void;
}>()((set, get) => ({
	playlists: [],
	storageProblem: false,
	createPlaylist: (raw) => {
		const name = raw.trim().slice(0, 80);
		if (!name || get().playlists.length >= 50) return null;
		const id = crypto.randomUUID();
		set((state) => ({
			playlists: [...state.playlists, { id, name, tracks: [] }],
		}));
		return id;
	},
	renamePlaylist: (id, raw) => {
		const name = raw.trim().slice(0, 80);
		if (name)
			set((state) => ({
				playlists: state.playlists.map((p) =>
					p.id === id ? { ...p, name } : p,
				),
			}));
	},
	deletePlaylist: (id) =>
		set((state) => ({ playlists: state.playlists.filter((p) => p.id !== id) })),
	addTracks: (id, tracks) =>
		set((state) => ({
			playlists: state.playlists.map((p) =>
				p.id === id ? { ...p, tracks: ids([...p.tracks, ...tracks]) } : p,
			),
		})),
	removeTrack: (id, track) =>
		set((state) => ({
			playlists: state.playlists.map((p) =>
				p.id === id
					? { ...p, tracks: p.tracks.filter((item) => item !== track) }
					: p,
			),
		})),
}));
let hydrated = false;
export function connectMusicLibraryStorage(
	storage: Pick<Storage, "getItem" | "setItem">,
) {
	if (!hydrated) {
		hydrated = true;
		try {
			useMusicLibraryStore.setState({
				playlists: parseLocalPlaylists(
					JSON.parse(storage.getItem(MUSIC_LIBRARY_KEY) ?? "[]"),
				),
			});
		} catch {
			useMusicLibraryStore.setState({ storageProblem: true });
		}
	}
	return useMusicLibraryStore.subscribe((state, previous) => {
		if (state.playlists === previous.playlists) return;
		try {
			storage.setItem(MUSIC_LIBRARY_KEY, JSON.stringify(state.playlists));
		} catch {
			useMusicLibraryStore.setState({ storageProblem: true });
		}
	});
}
