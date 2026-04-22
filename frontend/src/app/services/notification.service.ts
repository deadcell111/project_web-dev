import { HttpClient } from '@angular/common/http';
import { inject, Injectable, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BehaviorSubject, EMPTY, Subject, fromEvent, merge, of, timer } from 'rxjs';
import { filter, startWith, switchMap, tap, catchError } from 'rxjs';

import { AppNotification, NotificationListResponse } from '../interfaces/notification.interface';
import { AuthService } from './auth.service';

const POLL_INTERVAL_MS = 30_000;

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  private listSubject = new BehaviorSubject<AppNotification[]>([]);
  private unreadSubject = new BehaviorSubject<number>(0);

  list$ = this.listSubject.asObservable();
  unreadCount$ = this.unreadSubject.asObservable();

  private kick$ = new Subject<void>();

  constructor() {
    const visibility$ = fromEvent(document, 'visibilitychange').pipe(
      startWith(null),
      filter(() => document.visibilityState === 'visible'),
    );

    // Tick when tab becomes visible AND user is logged in, then every POLL_INTERVAL_MS.
    this.auth.isLoggedIn$.pipe(
      switchMap(loggedIn => {
        if (!loggedIn) {
          this.listSubject.next([]);
          this.unreadSubject.next(0);
          return EMPTY;
        }
        return merge(visibility$, this.kick$).pipe(
          switchMap(() => timer(0, POLL_INTERVAL_MS)),
          filter(() => document.visibilityState === 'visible'),
          switchMap(() => this.fetch()),
        );
      }),
      takeUntilDestroyed(),
    ).subscribe();
  }

  private fetch() {
    return this.http.get<NotificationListResponse>('/api/notifications/?limit=20').pipe(
      tap(res => {
        this.listSubject.next(res.results);
        this.unreadSubject.next(res.unread_count);
      }),
      catchError(() => of(null)),
    );
  }

  refresh() {
    this.kick$.next();
  }

  markRead(id: number) {
    return this.http.patch<AppNotification>(`/api/notifications/${id}/read/`, {}).pipe(
      tap(() => this.refresh()),
    );
  }

  markAllRead() {
    return this.http.post<{ unread_count: number }>('/api/notifications/read-all/', {}).pipe(
      tap(() => this.refresh()),
    );
  }
}
