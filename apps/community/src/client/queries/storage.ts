import { queryOptions } from "@tanstack/react-query";
import { type ApiClient, ApiError, expectOk, okJson } from "@/shared/api-client";
import type {
  AvatarDto,
  FileDto,
  InitUploadInput,
  RemoveAvatarInput,
  SaveAvatarInput,
  UploadDto,
} from "@/shared/storage";

export type StorageApi = {
  init(input: InitUploadInput, key: string, signal: AbortSignal): Promise<UploadDto>;
  upload(id: string, signal: AbortSignal): Promise<UploadDto>;
  part(id: string, index: number, body: Blob, hash: string, signal: AbortSignal): Promise<void>;
  complete(id: string, signal: AbortSignal): Promise<UploadDto>;
  cancel(id: string): Promise<void>;
  file(id: string, signal: AbortSignal): Promise<FileDto>;
  deleteFile(id: string): Promise<void>;
  saveAvatar(input: SaveAvatarInput, key: string): Promise<AvatarDto>;
  removeAvatar(input: RemoveAvatarInput, key: string): Promise<AvatarDto>;
};

/** Replay only ambiguous responses, keeping the original operation key and body. */
export async function replayRequest<T>(request: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  try {
    return await request();
  } catch (error) {
    if (signal?.aborted || (error instanceof ApiError && error.status < 500)) throw error;
    return request();
  }
}

// These routes parse JSON manually; hc's init seam carries bodies without changing server DTOs.
export function storageApi(api: ApiClient): StorageApi {
  const routes = api.api.v1;
  const json = (body?: unknown, key?: string, signal?: AbortSignal) => ({
    init: {
      headers: {
        "content-type": "application/json",
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal,
    },
  });
  const uploads = routes.uploads[":id"];
  return {
    init: (input, key, signal) =>
      replayRequest(async () => okJson(await routes.uploads.$post(undefined, json(input, key, signal))), signal),
    upload: async (id, signal) => okJson(await uploads.$get({ param: { id } }, { init: { signal } })),
    part: async (id, index, body, hash, signal) => {
      await replayRequest(
        async () =>
          expectOk(
            await uploads.parts[":index"].$put(
              { param: { id, index: String(index) } },
              {
                init: {
                  body,
                  signal,
                  headers: {
                    "content-type": "application/octet-stream",
                    "X-Part-Sha256": hash,
                  },
                },
              },
            ),
          ),
        signal,
      );
    },
    complete: (id, signal) =>
      replayRequest(
        async () => okJson(await uploads.complete.$post({ param: { id } }, json(undefined, undefined, signal))),
        signal,
      ),
    cancel: async (id) => {
      await replayRequest(async () => expectOk(await uploads.$delete({ param: { id } }, json())));
    },
    file: async (id, signal) => okJson(await routes.files[":id"].$get({ param: { id } }, { init: { signal } })),
    deleteFile: async (id) => {
      await replayRequest(async () => expectOk(await routes.files[":id"].$delete({ param: { id } }, json())));
    },
    saveAvatar: (input, key) =>
      replayRequest(async () => okJson(await routes.me.avatar.$put(undefined, json(input, key)))),
    removeAvatar: (input, key) =>
      replayRequest(async () => okJson(await routes.me.avatar.$delete(undefined, json(input, key)))),
  };
}
export const uploadQuery = (api: StorageApi, id: string) =>
  queryOptions({
    queryKey: ["me", "uploads", id] as const,
    queryFn: ({ signal }) => api.upload(id, signal),
  });
export const fileQuery = (api: StorageApi, id: string) =>
  queryOptions({
    queryKey: ["me", "files", id] as const,
    queryFn: ({ signal }) => api.file(id, signal),
  });
