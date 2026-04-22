import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, tap, map, catchError, of } from 'rxjs';
import { User } from '../interfaces/user.interface';

const API = '/api/auth';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private userSubject = new BehaviorSubject<User | null>(null);

  currentUser$ = this.userSubject.asObservable();
  isLoggedIn$ = this.currentUser$.pipe(map(u => !!u));
  isAdmin$ = this.currentUser$.pipe(map(u => !!u?.is_staff));

  loadUser() {
    this.http.get<User>(`${API}/me/`).pipe(
      catchError(() => of(null))
    ).subscribe(user => this.userSubject.next(user));
  }

  login(username: string, password: string): Observable<{ user: User }> {
    return this.http.post<{ user: User }>(`${API}/login/`, { username, password }).pipe(
      tap(res => this.userSubject.next(res.user))
    );
  }

  register(data: {
    username: string;
    email: string;
    password: string;
    first_name?: string;
    last_name?: string;
    telegram?: string;
  }): Observable<{ user: User }> {
    return this.http.post<{ user: User }>(`${API}/register/`, data).pipe(
      tap(res => this.userSubject.next(res.user))
    );
  }

  logout(): Observable<void> {
    return this.http.post<void>(`${API}/logout/`, {}).pipe(
      tap(() => this.userSubject.next(null))
    );
  }

  getMe(): Observable<User> {
    return this.http.get<User>(`${API}/me/`).pipe(
      tap(user => this.userSubject.next(user))
    );
  }

  updateProfile(data: Partial<User>): Observable<User> {
    return this.http.patch<User>(`${API}/me/`, data).pipe(
      tap(user => this.userSubject.next(user))
    );
  }

  get currentUser(): User | null {
    return this.userSubject.value;
  }

  clearUser() {
    this.userSubject.next(null);
  }
}
