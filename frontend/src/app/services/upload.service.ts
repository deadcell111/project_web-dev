import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable, switchMap, map } from 'rxjs';

interface PresignResponse {
  upload_url: string;
  object_key: string;
  expires_in: number;
}

@Injectable({ providedIn: 'root' })
export class UploadService {
  private http = inject(HttpClient);

  /** Uploads `file` directly to MinIO. Returns the stored object_key. */
  upload(file: File, kind: 'item' | 'avatar'): Observable<string> {
    const contentType = file.type;
    return this.http.post<PresignResponse>('/api/uploads/presign/', {
      kind,
      content_type: contentType,
    }).pipe(
      switchMap(res =>
        this.http.put(res.upload_url, file, {
          headers: { 'Content-Type': contentType },
          // Don't send credentials to MinIO — presigned URL is auth
          withCredentials: false,
        }).pipe(map(() => res.object_key)),
      ),
    );
  }
}
