import { Alert } from "@astrodx/ui/components/alert";
import { Button } from "@astrodx/ui/components/button";
import { Card, CardContent } from "@astrodx/ui/components/card";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { useLocation } from "react-router";
import { m } from "@/paraglide/messages.js";
import { ApiError } from "@/shared/api-client";
import { accountErrorRedirect } from "../lib/account-errors";
import { getBrowserApi } from "../lib/browser";
import {
  createUploadController,
  readUploadRecords,
  type RecoveryStorage,
  type UploadController,
  type UploadRecord,
  type UploadSnapshot,
} from "../lib/file-upload";
import { storageErrorMessage } from "../lib/storage-errors";
import { storageApi } from "../queries/storage";

export function AvatarUpload({ userId, image, revision }: { userId: string; image: string | null; revision: number }) {
  const queryClient = useQueryClient();
  const location = useLocation();
  const inputId = useId();
  const recoveryStorage = useRef<RecoveryStorage>({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  });
  const candidateVersion = useRef(0);
  const lifecycle = useRef(0);
  const controller = useRef<UploadController | null>(null);
  const previewUrl = useRef<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [state, setState] = useState<UploadSnapshot>({
    phase: "idle",
    progress: 0,
  });
  const [records, setRecords] = useState<UploadRecord[]>([]);
  const [resume, setResume] = useState<UploadRecord | null>(null);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const operation = useRef<{
    key: string;
    fileId?: string;
    uploadId?: string;
    revision: number;
  } | null>(null);
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["me"] }),
      queryClient.invalidateQueries({ queryKey: ["users", userId] }),
    ]);
  };
  const handleError = (error: unknown) => {
    const target = accountErrorRedirect(error, `${location.pathname}${location.search}`);
    if (target) window.location.assign(target);
    else setFailure(storageErrorMessage(error));
  };
  useEffect(() => {
    lifecycle.current++;
    let storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
    try {
      storage = localStorage;
    } catch {
      storage = {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {},
      };
    }
    recoveryStorage.current = storage;
    setRecords(readUploadRecords(storage, userId));
    const upload = createUploadController({
      api: storageApi(getBrowserApi()),
      userId,
      storage,
      onState: (next) => {
        setState(next);
        setRecords(readUploadRecords(storage, userId));
      },
    });
    controller.current = upload;
    return () => {
      lifecycle.current++;
      upload.dispose();
      controller.current = null;
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
      previewUrl.current = null;
    };
  }, [userId]);
  const busy = ["hashing", "uploading", "processing"].includes(state.phase);
  async function choose(file: File) {
    setFailure(null);
    if (
      file.size < 1 ||
      file.size > 8_388_608 ||
      !["image/jpeg", "image/png", "image/webp", "image/avif"].includes(file.type)
    ) {
      handleError(new ApiError(400, "TYPE_NOT_ALLOWED", "Invalid image"));
      return;
    }
    operation.current = null;
    candidateVersion.current++;
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = URL.createObjectURL(file);
    setPreview(previewUrl.current);
    const record = resume;
    setResume(null);
    if (record) await controller.current?.resume(file, record);
    else await controller.current?.start(file);
  }
  async function discard() {
    const candidate = state;
    const uploadController = controller.current;
    const version = candidateVersion.current;
    const owner = lifecycle.current;
    setFailure(null);
    setPending(true);
    try {
      if (candidate.file) {
        await storageApi(getBrowserApi()).deleteFile(candidate.file.id);
        if (candidate.uploadId) uploadController?.forget(candidate.uploadId);
      } else await uploadController?.cancel();
      if (owner !== lifecycle.current) return;
      setRecords(readUploadRecords(recoveryStorage.current, userId));
      if (version === candidateVersion.current) {
        if (candidate.file) setState({ phase: "idle", progress: 0 });
        if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
        previewUrl.current = null;
        setPreview(null);
      }
    } catch (error) {
      if (owner === lifecycle.current) handleError(error);
    } finally {
      if (owner === lifecycle.current) setPending(false);
    }
  }
  async function save(remove = false) {
    if (!remove && !state.file) return;
    const fileId = remove ? undefined : state.file!.id;
    // Retain the same key/body after an ambiguous network failure, including another click.
    if (!operation.current || operation.current.fileId !== fileId)
      operation.current = {
        key: crypto.randomUUID(),
        fileId,
        uploadId: state.uploadId,
        revision,
      };
    const op = operation.current;
    const uploadController = controller.current;
    const version = candidateVersion.current;
    const owner = lifecycle.current;
    setPending(true);
    setFailure(null);
    try {
      const api = storageApi(getBrowserApi());
      if (remove) await api.removeAvatar({ expectedRevision: op.revision }, op.key);
      else await api.saveAvatar({ fileId: op.fileId!, expectedRevision: op.revision }, op.key);
      await refresh(); // A replayed success DTO is historical; read current state from the server.
      if (owner !== lifecycle.current) return;
      if (operation.current === op) operation.current = null;
      if (!remove && op.uploadId) uploadController?.forget(op.uploadId);
      setRecords(readUploadRecords(recoveryStorage.current, userId));
      if (!remove && version === candidateVersion.current) {
        setState({ phase: "idle", progress: 0 });
        setPreview(null);
        if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
        previewUrl.current = null;
      }
    } catch (error) {
      if (owner !== lifecycle.current) return;
      if (error instanceof ApiError && error.code === "AVATAR_CHANGED") {
        if (operation.current === op) operation.current = null;
        await refresh();
      }
      handleError(error);
    } finally {
      if (owner === lifecycle.current) setPending(false);
    }
  }
  const status =
    state.phase === "hashing"
      ? m.avatar_hashing()
      : state.phase === "uploading"
        ? m.avatar_uploading()
        : state.phase === "processing"
          ? m.avatar_processing()
          : state.phase === "ready"
            ? m.avatar_ready()
            : null;
  return (
    <section aria-label={m.avatar_title()}>
      <Card>
        <CardContent className="space-y-4">
          <h2 className="font-semibold">{m.avatar_title()}</h2>
          <p className="text-sm text-muted-foreground">{m.avatar_hint()}</p>
          {preview && state.phase !== "error" ? (
            <img
              src={state.file?.previewUrl ?? preview}
              alt={m.avatar_preview()}
              width={128}
              height={128}
              className="rounded-full object-cover"
            />
          ) : null}
          <div className="space-y-2">
            <label htmlFor={inputId} className="text-sm font-medium">
              {resume ? m.avatar_resume({ name: resume.name }) : m.avatar_choose()}
            </label>
            <input
              id={inputId}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif"
              disabled={busy || pending}
              className="block w-full text-sm file:mr-3 file:rounded-md file:border file:px-3 file:py-2"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void choose(file);
              }}
            />
          </div>
          {records.length && !busy ? (
            <div className="flex flex-wrap gap-2">
              {records.map((record) => (
                <Button key={record.uploadId} type="button" variant="outline" onClick={() => setResume(record)}>
                  {m.avatar_resume({ name: record.name })}
                </Button>
              ))}
            </div>
          ) : null}
          {status ? (
            <p role="status" className="text-sm">
              {status}
            </p>
          ) : null}
          {state.phase === "hashing" || state.phase === "uploading" ? (
            <progress aria-label={status ?? m.avatar_uploading()} value={state.progress} max={1} className="w-full" />
          ) : null}
          {failure || state.error ? (
            <Alert role="alert" variant="destructive">
              {failure ?? storageErrorMessage(state.error)}
            </Alert>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {state.phase === "ready" ? (
              <Button type="button" disabled={pending} onClick={() => void save()}>
                {m.avatar_save()}
              </Button>
            ) : null}
            {busy || preview ? (
              <Button type="button" variant="outline" disabled={pending} onClick={() => void discard()}>
                {m.avatar_cancel()}
              </Button>
            ) : null}
            {image ? (
              <Button type="button" variant="outline" disabled={pending || busy} onClick={() => void save(true)}>
                {m.avatar_remove()}
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
