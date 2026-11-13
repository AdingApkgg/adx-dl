"use client";
import * as React from "react";
import { ArrowDownIcon, ArrowUpIcon, EllipsisIcon } from "lucide-react";
import { Button } from "@astrodx/ui/components/button";
import { CompatibleImage } from "@/components/site/compatible-image";
import { Input } from "@astrodx/ui/components/input";
import {
	DropdownMenu,
	DropdownMenuTrigger,
	DropdownMenuContent,
	DropdownMenuItem,
} from "@astrodx/ui/components/dropdown-menu";
import type { Locale } from "@/lib/i18n";
import type { MusicTrack } from "@/lib/music-playlists";
import { musicTrackArtist, musicTrackTitle } from "./music-player-utils";
import { useMusicPlayerStore } from "./music-player-store";
import {
	connectMusicLibraryStorage,
	useMusicLibraryStore,
} from "./music-library-store";
import { musicLibraryCopy } from "./music-library-copy";

export function MusicLibraryPanel({
	locale,
	onPlay,
}: {
	locale: Locale;
	onPlay: (track: MusicTrack) => void;
}) {
	const c = musicLibraryCopy(locale);
	const player = useMusicPlayerStore();
	const library = useMusicLibraryStore();
	const [tab, setTab] = React.useState<"queue" | "library" | "playlists">(
		"queue",
	);
	const [browse, setBrowse] = React.useState(player.versionId ?? "");
	const [query, setQuery] = React.useState("");
	const [selected, setSelected] = React.useState("");
	const [editing, setEditing] = React.useState<"new" | "rename" | null>(null);
	const [name, setName] = React.useState("");
	const [pending, setPending] = React.useState<"clear" | "delete" | null>(null);
	const [notice, setNotice] = React.useState("");
	React.useEffect(() => {
		try {
			return connectMusicLibraryStorage(window.localStorage);
		} catch {
			useMusicLibraryStore.setState({ storageProblem: true });
		}
	}, []);
	const all = React.useMemo(
		() => Object.values(player.tracksByVersion).flat(),
		[player.tracksByVersion],
	);
	const byId = React.useMemo(() => new Map(all.map((t) => [t.id, t])), [all]);
	const playlist =
		library.playlists.find((p) => p.id === selected) ?? library.playlists[0];
	const source = query.trim() ? all : (player.tracksByVersion[browse] ?? []);
	const filtered = source.filter((t) =>
		`${t.title} ${t.titleEn ?? ""} ${t.artist} ${t.artistEn ?? ""}`
			.toLocaleLowerCase()
			.includes(query.toLocaleLowerCase().trim()),
	);
	const rows =
		tab === "queue"
			? player.queue
			: tab === "playlists"
				? (playlist?.tracks ?? [])
				: filtered.slice(0, 200).map((t) => t.id);
	const enqueue = (ids: readonly string[], next = false) => {
		player.enqueue(ids, next);
		setNotice(c.added);
	};
	const saveName = (event: React.FormEvent) => {
		event.preventDefault();
		if (editing === "new") {
			const id = library.createPlaylist(name);
			if (!id) return;
			setSelected(id);
		} else if (playlist) library.renamePlaylist(playlist.id, name);
		setEditing(null);
		setName("");
	};
	return (
		<div
			data-music-library
			className="flex min-h-0 flex-1 flex-col overflow-hidden"
		>
			<div
				className="grid grid-cols-3 gap-1 border-b border-border p-2"
				role="group"
				aria-label={c.library}
			>
				{(["queue", "library", "playlists"] as const).map((key) => (
					<Button
						key={key}
						size="touch"
						variant={tab === key ? "secondary" : "ghost"}
						aria-pressed={tab === key}
						onClick={() => {
							setTab(key);
							setPending(null);
							setEditing(null);
						}}
					>
						{c[key]}
						{key === "queue" ? ` (${player.queue.length})` : ""}
					</Button>
				))}
			</div>
			<div className="flex max-h-[34dvh] shrink-0 flex-col gap-2 overflow-y-auto overscroll-contain border-b border-border p-3">
				{tab === "library" ? (
					<>
						<select
							aria-label={c.library}
							className="min-h-11 w-full rounded border border-input bg-background px-2 text-sm"
							value={browse}
							onChange={(e) => setBrowse(e.target.value)}
						>
							{Object.entries(player.tracksByVersion).map(([id, tracks]) => (
								<option key={id} value={id}>
									{tracks[0]?.versionName ?? id} · {tracks.length}
								</option>
							))}
						</select>
						<Input
							aria-label={c.search}
							placeholder={c.search}
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							className="min-h-11"
						/>
					</>
				) : null}
				{tab === "playlists" ? (
					<>
						<p className="text-xs text-muted-foreground">{c.local}</p>
						<select
							aria-label={c.choose}
							className="min-h-11 w-full rounded border border-input bg-background px-2 text-sm"
							disabled={!library.playlists.length}
							value={playlist?.id ?? ""}
							onChange={(e) => setSelected(e.target.value)}
						>
							{!library.playlists.length ? (
								<option value="">{c.noList}</option>
							) : (
								library.playlists.map((p) => (
									<option key={p.id} value={p.id}>
										{p.name} ({p.tracks.length})
									</option>
								))
							)}
						</select>
						<div className="flex flex-wrap gap-1">
							<Button
								size="touch"
								variant="outline"
								disabled={library.playlists.length >= 50}
								onClick={() => {
									setEditing("new");
									setName("");
								}}
							>
								{c.create}
							</Button>
							<Button
								size="touch"
								variant="ghost"
								disabled={!playlist}
								onClick={() => {
									setEditing("rename");
									setName(playlist?.name ?? "");
								}}
							>
								{c.rename}
							</Button>
							<Button
								size="touch"
								variant="ghost"
								disabled={!playlist}
								onClick={() => setPending("delete")}
							>
								{c.delete}
							</Button>
							<Button
								size="touch"
								variant="outline"
								disabled={!playlist?.tracks.length}
								onClick={() => enqueue(playlist?.tracks ?? [])}
							>
								{c.append}
							</Button>
						</div>
					</>
				) : null}
				{tab === "queue" ? (
					<div className="flex flex-wrap gap-1">
						<Button
							size="touch"
							variant="ghost"
							disabled={!player.queue.length}
							onClick={() => setPending("clear")}
						>
							{c.clear}
						</Button>
						<Button
							size="touch"
							variant="outline"
							disabled={!player.queue.length || !playlist}
							onClick={() => {
								if (playlist) library.addTracks(playlist.id, player.queue);
								setNotice(c.added);
							}}
						>
							{c.saveQueue}
							{playlist ? ` · ${playlist.name}` : ""}
						</Button>
					</div>
				) : null}
				{editing ? (
					<form className="flex flex-wrap gap-2" onSubmit={saveName}>
						<Input
							autoFocus
							aria-label={c.name}
							maxLength={80}
							value={name}
							onChange={(e) => setName(e.target.value)}
							className="min-h-11"
						/>
						<Button size="touch" type="submit" disabled={!name.trim()}>
							{c.save}
						</Button>
						<Button
							size="touch"
							variant="ghost"
							type="button"
							onClick={() => setEditing(null)}
						>
							{c.cancel}
						</Button>
					</form>
				) : null}
				{pending ? (
					<div
						data-player-confirm
						className="flex flex-wrap items-center gap-2 rounded border border-border p-2"
					>
						<p className="w-full text-sm">
							{pending === "clear" ? c.confirmClear : c.confirmDelete}
						</p>
						<Button
							size="touch"
							onClick={() => {
								if (pending === "clear") player.clearQueue();
								else if (playlist) library.deletePlaylist(playlist.id);
								setPending(null);
							}}
						>
							{pending === "clear" ? c.clear : c.delete}
						</Button>
						<Button
							size="touch"
							variant="ghost"
							onClick={() => setPending(null)}
						>
							{c.cancel}
						</Button>
					</div>
				) : null}
				{library.storageProblem ? (
					<p role="alert" className="text-xs text-destructive">
						{c.storage}
					</p>
				) : null}
				<p className="text-xs text-muted-foreground">{c.limit}</p>
				<span role="status" className="sr-only">
					{notice}
				</span>
			</div>
			<ol
				aria-label={c[tab]}
				className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2"
			>
				{!rows.length ? (
					<li className="px-2 py-6 text-sm text-muted-foreground">
						{tab === "queue" ? c.empty : c.noSongs}
					</li>
				) : null}
				{rows.map((id, index) => {
					const track = byId.get(id);
					const title = track ? musicTrackTitle(track, locale) : c.unavailable;
					return (
						<li
							key={id}
							className="flex min-w-0 items-center gap-1 border-b border-border/50 py-1"
						>
							<button
								type="button"
								disabled={!track}
								aria-current={id === player.trackId ? "true" : undefined}
								onClick={() => {
									if (track) {
										player.enqueue([id]);
										onPlay(track);
									}
								}}
								className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded p-1 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring aria-[current=true]:bg-primary/10"
							>
								{track?.coverUrl ? (
									<CompatibleImage
										sources={{ png: track.coverUrl }}
										alt=""
										loading="lazy"
										className="size-10 shrink-0 rounded object-contain"
									/>
								) : null}
								<span className="min-w-0">
									<span className="block truncate text-sm">{title}</span>
									<span className="block truncate text-xs text-muted-foreground">
										{track ? musicTrackArtist(track, locale) : id}
									</span>
								</span>
							</button>
							{tab === "queue" ? (
								<>
									<Button
										size="icon-touch"
										variant="ghost"
										aria-label={`${c.up}: ${title}`}
										disabled={index === 0}
										onClick={() => player.moveInQueue(id, -1)}
									>
										<ArrowUpIcon />
									</Button>
									<Button
										size="icon-touch"
										variant="ghost"
										aria-label={`${c.down}: ${title}`}
										disabled={index === rows.length - 1}
										onClick={() => player.moveInQueue(id, 1)}
									>
										<ArrowDownIcon />
									</Button>
								</>
							) : null}
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Button
										size="icon-touch"
										variant="ghost"
										aria-label={`${title} · …`}
									>
										<EllipsisIcon />
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent
									align="end"
									className="z-[56] max-h-72 max-w-[calc(100vw-2rem)] overflow-y-auto"
								>
									{track ? (
										<>
											<DropdownMenuItem
												onSelect={() => {
													player.enqueue([id]);
													onPlay(track);
												}}
											>
												{c.play}
											</DropdownMenuItem>
											<DropdownMenuItem onSelect={() => enqueue([id], true)}>
												{c.next}
											</DropdownMenuItem>
											<DropdownMenuItem onSelect={() => enqueue([id])}>
												{c.add}
											</DropdownMenuItem>
										</>
									) : null}
									{tab === "queue" ? (
										<DropdownMenuItem
											onSelect={() => {
												const resume =
													id === player.trackId && player.status === "playing";
												player.removeFromQueue(id);
												const next = byId.get(
													useMusicPlayerStore.getState().trackId ?? "",
												);
												if (resume && next) onPlay(next);
											}}
										>
											{c.remove}
										</DropdownMenuItem>
									) : null}
									{tab === "playlists" && playlist ? (
										<DropdownMenuItem
											onSelect={() => library.removeTrack(playlist.id, id)}
										>
											{c.remove}
										</DropdownMenuItem>
									) : null}
									{library.playlists.map((p) => (
										<DropdownMenuItem
											key={p.id}
											onSelect={() => {
												library.addTracks(p.id, [id]);
												setNotice(c.added);
											}}
										>
											{c.addTo} · {p.name}
										</DropdownMenuItem>
									))}
								</DropdownMenuContent>
							</DropdownMenu>
						</li>
					);
				})}
			</ol>
		</div>
	);
}
