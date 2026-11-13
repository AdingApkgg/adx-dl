import { expect, test } from "bun:test";
import {
	connectMusicLibraryStorage,
	parseLocalPlaylists,
	useMusicLibraryStore,
} from "./music-library-store";

test("local playlists reject malformed storage and deduplicate tracks", () => {
	expect(parseLocalPlaylists({})).toEqual([]);
	expect(
		parseLocalPlaylists([
			{ id: "x", name: " Favorites ", tracks: ["a", "a", null, "b"] },
			{ id: "x", name: "duplicate" },
		]),
	).toEqual([{ id: "x", name: "Favorites", tracks: ["a", "b"] }]);
});
test("create, rename, add/remove tracks and delete are separate from playback", () => {
	useMusicLibraryStore.setState({ playlists: [] });
	const id = useMusicLibraryStore.getState().createPlaylist(" Mix ")!;
	useMusicLibraryStore.getState().addTracks(id, ["a", "b", "a"]);
	useMusicLibraryStore.getState().renamePlaylist(id, "Night");
	useMusicLibraryStore.getState().removeTrack(id, "a");
	expect(useMusicLibraryStore.getState().playlists).toEqual([
		{ id, name: "Night", tracks: ["b"] },
	]);
	useMusicLibraryStore.getState().deletePlaylist(id);
	expect(useMusicLibraryStore.getState().playlists).toEqual([]);
	expect(useMusicLibraryStore.getState().createPlaylist("  ")).toBeNull();
});


test("blocked local storage leaves the playlist usable in memory and reports it", () => {
  useMusicLibraryStore.setState({ playlists: [], storageProblem: false });
  const disconnect = connectMusicLibraryStorage({
    getItem: () => { throw new Error("blocked"); },
    setItem: () => { throw new Error("quota"); },
  });
  expect(() => useMusicLibraryStore.getState().createPlaylist("Temporary")).not.toThrow();
  expect(useMusicLibraryStore.getState().storageProblem).toBe(true);
  expect(useMusicLibraryStore.getState().playlists[0]?.name).toBe("Temporary");
  disconnect();
});
