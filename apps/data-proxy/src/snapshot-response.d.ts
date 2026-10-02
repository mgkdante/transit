export interface R2ObjectBinding {
  readonly body?: BodyInit | null;
  readonly httpEtag: string;
  readonly uploaded?: Date;
  readonly size?: number;
  readonly range?: { readonly offset?: number; readonly length?: number };
  writeHttpMetadata(headers: Headers): void;
}

export interface R2BucketBinding {
  get(
    key: string,
    options?: { readonly onlyIf?: Headers; readonly range?: Headers },
  ): Promise<R2ObjectBinding | null>;
  head?(key: string): Promise<R2ObjectBinding | null>;
}

export function serveSnapshot(
  request: Request,
  bucket: R2BucketBinding,
  key: string,
): Promise<Response | null>;
